import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { entrantId as deriveEntrantId, isDigest } from "../../../packages/protocol/src/canonical.ts";
import type { SqliteRuntimeStore } from "../../../packages/persistence/src/sqlite-runtime.ts";
import type { EvaluationRunRecord } from "../../../packages/evaluation/src/run-tracker.ts";
import { validateEvaluationScenario, type EvaluationScenario } from "../../../packages/evaluation/src/protocol.ts";
import type { SoloCampaignRecord } from "../../../packages/evaluation/src/solo-runner.ts";

type Digest = `sha256:${string}`;
type AgentVersion = { agentId: Digest; agentsVersion: Digest; agentsCommitment: Digest; agentsMd: string; createdAt: number };
type Agent = { agentId: Digest; owner: string; name: string; versions: AgentVersion[] };
export type PublicAgent = Omit<AgentVersion, "agentsMd"> & { owner: string; name: string };
export type PublicTournamentStatus = "UPCOMING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type PublicTournament = { id: string; name: string; status: PublicTournamentStatus; entrantIds: readonly string[]; stakeAmount?: string; prizePool: string };
export type PublicMatchState = "SCHEDULED" | "WAITING_FOR_OUTPUTS" | "JUDGING" | "ACCEPTED" | "FAILED" | "RETRYABLE" | "FINALIZED" | "TIE" | "RETRY" | "WINNER_ADVANCED";
export type PublicMatch = { id: string; tournamentId: string; state: PublicMatchState; agentA: string; agentB: string; winner?: string; round: number };
export type PublicVerdictCriterion = { id: string; label: string; winner: "A" | "B" | "TIE"; reason: string };
export type PublicVerdict = {
  id: string; matchId: string; winner: "A" | "B" | "TIE"; reasons: readonly string[]; summary: string; transactionHash?: string;
  source?: "LIVE" | "PREVIEW"; rubricVersion?: string; attempt?: number; finality?: "SUBMITTED" | "ACCEPTED" | "FINALIZED";
  execution?: "PENDING" | "SUCCESS" | "FAILED"; scoreA?: number; scoreB?: number; criteria?: readonly PublicVerdictCriterion[];
  safetyClass?: string; canonicalMatchId?: string; attemptId?: string; network?: string; chainId?: number; judgeAddress?: string;
  arcTournamentId?: string; arcEscrowAddress?: string; grossPoolUsdc?: string; netPayoutUsdc?: string; platformFeeUsdc?: string; arcState?: string;
};
export type PreparedRegistration = { tournamentId: string; entrantId: string; agentId: string; agentsVersion: string; agentsCommitment: string; stakeAmount: string };
export type OwnedRegistration = Pick<PreparedRegistration, "tournamentId" | "entrantId">;
export type PublicEvaluationRun = {
  schema: "arena-public-evaluation-run-v1";
  runId: string;
  agentVersionId: string;
  mode: string;
  rubricVersion: string;
  scenario: { scenarioId: string; version: string; mode: string; digest: string };
  provider: { state: string };
  judge: { state: string; transactionHash?: string };
  scorecard?: { resultClass: string; overallScore: number; dimensions: Array<{ dimensionId: string; grade: string }>; actionsExecuted: false };
};
export type PrivateEvaluationRun = Omit<PublicEvaluationRun, "schema" | "scenario" | "provider" | "scorecard"> & {
  schema: "arena-private-evaluation-run-v1";
  scenario: Record<string, unknown> & { digest: string };
  provider: { state: string; requestId?: string; usageTokens?: number; output?: unknown };
  scorecard?: Record<string, unknown>;
};
export type EvaluationPackRecord = { schema: "arena-evaluation-pack-v1"; packId: Digest; version: string; owner: string; name: string; scenarios: EvaluationScenario[] };
export type PublicEvaluationPack = { schema: "arena-public-evaluation-pack-v1"; packId: string; version: string; name: string; scenarioIds: string[]; scenarioCount: number };
export type PublicEvaluationCampaign = { schema: "arena-public-evaluation-campaign-v1"; campaignId: string; agentVersionId: string; packId: string; packVersion: string; rubricVersion: string; state: string; items: Array<{ scenarioId: string; state: string; attempt: number; runIds: string[]; score?: string; overallScore?: number }> };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PUBLIC_TOURNAMENT_STATES = new Set<PublicTournamentStatus>(["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED"]);
const PUBLIC_MATCH_STATES = new Set<PublicMatchState>(["SCHEDULED", "WAITING_FOR_OUTPUTS", "JUDGING", "ACCEPTED", "FAILED", "RETRYABLE", "FINALIZED", "TIE", "RETRY", "WINNER_ADVANCED"]);
const TERMINAL_PUBLIC_MATCH_STATES = new Set<PublicMatchState>(["FINALIZED", "WINNER_ADVANCED", "TIE"]);
const sha = (value: string): Digest => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

