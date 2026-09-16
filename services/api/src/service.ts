import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { derivePublicBracketSeed, type PublicBracketSeed } from "../../../packages/domain/src/bracket.ts";
import { entrantId as deriveEntrantId, isDigest } from "../../../packages/protocol/src/canonical.ts";
import type { SqliteRuntimeStore } from "../../../packages/persistence/src/sqlite-runtime.ts";
import type { EvaluationRunRecord } from "../../../packages/evaluation/src/run-tracker.ts";
import { validateEvaluationScenario, type EvaluationScenario } from "../../../packages/evaluation/src/protocol.ts";
import type { SoloCampaignRecord } from "../../../packages/evaluation/src/solo-runner.ts";
import { VersionComparisonRegistry, type RegressionPolicy, type VersionComparisonRecord } from "../../../packages/evaluation/src/comparison.ts";
import { evaluateMarketplaceEligibility } from "../../../packages/marketplace/src/eligibility.ts";
import { EVO_CORE_SCENARIOS, EVO_CORE_VERSION, selectEvoCoreScenarios } from "../../../packages/evaluation/src/evo-core.ts";

type Digest = `sha256:${string}`;
type AgentVersion = { agentId: Digest; agentsVersion: Digest; agentsCommitment: Digest; agentsMd: string; createdAt: number };
export type TournamentOperatorEntrant = PreparedRegistration & { agentsMd: string };
export type AgentChainTransaction = { transactionId: string; state: string; txHash?: string; explorerUrl?: string; registryAddress?: string };
type Agent = { agentId: Digest; owner: string; name: string; versions: AgentVersion[]; active?: boolean; registrationPending?: boolean; registrationIdempotencyKey?: string; deactivationIdempotencyKey?: string; registration?: AgentChainTransaction; deactivation?: AgentChainTransaction };
export type AgentDraft = AgentVersion & { owner: string; name: string; idempotencyKey: string };
export type AgentStats = { latestEvaluationScore: number | null; tournamentCount: number; adversarialMatchCount: number | null };
export type PublicAgent = Omit<AgentVersion, "agentsMd"> & { owner: string; name: string; active: boolean; stats?: AgentStats; registration?: AgentChainTransaction; deactivation?: AgentChainTransaction };
export type AgentDetail = PublicAgent & {
  agentsMd: string;
  versions: Array<Pick<AgentVersion, "agentsVersion" | "agentsCommitment" | "createdAt">>;
  stats: AgentStats;
  tournaments: PublicTournament[];
  evaluations: PublicEvaluationCampaign[];
};
export type PublicTournamentStatus = "UPCOMING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type PublicTournament = { id: string; name: string; status: PublicTournamentStatus; entrantIds: readonly string[]; stakeAmount?: string; prizePool: string; registrationClosesAt?: number; bracketSeed?: PublicBracketSeed };
export type PublicMatchState = "SCHEDULED" | "WAITING_FOR_OUTPUTS" | "JUDGING" | "ACCEPTED" | "FAILED" | "RETRYABLE" | "FINALIZED" | "TIE" | "RETRY" | "WINNER_ADVANCED";
export type PublicMatch = { id: string; tournamentId: string; state: PublicMatchState; agentA: string; agentB: string; agentIdA?: Digest; agentIdB?: Digest; winner?: string; round: number };
export type PublicVerdictCriterion = { id: string; label: string; winner: "A" | "B" | "TIE"; reason: string };
export type PublicVerdict = {
  id: string; matchId: string; winner: "A" | "B" | "TIE"; reasons: readonly string[]; summary: string; transactionHash?: string;
  source?: "LIVE" | "PREVIEW"; rubricVersion?: string; attempt?: number; finality?: "SUBMITTED" | "ACCEPTED" | "FINALIZED";
  execution?: "PENDING" | "SUCCESS" | "FAILED"; scoreA?: number; scoreB?: number; criteria?: readonly PublicVerdictCriterion[];
  safetyClass?: string; canonicalMatchId?: string; attemptId?: string; network?: string; chainId?: number; judgeAddress?: string;
  arcTournamentId?: string; arcEscrowAddress?: string; grossPoolUsdc?: string; netPayoutUsdc?: string; platformFeeUsdc?: string; arcState?: string;
};
export type PreparedRegistration = { tournamentId: string; entrantId: string; agentId: string; agentsVersion: string; agentsCommitment: string; stakeAmount: string };
export type OwnedRegistration = Pick<PreparedRegistration, "tournamentId" | "entrantId" | "agentId">;
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
export type PublicEvaluationCampaign = { schema: "arena-public-evaluation-campaign-v1"; campaignId: string; agentVersionId: string; packId: string; packVersion: string; rubricVersion: string; state: string; createdAt?: number; startedAt?: number; items: Array<{ scenarioId: string; state: string; attempt: number; runIds: string[]; score?: string; overallScore?: number; failureStage?: string; failureCode?: string }> };
export type MarketplaceTransaction = { transactionId: string; state: string; txHash?: string; explorerUrl?: string };
export type MarketplaceCertificate = { schema: "arena-marketplace-certificate-v1"; certificateDigest: Digest; evidenceDigest: string; owner: string; agentId: Digest; agentVersionId: Digest; agentsCommitment: Digest; packId: Digest; packVersion: string; rubricVersion: string; executionModels?: string[]; coverageBps: number; overallScore: number; dimensionScores: Record<string, number>; maxSpread: number; issuedAt: number; expiresAt: number; state: "ELIGIBLE" | "APPROVED"; authorization?: MarketplaceTransaction };
export type MarketplaceListing = { schema: "arena-marketplace-listing-v1"; listingId: string; certificateDigest: Digest; agentId: Digest; agentVersionId: Digest; agentsCommitment: Digest; name: string; seller: string; sellerAddress: string; price: string; expiresAt: number; state: "SUBMITTED" | "ACTIVE" | "BUY_SUBMITTED" | "CANCEL_SUBMITTED" | "SOLD" | "CANCELLED" | "EXPIRED"; buyer?: string; buyerAddress?: string; purchaseApprovalIdempotencyKey?: string; purchaseIdempotencyKey?: string; cancellationIdempotencyKey?: string; transaction?: MarketplaceTransaction; purchase?: MarketplaceTransaction };
export type PublicMarketplaceListing = Omit<MarketplaceListing, "seller" | "buyer" | "purchaseApprovalIdempotencyKey" | "purchaseIdempotencyKey" | "cancellationIdempotencyKey">;
export type MarketplaceArcSnapshot = { listingId: string; agentId: Digest; version: Digest; commitment: Digest; sellerAddress: string; buyerAddress?: string; price: string; expiresAt: number; state: "ACTIVE" | "SOLD" | "CANCELLED" | "EXPIRED"; registryOwner: string; registryActive: boolean };
export type MarketplaceListingIntent = { certificateDigest: Digest; owner: string; sellerAddress: string; agentId: Digest; agentsVersion: Digest; agentsCommitment: Digest; price: string; expiresAt: number; idempotencyKey: string; transaction?: MarketplaceTransaction; listingId?: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const USER_PRINCIPAL = /^usr_[0-9a-f]{64}$/;
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
  private evoSelections = new Map<string, string[]>();
  private versionComparisons: VersionComparisonRegistry;
  private marketplaceCertificates = new Map<Digest, MarketplaceCertificate>();
  private marketplaceListings = new Map<string, MarketplaceListing>();
  private marketplaceListingIntents = new Map<Digest, MarketplaceListingIntent>();
  private nonce = 0;
  private runtime?: SqliteRuntimeStore;
  private readonly nowSeconds: () => number;

  constructor(operator: string, runtime?: SqliteRuntimeStore, nowSeconds: () => number = () => Math.floor(Date.now() / 1_000)) {
    this.operator = this.address(operator);
    this.runtime = runtime;
    this.nowSeconds = nowSeconds;
    this.versionComparisons = new VersionComparisonRegistry(runtime);
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
      for (const certificate of runtime.list<MarketplaceCertificate>("marketplace-certificates")) this.marketplaceCertificates.set(certificate.certificateDigest, certificate);
      for (const listing of runtime.list<MarketplaceListing>("marketplace-listings")) this.marketplaceListings.set(listing.listingId, listing);
      for (const intent of runtime.list<MarketplaceListingIntent>("marketplace-listing-intents")) this.marketplaceListingIntents.set(intent.certificateDigest, intent);
      this.nonce = runtime.counter("api-counters", "agent-sequence");
    }
  }
  get operatorAddress(): string { return this.operator; }

  createAgent(caller: string, name: string, agentsMd: string): PublicAgent {
    const draft = this.prepareAgentCreation(caller, name, agentsMd);
    return this.commitAgentCreation(caller, draft);
  }

  prepareAgentCreation(caller: string, name: string, agentsMd: string): AgentDraft {
    const owner = this.principal(caller); this.validateAgentText(name, agentsMd);
    const normalizedName = name.trim();
    const commitment = sha(agentsMd);
    const pending = [...this.agents.values()].find((agent) => agent.owner === owner && agent.registrationPending === true && agent.name === normalizedName && agent.versions.at(-1)?.agentsCommitment === commitment);
    if (pending) return { ...structuredClone(pending.versions.at(-1)!), owner, name: pending.name, idempotencyKey: pending.registrationIdempotencyKey! };
    this.nonce = this.runtime ? this.runtime.increment("api-counters", "agent-sequence", 1) : this.nonce + 1;
    const agentId = sha(`arena-agent-v1|${owner}|${this.nonce}|${name}`);
    const version = this.version(agentId, agentsMd, 1);
    const idempotencyKey = randomUUID();
    const agent: Agent = { agentId, owner, name: normalizedName, versions: [version], active: false, registrationPending: true, registrationIdempotencyKey: idempotencyKey };
    this.agents.set(agentId, agent);
    this.runtime?.put("api-agents", agentId, agent);
    return { ...version, owner, name: normalizedName, idempotencyKey };
  }

  commitAgentCreation(caller: string, draft: AgentDraft, registration?: AgentChainTransaction): PublicAgent {
    const owner = this.principal(caller);
    const pending = this.agents.get(draft.agentId);
    if (draft.owner !== owner || !pending || pending.owner !== owner || pending.registrationPending !== true || pending.registrationIdempotencyKey !== draft.idempotencyKey
      || pending.name !== draft.name || pending.versions.at(-1)?.agentsVersion !== draft.agentsVersion || pending.versions.at(-1)?.agentsCommitment !== draft.agentsCommitment) throw new Error("invalid agent creation");
    this.validateAgentText(draft.name, draft.agentsMd);
    pending.active = true;
    pending.registrationPending = false;
    if (registration) pending.registration = structuredClone(registration);
    this.runtime?.put("api-agents", draft.agentId, pending);
    return this.publicView(pending);
  }

  updateAgent(caller: string, agentId: Digest, agentsMd: string): PublicAgent {
    const agent = this.requireOwner(caller, agentId); this.validateAgentText(agent.name, agentsMd);
    if (agent.active === false) throw new Error("agent is inactive");
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
    const owner = this.principal(caller);
    return [...this.agents.values()].filter((agent) => agent.owner === owner && agent.active !== false).map((agent) => ({ ...this.publicView(agent), stats: this.agentStats(agent) }));
  }
  getAgentDetail(caller: string, agentId: Digest): AgentDetail {
    const agent = this.requireOwner(caller, agentId);
    const registrations = [...this.registrations.values()].filter((item) => item.agentId === digestBytes32(agentId));
    const tournaments = registrations.map((item) => this.tournaments.get(`sha256:${item.tournamentId.slice(2)}`)!).filter(Boolean).map((item) => structuredClone(item));
    const versionIds = new Set(agent.versions.map((version) => version.agentsVersion));
    const evaluations = this.allEvaluationCampaigns().filter((campaign) => versionIds.has(campaign.agent.versionId as Digest)).map((campaign) => this.publicCampaign(campaign));
    return {
      ...this.publicView(agent), agentsMd: agent.versions.at(-1)!.agentsMd,
      versions: agent.versions.map(({ agentsVersion, agentsCommitment, createdAt }) => ({ agentsVersion, agentsCommitment, createdAt })),
      stats: this.agentStats(agent),
      tournaments, evaluations,
    };
  }
  deactivateAgent(caller: string, agentId: Digest, exactName: string, deactivation?: AgentChainTransaction): PublicAgent {
    const agent = this.requireOwner(caller, agentId);
    if (agent.active === false) throw new Error("agent is already inactive");
    if (exactName !== agent.name) throw new Error("agent name does not match");
    agent.active = false;
    if (deactivation) agent.deactivation = structuredClone(deactivation);
    this.runtime?.put("api-agents", agentId, agent);
    return this.publicView(agent);
  }
  prepareAgentDeactivation(caller: string, agentId: Digest, exactName: string): string {
    const agent = this.requireOwner(caller, agentId);
    if (agent.active === false) throw new Error("agent is already inactive");
    if (exactName !== agent.name) throw new Error("agent name does not match");
    agent.deactivationIdempotencyKey ??= randomUUID();
    this.runtime?.put("api-agents", agentId, agent);
    return agent.deactivationIdempotencyKey;
  }
  listOwnedRegistrations(caller: string): OwnedRegistration[] {
    const owner = this.principal(caller);
    return [...this.registrations.values()]
      .filter((registration) => this.agents.get(`sha256:${registration.agentId.slice(2)}` as Digest)?.owner === owner)
      .map(({ tournamentId, entrantId, agentId }) => ({ tournamentId, entrantId, agentId }))
      .sort((left, right) => left.tournamentId.localeCompare(right.tournamentId) || left.entrantId.localeCompare(right.entrantId));
  }
  listTournamentOperatorEntrants(caller: string, tournamentId: Digest): TournamentOperatorEntrant[] {
    this.requireOperator(caller);
    if (!isDigest(tournamentId)) throw new Error("invalid tournament identity");
    const tournamentBytes = digestBytes32(tournamentId);
    return [...this.registrations.values()]
      .filter((registration) => registration.tournamentId === tournamentBytes)
      .map((registration) => {
        const agent = this.agents.get(`sha256:${registration.agentId.slice(2)}` as Digest);
        const version = agent?.versions.find((candidate) => digestBytes32(candidate.agentsVersion) === registration.agentsVersion);
        if (!agent || !version || digestBytes32(version.agentsCommitment) !== registration.agentsCommitment) throw new Error("tournament registration binding is invalid");
        return { ...structuredClone(registration), agentsMd: version.agentsMd };
      })
      .sort((left, right) => left.entrantId.localeCompare(right.entrantId));
  }
  publishTournament(caller: string, tournament: PublicTournament): void {
    if (this.address(caller) !== this.operator) throw new Error("unauthorized operator");
    if (!tournament.id || !tournament.name?.trim() || tournament.name.length > 96 || !PUBLIC_TOURNAMENT_STATES.has(tournament.status)
      || !Array.isArray(tournament.entrantIds) || tournament.entrantIds.some((id) => typeof id !== "string" || !id)
      || new Set(tournament.entrantIds).size !== tournament.entrantIds.length
      || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(tournament.prizePool)
      || (tournament.stakeAmount !== undefined && !/^[1-9][0-9]*$/.test(tournament.stakeAmount))
      || (tournament.registrationClosesAt !== undefined && (!Number.isSafeInteger(tournament.registrationClosesAt) || tournament.registrationClosesAt < 1))
      || (tournament.bracketSeed !== undefined && (tournament.bracketSeed.schema !== "arena-bracket-seed-v2" || !isDigest(tournament.bracketSeed.seedDigest) || !isDigest(tournament.bracketSeed.rosterDigest) || !/^0x[0-9a-f]{64}$/.test(tournament.bracketSeed.entropyBlockHash) || !/^(0|[1-9][0-9]*)$/.test(tournament.bracketSeed.entropyBlockNumber)))) throw new Error("invalid tournament");
    if (tournament.bracketSeed) {
      const expected = derivePublicBracketSeed({ tournamentId: tournament.id as Digest, entrants: tournament.entrantIds as Digest[], entropyBlockHash: tournament.bracketSeed.entropyBlockHash, entropyBlockNumber: tournament.bracketSeed.entropyBlockNumber });
      if (!isDeepStrictEqual(tournament.bracketSeed, expected)) throw new Error("invalid tournament bracket proof");
      const previous = this.tournaments.get(tournament.id)?.bracketSeed;
      if (previous && !isDeepStrictEqual(previous, tournament.bracketSeed)) throw new Error("invalid tournament bracket proof mutation");
    } else if (this.tournaments.get(tournament.id)?.bracketSeed) throw new Error("invalid tournament bracket proof removal");
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
      || ((match.agentIdA === undefined) !== (match.agentIdB === undefined))
      || (match.agentIdA !== undefined && (!isDigest(match.agentIdA) || !isDigest(match.agentIdB!)))
      || (match.winner !== undefined && match.winner !== match.agentA && match.winner !== match.agentB)
      || (winnerRequired && match.winner === undefined) || (match.state === "TIE" && match.winner !== undefined)) {
      throw new Error("invalid public match");
    }
    const existing = this.matches.get(match.id);
    if (existing) {
      if (isDeepStrictEqual(existing, match)) return;
      if (TERMINAL_PUBLIC_MATCH_STATES.has(existing.state)) throw new Error("conflicting public match");
      if (existing.tournamentId !== match.tournamentId || existing.agentA !== match.agentA || existing.agentB !== match.agentB || existing.agentIdA !== match.agentIdA || existing.agentIdB !== match.agentIdB || existing.round !== match.round) {
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
    const owner = this.principal(caller);
    if (!isDigest(runId)) throw new Error("invalid evaluation run ID");
    const record = this.runtime?.get<EvaluationRunRecord>("evaluation-runs", runId);
    if (!record) throw new Error("evaluation run not found");
    if (this.ownerForAgentVersion(record.input.agent.version_id) !== owner) throw new Error("unauthorized");
    return this.privateEvaluationView(record);
  }
  listOwnedEvaluationRuns(caller: string): PrivateEvaluationRun[] {
    const owner = this.principal(caller);
    return (this.runtime?.list<EvaluationRunRecord>("evaluation-runs") ?? [])
      .filter((record) => this.ownerForAgentVersion(record.input.agent.version_id) === owner)
      .map((record) => this.privateEvaluationView(record));
  }
  createEvaluationPack(caller: string, input: { packId: Digest; version: string; name: string; scenarios: EvaluationScenario[] }): PublicEvaluationPack {
    const owner = this.principal(caller);
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
    const owner = this.principal(caller);
    if (!isDigest(input?.campaignId)) throw new Error("invalid evaluation campaign ID");
    const agent = this.requireOwner(owner, input.agentId);
    if (agent.active === false) throw new Error("agent is inactive");
    const version = agent.versions.find((candidate) => candidate.agentsVersion === input.agentsVersion);
    if (!version) throw new Error("agent version not found");
    const pack = this.evaluationPacks.get(this.packKey(input.packId, input.packVersion));
    if (!pack || pack.owner !== owner) throw new Error("unauthorized or unknown evaluation pack");
    if (!input.runtimePolicy || !input.runtimePolicy.model || !Number.isSafeInteger(input.runtimePolicy.maxOutputTokens) || input.runtimePolicy.maxOutputTokens < 1 || !Number.isFinite(input.runtimePolicy.temperature) || input.runtimePolicy.temperature < 0 || input.runtimePolicy.temperature > 2 || !Number.isSafeInteger(input.runtimePolicy.maxProviderAttempts) || input.runtimePolicy.maxProviderAttempts < 1 || input.runtimePolicy.maxProviderAttempts > 3) throw new Error("invalid evaluation runtime policy");
    const campaignId = input.campaignId;
    const existing = this.evaluationCampaign(campaignId);
    if (existing) {
      this.requireSameSoloCampaign(existing, owner, version, pack, input.runtimePolicy);
      return this.publicCampaign(existing);
    }
    const campaign: SoloCampaignRecord = {
      schema: "arena-solo-campaign-v1", campaignId, owner,
      agent: { versionId: version.agentsVersion as `sha256:${string}`, commitment: version.agentsCommitment as `sha256:${string}`, agentsMd: version.agentsMd },
      testPack: { packId: pack.packId, version: pack.version, scenarios: structuredClone(pack.scenarios) },
      runtimePolicy: structuredClone(input.runtimePolicy), rubricVersion: "AgentEvaluationV5", state: "PENDING", createdAt: this.nowSeconds() * 1_000,
      items: pack.scenarios.map((scenario) => ({ scenarioId: scenario.scenarioId, state: "PENDING", attempt: 0, runIds: [] })),
    };
    this.evaluationCampaigns.set(campaignId, campaign);
    this.runtime?.put("evaluation-campaigns", campaignId, campaign);
    return this.publicCampaign(campaign);
  }
  createEvoCampaign(caller: string, input: { agentId: Digest; agentsVersion: Digest; model: string }): PublicEvaluationCampaign {
    const owner = this.principal(caller);
    const agent = this.requireOwner(owner, input.agentId);
    if (agent.active === false) throw new Error('agent is inactive');
    if (!agent.versions.some((version) => version.agentsVersion === input.agentsVersion)) throw new Error('agent version not found');
    if (!input.model) throw new Error('evaluation model is required');
    const selectionKey = `${input.agentId}:${EVO_CORE_VERSION}`;
    let scenarioIds = this.runtime?.get<string[]>('evaluation-evo-selections', selectionKey) ?? this.evoSelections.get(selectionKey);
    if (!scenarioIds) {
      const proposed = selectEvoCoreScenarios(randomBytes(32).toString('hex')).map((scenario) => scenario.scenarioId);
      if (this.runtime) {
        this.runtime.putIfAbsent('evaluation-evo-selections', selectionKey, proposed);
        scenarioIds = this.runtime.get<string[]>('evaluation-evo-selections', selectionKey)!;
      } else {
        this.evoSelections.set(selectionKey, proposed);
        scenarioIds = proposed;
      }
    }
    const scenarios = scenarioIds.map((id) => EVO_CORE_SCENARIOS.find((scenario) => scenario.scenarioId === id));
    if (scenarios.length !== 6 || scenarios.some((scenario) => !scenario) || new Set(scenarioIds).size !== 6 || new Set(scenarioIds.map((id) => id.split('_')[0])).size !== 6) throw new Error('stored evaluation selection is invalid');
    const selectedScenarios = scenarios as EvaluationScenario[];
    const packId = sha(JSON.stringify({ owner, scenarios: selectedScenarios }));
    this.createEvaluationPack(owner, { packId, version: EVO_CORE_VERSION, name: 'Arena ISS Evo Core', scenarios: selectedScenarios });
    return this.createSoloCampaign(owner, {
      campaignId: sha(`arena-evo-campaign-v1|${owner}|${input.agentId}|${input.agentsVersion}|${randomUUID()}`),
      agentId: input.agentId, agentsVersion: input.agentsVersion, packId, packVersion: EVO_CORE_VERSION,
      runtimePolicy: { model: input.model, maxOutputTokens: 1200, temperature: 0, maxProviderAttempts: 2 },
    });
  }
  getPublicEvaluationCampaign(campaignId: Digest): PublicEvaluationCampaign | null {
    if (!isDigest(campaignId)) throw new Error("invalid evaluation campaign ID");
    const campaign = this.evaluationCampaign(campaignId);
    return campaign ? this.publicCampaign(campaign) : null;
  }
  listOwnedEvaluationCampaigns(caller: string): PublicEvaluationCampaign[] {
    const owner = this.principal(caller);
    const newest = this.runtime ? this.runtime.listNewest<SoloCampaignRecord>("evaluation-campaigns") : [...this.evaluationCampaigns.values()].reverse();
    return newest.filter((campaign) => campaign.owner === owner).map((campaign) => this.publicCampaign(campaign));
  }
  createVersionComparison(caller: string, input: { comparisonId: Digest; agentId: Digest; baselineVersionId: Digest; candidateVersionId: Digest; baselineCampaignIds: Digest[]; candidateCampaignIds: Digest[]; policy: RegressionPolicy }): VersionComparisonRecord {
    const owner = this.principal(caller);
    const agent = this.requireOwner(owner, input.agentId);
    if (!agent.versions.some((version) => version.agentsVersion === input.baselineVersionId) || !agent.versions.some((version) => version.agentsVersion === input.candidateVersionId)) throw new Error("comparison Agent version not found");
    const campaigns = (ids: Digest[], versionId: Digest): SoloCampaignRecord[] => ids.map((campaignId) => {
      const campaign = this.evaluationCampaign(campaignId);
      if (!campaign || campaign.owner !== owner || campaign.agent.versionId !== versionId) throw new Error("unauthorized or mismatched comparison campaign");
      return campaign;
    });
    return this.versionComparisons.compare({
      schema: "arena-version-comparison-input-v1",
      comparisonId: input.comparisonId,
      agentId: input.agentId,
      baseline: { versionId: input.baselineVersionId, campaigns: campaigns(input.baselineCampaignIds, input.baselineVersionId) },
      candidate: { versionId: input.candidateVersionId, campaigns: campaigns(input.candidateCampaignIds, input.candidateVersionId) },
      policy: input.policy,
    });
  }
  getOwnedVersionComparison(caller: string, comparisonId: Digest): VersionComparisonRecord {
    const owner = this.principal(caller);
    const record = this.versionComparisons.get(comparisonId);
    if (!record) throw new Error("version comparison not found");
    this.requireOwner(owner, record.agentId as Digest);
    return record;
  }
  listOwnedVersionComparisons(caller: string): VersionComparisonRecord[] {
    const owner = this.principal(caller);
    const ownedAgentIds = new Set([...this.agents.values()].filter((agent) => agent.owner === owner).map((agent) => agent.agentId));
    return this.versionComparisons.list().filter((record) => ownedAgentIds.has(record.agentId as Digest));
  }

  createMarketplaceEligibility(caller: string, input: { agentId: Digest; agentsVersion: Digest; campaignIds: Digest[]; issuedAt: number; expiresAt: number; network: string; chainId: number; judgeAddress: string }): MarketplaceCertificate {
    const owner = this.principal(caller); const agent = this.requireOwner(owner, input.agentId);
    const version = agent.versions.find((row) => row.agentsVersion === input.agentsVersion); if (!version) throw new Error("agent version not found");
    if (!Array.isArray(input.campaignIds) || input.campaignIds.length !== 2 || new Set(input.campaignIds).size !== 2) throw new Error("exactly two evaluation campaigns are required");
    const campaigns = input.campaignIds.map((id) => this.evaluationCampaign(id));
    if (campaigns.some((row) => !row || row.owner !== owner || row.state !== "FINALIZED" || row.agent.versionId !== version.agentsVersion || row.agent.commitment !== version.agentsCommitment)) throw new Error("evaluation campaign is not finalized or bound to this version");
    const first = campaigns[0]!;
    if (campaigns.some((row) => row!.testPack.packId !== first.testPack.packId || row!.testPack.version !== first.testPack.version || row!.rubricVersion !== first.rubricVersion || JSON.stringify(row!.testPack.scenarios.map((s) => s.scenarioId)) !== JSON.stringify(first.testPack.scenarios.map((s) => s.scenarioId)))) throw new Error("evaluation campaigns are not comparable");
    const gradePoints: Record<string, number> = { EXCELLENT: 100, GOOD: 80, MIXED: 60, POOR: 30, FAIL: 0 };
    const runs = campaigns.flatMap((campaign) => campaign!.items.map((item) => {
      const runId = item.currentRunId ?? item.runIds.at(-1); const run = runId ? this.runtime?.get<EvaluationRunRecord>("evaluation-runs", runId) : undefined;
      if (!run || run.judge.state !== "FINALIZED" || !run.scorecard || item.state !== "FINALIZED" || run.provider.state !== "SUCCESS" || run.input.mode !== "ACTION_DECISION"
        || run.input.agent.version_id !== version.agentsVersion || run.input.agent.commitment !== version.agentsCommitment || run.input.scenario.scenario_id !== item.scenarioId
        || run.rubricVersion !== first.rubricVersion || run.scorecard.agent_version_id !== version.agentsVersion || run.scorecard.agents_digest !== version.agentsCommitment
        || run.scorecard.rubric_version !== first.rubricVersion || run.scorecard.run_id !== run.runId || run.scorecard.status !== "FINAL") throw new Error("evaluation run is not finalized or canonically bound");
      return { runId: run.runId, scenarioId: item.scenarioId, state: "FINALIZED", agentVersionId: run.input.agent.version_id, agentsCommitment: run.input.agent.commitment,
        testPackId: first.testPack.packId, testPackVersion: first.testPack.version, rubricVersion: first.rubricVersion, providerModel: run.provider.model ?? campaign!.runtimePolicy.model, network: input.network, chainId: input.chainId, judgeAddress: input.judgeAddress,
        overallScore: effectiveEvaluationScore(run.scorecard), dimensions: Object.fromEntries((run.scorecard.dimensions ?? []).map((row: any) => [String(row.dimension_id), gradePoints[String(row.grade)]])), criticalFindingCount: Array.isArray(run.scorecard.policy_findings) ? run.scorecard.policy_findings.length : 1 };
    }));
    const result = evaluateMarketplaceEligibility({ agentId: agent.agentId, agentVersionId: version.agentsVersion, agentsCommitment: version.agentsCommitment, testPackId: first.testPack.packId, testPackVersion: first.testPack.version, rubricVersion: first.rubricVersion, network: input.network, chainId: input.chainId, judgeAddress: input.judgeAddress, issuedAt: input.issuedAt, expiresAt: input.expiresAt, requiredScenarioIds: first.testPack.scenarios.map((s) => s.scenarioId), runs });
    if (!result.eligible) throw new Error(`Agent version is not marketplace eligible: ${result.reasons.join(",")}`);
    const certificateDigest = sha(JSON.stringify(result.certificate)); const existing = this.marketplaceCertificates.get(certificateDigest); if (existing) return structuredClone(existing);
    const record: MarketplaceCertificate = { schema: "arena-marketplace-certificate-v1", certificateDigest, evidenceDigest: result.certificate.evidenceDigest, owner, agentId: agent.agentId, agentVersionId: version.agentsVersion, agentsCommitment: version.agentsCommitment, packId: first.testPack.packId, packVersion: first.testPack.version, rubricVersion: first.rubricVersion, executionModels: result.certificate.executionModels, coverageBps: result.certificate.coverageBps, overallScore: result.certificate.overallScore, dimensionScores: result.certificate.dimensionScores, maxSpread: result.certificate.maxSpread, issuedAt: input.issuedAt, expiresAt: input.expiresAt, state: "ELIGIBLE" };
    this.marketplaceCertificates.set(certificateDigest, record); this.runtime?.put("marketplace-certificates", certificateDigest, record); return structuredClone(record);
  }
  approveMarketplaceEligibility(caller: string, digest: Digest, transaction: MarketplaceTransaction): MarketplaceCertificate { this.requireOperator(caller); const record = this.marketplaceCertificates.get(digest); if (!record) throw new Error("marketplace certificate not found"); if (record.state === "APPROVED") return structuredClone(record); record.state = "APPROVED"; record.authorization = structuredClone(transaction); this.runtime?.put("marketplace-certificates", digest, record); return structuredClone(record); }
  listOwnedMarketplaceCertificates(caller: string): MarketplaceCertificate[] { const owner = this.principal(caller); return [...this.marketplaceCertificates.values()].filter((row) => row.owner === owner).map((row) => structuredClone(row)); }
  listMarketplaceCertificatesForOperator(caller: string): MarketplaceCertificate[] { this.requireOperator(caller); return [...this.marketplaceCertificates.values()].map((row) => structuredClone(row)).sort((a, b) => b.issuedAt - a.issuedAt); }
  beginMarketplaceListing(caller: string, input: { certificateDigest: Digest; agentId: Digest; agentsVersion: Digest; agentsCommitment: Digest; sellerAddress: string; price: string; expiresAt: number; idempotencyKey: string }): MarketplaceListingIntent {
    const owner = this.principal(caller);
    const certificate = this.marketplaceCertificates.get(input.certificateDigest);
    if (!certificate || certificate.owner !== owner || certificate.state !== "APPROVED") throw new Error("approved marketplace certificate is required");
    if (certificate.agentId !== input.agentId || certificate.agentVersionId !== input.agentsVersion || certificate.agentsCommitment !== input.agentsCommitment) throw new Error("marketplace certificate binding mismatch");
    if (!ADDRESS.test(input.sellerAddress) || !/^[1-9][0-9]*$/.test(input.price) || BigInt(input.price) > (2n ** 128n - 1n)
      || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Math.floor(Date.now() / 1000)
      || input.expiresAt > certificate.expiresAt) throw new Error("invalid marketplace listing");
    this.requireOwner(owner, certificate.agentId);
    const prepare = () => {
      const existing = this.runtime?.get<MarketplaceListingIntent>("marketplace-listing-intents", input.certificateDigest) ?? this.marketplaceListingIntents.get(input.certificateDigest);
      if (existing) {
        if (existing.owner !== owner || existing.sellerAddress !== input.sellerAddress.toLowerCase() || existing.agentId !== input.agentId
          || existing.agentsVersion !== input.agentsVersion || existing.agentsCommitment !== input.agentsCommitment
          || existing.price !== input.price || existing.expiresAt !== input.expiresAt) throw new Error("conflicting marketplace listing intent");
        this.marketplaceListingIntents.set(input.certificateDigest, existing);
        return structuredClone(existing);
      }
      if ([...this.marketplaceListings.values()].some((row) => row.certificateDigest === input.certificateDigest && !["CANCELLED", "EXPIRED"].includes(row.state))) throw new Error("certificate already has a listing");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) throw new Error("invalid marketplace listing identity");
      const intent: MarketplaceListingIntent = { ...input, owner, sellerAddress: input.sellerAddress.toLowerCase() };
      this.runtime?.put("marketplace-listing-intents", input.certificateDigest, intent);
      this.marketplaceListingIntents.set(input.certificateDigest, intent);
      return structuredClone(intent);
    };
    return this.runtime ? this.runtime.transaction(prepare) : prepare();
  }
  recordMarketplaceListingTransaction(caller: string, digest: Digest, transaction: MarketplaceTransaction): MarketplaceListingIntent {
    const owner = this.principal(caller);
    const intent = this.runtime?.get<MarketplaceListingIntent>("marketplace-listing-intents", digest) ?? this.marketplaceListingIntents.get(digest);
    if (!intent || intent.owner !== owner || !transaction.transactionId || !/^0x[0-9a-fA-F]{64}$/.test(transaction.txHash || "")) throw new Error("marketplace listing intent unavailable");
    if (intent.transaction && intent.transaction.transactionId !== transaction.transactionId) throw new Error("conflicting marketplace listing transaction");
    const next = { ...intent, transaction: structuredClone(transaction) };
    this.runtime?.put("marketplace-listing-intents", digest, next); this.marketplaceListingIntents.set(digest, next);
    return structuredClone(next);
  }
  finishMarketplaceListing(caller: string, digest: Digest, listingId: string): PublicMarketplaceListing {
    const owner = this.principal(caller);
    const intent = this.runtime?.get<MarketplaceListingIntent>("marketplace-listing-intents", digest) ?? this.marketplaceListingIntents.get(digest);
    if (!intent || intent.owner !== owner || !intent.transaction?.txHash || !/^[1-9][0-9]*$/.test(listingId) || (intent.listingId && intent.listingId !== listingId)) throw new Error("marketplace listing intent unavailable");
    const existing = this.marketplaceListings.get(listingId);
    const listing = existing
      ? existing.certificateDigest === digest && existing.seller === owner ? this.publicMarketplaceListing(existing) : undefined
      : this.createMarketplaceListing(owner, { listingId, certificateDigest: digest, sellerAddress: intent.sellerAddress, price: intent.price, expiresAt: intent.expiresAt, transaction: intent.transaction });
    if (!listing) throw new Error("conflicting marketplace listing ID");
    if (!intent.listingId) { const next = { ...intent, listingId }; this.runtime?.put("marketplace-listing-intents", digest, next); this.marketplaceListingIntents.set(digest, next); }
    return listing;
  }
  createMarketplaceListing(caller: string, input: { listingId: string; certificateDigest: Digest; sellerAddress: string; price: string; expiresAt: number; transaction: MarketplaceTransaction }): PublicMarketplaceListing {
    const owner = this.principal(caller); const certificate = this.marketplaceCertificates.get(input.certificateDigest); if (!certificate || certificate.owner !== owner || certificate.state !== "APPROVED") throw new Error("approved marketplace certificate is required");
    if (!/^[1-9][0-9]*$/.test(input.listingId) || !/^[1-9][0-9]*$/.test(input.price) || !Number.isSafeInteger(input.expiresAt) || input.expiresAt > certificate.expiresAt || !ADDRESS.test(input.sellerAddress)) throw new Error("invalid marketplace listing");
    if ([...this.marketplaceListings.values()].some((row) => row.certificateDigest === input.certificateDigest && !["CANCELLED", "EXPIRED"].includes(row.state))) throw new Error("certificate already has a listing");
    const agent = this.requireOwner(owner, certificate.agentId); const record: MarketplaceListing = { schema: "arena-marketplace-listing-v1", listingId: input.listingId, certificateDigest: input.certificateDigest, agentId: certificate.agentId, agentVersionId: certificate.agentVersionId, agentsCommitment: certificate.agentsCommitment, name: agent.name, seller: owner, sellerAddress: input.sellerAddress.toLowerCase(), price: input.price, expiresAt: input.expiresAt, state: "SUBMITTED", transaction: structuredClone(input.transaction) };
    this.marketplaceListings.set(record.listingId, record); this.runtime?.put("marketplace-listings", record.listingId, record); return this.publicMarketplaceListing(record);
  }
  publishMarketplaceListing(caller: string, snapshot: MarketplaceArcSnapshot): PublicMarketplaceListing { this.requireOperator(caller); const row = this.marketplaceListings.get(snapshot.listingId); if (!row) throw new Error("marketplace listing not found");
    if (snapshot.agentId !== row.agentId || snapshot.version !== row.agentVersionId || snapshot.commitment !== row.agentsCommitment || snapshot.sellerAddress.toLowerCase() !== row.sellerAddress
      || snapshot.price !== row.price || snapshot.expiresAt !== row.expiresAt || !snapshot.registryActive) throw new Error("Arc listing binding mismatch");
    if (snapshot.state === "SOLD") { if (!row.buyer || !row.buyerAddress || row.buyerAddress !== snapshot.buyerAddress?.toLowerCase() || snapshot.registryOwner.toLowerCase() !== row.buyerAddress) throw new Error("canonical buyer mismatch"); }
    else if (snapshot.state === "ACTIVE" && snapshot.registryOwner.toLowerCase() !== row.sellerAddress) throw new Error("canonical seller mismatch");
    if (row.state === "SOLD" && snapshot.state !== "SOLD") throw new Error("marketplace state cannot regress");
    if ((row.state === "BUY_SUBMITTED" || row.state === "CANCEL_SUBMITTED") && snapshot.state === "ACTIVE") return this.publicMarketplaceListing(row);
    row.state = snapshot.state; this.runtime?.put("marketplace-listings", row.listingId, row); return this.publicMarketplaceListing(row); }
  beginMarketplacePurchase(caller: string, listingId: string, buyerAddress: string, keys: { approvalIdempotencyKey: string; buyIdempotencyKey: string }): { approvalIdempotencyKey: string; buyIdempotencyKey: string } {
    const buyer = this.principal(caller); const row = this.marketplaceListings.get(listingId);
    if (!row || row.seller === buyer || !ADDRESS.test(buyerAddress)) throw new Error("marketplace listing is unavailable");
    if (row.state === "BUY_SUBMITTED" && row.buyer === buyer && row.buyerAddress === buyerAddress.toLowerCase()
      && row.purchaseApprovalIdempotencyKey && row.purchaseIdempotencyKey) return { approvalIdempotencyKey: row.purchaseApprovalIdempotencyKey, buyIdempotencyKey: row.purchaseIdempotencyKey };
    if (row.state !== "ACTIVE") throw new Error("marketplace listing is unavailable");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(keys.approvalIdempotencyKey) || !uuid.test(keys.buyIdempotencyKey) || keys.approvalIdempotencyKey === keys.buyIdempotencyKey) throw new Error("invalid marketplace purchase identity");
    row.state = "BUY_SUBMITTED"; row.buyer = buyer; row.buyerAddress = buyerAddress.toLowerCase();
    row.purchaseApprovalIdempotencyKey = keys.approvalIdempotencyKey; row.purchaseIdempotencyKey = keys.buyIdempotencyKey;
    this.runtime?.put("marketplace-listings", row.listingId, row);
    return { approvalIdempotencyKey: row.purchaseApprovalIdempotencyKey, buyIdempotencyKey: row.purchaseIdempotencyKey };
  }
  beginMarketplaceCancellation(caller: string, listingId: string, sellerAddress: string, idempotencyKey: string): string {
    const seller = this.principal(caller); const row = this.marketplaceListings.get(listingId);
    if (!row || row.seller !== seller || row.sellerAddress !== sellerAddress.toLowerCase()) throw new Error("marketplace seller required");
    if (row.state === "CANCEL_SUBMITTED" && row.cancellationIdempotencyKey) return row.cancellationIdempotencyKey;
    if (row.state !== "ACTIVE") throw new Error("active marketplace listing unavailable");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) throw new Error("invalid marketplace cancellation identity");
    row.state = "CANCEL_SUBMITTED"; row.cancellationIdempotencyKey = idempotencyKey;
    this.runtime?.put("marketplace-listings", row.listingId, row);
    return idempotencyKey;
  }
  submitMarketplacePurchase(caller: string, listingId: string, buyerAddress: string, transaction: MarketplaceTransaction): PublicMarketplaceListing { const buyer = this.principal(caller); const row = this.marketplaceListings.get(listingId); if (!row || row.state !== "BUY_SUBMITTED" || row.buyer !== buyer || row.buyerAddress !== buyerAddress.toLowerCase()) throw new Error("marketplace listing is unavailable"); row.purchase = structuredClone(transaction); this.runtime?.put("marketplace-listings", row.listingId, row); return this.publicMarketplaceListing(row); }
  listMarketplaceListings(): PublicMarketplaceListing[] { return [...this.marketplaceListings.values()].filter((row) => row.state !== "SUBMITTED").map((row) => this.publicMarketplaceListing(row)).sort((a, b) => Number(b.listingId) - Number(a.listingId)); }
  listMarketplaceListingsForReconciliation(): PublicMarketplaceListing[] { return [...this.marketplaceListings.values()].filter((row) => row.state === "SUBMITTED" || row.state === "BUY_SUBMITTED" || row.state === "CANCEL_SUBMITTED").map((row) => this.publicMarketplaceListing(row)); }
  listOwnedMarketplaceListings(caller: string): PublicMarketplaceListing[] { const owner = this.principal(caller); return [...this.marketplaceListings.values()].filter((row) => row.seller === owner).map((row) => this.publicMarketplaceListing(row)).sort((a, b) => Number(b.listingId) - Number(a.listingId)); }
  listOwnedMarketplacePurchases(caller: string): PublicMarketplaceListing[] { const buyer = this.principal(caller); return [...this.marketplaceListings.values()].filter((row) => row.buyer === buyer && row.state === "SOLD").map((row) => this.publicMarketplaceListing(row)).sort((a, b) => Number(b.listingId) - Number(a.listingId)); }
  getMarketplaceDelivery(caller: string, listingId: string, snapshot: MarketplaceArcSnapshot): { agentId: Digest; agentVersionId: Digest; agentsCommitment: Digest; agentsMd: string } { const buyer = this.principal(caller); const row = this.marketplaceListings.get(listingId); if (!row || row.state !== "SOLD" || row.buyer !== buyer || snapshot.state !== "SOLD" || snapshot.registryOwner.toLowerCase() !== row.buyerAddress || snapshot.buyerAddress?.toLowerCase() !== row.buyerAddress || snapshot.agentId !== row.agentId || snapshot.version !== row.agentVersionId || snapshot.commitment !== row.agentsCommitment) throw new Error("marketplace delivery unavailable"); const agent = this.agents.get(row.agentId)!; const version = agent.versions.find((item) => item.agentsVersion === row.agentVersionId)!; return { agentId: row.agentId, agentVersionId: row.agentVersionId, agentsCommitment: row.agentsCommitment, agentsMd: version.agentsMd }; }
  prepareRegistration(caller: string, tournamentId: Digest, agentId: Digest, entrantWalletAddress?: string): PreparedRegistration {
    const owner = this.principal(caller);
    const entrantWallet = this.address(entrantWalletAddress ?? owner);
    if (!isDigest(tournamentId) || !isDigest(agentId)) throw new Error("invalid registration identity");
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament || !/^[1-9][0-9]*$/.test(tournament.stakeAmount || "")) throw new Error("tournament registration is unavailable");
    if (tournament.status !== "UPCOMING" || (tournament.registrationClosesAt !== undefined && this.nowSeconds() >= tournament.registrationClosesAt)) throw new Error("tournament registration is closed");
    const agent = this.requireOwner(owner, agentId);
    if (agent.active === false) throw new Error("agent is inactive");
    const latest = agent.versions.at(-1)!;
    const key = this.registrationKey(tournamentId, owner, agentId);
    const existing = this.registrations.get(key);
    const entrantId = digestBytes32(deriveEntrantId(tournamentId, entrantWallet, agentId, 1));
    if (tournament.entrantIds.some((id) => id.toLowerCase() === `sha256:${entrantId.slice(2)}` || id.toLowerCase() === entrantId)) throw new Error("agent is already registered for this Tournament");
    if (existing) {
      if (existing.entrantId !== entrantId) throw new Error("registration entrant does not match the managed wallet; reconciliation required");
      return structuredClone(existing);
    }
    const prepared: PreparedRegistration = {
      tournamentId: digestBytes32(tournamentId),
      entrantId,
      agentId: digestBytes32(agentId),
      agentsVersion: digestBytes32(latest.agentsVersion),
      agentsCommitment: digestBytes32(latest.agentsCommitment),
      stakeAmount: tournament.stakeAmount!,
    };
    this.registrations.set(key, prepared);
    this.runtime?.put("api-registrations", key, prepared);
    return structuredClone(prepared);
  }

  confirmRegistration(tournamentId: Digest, entrantId: string): void {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament || ![...this.registrations.values()].some((row) => row.tournamentId === digestBytes32(tournamentId) && row.entrantId === entrantId)) throw new Error("registration confirmation is invalid");
    const canonicalId = `sha256:${entrantId.slice(2)}`;
    if (tournament.entrantIds.includes(canonicalId)) return;
    const updated = { ...tournament, entrantIds: [...tournament.entrantIds, canonicalId] };
    this.tournaments.set(tournamentId, updated);
    this.runtime?.put("api-tournaments", tournamentId, updated);
  }

  private publicView(agent: Agent): PublicAgent { const latest = agent.versions.at(-1)!; return { agentId: latest.agentId, agentsVersion: latest.agentsVersion, agentsCommitment: latest.agentsCommitment, createdAt: latest.createdAt, owner: agent.owner, name: agent.name, active: agent.active !== false, ...(agent.registration ? { registration: structuredClone(agent.registration) } : {}), ...(agent.deactivation ? { deactivation: structuredClone(agent.deactivation) } : {}) }; }
  private agentStats(agent: Agent): AgentStats {
    const versionIds = new Set(agent.versions.map((version) => version.agentsVersion));
    const evaluations = (this.runtime ? this.runtime.listNewest<SoloCampaignRecord>("evaluation-campaigns") : [...this.evaluationCampaigns.values()].reverse())
      .filter((campaign) => versionIds.has(campaign.agent.versionId as Digest));
    const latestCompleted = evaluations.find((campaign) => campaign.state === "FINALIZED"
      && campaign.items.length > 0
      && campaign.items.every((item) => item.state === "FINALIZED" && item.scorecard));
    const scores = latestCompleted?.items.map((item) => effectiveEvaluationScore(item.scorecard!)) ?? [];
    const latestEvaluationScore = scores.length > 0 ? Math.floor(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
    const registrations = [...this.registrations.values()].filter((item) => item.agentId === digestBytes32(agent.agentId));
    const tournamentIds = new Set(registrations.map((item) => `sha256:${item.tournamentId.slice(2)}`));
    const relevantMatches = [...this.matches.values()].filter((match) => tournamentIds.has(match.tournamentId));
    const hasUnboundMatch = relevantMatches.some((match) => !match.agentIdA || !match.agentIdB);
    return { latestEvaluationScore, tournamentCount: registrations.length, adversarialMatchCount: hasUnboundMatch ? null : relevantMatches.filter((match) => match.agentIdA === agent.agentId || match.agentIdB === agent.agentId).length };
  }
  private packKey(packId: string, version: string): string { return `${packId}|${version}`; }
  private evaluationCampaign(campaignId: string): SoloCampaignRecord | undefined {
    return this.runtime ? this.runtime.get<SoloCampaignRecord>("evaluation-campaigns", campaignId) : this.evaluationCampaigns.get(campaignId);
  }
  private allEvaluationCampaigns(): SoloCampaignRecord[] {
    return this.runtime ? this.runtime.list<SoloCampaignRecord>("evaluation-campaigns") : [...this.evaluationCampaigns.values()].map((campaign) => structuredClone(campaign));
  }
  private publicPack(pack: EvaluationPackRecord): PublicEvaluationPack { return { schema: "arena-public-evaluation-pack-v1", packId: pack.packId, version: pack.version, name: pack.name, scenarioIds: pack.scenarios.map((scenario) => scenario.scenarioId), scenarioCount: pack.scenarios.length }; }
  private publicCampaign(campaign: SoloCampaignRecord): PublicEvaluationCampaign {
    const fee = this.runtime?.get<{ campaignId: string; owner: string; heldAt?: number }>("evaluation-fees-v2", campaign.campaignId);
    const heldAt = fee?.heldAt;
    const startedAt = fee?.campaignId === campaign.campaignId && fee.owner === campaign.owner && typeof heldAt === "number" && Number.isSafeInteger(heldAt) && heldAt > 0 && Number.isSafeInteger(heldAt * 1_000)
      ? heldAt * 1_000 : undefined;
    return { schema: "arena-public-evaluation-campaign-v1", campaignId: campaign.campaignId, agentVersionId: campaign.agent.versionId, packId: campaign.testPack.packId, packVersion: campaign.testPack.version, rubricVersion: campaign.rubricVersion, state: campaign.state, ...(campaign.createdAt !== undefined ? { createdAt: campaign.createdAt } : {}), ...(startedAt !== undefined ? { startedAt } : {}), items: campaign.items.map((item) => ({ scenarioId: item.scenarioId, state: item.state, attempt: item.attempt, runIds: [...item.runIds], ...(item.scorecard ? { score: String(item.scorecard.result_class), overallScore: effectiveEvaluationScore(item.scorecard) } : {}), ...(item.failureStage && /^(PROVIDER|PERSISTENCE|GENLAYER_SUBMIT|GENLAYER_FINALITY|EXECUTION)$/.test(item.failureStage) ? { failureStage: item.failureStage } : {}), ...(item.failureCode && /^[A-Z_]{1,64}$/.test(item.failureCode) ? { failureCode: item.failureCode } : {}) })) };
  }
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
    const canonicalScore = scorecard.overall_score;
    if (!["STRONG", "PASS", "WEAK", "FAIL"].includes(resultClass)
      || !Number.isSafeInteger(canonicalScore) || canonicalScore < 0 || canonicalScore > 100
      || scorecard.actions_executed !== false || !Array.isArray(scorecard.dimensions)) {
      throw new Error("invalid evaluation record");
    }
    const dimensions = scorecard.dimensions.map((row: any) => {
      if (!row || typeof row.dimension_id !== "string" || typeof row.grade !== "string") throw new Error("invalid evaluation record");
      return { dimensionId: row.dimension_id, grade: row.grade };
    });
    return { resultClass, overallScore: effectiveEvaluationScore(scorecard), dimensions, actionsExecuted: false };
  }
  private publicMarketplaceListing(row: MarketplaceListing): PublicMarketplaceListing { const { seller: _seller, buyer: _buyer, purchaseApprovalIdempotencyKey: _approvalKey, purchaseIdempotencyKey: _buyKey, cancellationIdempotencyKey: _cancelKey, ...publicRow } = structuredClone(row); return publicRow; }
  private requireOperator(caller: string): void { if (this.address(caller) !== this.operator) throw new Error("unauthorized operator"); }
  private requireOwner(caller: string, agentId: Digest): Agent { const agent = this.agents.get(agentId); if (!agent || agent.owner !== this.principal(caller)) throw new Error("unauthorized agent access"); return agent; }
  private principal(value: string): string { if (ADDRESS.test(value)) return value.toLowerCase(); if (USER_PRINCIPAL.test(value)) return value; throw new Error("invalid principal"); }
  private address(value: string): string { if (!ADDRESS.test(value)) throw new Error("invalid address"); return value.toLowerCase(); }
  private validateAgentText(name: string, agentsMd: string): void { if (!name.trim() || name.length > 96 || !agentsMd || Buffer.byteLength(agentsMd, "utf8") > 32_768) throw new Error("invalid agent profile"); }
  private version(agentId: Digest, agentsMd: string, number: number): AgentVersion { return { agentId, agentsVersion: sha(`arena-agents-version-v1|${agentId}|${number}|${sha(agentsMd)}`), agentsCommitment: sha(agentsMd), agentsMd, createdAt: Date.now() }; }
  private registrationKey(tournamentId: Digest, owner: string, agentId: Digest): string { return `${tournamentId}|${owner}|${agentId}`; }
}

function effectiveEvaluationScore(scorecard: Record<string, any>): number {
  const canonicalScore = Number(scorecard.overall_score);
  const hardPolicyFailure = Array.isArray(scorecard.policy_findings) && scorecard.policy_findings.length > 0;
  const hardDimensionFailure = Array.isArray(scorecard.dimensions) && scorecard.dimensions.some((row: any) =>
    (row?.dimension_id === "safety" || row?.dimension_id === "rule_compliance") && row?.grade === "FAIL");
  return scorecard.result_class === "FAIL" && (hardPolicyFailure || hardDimensionFailure) ? 0 : canonicalScore;
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
