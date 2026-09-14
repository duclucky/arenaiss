import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createPublicClient, decodeEventLog, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

import { createStudionetGenLayerPort } from "../packages/genlayer/src/sdk-port.ts";
import { normalizeReceipt } from "../packages/genlayer/src/tracker.ts";

const ARC_CHAIN_ID = 5_042_002;
const EXPECTED_STAKE = 1_000n;
const EVIDENCE_PATH = join("docs", "evidence", "live", "trusted-operator-lifecycle-settlement-2.json");
const STATE_PATH = join(".local", "live-lifecycle-settlement-2.json");

const tournamentComponents = [
  { name: "policy", type: "tuple", components: [
    { name: "registrationOpensAt", type: "uint64" }, { name: "registrationClosesAt", type: "uint64" },
    { name: "startsAt", type: "uint64" }, { name: "expiresAt", type: "uint64" },
    { name: "minEntrants", type: "uint32" }, { name: "maxEntrants", type: "uint32" },
    { name: "stakeAmount", type: "uint128" }, { name: "operatorAddress", type: "address" },
    { name: "feeRecipient", type: "address" }, { name: "payoutBps", type: "uint16[5]" },
  ] },
  { name: "state", type: "uint8" }, { name: "entrantCount", type: "uint32" },
  { name: "totalLockedStakes", type: "uint256" }, { name: "totalLiability", type: "uint256" },
  { name: "platformFeeCredit", type: "uint256" }, { name: "rankingDigest", type: "bytes32" },
  { name: "settlementNonce", type: "uint256" },
];

const entrantComponents = [
  { name: "wallet", type: "address" }, { name: "agentId", type: "bytes32" },
  { name: "agentsVersion", type: "bytes32" }, { name: "agentsCommitment", type: "bytes32" },
  { name: "registered", type: "bool" }, { name: "ranked", type: "bool" },
];

const escrowAbi = [
  { type: "function", name: "getTournament", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: tournamentComponents }] },
  { type: "function", name: "getEntrant", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "bytes32" }], outputs: [{ type: "tuple", components: entrantComponents }] },
  { type: "function", name: "creditOf", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "uint256" }] },
];

