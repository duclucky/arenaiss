import { attemptId, type Digest } from "../../protocol/src/canonical.ts";
import { buildBracket, type MatchBlueprint, type SlotRef } from "../../domain/src/bracket.ts";
import { advanceBracket, type MatchResult } from "../../domain/src/progression.ts";

type Entrant = {
  entrantId: Digest;
  agentId: Digest;
  agentsVersion: Digest;
  agentsMd: string;
  agentsCommitment: Digest;
};

type InferenceInput = {
  tournamentId: Digest;
  matchId: Digest;
  attemptId: Digest;
  topic: string;
  agentA: Entrant;
  agentB: Entrant;
};

type PairOutput = { state: "OUTPUTS_READY" | "PARTIAL_PAIR"; outputA?: string; outputB?: string; outputADigest?: Digest; outputBDigest?: Digest };

export interface OrchestratorInference { run(input: InferenceInput): Promise<PairOutput>; }
export type OrchestratorJudgeOutcome =
  | { state: "SUBMITTED" | "PENDING" | "ACCEPTED" }
  | { state: "FAILED" }
  | { state: "FINALIZED"; result: MatchResult };
export interface OrchestratorJudge { judge(input: InferenceInput & Required<Omit<PairOutput, "state">>): Promise<OrchestratorJudgeOutcome>; }

export type OrchestratorInput = {
  tournamentId: Digest;
  seedDigest: Digest;
  entrants: readonly Entrant[];
  topics: readonly string[];
  bracketRevision: number;
  retryCap: number;
  expiresAt: number;
  now: () => number;
  abandonedAttemptIds?: readonly Digest[];
};

export type OrchestratorResult =
  | { state: "RANKING_READY"; ranking: Digest[]; results: ReadonlyMap<Digest, MatchResult> }
  | { state: "WAITING_FOR_JUDGE"; matchId: Digest; attemptId: Digest }
  | { state: "RECOVERY_REQUIRED"; matchId: Digest; attemptId: Digest }
  | { state: "REFUND_REQUIRED"; reason: "TOURNAMENT_EXPIRED" | "RETRY_EXHAUSTED" };

export class TournamentOrchestrator {
  private inference: OrchestratorInference;
  private judge: OrchestratorJudge;
  constructor(inference: OrchestratorInference, judge: OrchestratorJudge) { this.inference = inference; this.judge = judge; }

  async run(input: OrchestratorInput): Promise<OrchestratorResult> {
    if (input.now() >= input.expiresAt) return { state: "REFUND_REQUIRED", reason: "TOURNAMENT_EXPIRED" };
    if (!input.topics.length || input.topics.some((topic) => !topic)) throw new Error("topic deck is empty or invalid");
    if (!Number.isSafeInteger(input.retryCap) || input.retryCap < 1) throw new Error("retry cap is invalid");
    const abandonedAttemptIds = new Set(input.abandonedAttemptIds ?? []);
    if (abandonedAttemptIds.size !== (input.abandonedAttemptIds?.length ?? 0)) throw new Error("duplicate abandoned attempt ID");
    const entrantMap = new Map(input.entrants.map((entrant) => [entrant.entrantId, entrant]));
    if (entrantMap.size !== input.entrants.length) throw new Error("duplicate tournament entrant");
    const bracket = buildBracket({ tournamentId: input.tournamentId, seedDigest: input.seedDigest, entrants: input.entrants.map((entrant) => entrant.entrantId), bracketRevision: input.bracketRevision });
    const results = new Map<Digest, MatchResult>();

    for (const match of bracket.matches) {
      const sideAId = this.resolveSlot(match.slotA, bracket.matches, results);
      const sideBId = this.resolveSlot(match.slotB, bracket.matches, results);
      if (!sideAId || !sideBId) throw new Error(`predecessor is not terminal for ${match.matchId}`);
      const agentA = entrantMap.get(sideAId); const agentB = entrantMap.get(sideBId);
      if (!agentA || !agentB) throw new Error("resolved entrant is missing");
      let terminal: MatchResult | undefined;
      for (let number = 1; number <= input.retryCap; number += 1) {
        if (input.now() >= input.expiresAt) return { state: "REFUND_REQUIRED", reason: "TOURNAMENT_EXPIRED" };
        const currentAttempt = attemptId(match.matchId, number);
        if (abandonedAttemptIds.has(currentAttempt)) continue;
        const context: InferenceInput = { tournamentId: input.tournamentId, matchId: match.matchId, attemptId: currentAttempt, topic: input.topics[(match.matchIndex + number - 1) % input.topics.length], agentA, agentB };
        const pair = await this.inference.run(context);
        if (pair.state !== "OUTPUTS_READY" || !pair.outputA || !pair.outputB || !pair.outputADigest || !pair.outputBDigest) return { state: "RECOVERY_REQUIRED", matchId: match.matchId, attemptId: currentAttempt };
        let outcome: OrchestratorJudgeOutcome;
        try {
          outcome = await this.judge.judge({ ...context, outputA: pair.outputA, outputB: pair.outputB, outputADigest: pair.outputADigest, outputBDigest: pair.outputBDigest });
        } catch {
          return { state: "RECOVERY_REQUIRED", matchId: match.matchId, attemptId: currentAttempt };
        }
        if (outcome.state === "SUBMITTED" || outcome.state === "PENDING" || outcome.state === "ACCEPTED") {
          return { state: "WAITING_FOR_JUDGE", matchId: match.matchId, attemptId: currentAttempt };
        }
        if (outcome.state === "FAILED") return { state: "RECOVERY_REQUIRED", matchId: match.matchId, attemptId: currentAttempt };
        const verdict = outcome.result;
        if (verdict === "A_WIN" || verdict === "B_WIN") { terminal = verdict; break; }
      }
      if (!terminal) return { state: "REFUND_REQUIRED", reason: "RETRY_EXHAUSTED" };
      results.set(match.matchId, terminal);
    }
    const progression = advanceBracket(bracket, results);
    if (progression.status !== "COMPLETE" || !progression.ranking) throw new Error("complete match set did not produce ranking");
    return { state: "RANKING_READY", ranking: progression.ranking, results };
  }

  private resolveSlot(slot: SlotRef, matches: readonly MatchBlueprint[], results: ReadonlyMap<Digest, MatchResult>): Digest | null {
    if (slot.kind === "entrant") return slot.id as Digest;
    const match = matches.find((candidate) => candidate.matchId === slot.id);
    if (!match) throw new Error("unknown predecessor match");
    const result = results.get(match.matchId);
    if (result !== "A_WIN" && result !== "B_WIN") return null;
    const selected = slot.kind === "winner"
      ? (result === "A_WIN" ? match.slotA : match.slotB)
      : (result === "A_WIN" ? match.slotB : match.slotA);
    return this.resolveSlot(selected, matches, results);
  }
}
