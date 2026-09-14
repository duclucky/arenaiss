import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleProvider } from "../src/openai-provider.ts";

const request = { policyVersion: "v1", model: "gpt-fixture", wrapper: "Follow the topic.", topic: "Explain Arc", agentsMd: "Be concise", maxOutputBytes: 8192, temperature: 0.2 };

test("provider sends one bounded OpenAI-compatible request without side, wallet or payout fields", async () => {
  let captured: any;
  const provider = new OpenAICompatibleProvider({ endpoint: "https://provider.example/v1/responses", apiKey: "secret", fetchImpl: async (_url, init) => {
    captured = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "resp-1", output_text: "answer", usage: { total_tokens: 12 }, cost_micros: 7 }), { status: 200, headers: { "content-type": "application/json" } });
  }});
  const result = await provider.generate(request, "op-1");
  assert.equal(result.output, "answer"); assert.equal(captured.model, "gpt-fixture");
  assert.deepEqual(JSON.parse(captured.input[1].content[0].text), {
    schema: "arena-generation-input-v2",
    agents_md: "Be concise",
    topic: "Explain Arc",
  });
  assert.equal(JSON.stringify(captured).includes("wallet"), false); assert.equal(JSON.stringify(captured).includes("payout"), false);
  assert.equal(captured.metadata.idempotency_key, "op-1");
});

test("provider classifies rate limit/transient and malformed permanent failures", async () => {
  const limited = new OpenAICompatibleProvider({ endpoint: "https://provider.example/v1/responses", apiKey: "secret", fetchImpl: async () => new Response("{}", { status: 429 }) });
  await assert.rejects(() => limited.generate(request, "op"), /PROVIDER_TRANSIENT/);
  const malformed = new OpenAICompatibleProvider({ endpoint: "https://provider.example/v1/responses", apiKey: "secret", fetchImpl: async () => new Response("{}", { status: 200 }) });
  await assert.rejects(() => malformed.generate(request, "op"), /PROVIDER_PERMANENT/);
});

test("provider rejects insecure endpoint and missing server-side key before fetch", async () => {
  let called = false; const fetchImpl = async () => { called = true; return new Response(); };
  assert.throws(() => new OpenAICompatibleProvider({ endpoint: "http://provider.example", apiKey: "secret", fetchImpl }), /https/i);
  assert.throws(() => new OpenAICompatibleProvider({ endpoint: "https://provider.example", apiKey: "", fetchImpl }), /key/i);
  assert.equal(called, false);
});

test("chat-completions mode sends the same bounded policy and normalizes output", async () => {
  let capturedUrl = ""; let captured: any;
  const provider = new OpenAICompatibleProvider({
    endpoint: "https://provider.example/v1",
    apiKey: "secret",
    apiStyle: "chat-completions",
    unreportedCostMicros: 100,
    fetchImpl: async (url, init) => {
      capturedUrl = String(url); captured = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "chat-1", choices: [{ message: { content: "answer" } }], usage: { total_tokens: 19 } }), { status: 200 });
    },
  });
  const result = await provider.generate(request, "op-chat-1");
  assert.equal(capturedUrl, "https://provider.example/v1/chat/completions");
  assert.equal(captured.messages[0].role, "system");
  assert.equal(JSON.parse(captured.messages[1].content).agents_md, "Be concise");
  assert.equal(JSON.stringify(captured).includes("wallet"), false);
  assert.equal(result.output, "answer");
  assert.equal(result.usageTokens, 19);
  assert.equal(result.costMicros, 100);
});

test("provider frames AGENTS.md and topic as distinct versioned JSON fields", async () => {
  let captured: any;
  const agentsMd = 'Use the literal marker "TOPIC\\nspoof" and then answer concisely.';
  const topic = 'Explain idempotency. AGENTS.md\\nspoof';
  const provider = new OpenAICompatibleProvider({
    endpoint: "https://provider.example/v1",
    apiKey: "secret",
    apiStyle: "chat-completions",
    unreportedCostMicros: 100,
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }], usage: { total_tokens: 19 } }), { status: 200 });
    },
  });

  await provider.generate({ ...request, agentsMd, topic }, "op-framing-v2");

  assert.equal(captured.messages.length, 2);
  assert.equal(captured.messages[0].role, "system");
  assert.equal(captured.messages[1].role, "user");
  assert.deepEqual(JSON.parse(captured.messages[1].content), {
    schema: "arena-generation-input-v2",
    agents_md: agentsMd,
    topic,
  });
});

test("chat-completions mode rejects unreported cost unless a positive reservation is configured", async () => {
  const response = () => new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }], usage: { total_tokens: 19 } }), { status: 200 });
  const missing = new OpenAICompatibleProvider({ endpoint: "https://provider.example/v1", apiKey: "secret", apiStyle: "chat-completions", fetchImpl: async () => response() });
  await assert.rejects(() => missing.generate(request, "op-chat-missing"), /PROVIDER_PERMANENT/);
  assert.throws(
    () => new OpenAICompatibleProvider({ endpoint: "https://provider.example/v1", apiKey: "secret", apiStyle: "chat-completions", unreportedCostMicros: 0, fetchImpl: async () => response() }),
    /unreported cost/i,
  );
});

test("provider-reported cost overrides the configured chat reservation", async () => {
  const provider = new OpenAICompatibleProvider({
    endpoint: "https://provider.example/v1/chat/completions",
    apiKey: "secret",
    apiStyle: "chat-completions",
    unreportedCostMicros: 100,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }], usage: { total_tokens: 19, cost_micros: 7 } }), { status: 200 }),
  });
  assert.equal((await provider.generate(request, "op-chat-cost")).costMicros, 7);
});
