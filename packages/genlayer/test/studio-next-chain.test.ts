import assert from "node:assert/strict";
import test from "node:test";

import { STUDIO_NEXT_CHAIN_ID, STUDIO_NEXT_RPC_URL, studioNextChain } from "../src/studio-next.ts";

test("all active GenLayer SDK factories use the canonical Studio Next RPC", () => {
  const chain = studioNextChain();
  assert.equal(STUDIO_NEXT_CHAIN_ID, 61997);
  assert.equal(STUDIO_NEXT_RPC_URL, "https://studio-next.genlayer.com/api");
  assert.equal(chain.id, STUDIO_NEXT_CHAIN_ID);
  assert.deepEqual(chain.rpcUrls.default.http, [STUDIO_NEXT_RPC_URL]);
});
