import assert from "node:assert/strict";
import test from "node:test";

import { SdkAgentEvaluationPort } from "../src/evaluation-sdk-port.ts";

const transactionHash = `0x${"ab".repeat(32)}`;
const judgeAddress = "0x1111111111111111111111111111111111111111";
const fees = { distribution: { rotations: [0] }, messageAllocations: [], feeValue: 456n };
const submission = {
  runId: `sha256:${"a".repeat(64)}`,
  agentVersionId: `sha256:${"b".repeat(64)}`,
  mode: "ACTION_DECISION",
  agentsMd: "Choose the least-privileged action.",
  scenarioJson: "{\"schema\":\"arena-test-scenario-v1\"}",
  responseJson: "{\"schema\":\"arena-evaluation-output-v1\"}",
  agentsDigest: `sha256:${"c".repeat(64)}`,
  scenarioDigest: `sha256:${"d".repeat(64)}`,
  responseDigest: `sha256:${"e".repeat(64)}`,
  rubricVersion: "AgentEvaluationV5",
};

test("production SDK adapter submits exact AgentEvaluationJudge V5 ABI order and reads canonical state", async () => {
  const calls: Array<{ kind: string; input: any }> = [];
  const client = {
    async estimateTransactionFeesForWrite(input: any) { calls.push({ kind: "estimate", input }); return fees; },
    async writeContract(input: any) { calls.push({ kind: "write", input }); return transactionHash; },
    async getTransaction(input: any) { calls.push({ kind: "receipt", input }); return { statusName: "FINALIZED" }; },
    async readContract(input: any) { calls.push({ kind: "read", input }); return { run_id: submission.runId }; },
  };
  const port = new SdkAgentEvaluationPort(client);
  assert.equal(await port.submit(submission, judgeAddress), transactionHash);
  await port.getReceipt(transactionHash);
  await port.getEvaluation(judgeAddress, submission.runId);
  const writeInput = { address: judgeAddress, functionName: "submit_evaluation", args: [submission.runId, submission.agentVersionId, submission.mode, submission.agentsMd, submission.scenarioJson, submission.responseJson, submission.agentsDigest, submission.scenarioDigest, submission.responseDigest, submission.rubricVersion] };
  assert.deepEqual(calls, [
    { kind: "estimate", input: writeInput },
    { kind: "write", input: { ...writeInput, fees } },
    { kind: "receipt", input: { hash: transactionHash } },
    { kind: "read", input: { address: judgeAddress, functionName: "get_evaluation", args: [submission.runId], jsonSafeReturn: true } },
  ]);
});
