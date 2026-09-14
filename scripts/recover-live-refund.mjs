import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const ARC_CHAIN_ID = 5_042_002;
const STAKE = 1_000n;
const HELPER_GAS_FLOOR = parseUnits("0.002", 18);
const HELPER_GAS_TARGET = parseUnits("0.005", 18);
const STATE_PATH = join(".local", "live-lifecycle-current.json");
const EVIDENCE_PATH = join("docs", "evidence", "live", "retry-exhausted-refund-pending-2026-09-13.json");

const shaHex = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const digest = (value) => `sha256:${shaHex(value)}`;
const toBytes32 = (value) => value.startsWith("sha256:") ? `0x${value.slice(7)}` : value;
const asString = (value) => typeof value === "bigint" ? value.toString() : String(value);

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

function entrantIdFor(state, account, index) {
  return toBytes32(digest(`${state.runId}|entrant|${index}|${account.address.toLowerCase()}`));
}

function persistState(state) {
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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
  { type: "function", name: "getTournament", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: tournamentComponents }] },
  { type: "function", name: "getEntrant", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "bytes32" }], outputs: [{ type: "tuple", components: entrantComponents }] },
  { type: "function", name: "creditOf", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cancelAndOpenRefunds", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "bytes32" }], outputs: [] },
  { type: "function", name: "claimRefund", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "bytes32" }], outputs: [] },
  { type: "function", name: "withdrawCredit", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "closeTournament", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
];

async function confirmedAction({ state, name, publicClient, walletClient, account, address, functionName, args }) {
  let hash = state.arcTransactions[name]?.hash;
  if (!hash) {
    const simulation = await publicClient.simulateContract({ account, address, abi: escrowAbi, functionName, args });
    hash = await walletClient.writeContract(simulation.request);
    state.arcTransactions[name] = { hash, submittedAtUtc: new Date().toISOString() };
    persistState(state);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`Arc recovery action reverted: ${name}`);
  state.arcTransactions[name] = { ...state.arcTransactions[name], blockNumber: asString(receipt.blockNumber), status: "SUCCESS" };
  persistState(state);
  process.stdout.write(`${JSON.stringify({ phase: "arc-refund", action: name, status: "SUCCESS", hash })}\n`);
  return hash;
}

