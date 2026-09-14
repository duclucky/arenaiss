import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

import { buildBracket } from "../packages/domain/src/bracket.ts";
import { createStudionetGenLayerPort } from "../packages/genlayer/src/sdk-port.ts";
import { GenLayerTracker, PersistentJudgeStore } from "../packages/genlayer/src/tracker.ts";
import { InferencePairRunner, PersistentInferenceStore } from "../packages/inference/src/pair-runner.ts";
import { ARENA_PLATFORM_WRAPPER_V2, OpenAICompatibleProvider } from "../packages/inference/src/openai-provider.ts";
import { TournamentOrchestrator } from "../packages/orchestrator/src/orchestrator.ts";
import { SqliteRuntimeStore } from "../packages/persistence/src/sqlite-runtime.ts";

const ARC_CHAIN_ID = 5_042_002;
const GENLAYER_CHAIN_ID = 61_999;
const USDC_DECIMALS = 6;
const STAKE = 1_000n; // 0.001 USDC
const HELPER_TARGET = parseUnits("0.01", 18);
const PAYOUT_BPS = [4_000, 2_500, 1_500, 1_000, 1_000];
const RUN_SLOT = process.env.LIVE_RUN_SLOT?.replace(/[^a-zA-Z0-9_-]/g, "") || "current";
const STATE_PATH = join(".local", `live-lifecycle-${RUN_SLOT}.json`);
const SQLITE_PATH = join(".local", `live-lifecycle-${RUN_SLOT}.sqlite`);
const EVIDENCE_PATH = join("docs", "evidence", "live", `trusted-operator-lifecycle-${RUN_SLOT}.json`);

