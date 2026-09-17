import { createHash } from "node:crypto";
import { attemptId, type Digest } from "../../protocol/src/canonical.ts";
import { buildBracket, type MatchBlueprint, type SlotRef } from "../../domain/src/bracket.ts";
import { advanceBracket, type MatchResult } from "../../domain/src/progression.ts";

export type Entrant = {
  entrantId: Digest;
  agentId: Digest;
  agentsVersion: Digest;
  agentsMd: string;
  agentsCommitment: Digest;
};

export type InferenceInput = {
  tournamentId: Digest;
  matchId: Digest;
  attemptId: Digest;
  topic: string;
  agentA: Entrant;
  agentB: Entrant;
};

export type PairOutput = { state: "OUTPUTS_READY" | "PARTIAL_PAIR"; outputA?: string; outputB?: string; outputADigest?: Digest; outputBDigest?: Digest; failureCode?: "EMPTY_OUTPUT" | "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "INVALID_OUTPUT" };

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
  topicSelection?: "seeded-shuffle-v1";
  bracketRevision: number;
  retryCap: number;
  maxConcurrentMatches?: number;
  expiresAt: number;
  now: () => number;
  abandonedAttemptIds?: readonly Digest[];
};

export type OrchestratorResult =
  | { state: "RANKING_READY"; ranking: Digest[]; results: ReadonlyMap<Digest, MatchResult> }
  | { state: "WAITING_FOR_JUDGE"; matchId: Digest; attemptId: Digest; results: ReadonlyMap<Digest, MatchResult>; activeMatches?: ReadonlyMap<Digest, "WAITING_FOR_JUDGE" | "RECOVERY_REQUIRED"> }
  | { state: "RECOVERY_REQUIRED"; matchId: Digest; attemptId: Digest; reason: "PROVIDER_INCOMPLETE" | "EMPTY_OUTPUT" | "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "INVALID_OUTPUT" | "JUDGE_ERROR" | "JUDGE_FAILED"; results: ReadonlyMap<Digest, MatchResult>; activeMatches?: ReadonlyMap<Digest, "WAITING_FOR_JUDGE" | "RECOVERY_REQUIRED"> }
  | { state: "REFUND_REQUIRED"; reason: "TOURNAMENT_EXPIRED" | "RETRY_EXHAUSTED" };

export class TournamentOrchestrator {
  private inference: OrchestratorInference;
  private judge: OrchestratorJudge;
  constructor(inference: OrchestratorInference, judge: OrchestratorJudge) { this.inference = inference; this.judge = judge; }

  async run(input: OrchestratorInput): Promise<OrchestratorResult> {
    if (input.now() >= input.expiresAt) return { state: "REFUND_REQUIRED", reason: "TOURNAMENT_EXPIRED" };
    if (!input.topics.length || input.topics.some((topic) => !topic)) throw new Error("topic deck is empty or invalid");
    if (input.topicSelection === "seeded-shuffle-v1" && new Set(input.topics).size !== input.topics.length) throw new Error("seeded topic deck contains duplicates");
    if (!Number.isSafeInteger(input.retryCap) || input.retryCap < 1) throw new Error("retry cap is invalid");
    if (input.maxConcurrentMatches !== undefined && (!Number.isSafeInteger(input.maxConcurrentMatches) || input.maxConcurrentMatches < 1 || input.maxConcurrentMatches > 4)) throw new Error("match concurrency is invalid");
    const abandonedAttemptIds = new Set(input.abandonedAttemptIds ?? []);
    if (abandonedAttemptIds.size !== (input.abandonedAttemptIds?.length ?? 0)) throw new Error("duplicate abandoned attempt ID");
    const entrantMap = new Map(input.entrants.map((entrant) => [entrant.entrantId, entrant]));
    if (entrantMap.size !== input.entrants.length) throw new Error("duplicate tournament entrant");
    const bracket = buildBracket({ tournamentId: input.tournamentId, seedDigest: input.seedDigest, entrants: input.entrants.map((entrant) => entrant.entrantId), bracketRevision: input.bracketRevision });
    const selectedTopics = input.topicSelection === "seeded-shuffle-v1"
      ? [...input.topics].sort((left, right) => {
        const leftRank = createHash("sha256").update(`arena-topic-shuffle-v1|${input.seedDigest}|${left}`).digest("hex");
        const rightRank = createHash("sha256").update(`arena-topic-shuffle-v1|${input.seedDigest}|${right}`).digest("hex");
        return leftRank < rightRank ? -1 : leftRank > rightRank ? 1 : left < right ? -1 : left > right ? 1 : 0;
      })
      : input.topics;
    const results = new Map<Digest, MatchResult>();
    if ((input.maxConcurrentMatches ?? 1) > 1) return this.runConcurrent(input, bracket.matches, entrantMap, selectedTopics, abandonedAttemptIds, results);

    for (const [matchOrdinal, match] of bracket.matches.entries()) {
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
        const topicIndex = input.topicSelection === "seeded-shuffle-v1" ? matchOrdinal + number - 1 : match.matchIndex + number - 1;
        const context: InferenceInput = { tournamentId: input.tournamentId, matchId: match.matchId, attemptId: currentAttempt, topic: selectedTopics[topicIndex % selectedTopics.length], agentA, agentB };
        const pair = await this.inference.run(context);
        if (pair.state !== "OUTPUTS_READY" || !pair.outputA || !pair.outputB || !pair.outputADigest || !pair.outputBDigest) return { state: "RECOVERY_REQUIRED", matchId: match.matchId, attemptId: currentAttempt, reason: pair.failureCode ?? "PROVIDER_INCOMPLETE", results };
        let outcome: OrchestratorJudgeOutcome;
        try {
          outcome = await this.judge.judge({ ...context, outputA: pair.outputA, outputB: pair.outputB, outputADigest: pair.outputADigest, outputBDigest: pair.outputBDigest });
        } catch {
          return { state: "RECOVERY_REQUIRED", matchId: match.matchId, attemptId: currentAttempt, reason: "JUDGE_ERROR", results };
        }
        if (outcome.state === "SUBMITTED" || outcome.state === "PENDING" || outcome.state === "ACCEPTED") {
          return { state: "WAITING_FOR_JUDGE", matchId: match.matchId, attemptId: currentAttempt, results };
        }
        if (outcome.state === "FAILED") return { state: "RECOVERY_REQUIRED", matchId: match.matchId, attemptId: currentAttempt, reason: "JUDGE_FAILED", results };
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

  private async runConcurrent(
    input: OrchestratorInput, matches: readonly MatchBlueprint[], entrants: ReadonlyMap<Digest, Entrant>,
    topics: readonly string[], abandoned: ReadonlySet<Digest>, results: Map<Digest, MatchResult>,
  ): Promise<OrchestratorResult> {
    let judgeTail = Promise.resolve();
    const judgeSerially = async (context: InferenceInput & Required<Omit<PairOutput, "state">>) => {
      const previous = judgeTail;
      let unlock = () => {};
      judgeTail = new Promise<void>((resolve) => { unlock = resolve; });
      await previous;
      try { return await this.judge.judge(context); } finally { unlock(); }
    };
    for (let start = 0; start < matches.length;) {
      let end = start + 1;
      while (end < matches.length && matches[end].stage === matches[start].stage && matches[end].roundNumber === matches[start].roundNumber) end += 1;
      const blocked: Array<Extract<OrchestratorResult, { state: "WAITING_FOR_JUDGE" | "RECOVERY_REQUIRED" }>> = [];
      for (let offset = start; offset < end; offset += input.maxConcurrentMatches!) {
        const batch = matches.slice(offset, Math.min(end, offset + input.maxConcurrentMatches!));
        const executions = await Promise.all(batch.map(async (match, index) => {
          const sideA = this.resolveSlot(match.slotA, matches, results);
          const sideB = this.resolveSlot(match.slotB, matches, results);
          if (!sideA || !sideB) throw new Error(`predecessor is not terminal for ${match.matchId}`);
          const agentA = entrants.get(sideA); const agentB = entrants.get(sideB);
          if (!agentA || !agentB) throw new Error("resolved entrant is missing");
          for (let number = 1; number <= input.retryCap; number += 1) {
            if (input.now() >= input.expiresAt) return { state: "REFUND_REQUIRED" as const, reason: "TOURNAMENT_EXPIRED" as const };
            const currentAttempt = attemptId(match.matchId, number);
            if (abandoned.has(currentAttempt)) continue;
            const topicIndex = input.topicSelection === "seeded-shuffle-v1" ? offset + index + number - 1 : match.matchIndex + number - 1;
            const context: InferenceInput = { tournamentId: input.tournamentId, matchId: match.matchId, attemptId: currentAttempt, topic: topics[topicIndex % topics.length], agentA, agentB };
            let pair: PairOutput;
            try { pair = await this.inference.run(context); }
            catch { return { state: "RECOVERY_REQUIRED" as const, matchId: match.matchId, attemptId: currentAttempt, reason: "PROVIDER_ERROR" as const }; }
            if (pair.state !== "OUTPUTS_READY" || !pair.outputA || !pair.outputB || !pair.outputADigest || !pair.outputBDigest) return { state: "RECOVERY_REQUIRED" as const, matchId: match.matchId, attemptId: currentAttempt, reason: pair.failureCode ?? "PROVIDER_INCOMPLETE" as const };
            let outcome: OrchestratorJudgeOutcome;
            try { outcome = await judgeSerially({ ...context, outputA: pair.outputA, outputB: pair.outputB, outputADigest: pair.outputADigest, outputBDigest: pair.outputBDigest }); }
            catch { return { state: "RECOVERY_REQUIRED" as const, matchId: match.matchId, attemptId: currentAttempt, reason: "JUDGE_ERROR" as const }; }
            if (outcome.state === "SUBMITTED" || outcome.state === "PENDING" || outcome.state === "ACCEPTED") return { state: "WAITING_FOR_JUDGE" as const, matchId: match.matchId, attemptId: currentAttempt };
            if (outcome.state === "FAILED") return { state: "RECOVERY_REQUIRED" as const, matchId: match.matchId, attemptId: currentAttempt, reason: "JUDGE_FAILED" as const };
            if (outcome.result === "A_WIN" || outcome.result === "B_WIN") return { state: "WIN" as const, matchId: match.matchId, result: outcome.result };
          }
          return { state: "REFUND_REQUIRED" as const, reason: "RETRY_EXHAUSTED" as const };
        }));
        for (const execution of executions) {
          if (execution.state === "WIN") results.set(execution.matchId, execution.result);
          else if (execution.state === "REFUND_REQUIRED") return execution;
          else blocked.push({ ...execution, results });
        }
      }
      if (blocked.length) {
        const activeMatches = new Map(blocked.map((item) => [item.matchId, item.state] as const));
        const selected = blocked.find((item) => item.state === "RECOVERY_REQUIRED") ?? blocked[0];
        return { ...selected, results, activeMatches };
      }
      start = end;
    }
    const progression = advanceBracket(buildBracket({ tournamentId: input.tournamentId, seedDigest: input.seedDigest, entrants: input.entrants.map((entrant) => entrant.entrantId), bracketRevision: input.bracketRevision }), results);
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
