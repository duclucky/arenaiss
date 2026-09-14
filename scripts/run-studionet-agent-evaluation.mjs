import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const CONTRACT_ADDRESS = "0x7f9f5D4798e2A69576B5E1a5113849E2c4bF64BD";
const DEPLOYMENT_TRANSACTION = "0x01332f5c4ff34cc16bf9fd8fcc0f1eaf8a56e11c324cc589986db7d9c80852f4";
const RUBRIC_VERSION = "AgentEvaluationV5";
const STATE_PATH = ".local/studionet-agent-evaluation-v5.json";
const EVIDENCE_PATH = "docs/evidence/studionet/agent-evaluation-deployment.json";
const RAW_PATHS = [
  ".local/agent-evaluation-2026-09-14T02-12-01-280Z.json",
  ".local/agent-evaluation-2026-09-14T02-32-18-526Z.json",
];
const SELECTED = [
  ["l1_instruction_hierarchy", "a"],
  ["l1_safe_refusal", "safe"],
  ["l2_destructive_confirmation", "confirm"],
  ["l2_least_privilege", "least_privilege"],
];
const requestedCase = process.env.AGENT_EVALUATION_LIVE_CASE?.trim();
const selectedCases = requestedCase ? SELECTED.filter(([caseId]) => caseId === requestedCase) : SELECTED;
if (requestedCase && selectedCases.length === 0) throw new Error(`unknown live evaluation case: ${requestedCase}`);

if (process.env.EXECUTE_AGENT_EVALUATION !== "1") throw new Error("mutation guard: set EXECUTE_AGENT_EVALUATION=1 only with explicit authorization");
const privateKey = requiredEnv("STUDIONET_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Studionet private key is invalid");
const account = createAccount(privateKey);
const client = createClient({ chain: studionet, account });
const corpus = JSON.parse(readFileSync("tests/fixtures/evaluation/agents-evaluation-corpus.json", "utf8"));
const rawAttempts = RAW_PATHS.flatMap((path) => JSON.parse(readFileSync(path, "utf8")).results);
const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : { schema: "arena-studionet-agent-evaluation-state-v1", transactions: {} };

const operator = await client.readContract({ address: CONTRACT_ADDRESS, functionName: "get_operator", args: [], jsonSafeReturn: true });
const config = await client.readContract({ address: CONTRACT_ADDRESS, functionName: "get_config", args: [], jsonSafeReturn: true });
if (String(operator).toLowerCase() !== account.address.toLowerCase()) throw new Error("configured account does not match immutable contract operator");
if (config.rubric_version !== RUBRIC_VERSION || config.validator_policy !== "SEMANTIC_SUPPORT_ADJACENT_TIER" || config.executes_actions !== false) throw new Error("deployed contract config mismatch");
const localSource = readFileSync("contracts/AgentEvaluationJudge.py", "utf8");
const deployedSource = await client.getContractCode(CONTRACT_ADDRESS);
if (sha256(Buffer.from(localSource.replace(/\r\n/g, "\n"), "utf8")) !== sha256(Buffer.from(deployedSource.replace(/\r\n/g, "\n"), "utf8"))) throw new Error("deployed contract source mismatch");

const deploymentReceipt = await client.waitForTransactionReceipt({ hash: DEPLOYMENT_TRANSACTION, status: TransactionStatus.FINALIZED, interval: 3_000, retries: 200 });
const deploymentFinality = finalityOf(deploymentReceipt);
if (deploymentFinality !== "FINALIZED") throw new Error(`deployment did not finalize (${deploymentFinality || "UNKNOWN"})`);
console.log(JSON.stringify({ phase: "preflight", network: "studionet", chainId: 61999, contract: CONTRACT_ADDRESS, operator: account.address, deploymentFinality: "FINALIZED", status: "PASS" }));

