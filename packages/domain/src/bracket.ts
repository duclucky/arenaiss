import { createHash } from "node:crypto";
import { isDigest, matchId, type Digest } from "../../protocol/src/canonical.ts";

export type SlotRef = { kind: "entrant" | "winner" | "loser"; id: string };
export type MatchStage = "preliminary" | "main" | "third_place" | "fifth_place";
export type MatchBlueprint = {
  matchId: Digest;
  stage: MatchStage;
  roundNumber: number;
  matchIndex: number;
  slotA: SlotRef;
  slotB: SlotRef;
};
export type BracketBlueprint = {
  entrantCount: number;
  preliminaryMatchCount: number;
  byeCount: number;
  matches: MatchBlueprint[];
  rankSources: SlotRef[];
  byes?: Array<{ roundNumber: number; slot: SlotRef }>;
};
export type BracketInput = {
  tournamentId: Digest;
  seedDigest: Digest;
  entrants: readonly Digest[];
  bracketRevision: number;
};
export type PublicBracketSeed = {
  schema: "arena-bracket-seed-v2";
  seedDigest: Digest;
  rosterDigest: Digest;
  entropyBlockHash: string;
  entropyBlockNumber: string;
};
export type PublicBracketSeedInput = {
  tournamentId: Digest;
  entrants: readonly Digest[];
  entropyBlockHash: string;
  entropyBlockNumber: string;
};