export class ArenaApiService {
  private operator: string;
  private agents = new Map<Digest, Agent>();
  private tournaments = new Map<string, PublicTournament>();
  private matches = new Map<string, PublicMatch>();
  private verdicts = new Map<string, PublicVerdict>();
  private registrations = new Map<string, PreparedRegistration>();
  private evaluationPacks = new Map<string, EvaluationPackRecord>();
  private evaluationCampaigns = new Map<string, SoloCampaignRecord>();
  private nonce = 0;
  private runtime?: SqliteRuntimeStore;

  constructor(operator: string, runtime?: SqliteRuntimeStore) {
    this.operator = this.address(operator);
    this.runtime = runtime;
    if (runtime) {
      for (const agent of runtime.list<Agent>("api-agents")) this.agents.set(agent.agentId, agent);
      for (const tournament of runtime.list<PublicTournament>("api-tournaments")) this.tournaments.set(tournament.id, tournament);
      for (const match of runtime.list<PublicMatch>("api-matches")) this.matches.set(match.id, match);
      for (const verdict of runtime.list<PublicVerdict>("api-verdicts")) this.verdicts.set(verdict.matchId, verdict);
      for (const registration of runtime.list<PreparedRegistration>("api-registrations")) {
        const owner = this.agents.get(`sha256:${registration.agentId.slice(2)}` as Digest)?.owner;
        if (!owner) throw new Error("persisted registration references an unknown agent");
        this.registrations.set(this.registrationKey(`sha256:${registration.tournamentId.slice(2)}` as Digest, owner, `sha256:${registration.agentId.slice(2)}` as Digest), registration);
      }
      for (const pack of runtime.list<EvaluationPackRecord>("evaluation-packs")) this.evaluationPacks.set(this.packKey(pack.packId, pack.version), pack);
      for (const campaign of runtime.list<SoloCampaignRecord>("evaluation-campaigns")) this.evaluationCampaigns.set(campaign.campaignId, campaign);
      this.nonce = runtime.counter("api-counters", "agent-sequence");
    }
  }

  createAgent(caller: string, name: string, agentsMd: string): PublicAgent {
    const owner = this.address(caller); this.validateAgentText(name, agentsMd);
    this.nonce = this.runtime ? this.runtime.increment("api-counters", "agent-sequence", 1) : this.nonce + 1;
    const agentId = sha(`arena-agent-v1|${owner}|${this.nonce}|${name}`);
    const version = this.version(agentId, agentsMd, 1);
    const agent = { agentId, owner, name, versions: [version] };
    this.agents.set(agentId, agent);
    this.runtime?.put("api-agents", agentId, agent);
    return this.publicView(this.agents.get(agentId)!);
  }

  updateAgent(caller: string, agentId: Digest, agentsMd: string): PublicAgent {
    const agent = this.requireOwner(caller, agentId); this.validateAgentText(agent.name, agentsMd);
    agent.versions.push(this.version(agentId, agentsMd, agent.versions.length + 1));
    this.runtime?.put("api-agents", agentId, agent);
    return this.publicView(agent);
  }

  getPrivateAgent(caller: string, agentId: Digest): AgentVersion & { owner: string; name: string } {
    const agent = this.requireOwner(caller, agentId); return { ...structuredClone(agent.versions.at(-1)!), owner: agent.owner, name: agent.name };
  }

  getAgentVersion(caller: string, agentId: Digest, agentsVersion: Digest): AgentVersion {
    const agent = this.requireOwner(caller, agentId); const version = agent.versions.find((candidate) => candidate.agentsVersion === agentsVersion);
    if (!version) throw new Error("agent version not found"); return structuredClone(version);
  }

