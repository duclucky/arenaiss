import { createHash } from "node:crypto";

export type Digest = `sha256:${string}`;

type Field = readonly [string, string, string];

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGEST = /^sha256:[0-9a-fA-F]{64}$/;

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be non-empty text`);
  return value;
}

function requireAddress(value: unknown, name: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new TypeError(`${name} address is invalid`);
  return value.toLowerCase();
}

function requireDigest(value: unknown, name: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${name} digest is invalid`);
  return value.toLowerCase();
}

function requireUint(value: unknown, name: string): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return String(value);
}

function encodeField(fieldName: string, fieldType: string, value: string): Buffer {
  const name = Buffer.from(requireText(fieldName, "field name"), "utf8");
  const type = Buffer.from(requireText(fieldType, "field type"), "utf8");
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([name, Buffer.from([0]), type, Buffer.from([0]), length, bytes]);
}

export function canonicalDigest(kind: string, fields: readonly Field[]): Digest {
  const prefix = Buffer.from(`ASYNC_AGENT_ARENA|v1|${requireText(kind, "kind")}|`, "utf8");
  const body = Buffer.concat(fields.map(([name, type, value]) => encodeField(name, type, value)));
  return `sha256:${createHash("sha256").update(Buffer.concat([prefix, body])).digest("hex")}`;
}

export function tournamentId(arcChainId: unknown, escrowAddress: unknown, creatorAddress: unknown, creatorNonce: unknown): Digest {
  return canonicalDigest("tournament", [
    ["arc_chain_id", "u64", requireUint(arcChainId, "arc chain")],
    ["escrow_address", "address", requireAddress(escrowAddress, "escrow")],
    ["creator_address", "address", requireAddress(creatorAddress, "creator")],
    ["creator_nonce", "u64", requireUint(creatorNonce, "creator nonce")],
  ]);
}

export function entrantId(tournament: unknown, walletAddress: unknown, agentId: unknown, entryNonce: unknown): Digest {
  return canonicalDigest("entrant", [
    ["tournament_id", "digest", requireDigest(tournament, "tournament")],
    ["wallet_address", "address", requireAddress(walletAddress, "wallet")],
    ["agent_id", "text", requireText(agentId, "agent")],
    ["entry_nonce", "u64", requireUint(entryNonce, "entry nonce")],
  ]);
}

export function roundId(tournament: unknown, roundNumber: unknown, bracketRevision: unknown): Digest {
  return canonicalDigest("round", [
    ["tournament_id", "digest", requireDigest(tournament, "tournament")],
    ["round_number", "u32", requireUint(roundNumber, "round")],
    ["bracket_revision", "u32", requireUint(bracketRevision, "bracket revision")],
  ]);
}

export function matchId(tournament: unknown, stage: unknown, roundNumber: unknown, matchIndex: unknown, slotA: unknown, slotB: unknown, bracketRevision: unknown): Digest {
  return canonicalDigest("match", [
    ["tournament_id", "digest", requireDigest(tournament, "tournament")],
    ["stage", "text", requireText(stage, "stage")],
    ["round_number", "u32", requireUint(roundNumber, "round")],
    ["match_index", "u32", requireUint(matchIndex, "match index")],
    ["slot_a", "slot", requireText(slotA, "slot A")],
    ["slot_b", "slot", requireText(slotB, "slot B")],
    ["bracket_revision", "u32", requireUint(bracketRevision, "bracket revision")],
  ]);
}

export function attemptId(match: unknown, attemptNumber: unknown): Digest {
  return canonicalDigest("attempt", [
    ["match_id", "digest", requireDigest(match, "match")],
    ["attempt_number", "u32", requireUint(attemptNumber, "attempt")],
  ]);
}

export function isDigest(value: unknown): value is Digest { return typeof value === "string" && DIGEST.test(value); }
