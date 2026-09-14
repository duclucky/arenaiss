import { test } from "node:test";
import * as assert from "node:assert";
import { createHash } from "node:crypto";
import { ArenaStore } from "../src/store.ts";
import type { TournamentRecord, EntrantRecord, MatchRecord, AttemptRecord, OutboxEvent, Snapshot } from "../src/store.ts";
import type { Digest } from "../../protocol/src/canonical.ts";

const dummyDigest = (id: string): Digest => `sha256:${createHash("sha256").update(id).digest("hex")}`;

test("duplicate tournament is idempotent only for identical payload", () => {
    const store = new ArenaStore();
    const tId = dummyDigest("1");
    const t: TournamentRecord = { tournamentId: tId, policy: { a: 1 }, state: "ACTIVE", createdAt: 123 };
    
    store.transact(tx => {
        tx.addTournament(t);
    });
    
    // Identical payload
    store.transact(tx => {
        tx.addTournament({ ...t });
    });
    
    assert.strictEqual(store.tournaments.length, 1);
    
    // Conflicting payload
    assert.throws(() => {
        store.transact(tx => {
            tx.addTournament({ ...t, state: "COMPLETE" });
        });
    }, /Conflict/);
    
    assert.strictEqual(store.tournaments.length, 1);
});

test("entrant composite uniqueness rejects a second registration", () => {
    const store = new ArenaStore();
    const tId = dummyDigest("1");
    const e1: EntrantRecord = { entrantId: dummyDigest("e1"), tournamentId: tId, walletAddress: "0x123", agentId: "agent1", agentsDigest: dummyDigest("a1"), state: "ACCEPTED", createdAt: 1 };
    
    store.transact(tx => tx.addEntrant(e1));
    
    // Identical
    store.transact(tx => tx.addEntrant({ ...e1 }));
    assert.strictEqual(store.entrants.length, 1);
    
    // Different entrantId, same composite
    const e2: EntrantRecord = { ...e1, entrantId: dummyDigest("e2") };
    assert.throws(() => {
        store.transact(tx => tx.addEntrant(e2));
    }, /Conflict/);
    
    assert.strictEqual(store.entrants.length, 1);
});

test("attempt history is append only and duplicate attempt is idempotent", () => {
    const store = new ArenaStore();
    const mId = dummyDigest("m1");
    const a1: AttemptRecord = { attemptId: dummyDigest("a1"), matchId: mId, attemptNumber: 1, topicDigest: dummyDigest("t"), outputADigest: dummyDigest("oa"), outputBDigest: dummyDigest("ob"), state: "FINALIZED", createdAt: 1 };
    
    store.transact(tx => tx.addAttempt(a1));
    store.transact(tx => tx.addAttempt({ ...a1 })); // Idempotent
    
    assert.strictEqual(store.attempts.length, 1);
    
    // Conflicting payload
    assert.throws(() => {
        store.transact(tx => tx.addAttempt({ ...a1, state: "FAILED" }));
    }, /Conflict/);
    
    // Different attemptId, same match + attemptNumber
    const a2: AttemptRecord = { ...a1, attemptId: dummyDigest("a2") };
    assert.throws(() => {
        store.transact(tx => tx.addAttempt(a2));
    }, /Conflict/);
});

test("conflicting match and outbox operation reject without mutation", () => {
    const store = new ArenaStore();
    const m: MatchRecord = { matchId: dummyDigest("m1"), tournamentId: dummyDigest("t1"), stage: "s1", roundNumber: 1, slotA: "a", slotB: "b", state: "PENDING", createdAt: 1 };
    const o: OutboxEvent = { eventId: dummyDigest("e1"), kind: "k", aggregateId: dummyDigest("agg1"), operationKey: "op1", payload: "data", createdAt: 1 };
    
    store.transact(tx => {
        tx.addMatch(m);
        tx.enqueueOutbox(o);
    });
    
    assert.strictEqual(store.matches.length, 1);
    assert.strictEqual(store.outbox.length, 1);
    
    // Conflicting match payload
    assert.throws(() => {
        store.transact(tx => tx.addMatch({ ...m, stage: "s2" }));
    }, /Conflict/);
    assert.strictEqual(store.matches.length, 1);
});