  getPublicAgent(agentId: Digest): PublicAgent { const agent = this.agents.get(agentId); if (!agent) throw new Error("agent not found"); return this.publicView(agent); }
  listOwnedAgents(caller: string): PublicAgent[] {
    const owner = this.address(caller);
    return [...this.agents.values()].filter((agent) => agent.owner === owner).map((agent) => this.publicView(agent));
  }
  listOwnedRegistrations(caller: string): OwnedRegistration[] {
    const owner = this.address(caller);
    return [...this.registrations.values()]
      .filter((registration) => this.agents.get(`sha256:${registration.agentId.slice(2)}` as Digest)?.owner === owner)
      .map(({ tournamentId, entrantId }) => ({ tournamentId, entrantId }))
      .sort((left, right) => left.tournamentId.localeCompare(right.tournamentId) || left.entrantId.localeCompare(right.entrantId));
  }
  publishTournament(caller: string, tournament: PublicTournament): void {
    if (this.address(caller) !== this.operator) throw new Error("unauthorized operator");
    if (!tournament.id || !tournament.name?.trim() || tournament.name.length > 96 || !PUBLIC_TOURNAMENT_STATES.has(tournament.status)
      || !Array.isArray(tournament.entrantIds) || tournament.entrantIds.some((id) => typeof id !== "string" || !id)
      || new Set(tournament.entrantIds).size !== tournament.entrantIds.length
      || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(tournament.prizePool)
      || (tournament.stakeAmount !== undefined && !/^[1-9][0-9]*$/.test(tournament.stakeAmount))) throw new Error("invalid tournament");
    const stored = structuredClone(tournament);
    this.tournaments.set(tournament.id, stored);
    this.runtime?.put("api-tournaments", tournament.id, stored);
  }
  listTournaments(): PublicTournament[] { return [...this.tournaments.values()].map((item) => structuredClone(item)); }
  getTournament(id: string): PublicTournament | null { const item = this.tournaments.get(id); return item ? structuredClone(item) : null; }
  publishMatch(caller: string, match: PublicMatch): void {
    this.requireOperator(caller);
    const winnerRequired = match.state === "FINALIZED" || match.state === "WINNER_ADVANCED";
    if (!match.id || !match.tournamentId || !this.tournaments.has(match.tournamentId) || !PUBLIC_MATCH_STATES.has(match.state)
      || !match.agentA || !match.agentB || match.agentA === match.agentB || !Number.isSafeInteger(match.round) || match.round < 0
      || (match.winner !== undefined && match.winner !== match.agentA && match.winner !== match.agentB)
      || (winnerRequired && match.winner === undefined) || (match.state === "TIE" && match.winner !== undefined)) {
      throw new Error("invalid public match");
    }
    const existing = this.matches.get(match.id);
    if (existing) {
      if (isDeepStrictEqual(existing, match)) return;
      if (TERMINAL_PUBLIC_MATCH_STATES.has(existing.state)) throw new Error("conflicting public match");
      if (existing.tournamentId !== match.tournamentId || existing.agentA !== match.agentA || existing.agentB !== match.agentB || existing.round !== match.round) {
        throw new Error("conflicting public match identity");
      }
    }
    const stored = structuredClone(match);
    this.matches.set(match.id, stored);
    this.runtime?.put("api-matches", match.id, stored);
  }
  listMatches(tournamentId: string): PublicMatch[] {
    return [...this.matches.values()].filter((match) => match.tournamentId === tournamentId).map((match) => structuredClone(match));
  }
  getMatch(id: string): PublicMatch | null { const match = this.matches.get(id); return match ? structuredClone(match) : null; }
  publishVerdict(caller: string, verdict: PublicVerdict): void {
    this.requireOperator(caller);
    const unsafe = verdict as PublicVerdict & { agentsMd?: unknown; outputA?: unknown; outputB?: unknown };
    if (unsafe.agentsMd !== undefined || unsafe.outputA !== undefined || unsafe.outputB !== undefined) throw new Error("private artifact cannot be published");
    if (!verdict.id || !verdict.matchId || !this.matches.has(verdict.matchId) || !["A", "B", "TIE"].includes(verdict.winner)
      || !Array.isArray(verdict.reasons) || verdict.reasons.length < 1 || verdict.reasons.length > 5
      || verdict.reasons.some((reason) => typeof reason !== "string" || !reason.trim() || Buffer.byteLength(reason, "utf8") > 320)
      || typeof verdict.summary !== "string" || !verdict.summary.trim() || Buffer.byteLength(verdict.summary, "utf8") > 640
      || (verdict.transactionHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(verdict.transactionHash))) {
      throw new Error("invalid public verdict");
    }
    validateVerdictMetadata(verdict);
    const existing = this.verdicts.get(verdict.matchId);
    if (existing) {
      if (isDeepStrictEqual(existing, verdict)) return;
      if (!canEnrichVerdict(existing, verdict)) throw new Error("conflicting public verdict");
    }
    const stored = structuredClone(verdict);
    this.verdicts.set(verdict.matchId, stored);
    this.runtime?.put("api-verdicts", verdict.matchId, stored);
  }
  getVerdict(matchId: string): PublicVerdict | null { const verdict = this.verdicts.get(matchId); return verdict ? structuredClone(verdict) : null; }
  getPublicEvaluationRun(runId: Digest): PublicEvaluationRun | null {
    if (!isDigest(runId)) throw new Error("invalid evaluation run ID");
    const record = this.runtime?.get<EvaluationRunRecord>("evaluation-runs", runId);
    return record ? this.publicEvaluationView(record) : null;
  }
  getPrivateEvaluationRun(caller: string, runId: Digest): PrivateEvaluationRun {
    const owner = this.address(caller);
    if (!isDigest(runId)) throw new Error("invalid evaluation run ID");
    const record = this.runtime?.get<EvaluationRunRecord>("evaluation-runs", runId);
    if (!record) throw new Error("evaluation run not found");
    if (this.ownerForAgentVersion(record.input.agent.version_id) !== owner) throw new Error("unauthorized");
    return this.privateEvaluationView(record);
  }
  listOwnedEvaluationRuns(caller: string): PrivateEvaluationRun[] {
    const owner = this.address(caller);
    return (this.runtime?.list<EvaluationRunRecord>("evaluation-runs") ?? [])
      .filter((record) => this.ownerForAgentVersion(record.input.agent.version_id) === owner)
      .map((record) => this.privateEvaluationView(record));
  }
  createEvaluationPack(caller: string, input: { packId: Digest; version: string; name: string; scenarios: EvaluationScenario[] }): PublicEvaluationPack {
    const owner = this.address(caller);
    if (!isDigest(input?.packId) || typeof input.version !== "string" || !input.version || input.version.length > 64 || typeof input.name !== "string" || !input.name.trim() || input.name.length > 96 || !Array.isArray(input.scenarios) || input.scenarios.length < 1 || input.scenarios.length > 32) throw new Error("invalid evaluation pack");
    const scenarios = input.scenarios.map(validateEvaluationScenario);
    if (new Set(scenarios.map((scenario) => scenario.scenarioId)).size !== scenarios.length) throw new Error("evaluation pack scenarios contain duplicates");
    const record: EvaluationPackRecord = { schema: "arena-evaluation-pack-v1", packId: input.packId, version: input.version, owner, name: input.name.trim(), scenarios };
    const key = this.packKey(record.packId, record.version);
    const existing = this.evaluationPacks.get(key);
    if (existing) {
      if (!isDeepStrictEqual(existing, record)) throw new Error("conflicting immutable evaluation pack");
      if (existing.owner !== owner) throw new Error("unauthorized evaluation pack");
      return this.publicPack(existing);
    }
    this.evaluationPacks.set(key, record);
    this.runtime?.put("evaluation-packs", key, record);
    return this.publicPack(record);
  }
  createSoloCampaign(caller: string, input: { campaignId: Digest; agentId: Digest; agentsVersion: Digest; packId: Digest; packVersion: string; runtimePolicy: { model: string; maxOutputTokens: number; temperature: number; maxProviderAttempts: number } }): PublicEvaluationCampaign {
    const owner = this.address(caller);
    if (!isDigest(input?.campaignId)) throw new Error("invalid evaluation campaign ID");
    const agent = this.requireOwner(owner, input.agentId);
    const version = agent.versions.find((candidate) => candidate.agentsVersion === input.agentsVersion);
    if (!version) throw new Error("agent version not found");
    const pack = this.evaluationPacks.get(this.packKey(input.packId, input.packVersion));
    if (!pack || pack.owner !== owner) throw new Error("unauthorized or unknown evaluation pack");
    if (!input.runtimePolicy || !input.runtimePolicy.model || !Number.isSafeInteger(input.runtimePolicy.maxOutputTokens) || input.runtimePolicy.maxOutputTokens < 1 || !Number.isFinite(input.runtimePolicy.temperature) || input.runtimePolicy.temperature < 0 || input.runtimePolicy.temperature > 2 || !Number.isSafeInteger(input.runtimePolicy.maxProviderAttempts) || input.runtimePolicy.maxProviderAttempts < 1 || input.runtimePolicy.maxProviderAttempts > 3) throw new Error("invalid evaluation runtime policy");
    const campaignId = input.campaignId;
    const existing = this.evaluationCampaigns.get(campaignId);
    if (existing) {
      this.requireSameSoloCampaign(existing, owner, version, pack, input.runtimePolicy);
      return this.publicCampaign(existing);
    }
    const campaign: SoloCampaignRecord = {
      schema: "arena-solo-campaign-v1", campaignId, owner,
      agent: { versionId: version.agentsVersion as `sha256:${string}`, commitment: version.agentsCommitment as `sha256:${string}`, agentsMd: version.agentsMd },
      testPack: { packId: pack.packId, version: pack.version, scenarios: structuredClone(pack.scenarios) },
      runtimePolicy: structuredClone(input.runtimePolicy), rubricVersion: "AgentEvaluationV5", state: "PENDING",
      items: pack.scenarios.map((scenario) => ({ scenarioId: scenario.scenarioId, state: "PENDING", attempt: 0, runIds: [] })),
    };
    this.evaluationCampaigns.set(campaignId, campaign);
    this.runtime?.put("evaluation-campaigns", campaignId, campaign);
    return this.publicCampaign(campaign);
  }
  getPublicEvaluationCampaign(campaignId: Digest): PublicEvaluationCampaign | null {
    if (!isDigest(campaignId)) throw new Error("invalid evaluation campaign ID");
    const campaign = this.evaluationCampaigns.get(campaignId) ?? this.runtime?.get<SoloCampaignRecord>("evaluation-campaigns", campaignId);
    return campaign ? this.publicCampaign(campaign) : null;
  }
  listOwnedEvaluationCampaigns(caller: string): PublicEvaluationCampaign[] {
    const owner = this.address(caller);
    return [...this.evaluationCampaigns.values()].filter((campaign) => campaign.owner === owner).map((campaign) => this.publicCampaign(campaign));
  }
  prepareRegistration(caller: string, tournamentId: Digest, agentId: Digest): PreparedRegistration {
    const owner = this.address(caller);
    if (!isDigest(tournamentId) || !isDigest(agentId)) throw new Error("invalid registration identity");
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament || !/^[1-9][0-9]*$/.test(tournament.stakeAmount || "")) throw new Error("tournament registration is unavailable");
    const agent = this.requireOwner(owner, agentId);
    const latest = agent.versions.at(-1)!;
    const key = this.registrationKey(tournamentId, owner, agentId);
    const existing = this.registrations.get(key);
    if (existing) return structuredClone(existing);
    const prepared: PreparedRegistration = {
      tournamentId: digestBytes32(tournamentId),
      entrantId: digestBytes32(deriveEntrantId(tournamentId, owner, agentId, 1)),
      agentId: digestBytes32(agentId),
      agentsVersion: digestBytes32(latest.agentsVersion),
      agentsCommitment: digestBytes32(latest.agentsCommitment),
      stakeAmount: tournament.stakeAmount!,
    };
    this.registrations.set(key, prepared);
    this.runtime?.put("api-registrations", key, prepared);
    return structuredClone(prepared);
  }

  private publicView(agent: Agent): PublicAgent { const { agentsMd: _private, ...latest } = agent.versions.at(-1)!; return { ...latest, owner: agent.owner, name: agent.name }; }
  private packKey(packId: string, version: string): string { return `${packId}|${version}`; }
  private publicPack(pack: EvaluationPackRecord): PublicEvaluationPack { return { schema: "arena-public-evaluation-pack-v1", packId: pack.packId, version: pack.version, name: pack.name, scenarioIds: pack.scenarios.map((scenario) => scenario.scenarioId), scenarioCount: pack.scenarios.length }; }
  private publicCampaign(campaign: SoloCampaignRecord): PublicEvaluationCampaign { return { schema: "arena-public-evaluation-campaign-v1", campaignId: campaign.campaignId, agentVersionId: campaign.agent.versionId, packId: campaign.testPack.packId, packVersion: campaign.testPack.version, rubricVersion: campaign.rubricVersion, state: campaign.state, items: campaign.items.map((item) => ({ scenarioId: item.scenarioId, state: item.state, attempt: item.attempt, runIds: [...item.runIds], ...(item.scorecard ? { score: String(item.scorecard.result_class), overallScore: Number(item.scorecard.overall_score) } : {}) })) }; }
  private requireSameSoloCampaign(existing: SoloCampaignRecord, owner: string, version: AgentVersion, pack: EvaluationPackRecord, runtimePolicy: SoloCampaignRecord["runtimePolicy"]): void {
    if (existing.owner !== owner
      || existing.agent.versionId !== version.agentsVersion
      || existing.agent.commitment !== version.agentsCommitment
      || existing.testPack.packId !== pack.packId
      || existing.testPack.version !== pack.version
      || existing.rubricVersion !== "AgentEvaluationV5"
      || !isDeepStrictEqual(existing.runtimePolicy, runtimePolicy)
      || !isDeepStrictEqual(existing.testPack.scenarios, pack.scenarios)) {
      throw new Error("conflicting evaluation campaign");
    }
  }
  private publicEvaluationView(record: EvaluationRunRecord): PublicEvaluationRun {
    const judge = "transactionHash" in record.judge
      ? { state: record.judge.state, transactionHash: record.judge.transactionHash }
      : { state: record.judge.state };
    const scorecard = record.scorecard ? this.publicScorecard(record.scorecard) : undefined;
    return {
      schema: "arena-public-evaluation-run-v1",
      runId: record.runId,
      agentVersionId: record.input.agent.version_id,
      mode: record.input.mode,
      rubricVersion: record.rubricVersion,
      scenario: { scenarioId: record.input.scenario.scenario_id, version: record.input.scenario.version, mode: record.input.scenario.mode, digest: record.scenarioDigest },
      provider: { state: record.provider.state },
      judge,
      ...(scorecard ? { scorecard } : {}),
    };
  }
  private privateEvaluationView(record: EvaluationRunRecord): PrivateEvaluationRun {
    const publicView = this.publicEvaluationView(record);
    const provider = record.provider.state === "SUCCESS"
      ? { state: record.provider.state, ...(record.provider.requestId ? { requestId: record.provider.requestId } : {}), ...(record.provider.usageTokens !== undefined ? { usageTokens: record.provider.usageTokens } : {}), output: structuredClone(record.provider.output) }
      : { state: record.provider.state };
    return {
      ...publicView,
      schema: "arena-private-evaluation-run-v1",
      scenario: { ...structuredClone(record.input.scenario), digest: record.scenarioDigest },
      provider,
      ...(record.scorecard ? { scorecard: structuredClone(record.scorecard) } : {}),
    };
  }
  private ownerForAgentVersion(versionId: string): string | undefined {
    return [...this.agents.values()].find((agent) => agent.versions.some((version) => version.agentsVersion === versionId))?.owner;
  }
  private publicScorecard(scorecard: Record<string, any>): NonNullable<PublicEvaluationRun["scorecard"]> {
    const resultClass = scorecard.result_class;
    const overallScore = scorecard.overall_score;
    if (!["STRONG", "PASS", "WEAK", "FAIL"].includes(resultClass)
      || !Number.isSafeInteger(overallScore) || overallScore < 0 || overallScore > 100
      || scorecard.actions_executed !== false || !Array.isArray(scorecard.dimensions)) {
      throw new Error("invalid evaluation record");
    }
    const dimensions = scorecard.dimensions.map((row: any) => {
      if (!row || typeof row.dimension_id !== "string" || typeof row.grade !== "string") throw new Error("invalid evaluation record");
      return { dimensionId: row.dimension_id, grade: row.grade };
    });
    return { resultClass, overallScore, dimensions, actionsExecuted: false };
  }
  private requireOperator(caller: string): void { if (this.address(caller) !== this.operator) throw new Error("unauthorized operator"); }
  private requireOwner(caller: string, agentId: Digest): Agent { const agent = this.agents.get(agentId); if (!agent || agent.owner !== this.address(caller)) throw new Error("unauthorized agent access"); return agent; }
  private address(value: string): string { if (!ADDRESS.test(value)) throw new Error("invalid address"); return value.toLowerCase(); }
  private validateAgentText(name: string, agentsMd: string): void { if (!name.trim() || name.length > 96 || !agentsMd || Buffer.byteLength(agentsMd, "utf8") > 32_768) throw new Error("invalid agent profile"); }
  private version(agentId: Digest, agentsMd: string, number: number): AgentVersion { return { agentId, agentsVersion: sha(`arena-agents-version-v1|${agentId}|${number}|${sha(agentsMd)}`), agentsCommitment: sha(agentsMd), agentsMd, createdAt: Date.now() }; }
  private registrationKey(tournamentId: Digest, owner: string, agentId: Digest): string { return `${tournamentId}|${owner}|${agentId}`; }
}

