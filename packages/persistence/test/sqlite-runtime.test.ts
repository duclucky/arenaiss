import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteRuntimeStore } from "../src/sqlite-runtime.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "arena-runtime-"));
  return { path: join(directory, "runtime.sqlite"), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("runtime records and counters survive database reopen", () => {
  const temp = fixture();
  try {
    const first = new SqliteRuntimeStore(temp.path);
    first.put("inference", "attempt:A", { state: "SUCCESS", outputDigest: "sha256:test" });
    assert.equal(first.increment("cost", "tournament-1", 25), 25);
    assert.equal(first.increment("cost", "tournament-1", 10), 35);
    first.close();

    const restarted = new SqliteRuntimeStore(temp.path);
    assert.deepEqual(restarted.get("inference", "attempt:A"), { state: "SUCCESS", outputDigest: "sha256:test" });
    assert.deepEqual(restarted.list("inference"), [{ state: "SUCCESS", outputDigest: "sha256:test" }]);
    assert.equal(restarted.counter("cost", "tournament-1"), 35);
    restarted.close();
  } finally {
    temp.cleanup();
  }
});

test("lease is exclusive across connections and expires deterministically", () => {
  const temp = fixture();
  try {
    const first = new SqliteRuntimeStore(temp.path);
    const second = new SqliteRuntimeStore(temp.path);
    assert.equal(first.claimLease("model", "attempt-1", "sha256:one", "worker-a", 100, 50), "CLAIMED");
    assert.equal(second.claimLease("model", "attempt-1", "sha256:one", "worker-b", 120, 50), "BUSY");
    assert.throws(() => second.claimLease("model", "attempt-1", "sha256:other", "worker-b", 120, 50), /conflicting.*lease/i);
    assert.equal(second.claimLease("model", "attempt-1", "sha256:one", "worker-b", 150, 50), "CLAIMED");
    assert.equal(first.releaseLease("model", "attempt-1", "worker-a"), false);
    assert.equal(second.releaseLease("model", "attempt-1", "worker-b"), true);
    first.close();
    second.close();
  } finally {
    temp.cleanup();
  }
});

test("invalid namespaces, keys, lease timing and non-JSON values reject before mutation", () => {
  const temp = fixture();
  try {
    const store = new SqliteRuntimeStore(temp.path);
    assert.throws(() => store.put("", "key", {}), /namespace/i);
    assert.throws(() => store.put("records", "", {}), /key/i);
    assert.throws(() => store.put("records", "bad", undefined), /JSON/i);
    assert.throws(() => store.claimLease("jobs", "one", "fingerprint", "owner", -1, 10), /time/i);
    assert.deepEqual(store.list("records"), []);
    store.close();
  } finally {
    temp.cleanup();
  }
});
