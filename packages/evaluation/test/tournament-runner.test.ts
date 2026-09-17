import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { TournamentEvaluationPairRunner } from "../src/tournament-runner.ts";
import type { EvaluationProviderInput } from "../src/protocol.ts";
import { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

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
  assert.equal(calls, 2); assert.equal(result.state, "PARTIAL_PAIR"); assert.ok(result.outputA); assert.equal(result.outputB, undefined); assert.equal(result.failureCode, "PROVIDER_TIMEOUT");
});

test("a primary timeout reruns both Tournament sides on the same fallback model", async () => {
  const calls: Array<{ side: string; route?: string; model: string }> = [];
  const provider = {
    getFallbackModel: () => "fallback-model",
    async generate(value: any) {
      const side = value.input.agent.content;
      calls.push({ side, route: value.route, model: value.model });
      if (value.route === "PRIMARY" && side === "Agent B") throw new Error("PROVIDER_TIMEOUT");
      return { rawOutput: `${value.route}:${side}`, output: {}, model: value.route === "FALLBACK" ? "fallback-model" : "primary-model", route: value.route };
    },
  };
  const runner = new TournamentEvaluationPairRunner(provider, { model: "primary-model", maxOutputTokens: 1000, temperature: 0 });
  const result = await runner.run(context);
  assert.equal(result.state, "OUTPUTS_READY");
  assert.equal(result.outputA, "FALLBACK:Agent A");
  assert.equal(result.outputB, "FALLBACK:Agent B");
  assert.deepEqual(calls, [
    { side: "Agent A", route: "PRIMARY", model: "primary-model" }, { side: "Agent B", route: "PRIMARY", model: "primary-model" },
    { side: "Agent A", route: "FALLBACK", model: "fallback-model" }, { side: "Agent B", route: "FALLBACK", model: "fallback-model" },
  ]);
});

test("a temporary primary provider failure reruns the full pair on fallback", async () => {
  const calls: string[] = [];
  const provider = {
    getFallbackModel: () => "fallback-model",
    async generate(value: any) {
      calls.push(`${value.route}:${value.input.agent.content}`);
      if (value.route === "PRIMARY" && value.input.agent.content === "Agent B") throw Object.assign(new Error("PROVIDER_ERROR"), { transient: true });
      return { rawOutput: `${value.route}:${value.input.agent.content}`, output: {}, model: value.route === "FALLBACK" ? "fallback-model" : "primary-model", route: value.route };
    },
  };
  const result = await new TournamentEvaluationPairRunner(provider, { model: "primary-model", maxOutputTokens: 1000, temperature: 0 }).run(context);
  assert.equal(result.state, "OUTPUTS_READY");
  assert.equal(result.outputA, "FALLBACK:Agent A");
  assert.equal(result.outputB, "FALLBACK:Agent B");
  assert.deepEqual(calls, ["PRIMARY:Agent A", "PRIMARY:Agent B", "FALLBACK:Agent A", "FALLBACK:Agent B"]);
});

test("Tournament restart keeps the fallback route and reuses its completed side", async () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const calls: Array<{ side: string; route?: string }> = [];
    let fallbackBFailures = 1;
    const provider = {
      getFallbackModel: () => "fallback-model",
      async generate(value: any) {
        const side = value.input.agent.content;
        calls.push({ side, route: value.route });
        if (value.route === "PRIMARY" && side === "Agent B") throw new Error("PROVIDER_TIMEOUT");
        if (value.route === "FALLBACK" && side === "Agent B" && fallbackBFailures-- > 0) throw new Error("PROVIDER_ERROR");
        return { rawOutput: `${value.route}:${side}`, output: {}, model: value.route === "FALLBACK" ? "fallback-model" : "primary-model", route: value.route };
      },
    };
    const policy = { model: "primary-model", maxOutputTokens: 1000, temperature: 0 };
    assert.equal((await new TournamentEvaluationPairRunner(provider, policy, runtime).run(context)).state, "PARTIAL_PAIR");
    const resumed = await new TournamentEvaluationPairRunner(provider, policy, runtime).run(context);
    assert.equal(resumed.state, "OUTPUTS_READY");
    assert.equal(resumed.outputA, "FALLBACK:Agent A");
    assert.equal(resumed.outputB, "FALLBACK:Agent B");
    assert.deepEqual(calls.slice(4), [{ side: "Agent B", route: "FALLBACK" }]);
  } finally { runtime.close(); }
});
