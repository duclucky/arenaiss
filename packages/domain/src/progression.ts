import type { BracketBlueprint, SlotRef } from "./bracket.ts";
import type { Digest } from "../../protocol/src/canonical.ts";

export type MatchResult = "A_WIN" | "B_WIN" | "TIE" | "RETRYABLE";
export type Progression = { status: "PENDING" | "COMPLETE"; ranking?: Digest[] };

function invalid(message: string): never { throw new Error(`invalid progression: ${message}`); }

export function advanceBracket(blueprint: BracketBlueprint, results: ReadonlyMap<Digest, MatchResult>): Progression {
  const matches = new Map(blueprint.matches.map((match) => [match.matchId, match]));
  for (const [id, result] of results) {
    if (!matches.has(id)) invalid("unknown or extra match result");
    if (result !== "A_WIN" && result !== "B_WIN" && result !== "TIE" && result !== "RETRYABLE") invalid("result enum is invalid");
  }
  const resolve = (ref: SlotRef, path: Set<string>): Digest | null => {
    if (ref.kind === "entrant") return ref.id as Digest;
    const parent = matches.get(ref.id);
    if (!parent) invalid(`missing predecessor match ${ref.id}`);
    if (path.has(parent.matchId)) invalid("cyclic ancestry");
    const result = results.get(parent.matchId);
    if (!result || result === "TIE" || result === "RETRYABLE") return null;
    const nextPath = new Set(path);
    nextPath.add(parent.matchId);
    const selected = result === "A_WIN" ? parent.slotA : parent.slotB;
    const discarded = result === "A_WIN" ? parent.slotB : parent.slotA;
    return resolve(ref.kind === "winner" ? selected : discarded, nextPath);
  };
  const ranking: Digest[] = [];
  for (const source of blueprint.rankSources) {
    const entrant = resolve(source, new Set());
    if (!entrant) return { status: "PENDING" };
    if (ranking.includes(entrant)) invalid("duplicate entrant in ranking");
    ranking.push(entrant);
  }
  if (ranking.length !== 5) invalid("top-five ranking must contain exactly five entrants");
  return { status: "COMPLETE", ranking };
}
