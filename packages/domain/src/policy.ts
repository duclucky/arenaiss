const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]*)$/;

export interface TournamentPolicyV1 {
  schemaVersion: "arena.tournament-policy.v1";
  arcChainId: number;
  escrowAddress: string;
  operatorAddress: string;
  registrationOpensAt: number;
  registrationClosesAt: number;
  startsAt: number;
  expiresAt: number;
  minEntrants: number;
  maxEntrants: number;
  stakeUnits: string;
  maxStakeUnits: string;
  platformFeeBps: number;
  payoutBps: readonly number[];
  retryPolicyVersion: string;
  tiePolicyVersion: string;
  modelPolicyVersion: string;
  topicPolicyVersion: string;
  rubricVersion: string;
  operatorPolicyVersion: string;
}

function fail(message: string): never { throw new Error(`invalid tournament policy: ${message}`); }
function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(`${name} must be an integer`);
  return value;
}
function version(value: unknown, name: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 96) fail(`${name} version is missing or too long`);
}
function stake(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !UINT.test(value) || value === "0") fail(`${name} stake must be a positive canonical integer string`);
  return BigInt(value);
}

export function validateTournamentPolicy(policy: TournamentPolicyV1): void {
  if (!policy || typeof policy !== "object") fail("object is required");
  if (policy.schemaVersion !== "arena.tournament-policy.v1") fail("schema version is unsupported");
  integer(policy.arcChainId, "arc chain");
  if (policy.arcChainId <= 0) fail("arc chain must be positive");
  for (const [name, value] of [["escrow", policy.escrowAddress], ["operator", policy.operatorAddress]] as const) {
    if (typeof value !== "string" || !ADDRESS.test(value)) fail(`${name} address is invalid`);
  }
  const opens = integer(policy.registrationOpensAt, "registration opens");
  const closes = integer(policy.registrationClosesAt, "registration closes");
  const starts = integer(policy.startsAt, "starts");
  const expires = integer(policy.expiresAt, "expires");
  if (opens < 0 || !(opens < closes && closes <= starts && starts < expires)) fail("timestamp order is invalid");
  const min = integer(policy.minEntrants, "minimum entrants");
  const max = integer(policy.maxEntrants, "maximum entrants");
  if (min < 8 || max > 32 || min > max) fail("entrant bounds must be within 8..32");
  const configuredStake = stake(policy.stakeUnits, "entry");
  const maximumStake = stake(policy.maxStakeUnits, "maximum");
  if (configuredStake > maximumStake) fail("entry stake exceeds maximum stake");
  if (policy.platformFeeBps !== 1000) fail("platform fee must be exactly 1000 BPS");
  if (!Array.isArray(policy.payoutBps) || policy.payoutBps.length !== 5 || policy.payoutBps.some((v) => typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)) fail("payout BPS must contain five non-negative integers");
  if (policy.payoutBps.reduce((sum, value) => sum + value, 0) !== 10000) fail("payout BPS must sum to 10000");
  for (const [name, value] of Object.entries(policy)) {
    if (name.endsWith("Version")) version(value, name);
  }
  for (const name of ["retryPolicyVersion", "tiePolicyVersion", "modelPolicyVersion", "topicPolicyVersion", "rubricVersion", "operatorPolicyVersion"] as const) version(policy[name], name);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function assertPolicyImmutable(previous: TournamentPolicyV1, next: TournamentPolicyV1): void {
  validateTournamentPolicy(previous);
  validateTournamentPolicy(next);
  if (stableJson(previous) !== stableJson(next)) fail("policy is immutable after the first accepted entry");
}
