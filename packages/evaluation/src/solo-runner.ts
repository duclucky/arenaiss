import { randomUUID } from "node:crypto";

import type { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";
import { classifyEvaluationProviderError, type EvaluationProviderResult } from "./provider.ts";
import { buildEvaluationInput, sha256Text, validateEvaluationScenario, type EvaluationProviderInput, type EvaluationScenario } from "./protocol.ts";
import type { EvaluationRunTracker } from "./run-tracker.ts";

export interface SoloProviderPort {
  generate(value: { model: string; input: EvaluationProviderInput; maxOutputTokens: number; temperature: number; operationKey: string }): Promise<EvaluationProviderResult>;
}

export interface SoloCampaignInput {
  campaignId: `sha256:${string}`;
  owner: string;
  agent: { versionId: `sha256:${string}`; commitment: `sha256:${string}`; agentsMd: string };
  testPack: { packId: `sha256:${string}`; version: string; scenarios: EvaluationScenario[] };
  runtimePolicy: { model: string; maxOutputTokens: number; temperature: number; maxProviderAttempts: number };
  rubricVersion: "AgentEvaluationV5";
}

export interface SoloCampaignItem {
  scenarioId: string;
  state: "PENDING" | "GENERATING" | "RETRYABLE" | "JUDGING" | "RECOVERY_REQUIRED" | "FINALIZED" | "FAILED";
  attempt: number;
  runIds: string[];
  currentRunId?: string;
  failure?: string;
  failureStage?: "PROVIDER" | "PERSISTENCE" | "GENLAYER_SUBMIT" | "GENLAYER_FINALITY" | "EXECUTION";
  failureCode?: string;
  scorecard?: Record<string, any>;
  providerModel?: string;
  providerRoute?: "PRIMARY" | "FALLBACK";
}

export interface SoloCampaignRecord extends SoloCampaignInput {
  schema: "arena-solo-campaign-v1";
  createdAt?: number;
  state: "PENDING" | "RUNNING" | "RECOVERY_REQUIRED" | "FINALIZED" | "FAILED";
  items: SoloCampaignItem[];
}

export interface SoloCampaignStore {
  get(campaignId: string): SoloCampaignRecord | undefined;
  put(record: SoloCampaignRecord): void;
  advanceOnce(campaignId: string, operation: () => Promise<SoloCampaignRecord>): Promise<SoloCampaignRecord>;
}

const clone = <T>(value: T): T => structuredClone(value);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export class MemorySoloCampaignStore implements SoloCampaignStore {
  private records = new Map<string, SoloCampaignRecord>();
  private advances = new Map<string, Promise<SoloCampaignRecord>>();

  get(campaignId: string): SoloCampaignRecord | undefined {
    const record = this.records.get(campaignId);
    return record ? clone(record) : undefined;
  }

  put(record: SoloCampaignRecord): void {
    this.records.set(record.campaignId, clone(record));
  }

  advanceOnce(campaignId: string, operation: () => Promise<SoloCampaignRecord>): Promise<SoloCampaignRecord> {
    const active = this.advances.get(campaignId);
    if (active) return active;
    const promise = Promise.resolve().then(operation);
    this.advances.set(campaignId, promise);
    void promise.finally(() => {
      if (this.advances.get(campaignId) === promise) this.advances.delete(campaignId);
    }).catch(() => undefined);
    return promise;
  }
}

export class PersistentSoloCampaignStore implements SoloCampaignStore {
  private readonly runtime: SqliteRuntimeStore;
  private readonly workerId: string;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private advances = new Map<string, Promise<SoloCampaignRecord>>();

  constructor(runtime: SqliteRuntimeStore, options: { workerId?: string; now?: () => number; leaseMs?: number } = {}) {
    this.runtime = runtime;
    this.workerId = options.workerId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
    if (!this.workerId || !Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1) throw new TypeError("SOLO lease configuration is invalid");
  }

  get(campaignId: string): SoloCampaignRecord | undefined {
    return this.runtime.get<SoloCampaignRecord>("evaluation-campaigns", campaignId);
  }

  put(record: SoloCampaignRecord): void {
    this.runtime.put("evaluation-campaigns", record.campaignId, record);
  }

  advanceOnce(campaignId: string, operation: () => Promise<SoloCampaignRecord>): Promise<SoloCampaignRecord> {
    const active = this.advances.get(campaignId);
    if (active) return active;
    const fingerprint = sha256Text(`arena-solo-advance-v1|${campaignId}`);
    const claim = this.runtime.claimLease("evaluation-campaign-advance", campaignId, fingerprint, this.workerId, this.now(), this.leaseMs);
    if (claim === "BUSY") return Promise.reject(new Error("SOLO campaign is leased by another worker"));
    const promise = Promise.resolve().then(operation);
    this.advances.set(campaignId, promise);
    void promise.finally(() => {
      if (this.advances.get(campaignId) === promise) this.advances.delete(campaignId);
      this.runtime.releaseLease("evaluation-campaign-advance", campaignId, this.workerId);
    }).catch(() => undefined);
    return promise;
  }
}

export class SoloEvaluationRunner {
  private readonly provider: SoloProviderPort;
  private readonly tracker: EvaluationRunTracker;
  private readonly store: SoloCampaignStore;

  constructor(provider: SoloProviderPort, tracker: EvaluationRunTracker, store: SoloCampaignStore) {
    this.provider = provider;
    this.tracker = tracker;
    this.store = store;
  }

  start(input: SoloCampaignInput): SoloCampaignRecord {
    const normalized = this.validateInput(input);
    const created: SoloCampaignRecord = {
      ...normalized,
      schema: "arena-solo-campaign-v1",
      state: "PENDING",
      items: normalized.testPack.scenarios.map((scenario) => ({ scenarioId: scenario.scenarioId, state: "PENDING", attempt: 0, runIds: [] })),
    };
    const existing = this.store.get(created.campaignId);
    if (existing) {
      const existingBinding = { ...existing, state: created.state, items: created.items };
      if (JSON.stringify(existingBinding) !== JSON.stringify(created)) throw new Error("conflicting SOLO campaign binding");
      return existing;
    }
    this.store.put(created);
    return clone(created);
  }

  advance(campaignId: string): Promise<SoloCampaignRecord> {
    if (!DIGEST.test(campaignId)) return Promise.reject(new TypeError("SOLO campaign ID is invalid"));
    return this.store.advanceOnce(campaignId, () => this.advanceClaimed(campaignId));
  }

  get(campaignId: string): SoloCampaignRecord | undefined {
    return this.store.get(campaignId);
  }

  failInfrastructure(campaignId: string, failure: { stage: NonNullable<SoloCampaignItem["failureStage"]>; code: string } = { stage: "EXECUTION", code: "UNEXPECTED_RUNTIME_ERROR" }): SoloCampaignRecord {
    const campaign = this.requireCampaign(campaignId);
    if (["FINALIZED", "FAILED", "RECOVERY_REQUIRED"].includes(campaign.state)) return campaign;
    const itemIndex = campaign.items.findIndex((item) => item.state !== "FINALIZED");
    if (itemIndex < 0) return this.persist({ ...campaign, state: "FAILED" });
    const failed: SoloCampaignItem = { ...campaign.items[itemIndex], state: "FAILED", failure: "INFRASTRUCTURE_ERROR", failureStage: failure.stage, failureCode: failure.code };
    return this.persist(this.updateItem(campaign, itemIndex, failed, "FAILED"));
  }

  private async advanceClaimed(campaignId: string): Promise<SoloCampaignRecord> {
    let campaign = this.requireCampaign(campaignId);
    if (["FINALIZED", "FAILED", "RECOVERY_REQUIRED"].includes(campaign.state)) return campaign;
    const itemIndex = campaign.items.findIndex((item) => item.state !== "FINALIZED");
    if (itemIndex < 0) return this.persist({ ...campaign, state: "FINALIZED" });
    let item = campaign.items[itemIndex];

    if (!item.currentRunId) {
      const attempt = item.attempt + 1;
      const scenario = campaign.testPack.scenarios[itemIndex];
      const runId = sha256Text(["arena-solo-run-v1", campaign.campaignId, campaign.agent.versionId, campaign.testPack.packId, campaign.testPack.version, scenario.scenarioId, scenario.version, String(attempt), campaign.rubricVersion].join("|"));
      const operationKey = `solo:${campaign.campaignId}:${scenario.scenarioId}:${attempt}`;
      const input = buildEvaluationInput({ runId, agentVersionId: campaign.agent.versionId, agentsMd: campaign.agent.agentsMd, agentsCommitment: campaign.agent.commitment, scenario });
      this.tracker.createRun({ input, rubricVersion: campaign.rubricVersion, providerOperationKey: operationKey });
      item = { scenarioId: scenario.scenarioId, state: "GENERATING", attempt, runIds: [...item.runIds, runId], currentRunId: runId };
      campaign = this.updateItem(campaign, itemIndex, item, "RUNNING");
      this.store.put(campaign);
    }

    let run = this.tracker.get(item.currentRunId!);
    if (!run) throw new Error("SOLO run is missing");
    if (run.provider.state === "PENDING") {
      try {
        const result = await this.provider.generate({
          model: campaign.runtimePolicy.model,
          input: run.input,
          maxOutputTokens: campaign.runtimePolicy.maxOutputTokens,
          temperature: campaign.runtimePolicy.temperature,
          operationKey: run.provider.operationKey,
        });
        run = this.tracker.recordProviderSuccess(run.runId, result);
      } catch (error) {
        const failure = classifyEvaluationProviderError(error);
        this.tracker.recordProviderFailure(run.runId, failure);
        return this.persistProviderFailure(campaign, itemIndex, item, failure);
      }
    }

    if (run.provider.state !== "SUCCESS") {
      return this.persistProviderFailure(campaign, itemIndex, item, run.provider.state);
    }

    item = { ...item, state: "JUDGING", providerModel: run.provider.model ?? campaign.runtimePolicy.model, providerRoute: run.provider.route ?? "PRIMARY", failure: undefined, failureStage: undefined, failureCode: undefined };
    campaign = this.updateItem(campaign, itemIndex, item, "RUNNING");
    this.store.put(campaign);
    run = this.tracker.get(item.currentRunId!)!;
    if (run.judge.state === "NOT_SUBMITTED") {
      try { await this.tracker.submit(run.runId); }
      catch {
        const persisted = this.tracker.get(run.runId);
        if (!persisted || persisted.judge.state === "NOT_SUBMITTED") {
          return this.persistInfrastructureFailure(campaign, itemIndex, item, "GENLAYER_SUBMIT", "GENLAYER_SUBMISSION_FAILED");
        }
      }
    }
    let polled;
    try { polled = await this.tracker.poll(run.runId); }
    catch {
      const persisted = this.tracker.get(run.runId);
      const reconciling = persisted?.judge.state === "SUBMISSION_PERSISTED";
      return this.persist(this.updateItem(campaign, itemIndex, { ...item, failureStage: "GENLAYER_FINALITY", failureCode: reconciling ? "GENLAYER_RECONCILING" : "GENLAYER_FINALITY_RETRY" }, "RUNNING"));
    }
    if (polled.judge.state === "RECOVERY_REQUIRED") {
      const uncertain: SoloCampaignItem = { ...item, state: "RECOVERY_REQUIRED", failure: "INFRASTRUCTURE_ERROR", failureStage: "GENLAYER_SUBMIT", failureCode: "GENLAYER_TRANSACTION_UNKNOWN" };
      return this.persist(this.updateItem(campaign, itemIndex, uncertain, "RECOVERY_REQUIRED"));
    }
    if (polled.judge.state === "FAILED") {
      return this.persistInfrastructureFailure(campaign, itemIndex, item, "GENLAYER_FINALITY", "JUDGE_EXECUTION_FAILED");
    }
    if (polled.judge.state !== "FINALIZED") {
      const pending = polled.judge.state === "SUBMISSION_PERSISTED"
        ? { ...item, failureStage: "GENLAYER_FINALITY" as const, failureCode: "GENLAYER_RECONCILING" }
        : item;
      return this.persist(this.updateItem(campaign, itemIndex, pending, "RUNNING"));
    }
    const finalized: SoloCampaignItem = { ...item, state: "FINALIZED", scorecard: clone(polled.scorecard!) };
    campaign = this.updateItem(campaign, itemIndex, finalized, "RUNNING");
    if (campaign.items.every((candidate) => candidate.state === "FINALIZED")) campaign = { ...campaign, state: "FINALIZED" };
    return this.persist(campaign);
  }

  private validateInput(input: SoloCampaignInput): SoloCampaignInput {
    if (!DIGEST.test(input?.campaignId) || !ADDRESS.test(input?.owner) || !DIGEST.test(input?.agent?.versionId) || !DIGEST.test(input?.agent?.commitment)) throw new TypeError("SOLO campaign identity is invalid");
    if (!input.agent.agentsMd || Buffer.byteLength(input.agent.agentsMd, "utf8") > 32_768 || sha256Text(input.agent.agentsMd) !== input.agent.commitment) throw new TypeError("SOLO Agent binding is invalid");
    if (!DIGEST.test(input?.testPack?.packId) || typeof input.testPack.version !== "string" || !input.testPack.version || input.testPack.version.length > 64) throw new TypeError("SOLO Test Pack is invalid");
    if (!Array.isArray(input.testPack.scenarios) || input.testPack.scenarios.length < 1 || input.testPack.scenarios.length > 32) throw new TypeError("SOLO scenarios are invalid");
    const scenarios = input.testPack.scenarios.map(validateEvaluationScenario);
    if (new Set(scenarios.map((scenario) => scenario.scenarioId)).size !== scenarios.length) throw new TypeError("SOLO scenarios contain duplicate IDs");
    const policy = input.runtimePolicy;
    if (!policy?.model || Buffer.byteLength(policy.model, "utf8") > 160 || !Number.isSafeInteger(policy.maxOutputTokens) || policy.maxOutputTokens < 1 || policy.maxOutputTokens > 32_768 || !Number.isFinite(policy.temperature) || policy.temperature < 0 || policy.temperature > 2 || !Number.isSafeInteger(policy.maxProviderAttempts) || policy.maxProviderAttempts < 1 || policy.maxProviderAttempts > 3) throw new TypeError("SOLO runtime policy is invalid");
    if (input.rubricVersion !== "AgentEvaluationV5") throw new TypeError("SOLO rubric is unsupported");
    return clone({ ...input, owner: input.owner.toLowerCase(), testPack: { ...input.testPack, scenarios } });
  }

  private requireCampaign(campaignId: string): SoloCampaignRecord {
    const campaign = this.store.get(campaignId);
    if (!campaign) throw new Error("SOLO campaign is unknown");
    return campaign;
  }

  private updateItem(campaign: SoloCampaignRecord, index: number, item: SoloCampaignItem, state: SoloCampaignRecord["state"]): SoloCampaignRecord {
    const items = campaign.items.map((candidate, candidateIndex) => candidateIndex === index ? clone(item) : candidate);
    return { ...campaign, state, items };
  }

  private persistProviderFailure(campaign: SoloCampaignRecord, itemIndex: number, item: SoloCampaignItem, failure: string): SoloCampaignRecord {
    if (item.attempt < campaign.runtimePolicy.maxProviderAttempts) {
      const retryable: SoloCampaignItem = { ...item, state: "RETRYABLE", currentRunId: undefined, failure, failureStage: "PROVIDER", failureCode: failure };
      return this.persist(this.updateItem(campaign, itemIndex, retryable, "RUNNING"));
    }
    const failed: SoloCampaignItem = { ...item, state: "FAILED", failure, failureStage: "PROVIDER", failureCode: failure };
    return this.persist(this.updateItem(campaign, itemIndex, failed, "FAILED"));
  }

  private persistInfrastructureFailure(campaign: SoloCampaignRecord, itemIndex: number, item: SoloCampaignItem, failureStage: NonNullable<SoloCampaignItem["failureStage"]>, failureCode: string): SoloCampaignRecord {
    const failed: SoloCampaignItem = { ...item, state: "FAILED", failure: "INFRASTRUCTURE_ERROR", failureStage, failureCode };
    return this.persist(this.updateItem(campaign, itemIndex, failed, "FAILED"));
  }

  private persist(campaign: SoloCampaignRecord): SoloCampaignRecord {
    this.store.put(campaign);
    return clone(campaign);
  }
}