const withdrawalEvents = [
  { type: "event", name: "CreditWithdrawn", inputs: [
    { name: "tournamentId", type: "bytes32", indexed: true },
    { name: "account", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "PlatformFeeWithdrawn", inputs: [
    { name: "tournamentId", type: "bytes32", indexed: true },
    { name: "recipient", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ] },
];

const shaHex = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const toBytes32 = (value) => `0x${value.slice(7)}`;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function deriveHelper(privateKey, runId, index) {
  const hex = createHmac("sha256", Buffer.from(privateKey.slice(2), "hex"))
    .update(`async-agent-arena-live-helper-v1|${runId}|${index}`, "utf8")
    .digest("hex");
  return privateKeyToAccount(`0x${hex}`);
}

function entrantId(state, account, index) {
  return `0x${shaHex(`${state.runId}|entrant|${index}|${account.address.toLowerCase()}`)}`;
}

async function main() {
  const privateKey = requiredEnv("STUDIONET_PRIVATE_KEY");
  const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  const owner = privateKeyToAccount(privateKey);
  const accounts = [owner, ...Array.from({ length: 7 }, (_, index) => deriveHelper(privateKey, state.runId, index + 1))];
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  if (await publicClient.getChainId() !== ARC_CHAIN_ID) throw new Error("Arc chain mismatch");

  const tournament = await publicClient.readContract({ address: evidence.arc.escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [evidence.arc.tournamentId] });
  const expectedRankingDigest = `0x${shaHex(JSON.stringify(evidence.ranking))}`;
  if (Number(tournament.state) !== 5 || tournament.totalLiability !== 0n || tournament.totalLockedStakes !== 0n || tournament.platformFeeCredit !== 0n) throw new Error("Arc terminal accounting readback mismatch");
  if (Number(tournament.entrantCount) !== 8 || tournament.policy.stakeAmount !== EXPECTED_STAKE || tournament.rankingDigest.toLowerCase() !== expectedRankingDigest.toLowerCase()) throw new Error("Arc tournament binding mismatch");
  if (tournament.policy.operatorAddress.toLowerCase() !== owner.address.toLowerCase() || tournament.policy.feeRecipient.toLowerCase() !== owner.address.toLowerCase()) throw new Error("Arc operator or fee recipient mismatch");

  const rosterIds = new Set();
  for (let index = 0; index < accounts.length; index += 1) {
    const id = entrantId(state, accounts[index], index);
    rosterIds.add(`sha256:${id.slice(2)}`);
    const [entrant, credit] = await Promise.all([
      publicClient.readContract({ address: evidence.arc.escrowAddress, abi: escrowAbi, functionName: "getEntrant", args: [evidence.arc.tournamentId, id] }),
      publicClient.readContract({ address: evidence.arc.escrowAddress, abi: escrowAbi, functionName: "creditOf", args: [evidence.arc.tournamentId, accounts[index].address] }),
    ]);
    if (!entrant.registered || entrant.wallet.toLowerCase() !== accounts[index].address.toLowerCase() || credit !== 0n) throw new Error(`Arc entrant readback mismatch: ${index}`);
  }
  if (evidence.ranking.length !== 5 || new Set(evidence.ranking).size !== 5 || evidence.ranking.some((id) => !rosterIds.has(id))) throw new Error("evidence ranking is not a unique roster subset");

  const arcReceipts = await Promise.all(Object.entries(evidence.arc.transactionHashes).map(async ([name, hash]) => {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Arc transaction failed: ${name}`);
    return [name, receipt];
  }));
  let payoutTotal = 0n;
  let feeTotal = 0n;
  for (const [name, receipt] of arcReceipts) {
    if (!name.startsWith("withdraw-rank-") && name !== "withdraw-platform-fee") continue;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== evidence.arc.escrowAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: withdrawalEvents, data: log.data, topics: log.topics });
        if (decoded.eventName === "CreditWithdrawn") payoutTotal += decoded.args.amount;
        if (decoded.eventName === "PlatformFeeWithdrawn") feeTotal += decoded.args.amount;
      } catch {
        // Ignore unrelated escrow events in the same receipt.
      }
    }
  }
  if (payoutTotal !== 7_200n || feeTotal !== 800n) throw new Error("Arc live USDC withdrawal totals mismatch");

  const genLayer = createStudionetGenLayerPort(privateKey);
  const verdictChecks = await Promise.all(evidence.genLayer.verdicts.map(async (expected) => {
    const receipt = normalizeReceipt(await genLayer.getReceipt(expected.transactionHash));
    if (receipt.finality !== "FINALIZED" || receipt.execution !== "SUCCESS") throw new Error("GenLayer transaction is not finalized successfully");
    const raw = await genLayer.getResult(evidence.genLayer.judgeAddress, expected.matchId, expected.attemptId);
    const actual = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (actual.result !== expected.result || actual.score_a !== expected.scoreA || actual.score_b !== expected.scoreB || actual.summary !== expected.summary) throw new Error("GenLayer canonical verdict mismatch");
    if (JSON.stringify(actual.criteria) !== JSON.stringify(expected.criteria)) throw new Error("GenLayer canonical reasons mismatch");
    return true;
  }));
  if (verdictChecks.length !== evidence.genLayer.finalizedMatchTransactions) throw new Error("GenLayer evidence count mismatch");

  process.stdout.write(`${JSON.stringify({ status: "PASS", arc: { chainId: ARC_CHAIN_ID, successfulTransactions: arcReceipts.length, terminalState: "CLOSED", entrantCreditsMicroUsdc: "0", totalLiabilityMicroUsdc: "0", payoutWithdrawnMicroUsdc: payoutTotal.toString(), ownerFeeWithdrawnMicroUsdc: feeTotal.toString() }, genLayer: { chainId: evidence.genLayer.chainId, finalizedSuccessfulTransactions: verdictChecks.length, canonicalVerdictsAndReasonsMatched: true }, provider: { successfulCalls: evidence.provider.successfulCalls, failedCalls: evidence.provider.failedCalls, totalTokens: evidence.provider.totalTokens, monetaryCostReported: evidence.provider.providerReportedMonetaryCost } })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "unknown failure" })}\n`);
  process.exitCode = 1;
});
