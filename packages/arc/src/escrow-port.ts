export type Bytes32 = `0x${string}`;

export type EscrowCall = {
  method: "createTournament" | "register" | "closeRegistration" | "markRunning"
    | "settleByOperator" | "cancelAndOpenRefunds" | "claimRefund"
    | "withdrawCredit" | "withdrawCreditFor" | "withdrawPlatformFee"
    | "withdrawPlatformFeeFor" | "closeTournament";
  args: readonly unknown[];
};

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function bytes32(value: string, field: string): Bytes32 {
  if (!BYTES32.test(value) || /^0x0{64}$/i.test(value)) throw new TypeError(`${field} must be a non-zero bytes32`);
  return value as Bytes32;
}

function positiveNonce(value: string): string {
  if (!/^[1-9][0-9]*$/.test(value)) throw new TypeError("settlement nonce must be a positive integer string");
  return value;
}

/** Pure call builders keep the Solidity boundary explicit without performing RPC or wallet writes. */
export function buildRegisterCall(input: {
  tournamentId: string;
  entrantId: string;
  agentId: string;
  agentsVersion: string;
  agentsCommitment: string;
}): EscrowCall {
  return {
    method: "register",
    args: [
      bytes32(input.tournamentId, "tournament ID"),
      bytes32(input.entrantId, "entrant ID"),
      bytes32(input.agentId, "agent ID"),
      bytes32(input.agentsVersion, "agents version"),
      bytes32(input.agentsCommitment, "agents commitment"),
    ],
  };
}

export function buildSettlementCall(input: {
  tournamentId: string;
  rankedEntrants: readonly string[];
  rankingDigest: string;
  settlementNonce: string;
}): EscrowCall {
  if (input.rankedEntrants.length !== 5) throw new TypeError("ranking must contain exactly five entrants");
  const ranked = input.rankedEntrants.map((id) => bytes32(id, "ranked entrant ID"));
  if (new Set(ranked).size !== ranked.length) throw new TypeError("ranking entrants must be unique");
  return {
    method: "settleByOperator",
    args: [bytes32(input.tournamentId, "tournament ID"), ranked, bytes32(input.rankingDigest, "ranking digest"), positiveNonce(input.settlementNonce)],
  };
}

export function buildSimpleCall(method: Exclude<EscrowCall["method"], "register" | "settleByOperator" | "withdrawCreditFor">, tournamentId: string): EscrowCall {
  return { method, args: [bytes32(tournamentId, "tournament ID")] };
}

export function buildCreditPayoutCall(tournamentId: string, beneficiary: string): EscrowCall {
  if (!ADDRESS.test(beneficiary) || /^0x0{40}$/i.test(beneficiary)) {
    throw new TypeError("beneficiary must be a non-zero EVM address");
  }
  return { method: "withdrawCreditFor", args: [bytes32(tournamentId, "tournament ID"), beneficiary] };
}