test("transaction rolls back records and outbox atomically", () => {
    const store = new ArenaStore();
    const m1: MatchRecord = { matchId: dummyDigest("m1"), tournamentId: dummyDigest("t1"), stage: "s1", roundNumber: 1, slotA: "a", slotB: "b", state: "PENDING", createdAt: 1 };
    const o1: OutboxEvent = { eventId: dummyDigest("e1"), kind: "k", aggregateId: dummyDigest("agg1"), operationKey: "op1", payload: "data", createdAt: 1 };
    
    assert.throws(() => {
        store.transact(tx => {
            tx.addMatch(m1);
            tx.enqueueOutbox(o1);
            throw new Error("Abort");
        });
    }, /Abort/);
    
    assert.strictEqual(store.matches.length, 0);
    assert.strictEqual(store.outbox.length, 0);
});

test("snapshot restore is deterministic and exposes no mutable internals", () => {
    const store = new ArenaStore();
    const m1: MatchRecord = { matchId: dummyDigest("m2"), tournamentId: dummyDigest("t1"), stage: "s1", roundNumber: 1, slotA: "a", slotB: "b", state: "PENDING", createdAt: 1 };
    const m2: MatchRecord = { matchId: dummyDigest("m1"), tournamentId: dummyDigest("t1"), stage: "s1", roundNumber: 1, slotA: "a", slotB: "b", state: "PENDING", createdAt: 1 };
    
    store.transact(tx => {
        tx.addMatch(m1);
        tx.addMatch(m2);
    });
    
    const snap1 = store.snapshot();
    // Test determinism (sorting)
    const sortedMatchIds = [dummyDigest("m1"), dummyDigest("m2")].sort();
    assert.deepStrictEqual(snap1.matches.map(match => match.matchId), sortedMatchIds);
    
    // Exposes no mutable internals
    snap1.matches[0].stage = "mutated";
    assert.strictEqual(store.matches[0].stage, "s1"); // Or whatever the original was
    assert.strictEqual(store.snapshot().matches[0].stage, "s1"); // m1 comes first, stage is s1
    
    const store2 = ArenaStore.fromSnapshot(store.snapshot());
    const snap2 = store2.snapshot();
    
    assert.deepStrictEqual(store.snapshot(), snap2);
});

test("outbox operation key is exactly once across repeated enqueue", () => {
    const store = new ArenaStore();
    const o: OutboxEvent = { eventId: dummyDigest("e1"), kind: "k", aggregateId: dummyDigest("agg1"), operationKey: "op1", payload: "data", createdAt: 1 };
    
    store.transact(tx => {
        tx.enqueueOutbox(o);
        tx.enqueueOutbox({ ...o });
    });
    
    assert.strictEqual(store.outbox.length, 1);
    
    assert.throws(() => {
        store.transact(tx => tx.enqueueOutbox({ ...o, payload: "differ" }));
    }, /Conflict/);
    
    assert.strictEqual(store.outbox.length, 1);
});

test("snapshot orders every collection by primary identifier", () => {
    const store = new ArenaStore();
    const firstId = dummyDigest("event-a");
    const secondId = dummyDigest("event-b");
    const [lowId, highId] = [firstId, secondId].sort();
    const operationKeyForLowId = "operation-z";
    const operationKeyForHighId = "operation-a";

    const event = (eventId: Digest, operationKey: string): OutboxEvent => ({
        eventId,
        kind: "MATCH_READY",
        aggregateId: dummyDigest("aggregate"),
        operationKey,
        payload: {},
        createdAt: 1,
    });

    store.transact(tx => {
        tx.enqueueOutbox(event(highId, operationKeyForHighId));
        tx.enqueueOutbox(event(lowId, operationKeyForLowId));
    });

    assert.deepStrictEqual(store.snapshot().outbox.map(item => item.eventId), [lowId, highId]);
});

