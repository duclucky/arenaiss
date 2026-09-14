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
};
export type BracketInput = {
  tournamentId: Digest;
  seedDigest: Digest;
  entrants: readonly Digest[];
  bracketRevision: number;
};

function invalid(message: string): never { throw new Error(`invalid bracket: ${message}`); }
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
