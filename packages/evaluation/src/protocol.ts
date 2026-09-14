import { createHash } from "node:crypto";

export const EVALUATION_INPUT_SCHEMA = "arena-evaluation-input-v1";
export const EVALUATION_OUTPUT_SCHEMA = "arena-evaluation-output-v1";
export const TEST_SCENARIO_SCHEMA = "arena-test-scenario-v1";

export type EvaluationLevel = "RESPONSE" | "ACTION_DECISION";
export type Digest = `sha256:${string}`;
export type EvaluationDecision = "RESPOND" | "PROPOSE_ACTION" | "REQUEST_CONFIRMATION" | "REFUSE";

export interface ActionDefinition {
  actionId: string;
  description: string;
  argumentKeys: string[];
  requiresConfirmation: boolean;
}

export interface EvaluationScenario {
  schema: typeof TEST_SCENARIO_SCHEMA;
  scenarioId: string;
  version: string;
  level: EvaluationLevel;
  objective: string;
  context: string;
  constraints: string[];
  availableActions: ActionDefinition[];
  forbiddenActionIds: string[];
  confirmationRequiredActionIds: string[];
  maxProposedActions: number;
}

export interface EvaluationOutput {
  schema: typeof EVALUATION_OUTPUT_SCHEMA;
  mode: EvaluationLevel;
  decision: EvaluationDecision;
  answer: string;
  observableRationale: string;
  proposedActions: Array<{ actionId: string; arguments: Record<string, unknown> }>;
}

export interface EvaluationProviderInput {
  schema: typeof EVALUATION_INPUT_SCHEMA;
  mode: EvaluationLevel;
  run_id: Digest;
  agent: { artifact: "AGENTS.md"; version_id: Digest; commitment: Digest; content: string };
  scenario: {
    schema: typeof TEST_SCENARIO_SCHEMA;
    scenario_id: string;
    version: string;
    mode: EvaluationLevel;
    objective: string;
    context: string;
    constraints: string[];
    available_actions: Array<{ action_id: string; description: string; argument_keys: string[]; requires_confirmation: boolean }>;
    forbidden_action_ids: string[];
    confirmation_required_action_ids: string[];
    max_proposed_actions: number;
  };
  output_contract: {
    schema: typeof EVALUATION_OUTPUT_SCHEMA;
    allowed_decisions: EvaluationDecision[];
    actions_are_proposals_only: true;
    hidden_chain_of_thought_forbidden: true;
  };
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_.-]{1,96}$/;
const OUTPUT_FIELDS = new Set(["schema", "mode", "decision", "answer", "observable_rationale", "proposed_actions"]);

export const sha256Text = (value: string): Digest => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

function requireText(value: unknown, name: string, maximumBytes: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) throw new TypeError(`${name} must be ${allowEmpty ? "text" : "non-empty text"}`);
  if (Buffer.byteLength(value, "utf8") > maximumBytes) throw new TypeError(`${name} exceeds byte limit`);
  return value;
}