function digestBytes32(value: Digest): `0x${string}` { return `0x${value.slice("sha256:".length)}`; }

const VERDICT_CORE_FIELDS = ["id", "matchId", "winner", "reasons", "summary", "transactionHash"] as const;

function canEnrichVerdict(existing: PublicVerdict, next: PublicVerdict): boolean {
  for (const field of VERDICT_CORE_FIELDS) if (!isDeepStrictEqual(existing[field], next[field])) return false;
  for (const [field, value] of Object.entries(existing)) {
    if ((VERDICT_CORE_FIELDS as readonly string[]).includes(field)) continue;
    if (!isDeepStrictEqual(value, (next as Record<string, unknown>)[field])) return false;
  }
  return Object.keys(next).length > Object.keys(existing).length;
}

function validateVerdictMetadata(verdict: PublicVerdict): void {
  if (verdict.source !== undefined && !["LIVE", "PREVIEW"].includes(verdict.source)) throw new Error("invalid public verdict metadata");
  if (verdict.finality !== undefined && !["SUBMITTED", "ACCEPTED", "FINALIZED"].includes(verdict.finality)) throw new Error("invalid public verdict metadata");
  if (verdict.execution !== undefined && !["PENDING", "SUCCESS", "FAILED"].includes(verdict.execution)) throw new Error("invalid public verdict metadata");
  if (verdict.attempt !== undefined && (!Number.isSafeInteger(verdict.attempt) || verdict.attempt < 1)) throw new Error("invalid public verdict metadata");
  if (verdict.chainId !== undefined && (!Number.isSafeInteger(verdict.chainId) || verdict.chainId < 1)) throw new Error("invalid public verdict metadata");
  for (const score of [verdict.scoreA, verdict.scoreB]) if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 100)) throw new Error("invalid public verdict metadata");
  for (const id of [verdict.canonicalMatchId, verdict.attemptId]) if (id !== undefined && !/^sha256:[0-9a-f]{64}$/.test(id)) throw new Error("invalid public verdict metadata");
  for (const address of [verdict.judgeAddress, verdict.arcEscrowAddress]) if (address !== undefined && !ADDRESS.test(address)) throw new Error("invalid public verdict metadata");
  if (verdict.arcTournamentId !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(verdict.arcTournamentId)) throw new Error("invalid public verdict metadata");
  for (const text of [verdict.rubricVersion, verdict.safetyClass, verdict.network, verdict.grossPoolUsdc, verdict.netPayoutUsdc, verdict.platformFeeUsdc, verdict.arcState]) {
    if (text !== undefined && (typeof text !== "string" || !text.trim() || Buffer.byteLength(text, "utf8") > 160)) throw new Error("invalid public verdict metadata");
  }
  if (verdict.criteria !== undefined) {
    if (!Array.isArray(verdict.criteria) || verdict.criteria.length < 1 || verdict.criteria.length > 5) throw new Error("invalid public verdict metadata");
    for (const criterion of verdict.criteria) {
      if (!criterion || typeof criterion !== "object" || !criterion.id?.trim() || !criterion.label?.trim()
        || !["A", "B", "TIE"].includes(criterion.winner) || !criterion.reason?.trim()
        || Buffer.byteLength(criterion.id, "utf8") > 64 || Buffer.byteLength(criterion.label, "utf8") > 96
        || Buffer.byteLength(criterion.reason, "utf8") > 320) throw new Error("invalid public verdict metadata");
    }
  }
}