function writeClosedEvidence(state, tournament, accounts) {
  const existing = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));
  const recoveryNames = Object.keys(state.arcTransactions).filter((name) =>
    name === "cancel-refunds" || name.startsWith("claim-refund-") || name.startsWith("withdraw-refund-") || name === "close-refunded",
  );
  const evidence = {
    ...existing,
    capturedAtUtc: new Date().toISOString(),
    outcome: "REFUNDED_CLOSED",
    arc: {
      ...existing.arc,
      state: "CLOSED",
      totalLockedStakesMicroUsdc: tournament.totalLockedStakes.toString(),
      totalLiabilityMicroUsdc: tournament.totalLiability.toString(),
      refundRecipientCount: accounts.length,
      refundedPrincipalMicroUsdc: (STAKE * BigInt(accounts.length)).toString(),
      recoveryTransactionHashes: Object.fromEntries(recoveryNames.map((name) => [name, state.arcTransactions[name].hash])),
    },
    requiredRecovery: "COMPLETED: refunds were opened after expiry; all registered wallets claimed and withdrew; closure readback proved zero liability.",
  };
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function main() {
  if (!existsSync(STATE_PATH)) throw new Error("missing retry-exhausted lifecycle state");
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  const privateKey = requiredEnv("STUDIONET_PRIVATE_KEY");
  const owner = privateKeyToAccount(privateKey);
  const helpers = Array.from({ length: 7 }, (_, index) => deriveHelper(privateKey, state.runId, index + 1));
  const accounts = [owner, ...helpers];
  const deployment = JSON.parse(readFileSync(join("docs", "evidence", "arc-testnet", "deployment.json"), "utf8"));
  const escrowAddress = deployment.address;
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const [chainId, configuredOwner, code] = await Promise.all([
    publicClient.getChainId(),
    publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "owner" }),
    publicClient.getCode({ address: escrowAddress }),
  ]);
  if (chainId !== ARC_CHAIN_ID || !code || code === "0x" || configuredOwner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error("Arc recovery preflight failed");
  }

  let tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number(tournament.policy.expiresAt);
  if (Number(tournament.state) <= 2 && now < expiresAt) {
    process.stdout.write(`${JSON.stringify({ phase: "refund-pending", state: Number(tournament.state), expiresAtUnix: expiresAt, secondsRemaining: expiresAt - now, totalLockedStakesMicroUsdc: tournament.totalLockedStakes.toString(), totalLiabilityMicroUsdc: tournament.totalLiability.toString() })}\n`);
    return;
  }

  const ownerWallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http() });
  if (Number(tournament.state) <= 2) {
    await confirmedAction({ state, name: "cancel-refunds", publicClient, walletClient: ownerWallet, account: owner, address: escrowAddress, functionName: "cancelAndOpenRefunds", args: [state.arcTournamentId, `0x${shaHex("RETRY_EXHAUSTED")}`] });
  }
  tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
  if (Number(tournament.state) !== 4 && Number(tournament.state) !== 5) throw new Error("tournament is not refundable or closed");

  if (Number(tournament.state) === 4) {
    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index];
      const entrantId = entrantIdFor(state, account, index);
      const entrant = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getEntrant", args: [state.arcTournamentId, entrantId] });
      if (!entrant.registered || entrant.wallet.toLowerCase() !== account.address.toLowerCase()) throw new Error(`refund roster binding mismatch: ${index}`);

      if (index > 0) {
        const nativeBalance = await publicClient.getBalance({ address: account.address });
        if (nativeBalance < HELPER_GAS_FLOOR) {
          const fundingName = `fund-refund-gas-${index}`;
          let hash = state.arcTransactions[fundingName]?.hash;
          if (!hash) {
            hash = await ownerWallet.sendTransaction({ account: owner, to: account.address, value: HELPER_GAS_TARGET - nativeBalance });
            state.arcTransactions[fundingName] = { hash, submittedAtUtc: new Date().toISOString() };
            persistState(state);
          }
          const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error(`refund gas funding reverted: ${index}`);
          state.arcTransactions[fundingName] = { ...state.arcTransactions[fundingName], blockNumber: asString(receipt.blockNumber), status: "SUCCESS" };
          persistState(state);
        }
      }

      const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });
      const claimName = `claim-refund-${index}`;
      const withdrawName = `withdraw-refund-${index}`;
      if (state.arcTransactions[claimName]?.status !== "SUCCESS") {
        await confirmedAction({ state, name: claimName, publicClient, walletClient, account, address: escrowAddress, functionName: "claimRefund", args: [state.arcTournamentId, entrantId] });
      }
      let credit = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "creditOf", args: [state.arcTournamentId, account.address] });
      if (state.arcTransactions[withdrawName]?.status !== "SUCCESS" && credit > 0n) {
        await confirmedAction({ state, name: withdrawName, publicClient, walletClient, account, address: escrowAddress, functionName: "withdrawCredit", args: [state.arcTournamentId] });
      }
      credit = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "creditOf", args: [state.arcTournamentId, account.address] });
      if (credit !== 0n) throw new Error(`refund credit remains for entrant ${index}`);
    }

    tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
    if (tournament.totalLiability !== 0n || tournament.totalLockedStakes !== 0n) throw new Error("refund zero-liability invariant failed before closure");
    if (state.arcTransactions["close-refunded"]?.status !== "SUCCESS") {
      await confirmedAction({ state, name: "close-refunded", publicClient, walletClient: ownerWallet, account: owner, address: escrowAddress, functionName: "closeTournament", args: [state.arcTournamentId] });
    }
  }

  tournament = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getTournament", args: [state.arcTournamentId] });
  if (Number(tournament.state) !== 5 || tournament.totalLiability !== 0n || tournament.totalLockedStakes !== 0n) throw new Error("closed refund readback failed");
  state.status = "REFUNDED_CLOSED";
  state.refundedAtUtc = new Date().toISOString();
  persistState(state);
  writeClosedEvidence(state, tournament, accounts);
  process.stdout.write(`${JSON.stringify({ phase: "refund-complete", tournamentId: state.arcTournamentId, state: "CLOSED", refundRecipients: accounts.length, totalLiabilityMicroUsdc: "0", evidencePath: EVIDENCE_PATH })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ phase: "failed", error: error instanceof Error ? error.message : "unknown failure" })}\n`);
  process.exitCode = 1;
});