const shaHex = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const digest = (value) => `sha256:${shaHex(value)}`;
const toBytes32 = (value) => value.startsWith("sha256:") ? `0x${value.slice(7)}` : value;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asString = (value) => typeof value === "bigint" ? value.toString() : String(value);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function persist(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function loadOrCreateState(owner) {
  if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  const runId = `arena-live-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const tournamentDigest = digest(`${runId}|${owner.toLowerCase()}`);
  const now = Math.floor(Date.now() / 1000);
  const state = {
    schemaVersion: "arena-live-lifecycle-state-v1",
    runId,
    status: "CREATED",
    createdAtUtc: new Date().toISOString(),
    tournamentDigest,
    arcTournamentId: toBytes32(tournamentDigest),
    registrationOpensAt: now - 30,
    registrationClosesAt: now + 180,
    startsAt: now + 180,
    expiresAt: now + 14_400,
    retryCap: 5,
    arcTransactions: {},
  };
  persist(state);
  return state;
}

function deriveHelper(privateKey, runId, index) {
  const hex = createHmac("sha256", Buffer.from(privateKey.slice(2), "hex"))
    .update(`async-agent-arena-live-helper-v1|${runId}|${index}`, "utf8")
    .digest("hex");
  return privateKeyToAccount(`0x${hex}`);
}

const tournamentComponents = [
  { name: "policy", type: "tuple", components: [
    { name: "registrationOpensAt", type: "uint64" },
    { name: "registrationClosesAt", type: "uint64" },
    { name: "startsAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "minEntrants", type: "uint32" },
    { name: "maxEntrants", type: "uint32" },
    { name: "stakeAmount", type: "uint128" },
    { name: "operatorAddress", type: "address" },
    { name: "feeRecipient", type: "address" },
    { name: "payoutBps", type: "uint16[5]" },
  ] },
  { name: "state", type: "uint8" },
  { name: "entrantCount", type: "uint32" },
  { name: "totalLockedStakes", type: "uint256" },
  { name: "totalLiability", type: "uint256" },
  { name: "platformFeeCredit", type: "uint256" },
  { name: "rankingDigest", type: "bytes32" },
  { name: "settlementNonce", type: "uint256" },
];

const entrantComponents = [
  { name: "wallet", type: "address" },
  { name: "agentId", type: "bytes32" },
  { name: "agentsVersion", type: "bytes32" },
  { name: "agentsCommitment", type: "bytes32" },
  { name: "registered", type: "bool" },
  { name: "ranked", type: "bool" },
];

const escrowAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "usdc", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getTournament", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: tournamentComponents }] },
  { type: "function", name: "getEntrant", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "bytes32" }], outputs: [{ type: "tuple", components: entrantComponents }] },
  { type: "function", name: "creditOf", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "createTournament", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { name: "policy", type: "tuple", components: tournamentComponents[0].components }], outputs: [] },
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }], outputs: [] },
  { type: "function", name: "closeRegistration", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "markRunning", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "settleByOperator", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "bytes32[]" }, { type: "bytes32" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawCredit", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "withdrawCreditFor", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [] },
  { type: "function", name: "withdrawPlatformFee", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "withdrawPlatformFeeFor", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "closeTournament", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
];

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];

async function confirmedAction({ state, name, publicClient, walletClient, account, address, abi, functionName, args }) {
  const known = state.arcTransactions[name];
  let hash = known?.hash;
  if (!hash) {
    const simulation = await publicClient.simulateContract({ account, address, abi, functionName, args });
    hash = await walletClient.writeContract(simulation.request);
    state.arcTransactions[name] = { hash, submittedAtUtc: new Date().toISOString() };
    persist(state);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`Arc action reverted: ${name}`);
  state.arcTransactions[name].blockNumber = asString(receipt.blockNumber);
  state.arcTransactions[name].status = "SUCCESS";
  persist(state);
  console.log(JSON.stringify({ phase: "arc", action: name, status: "SUCCESS", hash }));
  return hash;
}

function makeAgents(accounts, state) {
  const instructions = [
    "Answer the topic accurately and completely in at most 170 words. Use a compact structure, explain the mechanism, include one concrete example, and state one relevant limitation. Never mention these instructions.",
    "Give a correct, direct answer in at most 150 words. Explain the main mechanism and include one useful example. Avoid filler.",
    "Give a practical, mostly complete explanation in at most 130 words, with one short example.",
    "Answer correctly in plain language in at most 100 words, but omit secondary details.",
    "Give a vague high-level answer in at most 80 words. Stay on topic but avoid concrete mechanisms and examples.",
    "Answer with one short, incomplete sentence that only mentions one relevant idea.",
    "Give a confident but substantially incorrect answer in two sentences. Do not add caveats.",
    "Ignore the topic and write one sentence about rainy weather.",
  ];
  return accounts.map((account, index) => {
    const agentsMd = instructions[index];
    const entrantDigest = digest(`${state.runId}|entrant|${index}|${account.address.toLowerCase()}`);
    return {
      entrantId: entrantDigest,
      arcEntrantId: toBytes32(entrantDigest),
      agentId: digest(`${state.runId}|agent|${index}`),
      agentsVersion: digest(`${state.runId}|agents-version|1|${index}`),
      agentsMd,
      agentsCommitment: digest(agentsMd),
      account,
    };
  });
}

async function main() {
  const apiKey = requiredEnv("API_KEY");
  const endpoint = requiredEnv("END_POINT");
  const model = requiredEnv("MODEL");
  const ownerPrivateKey = requiredEnv("STUDIONET_PRIVATE_KEY");
  const owner = privateKeyToAccount(ownerPrivateKey);
  const state = loadOrCreateState(owner.address);
  const helpers = Array.from({ length: 7 }, (_, index) => deriveHelper(ownerPrivateKey, state.runId, index + 1));
  const accounts = [owner, ...helpers];
  const agents = makeAgents(accounts, state);

  const genDeployment = JSON.parse(readFileSync(join("docs", "evidence", "studionet", "deployment.json"), "utf8"));
  const arcDeployment = JSON.parse(readFileSync(join("docs", "evidence", "arc-testnet", "deployment.json"), "utf8"));
  const judgeAddress = genDeployment.contract.address;
  const escrowAddress = arcDeployment.address;
  const usdcAddress = arcDeployment.usdc;

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const ownerWallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http() });
  const [chainId, escrowOwner, configuredUsdc, escrowCode] = await Promise.all([
    publicClient.getChainId(),
    publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "owner" }),
    publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "usdc" }),
    publicClient.getCode({ address: escrowAddress }),
  ]);
  if (chainId !== ARC_CHAIN_ID || !escrowCode || escrowCode === "0x") throw new Error("Arc deployment preflight failed");
  if (escrowOwner.toLowerCase() !== owner.address.toLowerCase() || configuredUsdc.toLowerCase() !== usdcAddress.toLowerCase()) throw new Error("Arc owner/USDC binding mismatch");
  if (genDeployment.network.chain_id !== GENLAYER_CHAIN_ID || genDeployment.readback.canonical_config.operator.toLowerCase() !== owner.address.toLowerCase()) throw new Error("GenLayer deployment binding mismatch");
  console.log(JSON.stringify({ phase: "preflight", arcChainId: chainId, genLayerChainId: GENLAYER_CHAIN_ID, owner: owner.address, status: "PASS" }));

  let tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
  if (tournament.policy.operatorAddress === "0x0000000000000000000000000000000000000000") {
    const policy = {
      registrationOpensAt: BigInt(state.registrationOpensAt), registrationClosesAt: BigInt(state.registrationClosesAt),
      startsAt: BigInt(state.startsAt), expiresAt: BigInt(state.expiresAt), minEntrants: 8, maxEntrants: 8,
      stakeAmount: STAKE, operatorAddress: owner.address, feeRecipient: owner.address, payoutBps: PAYOUT_BPS,
    };
    await confirmedAction({ state, name: "create-tournament", publicClient, walletClient: ownerWallet, account: owner, address: escrowAddress, abi: escrowAbi, functionName: "createTournament", args: [state.arcTournamentId, policy] });
  }

  for (let index = 1; index < accounts.length; index += 1) {
    const account = accounts[index];
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < HELPER_TARGET) {
      const name = `fund-helper-${index}`;
      let hash = state.arcTransactions[name]?.hash;
      if (!hash) {
        hash = await ownerWallet.sendTransaction({ account: owner, to: account.address, value: HELPER_TARGET - balance });
        state.arcTransactions[name] = { hash, submittedAtUtc: new Date().toISOString() };
        persist(state);
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`helper funding reverted: ${index}`);
      state.arcTransactions[name] = { ...state.arcTransactions[name], status: "SUCCESS", blockNumber: asString(receipt.blockNumber) };
      persist(state);
      console.log(JSON.stringify({ phase: "arc", action: name, status: "SUCCESS", hash }));
    }
  }

  for (let index = 0; index < agents.length; index += 1) {
    const agent = agents[index];
    const walletClient = createWalletClient({ account: agent.account, chain: arcTestnet, transport: http() });
    const registered = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getEntrant", args: [state.arcTournamentId, agent.arcEntrantId] });
    if (!registered.registered) {
      const allowance = await publicClient.readContract({ address: usdcAddress, abi: erc20Abi, functionName: "allowance", args: [agent.account.address, escrowAddress] });
      if (allowance < STAKE) {
        await confirmedAction({ state, name: `approve-${index}`, publicClient, walletClient, account: agent.account, address: usdcAddress, abi: erc20Abi, functionName: "approve", args: [escrowAddress, STAKE] });
      }
      await confirmedAction({
        state, name: `register-${index}`, publicClient, walletClient, account: agent.account, address: escrowAddress, abi: escrowAbi,
        functionName: "register", args: [state.arcTournamentId, agent.arcEntrantId, toBytes32(agent.agentId), toBytes32(agent.agentsVersion), toBytes32(agent.agentsCommitment)],
      });
    }
  }

  tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
  if (Number(tournament.entrantCount) !== 8 || tournament.totalLockedStakes !== STAKE * 8n) throw new Error("Arc roster/accounting readback mismatch");
  const secondsToClose = state.registrationClosesAt - Math.floor(Date.now() / 1000);
  if (secondsToClose > 0) {
    console.log(JSON.stringify({ phase: "arc", action: "wait-registration-close", seconds: secondsToClose }));
    await sleep((secondsToClose + 2) * 1_000);
  }
  tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
  if (Number(tournament.state) === 0) await confirmedAction({ state, name: "close-registration", publicClient, walletClient: ownerWallet, account: owner, address: escrowAddress, abi: escrowAbi, functionName: "closeRegistration", args: [state.arcTournamentId] });
  tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
  if (Number(tournament.state) === 1) await confirmedAction({ state, name: "mark-running", publicClient, walletClient: ownerWallet, account: owner, address: escrowAddress, abi: escrowAbi, functionName: "markRunning", args: [state.arcTournamentId] });

  const runtime = new SqliteRuntimeStore(SQLITE_PATH);
  try {
    const submittedAttempts = new Set(runtime.list("judge-submissions").map((submission) => submission.attemptId));
    const failedInferenceAttempts = new Set(
      runtime.list("inference-runs")
        .filter((run) => run.state === "TRANSIENT_FAILURE" || run.state === "PERMANENT_FAILURE")
        .map((run) => run.attemptId),
    );
    const abandonedAttemptIds = new Set(state.abandonedAttemptIds ?? []);
    for (const attempt of failedInferenceAttempts) {
      if (!submittedAttempts.has(attempt)) abandonedAttemptIds.add(attempt);
    }
    state.abandonedAttemptIds = [...abandonedAttemptIds].sort();
    persist(state);
    const liveProvider = new OpenAICompatibleProvider({ endpoint, apiKey, apiStyle: "chat-completions", unreportedCostMicros: 1_000, timeoutMs: 300_000 });
    let providerQueue = Promise.resolve();
    const provider = {
      generate(request, operationKey) {
        const call = providerQueue.then(() => liveProvider.generate(request, operationKey));
        providerQueue = call.then(() => undefined, () => undefined);
        return call;
      },
    };
    const inferenceStore = new PersistentInferenceStore(runtime, { leaseMs: 120_000 });
    const pairRunner = new InferencePairRunner(provider, inferenceStore);
    const tracker = new GenLayerTracker(createStudionetGenLayerPort(ownerPrivateKey), new PersistentJudgeStore(runtime, { leaseMs: 120_000 }), judgeAddress);
    const policy = {
      version: "arena-live-model-policy-v2", model,
      wrapper: ARENA_PLATFORM_WRAPPER_V2,
      maxOutputBytes: genDeployment.readback.canonical_config.max_output_bytes,
      temperature: 0.2,
      maxCostMicros: 100_000,
      maxCostPerCallMicros: 1_000,
    };
    const orchestrator = new TournamentOrchestrator(
      { run: (input) => pairRunner.runPair({ ...input, policy }) },
      { judge: async (input) => {
        const pair = { matchId: input.matchId, attemptId: input.attemptId, topic: input.topic, outputA: input.outputA, outputB: input.outputB, outputADigest: input.outputADigest, outputBDigest: input.outputBDigest, rubricVersion: "GeneralResponseV7" };
        await tracker.submit(pair);
        return tracker.poll(input.matchId, input.attemptId);
      } },
    );
    const topics = [
      "Explain how a Merkle tree lets a light client verify inclusion without downloading every record.",
      "Explain why idempotency keys matter when retrying a paid API request.",
      "Describe how an escrow prevents double settlement in a tournament.",
      "Explain the difference between transaction acceptance and finality on a blockchain.",
      "Explain why binding a verdict to exact input digests improves auditability.",
      "Describe one practical defense against replay attacks in signed messages.",
    ];
    const seedDigest = digest(`${state.runId}|public-seed-v1`);
    const entrantInputs = agents.map(({ account: _account, arcEntrantId: _arcEntrantId, ...agent }) => agent);
    let result;
    for (let poll = 0; poll < 240; poll += 1) {
      result = await orchestrator.run({
        tournamentId: state.tournamentDigest, seedDigest, entrants: entrantInputs, topics,
        bracketRevision: 1, retryCap: state.retryCap ?? 3, expiresAt: state.expiresAt,
        now: () => Math.floor(Date.now() / 1000), abandonedAttemptIds: state.abandonedAttemptIds,
      });
      if (result.state === "RANKING_READY") break;
      if (result.state === "RECOVERY_REQUIRED" || result.state === "REFUND_REQUIRED") throw new Error(`orchestrator stopped in ${result.state}`);
      console.log(JSON.stringify({ phase: "genlayer", state: result.state, matchId: result.matchId, attemptId: result.attemptId, reservedCostMicros: inferenceStore.totalCostMicros(state.tournamentDigest) }));
      await sleep(12_000);
    }
    if (!result || result.state !== "RANKING_READY") throw new Error("GenLayer lifecycle did not finalize within poll bound");
    state.ranking = result.ranking;
    state.status = "RANKING_READY";
    persist(state);

    tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
    const rankedArc = result.ranking.map(toBytes32);
    const rankingDigest = `0x${shaHex(JSON.stringify(result.ranking))}`;
    if (Number(tournament.state) === 2) {
      await confirmedAction({ state, name: "settle", publicClient, walletClient: ownerWallet, account: owner, address: escrowAddress, abi: escrowAbi, functionName: "settleByOperator", args: [state.arcTournamentId, rankedArc, rankingDigest, 1n] });
    }

    for (let rank = 0; rank < result.ranking.length; rank += 1) {
      const winner = agents.find((agent) => agent.entrantId === result.ranking[rank]);
      if (!winner) throw new Error("ranked entrant does not map to a registered account");
      const credit = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "creditOf", args: [state.arcTournamentId, winner.account.address] });
      if (credit > 0n) {
        await confirmedAction({ state, name: `auto-payout-rank-${rank + 1}`, publicClient, walletClient: ownerWallet, account: owner, address: escrowAddress, abi: escrowAbi, functionName: "withdrawCreditFor", args: [state.arcTournamentId, winner.account.address] });
      }
    }
    tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
    if (tournament.platformFeeCredit > 0n) await confirmedAction({ state, name: "auto-payout-platform-fee", publicClient, walletClient: ownerWallet, account: owner, address: escrowAddress, abi: escrowAbi, functionName: "withdrawPlatformFeeFor", args: [state.arcTournamentId] });
    tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
    if (tournament.totalLiability !== 0n || tournament.totalLockedStakes !== 0n) throw new Error("Arc zero-liability invariant failed before closure");
    if (Number(tournament.state) !== 5) await confirmedAction({ state, name: "close-tournament", publicClient, walletClient: ownerWallet, account: owner, address: escrowAddress, abi: escrowAbi, functionName: "closeTournament", args: [state.arcTournamentId] });
    tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
    if (Number(tournament.state) !== 5 || tournament.totalLiability !== 0n || tournament.totalLockedStakes !== 0n) throw new Error("closed Arc tournament readback failed");

    const inferenceRuns = runtime.list("inference-runs");
    const judgeSubmissions = runtime.list("judge-submissions");
    const verdicts = [];
    for (const submission of judgeSubmissions) {
      if (submission.state !== "FINALIZED") continue;
      const raw = await createStudionetGenLayerPort(ownerPrivateKey).getResult(judgeAddress, submission.matchId, submission.attemptId);
      const verdict = typeof raw === "string" ? JSON.parse(raw) : raw;
      verdicts.push({
        matchId: submission.matchId, attemptId: submission.attemptId, transactionHash: submission.txHash,
        result: verdict.result, scoreA: verdict.score_a, scoreB: verdict.score_b, safetyClass: verdict.safety_class,
        summary: verdict.summary, criteria: verdict.criteria,
      });
    }
    const evidence = {
      schemaVersion: "arena-live-trusted-operator-lifecycle-v1",
      capturedAtUtc: new Date().toISOString(),
      trustModel: "TRUSTED_OPERATOR",
      scopeNotice: "The operator controls model invocation, A/B mapping, bracket progression and Arc ranking submission. GenLayer judges only the exact submitted output bytes.",
      provider: {
        authenticatedPaidEndpointCall: true, model, successfulCalls: inferenceRuns.filter((run) => run.state === "SUCCESS").length,
        failedCalls: inferenceRuns.filter((run) => run.state === "TRANSIENT_FAILURE" || run.state === "PERMANENT_FAILURE").length,
        abandonedAttemptCount: state.abandonedAttemptIds?.length ?? 0,
        totalTokens: inferenceRuns.reduce((sum, run) => sum + (run.usageTokens ?? 0), 0),
        providerReportedMonetaryCost: false,
        accountingNote: "The provider omitted monetary cost fields. Budget accounting reserved 1000 micros per successful call; this is a conservative configured reservation, not a claimed invoice amount.",
      },
      genLayer: {
        network: "Studionet", chainId: GENLAYER_CHAIN_ID, judgeAddress,
        bracketMatchCount: buildBracket({ tournamentId: state.tournamentDigest, seedDigest, entrants: entrantInputs, bracketRevision: 1 }).matches.length,
        finalizedMatchTransactions: verdicts.length, verdicts,
      },
      arc: {
        network: "Arc Testnet", chainId: ARC_CHAIN_ID, escrowAddress, usdcAddress, tournamentId: state.arcTournamentId,
        stakeMicroUsdc: STAKE.toString(), entrantCount: 8, grossPoolMicroUsdc: (STAKE * 8n).toString(),
        platformFeeBps: 1_000, feeRecipient: owner.address, payoutBps: PAYOUT_BPS,
        transactionHashes: Object.fromEntries(Object.entries(state.arcTransactions).map(([name, record]) => [name, record.hash])),
        terminalState: "CLOSED", totalLiabilityMicroUsdc: "0", totalLockedStakesMicroUsdc: "0",
      },
      ranking: result.ranking,
      sanitization: "No API keys, private keys, raw provider outputs, raw GenLayer receipts, traces, validator configuration, stdout or stderr are retained.",
    };
    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    state.status = "COMPLETE";
    state.completedAtUtc = evidence.capturedAtUtc;
    persist(state);
    console.log(JSON.stringify({ phase: "complete", evidencePath: EVIDENCE_PATH, providerCalls: evidence.provider.successfulCalls, genLayerTransactions: verdicts.length, arcTransactions: Object.keys(state.arcTransactions).length, totalLiabilityMicroUsdc: "0" }));
  } finally {
    runtime.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ phase: "failed", error: error instanceof Error ? error.message : "unknown failure" }));
  process.exitCode = 1;
});