function requireDigest(value: unknown, name: string): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${name} digest is invalid`);
  return value as Digest;
}

function requireId(value: unknown, name: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function uniqueTextList(value: unknown, name: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new TypeError(`${name} is invalid`);
  const result = value.map((item, index) => requireText(item, `${name}[${index}]`, 1024));
  if (new Set(result).size !== result.length) throw new TypeError(`${name} contains duplicates`);
  return result;
}

export function validateEvaluationScenario(value: EvaluationScenario): EvaluationScenario {
  if (!value || typeof value !== "object") throw new TypeError("scenario is invalid");
  if (value.schema !== TEST_SCENARIO_SCHEMA) throw new TypeError("scenario schema is unsupported");
  if (value.level !== "RESPONSE" && value.level !== "ACTION_DECISION") throw new TypeError("scenario level is invalid");
  requireId(value.scenarioId, "scenario ID");
  requireText(value.version, "scenario version", 64);
  requireText(value.objective, "scenario objective", 4096);
  requireText(value.context, "scenario context", 16384, true);
  uniqueTextList(value.constraints, "scenario constraints", 24);
  if (!Array.isArray(value.availableActions) || value.availableActions.length > 16) throw new TypeError("available actions are invalid");
  const actionIds = new Set<string>();
  for (const action of value.availableActions) {
    const actionId = requireId(action?.actionId, "action ID");
    if (actionIds.has(actionId)) throw new TypeError("available actions contain duplicates");
    actionIds.add(actionId);
    requireText(action.description, "action description", 1024);
    uniqueTextList(action.argumentKeys, "action argument keys", 24).forEach((key) => requireId(key, "action argument key"));
    if (typeof action.requiresConfirmation !== "boolean") throw new TypeError("action confirmation flag is invalid");
  }
  const forbidden = uniqueTextList(value.forbiddenActionIds, "forbidden action IDs", 16);
  const confirmation = uniqueTextList(value.confirmationRequiredActionIds, "confirmation action IDs", 16);
  forbidden.forEach((id) => requireId(id, "forbidden action ID"));
  confirmation.forEach((id) => requireId(id, "confirmation action ID"));
  if (!Number.isSafeInteger(value.maxProposedActions) || value.maxProposedActions < 0 || value.maxProposedActions > 8) throw new TypeError("max proposed actions is invalid");
  if (value.level === "RESPONSE" && (value.availableActions.length !== 0 || value.maxProposedActions !== 0)) throw new TypeError("response scenario cannot expose actions");
  return structuredClone(value);
}

export function buildEvaluationInput(value: { runId: Digest; agentVersionId: Digest; agentsMd: string; agentsCommitment: Digest; scenario: EvaluationScenario }): EvaluationProviderInput {
  const scenario = validateEvaluationScenario(value.scenario);
  const agentsMd = requireText(value.agentsMd, "AGENTS.md", 32768);
  const commitment = requireDigest(value.agentsCommitment, "AGENTS.md");
  if (sha256Text(agentsMd) !== commitment) throw new TypeError("AGENTS.md commitment mismatch");
  return {
    schema: EVALUATION_INPUT_SCHEMA,
    mode: scenario.level,
    run_id: requireDigest(value.runId, "run ID"),
    agent: { artifact: "AGENTS.md", version_id: requireDigest(value.agentVersionId, "agent version ID"), commitment, content: agentsMd },
    scenario: {
      schema: scenario.schema,
      scenario_id: scenario.scenarioId,
      version: scenario.version,
      mode: scenario.level,
      objective: scenario.objective,
      context: scenario.context,
      constraints: [...scenario.constraints],
      available_actions: scenario.availableActions.map((action) => ({ action_id: action.actionId, description: action.description, argument_keys: [...action.argumentKeys], requires_confirmation: action.requiresConfirmation })),
      forbidden_action_ids: [...scenario.forbiddenActionIds],
      confirmation_required_action_ids: [...scenario.confirmationRequiredActionIds],
      max_proposed_actions: scenario.maxProposedActions,
    },
    output_contract: {
      schema: EVALUATION_OUTPUT_SCHEMA,
      allowed_decisions: ["RESPOND", "PROPOSE_ACTION", "REQUEST_CONFIRMATION", "REFUSE"],
      actions_are_proposals_only: true,
      hidden_chain_of_thought_forbidden: true,
    },
  };
}

export function parseEvaluationOutput(raw: string, expectedMode: EvaluationLevel): EvaluationOutput {
  if (typeof raw !== "string" || raw.trim().length === 0) throw new Error("EMPTY_OUTPUT");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("INVALID_OUTPUT_JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_OUTPUT_JSON");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!OUTPUT_FIELDS.has(key)) throw new Error(`unsupported output field: ${key}`);
  if (record.schema !== EVALUATION_OUTPUT_SCHEMA) throw new Error("OUTPUT_SCHEMA_MISMATCH");
  if (record.mode !== expectedMode) throw new Error("OUTPUT_MODE_MISMATCH");
  if (!["RESPOND", "PROPOSE_ACTION", "REQUEST_CONFIRMATION", "REFUSE"].includes(String(record.decision))) throw new Error("OUTPUT_DECISION_INVALID");
  const answer = requireText(record.answer, "output answer", 32768);
  const observableRationale = requireText(record.observable_rationale, "observable rationale", 4096);
  if (!Array.isArray(record.proposed_actions) || record.proposed_actions.length > 8) throw new Error("OUTPUT_ACTIONS_INVALID");
  const proposedActions = record.proposed_actions.map((rawAction, index) => {
    if (!rawAction || typeof rawAction !== "object" || Array.isArray(rawAction)) throw new Error("OUTPUT_ACTION_INVALID");
    const action = rawAction as Record<string, unknown>;
    if (Object.keys(action).some((key) => key !== "action_id" && key !== "arguments")) throw new Error("OUTPUT_ACTION_FIELD_INVALID");
    const actionId = requireId(action.action_id, `output action ${index} ID`);
    if (!action.arguments || typeof action.arguments !== "object" || Array.isArray(action.arguments)) throw new Error("OUTPUT_ACTION_ARGUMENTS_INVALID");
    return { actionId, arguments: structuredClone(action.arguments as Record<string, unknown>) };
  });
  if (expectedMode === "RESPONSE" && (proposedActions.length > 0 || record.decision === "PROPOSE_ACTION" || record.decision === "REQUEST_CONFIRMATION")) throw new Error("RESPONSE_ACTIONS_FORBIDDEN");
  return { schema: EVALUATION_OUTPUT_SCHEMA, mode: expectedMode, decision: record.decision as EvaluationDecision, answer, observableRationale, proposedActions };
}
