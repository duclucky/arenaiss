import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { TournamentEvaluationPairRunner } from "../src/tournament-runner.ts";
import type { EvaluationProviderInput } from "../src/protocol.ts";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const context = { tournamentId: digest("t"), matchId: digest("m"), attemptId: digest("a"), topic: "Explain least privilege.", agentA: { entrantId: digest("ea"), agentId: digest("aa"), agentsVersion: digest("va"), agentsMd: "Agent A", agentsCommitment: digest("Agent A") }, agentB: { entrantId: digest("eb"), agentId: digest("ab"), agentsVersion: digest("vb"), agentsMd: "Agent B", agentsCommitment: digest("Agent B") } };

test("E6 Tournament provider evaluates both Agents under one exact Evaluation scenario and returns structured bytes", async () => {
  const calls: Array<{ input: EvaluationProviderInput; operationKey: string }> = [];
  const provider = { async generate(value: any) { calls.push(value); const rawOutput = JSON.stringify({ schema: "arena-evaluation-output-v1", mode: "RESPONSE", decision: "RESPOND", answer: value.input.agent.content, observable_rationale: "Observable support.", proposed_actions: [] }); return { rawOutput, output: {}, requestId: value.operationKey }; } };
  const runner = new TournamentEvaluationPairRunner(provider, { model: "fixture", maxOutputTokens: 1000, temperature: 0 });
  const result = await runner.run(context);
  assert.equal(result.state, "OUTPUTS_READY"); assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].input.scenario, calls[1].input.scenario);
  assert.notEqual(calls[0].input.agent.version_id, calls[1].input.agent.version_id);
  assert.equal(calls.every((call) => call.input.schema === "arena-evaluation-input-v1" && call.input.output_contract.hidden_chain_of_thought_forbidden), true);
  assert.equal(await runner.run(context).then((row) => row.state), "OUTPUTS_READY"); assert.equal(calls.length, 2);
});

test("E6 partial rich provider pair stops before comparison submission", async () => {
  let calls = 0;
  const provider = { async generate(value: any) { calls += 1; if (value.input.agent.content === "Agent B") throw new Error("PROVIDER_TIMEOUT"); const rawOutput = JSON.stringify({ schema: "arena-evaluation-output-v1", mode: "RESPONSE", decision: "RESPOND", answer: "A", observable_rationale: "Support", proposed_actions: [] }); return { rawOutput, output: {} }; } };
  const result = await new TournamentEvaluationPairRunner(provider, { model: "fixture", maxOutputTokens: 1000, temperature: 0 }).run(context);
  assert.equal(calls, 2); assert.equal(result.state, "PARTIAL_PAIR"); assert.ok(result.outputA); assert.equal(result.outputB, undefined);
});