function invalid(message: string): never { throw new Error(`invalid bracket: ${message}`); }
function sha(value: string): Digest { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
export function derivePublicBracketSeed(input: PublicBracketSeedInput): PublicBracketSeed {
  if (!input || !isDigest(input.tournamentId)) invalid("tournament digest is required for public seed");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.entropyBlockHash)) invalid("Arc entropy block hash is malformed");
  if (!/^(0|[1-9][0-9]*)$/.test(input.entropyBlockNumber)) invalid("Arc entropy block number is malformed");
  if (input.entrants.length < 8 || input.entrants.length > 32 || input.entrants.some((id) => !isDigest(id)) || new Set(input.entrants).size !== input.entrants.length) invalid("public seed roster is invalid");
  const entrants = [...input.entrants].sort();
  const entropyBlockHash = input.entropyBlockHash.toLowerCase();
  const rosterDigest = sha(JSON.stringify({ schema: "arena-bracket-roster-v1", entrants }));
  const seedDigest = sha(JSON.stringify({ schema: "arena-bracket-seed-v2", tournament_id: input.tournamentId, roster_digest: rosterDigest, entropy_block_hash: entropyBlockHash }));
  return { schema: "arena-bracket-seed-v2", seedDigest, rosterDigest, entropyBlockHash, entropyBlockNumber: input.entropyBlockNumber };
}
function stableOrder(seedDigest: Digest, entrants: readonly Digest[]): Digest[] {
  return [...entrants].sort((a, b) => {
    const left = createHash("sha256").update(Buffer.concat([Buffer.from("seed-order-v1"), Buffer.from(seedDigest), Buffer.from(a)])).digest("hex");
    const right = createHash("sha256").update(Buffer.concat([Buffer.from("seed-order-v1"), Buffer.from(seedDigest), Buffer.from(b)])).digest("hex");
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
function slot(kind: SlotRef["kind"], id: string): SlotRef { return { kind, id }; }
function slotText(ref: SlotRef): string { return `${ref.kind}:${ref.id}`; }
function makeMatch(input: BracketInput, stage: MatchStage, roundNumber: number, matchIndex: number, slotA: SlotRef, slotB: SlotRef): MatchBlueprint {
  return { matchId: matchId(input.tournamentId, stage, roundNumber, matchIndex, slotText(slotA), slotText(slotB), input.bracketRevision), stage, roundNumber, matchIndex, slotA, slotB };
}

export function buildBracket(input: BracketInput): BracketBlueprint {
  if (!input || !isDigest(input.tournamentId) || !isDigest(input.seedDigest)) invalid("tournament and seed digests are required");
  if (!Number.isSafeInteger(input.bracketRevision) || input.bracketRevision < 0) invalid("bracket revision must be non-negative");
  const n = input.entrants.length;
  if (n < 8 || n > 32) invalid("entrant count must be within 8..32");
  if (input.entrants.some((id) => !isDigest(id))) invalid("entrant digest is malformed");
  if (new Set(input.entrants).size !== n) invalid("duplicate entrant");
  if (input.bracketRevision >= 2) return buildRollingByeBracket(input);
  const ordered = stableOrder(input.seedDigest, input.entrants);
  const power = 2 ** Math.floor(Math.log2(n));
  const preliminaryMatchCount = n - power;
  const byeCount = 2 * power - n;
  const matches: MatchBlueprint[] = [];
  const preliminary: MatchBlueprint[] = [];
  for (let i = 0; i < preliminaryMatchCount; i += 1) {
    const match = makeMatch(input, "preliminary", 0, i, slot("entrant", ordered[i * 2]), slot("entrant", ordered[i * 2 + 1]));
    preliminary.push(match);
    matches.push(match);
  }
  const sources: SlotRef[] = preliminary.map((m) => slot("winner", m.matchId));
  sources.push(...ordered.slice(preliminaryMatchCount * 2).map((id) => slot("entrant", id)));
  sources.sort((a, b) => {
    const left = createHash("sha256").update(Buffer.concat([Buffer.from("main-placement-v1"), Buffer.from(input.seedDigest), Buffer.from(slotText(a))])).digest("hex");
    const right = createHash("sha256").update(Buffer.concat([Buffer.from("main-placement-v1"), Buffer.from(input.seedDigest), Buffer.from(slotText(b))])).digest("hex");
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const mainRounds: MatchBlueprint[][] = [];
  let roundSources = sources;
  let roundNumber = 1;
  while (roundSources.length > 1) {
    const round: MatchBlueprint[] = [];
    for (let i = 0; i < roundSources.length; i += 2) {
      const m = makeMatch(input, "main", roundNumber, i / 2, roundSources[i], roundSources[i + 1]);
      round.push(m);
      matches.push(m);
    }
    mainRounds.push(round);
    roundSources = round.map((m) => slot("winner", m.matchId));
    roundNumber += 1;
  }
  const semifinals = mainRounds[mainRounds.length - 2];
  const quarterfinals = mainRounds[mainRounds.length - 3];
  if (!semifinals || semifinals.length !== 2 || !quarterfinals || quarterfinals.length !== 4) invalid("main bracket cannot produce placement paths");
  const third = makeMatch(input, "third_place", 1, 0, slot("loser", semifinals[0].matchId), slot("loser", semifinals[1].matchId));
  matches.push(third);
  const fifthA = makeMatch(input, "fifth_place", 1, 0, slot("loser", quarterfinals[0].matchId), slot("loser", quarterfinals[1].matchId));
  const fifthB = makeMatch(input, "fifth_place", 1, 1, slot("loser", quarterfinals[2].matchId), slot("loser", quarterfinals[3].matchId));
  const fifthFinal = makeMatch(input, "fifth_place", 2, 0, slot("winner", fifthA.matchId), slot("winner", fifthB.matchId));
  matches.push(fifthA, fifthB, fifthFinal);
  const final = mainRounds[mainRounds.length - 1][0];
  return {
    entrantCount: n,
    preliminaryMatchCount,
    byeCount,
    matches,
    rankSources: [slot("winner", final.matchId), slot("loser", final.matchId), slot("winner", third.matchId), slot("loser", third.matchId), slot("winner", fifthFinal.matchId)],
  };
}

function stableSlotOrder(seedDigest: Digest, label: string, sources: readonly SlotRef[]): SlotRef[] {
  return [...sources].sort((a, b) => {
    const left = createHash("sha256").update(Buffer.concat([Buffer.from(label), Buffer.from(seedDigest), Buffer.from(slotText(a))])).digest("hex");
    const right = createHash("sha256").update(Buffer.concat([Buffer.from(label), Buffer.from(seedDigest), Buffer.from(slotText(b))])).digest("hex");
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function buildRollingByeBracket(input: BracketInput): BracketBlueprint {
  const matches: MatchBlueprint[] = [];
  const mainRounds: MatchBlueprint[][] = [];
  const byes: Array<{ roundNumber: number; slot: SlotRef }> = [];
  let sources = stableOrder(input.seedDigest, input.entrants).map((id) => slot("entrant", id));
  let roundNumber = 1;
  while (sources.length > 1) {
    const ordered = stableSlotOrder(input.seedDigest, `rolling-bye-round-${roundNumber}-v1`, sources);
    const bye = ordered.length % 2 === 1 ? ordered.shift()! : undefined;
    if (bye) byes.push({ roundNumber, slot: bye });
    const round: MatchBlueprint[] = [];
    for (let index = 0; index < ordered.length; index += 2) {
      const match = makeMatch(input, "main", roundNumber, index / 2, ordered[index], ordered[index + 1]);
      round.push(match); matches.push(match);
    }
    mainRounds.push(round);
    sources = [...(bye ? [bye] : []), ...round.map((match) => slot("winner", match.matchId))];
    roundNumber += 1;
  }
  const final = mainRounds.at(-1)?.[0];
  if (!final || mainRounds.at(-1)?.length !== 1) invalid("rolling bracket did not produce a final");
  const placementCandidates = mainRounds.slice(0, -1).reverse()
    .flatMap((round, reverseRoundIndex) => stableSlotOrder(input.seedDigest, `rolling-placement-${reverseRoundIndex}-v1`, round.map((match) => slot("loser", match.matchId))))
    .slice(0, 3);
  if (placementCandidates.length !== 3) invalid("rolling bracket cannot produce top-five placement paths");
  const fifth = makeMatch(input, "fifth_place", 1, 0, placementCandidates[1], placementCandidates[2]);
  const third = makeMatch(input, "third_place", 1, 0, placementCandidates[0], slot("winner", fifth.matchId));
  const detachedFinal = matches.pop();
  if (detachedFinal?.matchId !== final.matchId) invalid("rolling final ordering is invalid");
  matches.push(fifth, third, final);
  return {
    entrantCount: input.entrants.length,
    preliminaryMatchCount: 0,
    byeCount: byes.length,
    byes,
    matches,
    rankSources: [slot("winner", final.matchId), slot("loser", final.matchId), slot("winner", third.matchId), slot("loser", third.matchId), slot("loser", fifth.matchId)],
  };
}