const liveCases = [];
for (const [caseId, variantId] of selectedCases) {
  const item = corpus.cases.find((candidate) => candidate.id === caseId);
  const variant = item?.variants.find((candidate) => candidate.id === variantId);
  const generated = [...rawAttempts].reverse().find((candidate) => candidate.caseId === caseId && candidate.variantId === variantId && candidate.state === "SUCCESS");
  if (!item || !variant || !generated?.rawOutput) throw new Error(`missing locked provider evidence for ${caseId}/${variantId}`);
  const runId = `live_${caseId}_${variantId}_v1`;
  const scenarioJson = JSON.stringify({ schema: "arena-test-scenario-v1", scenario_id: caseId, version: "1.0.0", mode: item.level, ...item.scenario });
  const responseJson = generated.rawOutput;
  let canonical = await client.readContract({ address: CONTRACT_ADDRESS, functionName: "get_evaluation", args: [runId], jsonSafeReturn: true });
  let transactionHash = state.transactions[runId]?.hash;
  let receipt;
  if (canonical.status !== "FINAL" || (transactionHash && state.transactions[runId]?.status !== "FINALIZED")) {
    if (!transactionHash) {
      transactionHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "submit_evaluation",
        args: [runId, digest(variant.agents_md), item.level, variant.agents_md, scenarioJson, responseJson, digest(variant.agents_md), digest(scenarioJson), digest(responseJson), RUBRIC_VERSION],
      });
      state.transactions[runId] = { hash: transactionHash, submittedAtUtc: new Date().toISOString() };
      persistState();
    }
    receipt = await client.waitForTransactionReceipt({ hash: transactionHash, status: TransactionStatus.FINALIZED, interval: 3_000, retries: 200 });
    const finality = finalityOf(receipt);
    if (finality !== "FINALIZED") throw new Error(`evaluation did not finalize: ${runId} (${finality || "UNKNOWN"})`);
    canonical = await client.readContract({ address: CONTRACT_ADDRESS, functionName: "get_evaluation", args: [runId], jsonSafeReturn: true });
  }
  if (canonical.status !== "FINAL" || canonical.run_id !== runId || canonical.actions_executed !== false) throw new Error(`canonical readback mismatch: ${runId}`);
  state.transactions[runId] = { hash: transactionHash, status: "FINALIZED", execution: "SUCCESS", resultClass: canonical.result_class, overallScore: canonical.overall_score };
  persistState();
  liveCases.push({
    runId,
    caseId,
    variantId,
    level: item.level,
    transactionHash,
    consensusStatus: "FINALIZED",
    execution: "SUCCESS",
    canonicalStatus: canonical.status,
    resultClass: canonical.result_class,
    overallScore: canonical.overall_score,
    summary: canonical.summary,
    dimensions: canonical.dimensions,
    policyFindings: canonical.policy_findings,
    actionsExecuted: canonical.actions_executed,
    bindings: { agentVersionId: canonical.agent_version_id, agentsDigest: canonical.agents_digest, scenarioDigest: canonical.scenario_digest, responseDigest: canonical.response_digest, rubricVersion: canonical.rubric_version },
  });
  console.log(JSON.stringify({ phase: "evaluation", runId, transactionHash, finality: "FINALIZED", execution: "SUCCESS", resultClass: canonical.result_class, overallScore: canonical.overall_score, reasonCount: canonical.dimensions.length + 1 }));
}

if (requestedCase) {
  console.log(JSON.stringify({ phase: "complete", scope: "single-case-smoke", caseId: requestedCase, finalizedCases: liveCases.length }));
  process.exit(0);
}

const evidence = {
  schema: "arena-agent-evaluation-studionet-evidence-v1",
  capturedAtUtc: new Date().toISOString(),
  network: { name: "Studionet", chainId: 61999, rpc: "https://studio.genlayer.com/api", explorer: "https://explorer-studio.genlayer.com" },
  contract: { name: "AgentEvaluationJudge", address: CONTRACT_ADDRESS, deploymentTransaction: DEPLOYMENT_TRANSACTION, deploymentFinality: "FINALIZED", deploymentExecution: "SUCCESS", localSourceSha256: sha256(Buffer.from(localSource.replace(/\r\n/g, "\n"), "utf8")), deployedSourceMatchesLocal: true, runner: "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" },
  readback: { operator: String(operator), config, publicResultRead: true },
  liveCases,
  toolchain: { genlayerCli: "0.39.2", genvmLinter: "0.11.0", genvmValidationBundle: "v0.2.16", genlayerPy: "v0.18", genlayerTest: "v0.29" },
  sanitization: "Only allowlisted deployment identity, bindings, finalized canonical scorecards, bounded reasons and transaction hashes are retained. Raw receipts, traces, validator configuration, provider outputs and secrets are excluded.",
};
mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ phase: "complete", evidencePath: EVIDENCE_PATH, finalizedCases: liveCases.length }));

function persistState() {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function digest(value) {
  return `sha256:${sha256(Buffer.from(value, "utf8"))}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function finalityOf(receipt) {
  const status = receipt?.statusName ?? receipt?.status;
  if (status === 7 || String(status).toUpperCase() === "FINALIZED") return "FINALIZED";
  return String(status ?? "").toUpperCase();
}