test("malformed digest fields reject before mutation", () => {
    const invalid = "not-a-digest" as Digest;
    const valid = dummyDigest("valid");
    const cases: Array<(store: ArenaStore) => void> = [
        store => store.transact(tx => tx.addTournament({ tournamentId: invalid, policy: {}, state: "ACTIVE", createdAt: 1 })),
        store => store.transact(tx => tx.addEntrant({ entrantId: invalid, tournamentId: valid, walletAddress: "0x123", agentId: "a", agentsDigest: valid, state: "ACCEPTED", createdAt: 1 })),
        store => store.transact(tx => tx.addEntrant({ entrantId: valid, tournamentId: invalid, walletAddress: "0x123", agentId: "a", agentsDigest: valid, state: "ACCEPTED", createdAt: 1 })),
        store => store.transact(tx => tx.addEntrant({ entrantId: valid, tournamentId: valid, walletAddress: "0x123", agentId: "a", agentsDigest: invalid, state: "ACCEPTED", createdAt: 1 })),
        store => store.transact(tx => tx.addMatch({ matchId: invalid, tournamentId: valid, stage: "main", roundNumber: 1, slotA: "a", slotB: "b", state: "PENDING", createdAt: 1 })),
        store => store.transact(tx => tx.addMatch({ matchId: valid, tournamentId: invalid, stage: "main", roundNumber: 1, slotA: "a", slotB: "b", state: "PENDING", createdAt: 1 })),
        store => store.transact(tx => tx.addAttempt({ attemptId: invalid, matchId: valid, attemptNumber: 1, topicDigest: valid, outputADigest: valid, outputBDigest: valid, state: "CREATED", createdAt: 1 })),
        store => store.transact(tx => tx.addAttempt({ attemptId: valid, matchId: invalid, attemptNumber: 1, topicDigest: valid, outputADigest: valid, outputBDigest: valid, state: "CREATED", createdAt: 1 })),
        store => store.transact(tx => tx.addAttempt({ attemptId: valid, matchId: valid, attemptNumber: 1, topicDigest: invalid, outputADigest: valid, outputBDigest: valid, state: "CREATED", createdAt: 1 })),
        store => store.transact(tx => tx.addAttempt({ attemptId: valid, matchId: valid, attemptNumber: 1, topicDigest: valid, outputADigest: invalid, outputBDigest: valid, state: "CREATED", createdAt: 1 })),
        store => store.transact(tx => tx.addAttempt({ attemptId: valid, matchId: valid, attemptNumber: 1, topicDigest: valid, outputADigest: valid, outputBDigest: invalid, state: "CREATED", createdAt: 1 })),
        store => store.transact(tx => tx.enqueueOutbox({ eventId: invalid, kind: "k", aggregateId: valid, operationKey: "op", payload: {}, createdAt: 1 })),
        store => store.transact(tx => tx.enqueueOutbox({ eventId: valid, kind: "k", aggregateId: invalid, operationKey: "op", payload: {}, createdAt: 1 })),
    ];

    for (const run of cases) {
        const store = new ArenaStore();
        assert.throws(() => run(store), /digest/i);
        assert.deepStrictEqual(store.snapshot(), {
            tournaments: [], entrants: [], matches: [], attempts: [], outbox: [],
        });
    }
});

test("snapshot restore rejects malformed and duplicate identity keys", () => {
    const tournament: TournamentRecord = {
        tournamentId: dummyDigest("tournament"), policy: {}, state: "ACTIVE", createdAt: 1,
    };
    const entrant: EntrantRecord = {
        entrantId: dummyDigest("entrant-a"), tournamentId: tournament.tournamentId,
        walletAddress: "0x123", agentId: "agent", agentsDigest: dummyDigest("agents"),
        state: "ACCEPTED", createdAt: 1,
    };
    const event: OutboxEvent = {
        eventId: dummyDigest("event"), kind: "k", aggregateId: tournament.tournamentId,
        operationKey: "operation", payload: {}, createdAt: 1,
    };
    const base: Snapshot = {
        tournaments: [tournament], entrants: [entrant], matches: [], attempts: [], outbox: [event],
    };

    const malformed: Snapshot = structuredClone(base);
    malformed.tournaments[0].tournamentId = "bad" as Digest;
    assert.throws(() => ArenaStore.fromSnapshot(malformed), /digest/i);

    const duplicatePrimary: Snapshot = structuredClone(base);
    duplicatePrimary.outbox.push({ ...event });
    assert.throws(() => ArenaStore.fromSnapshot(duplicatePrimary), /duplicate.*event/i);

    const duplicateComposite: Snapshot = structuredClone(base);
    duplicateComposite.entrants.push({ ...entrant, entrantId: dummyDigest("entrant-b") });
    assert.throws(() => ArenaStore.fromSnapshot(duplicateComposite), /duplicate.*entrant/i);
});
