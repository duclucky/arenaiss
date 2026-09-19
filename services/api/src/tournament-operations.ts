export type TournamentOperationAction = 'PROGRESS' | 'SETTLE' | 'EXPIRE' | 'REFUND';
export type TournamentOperationState = 'DRAFT' | 'REGISTRATION' | 'RUNNING' | 'WAITING_FOR_JUDGE' | 'SETTLEMENT_PENDING' | 'REFUND_PENDING' | 'COMPLETED' | 'REFUNDED' | 'RECOVERY_REQUIRED';

export type TournamentOperationSnapshot = {
  tournamentId: string;
  name: string;
  state: TournamentOperationState;
  entrantCount: number;
  matchCount: number;
  finalizedMatchCount: number;
  nextActions: readonly TournamentOperationAction[];
  arc?: { state: string; transactionHash?: string; totalLiability?: string };
  genLayer?: { pendingCount: number; finalizedCount: number; recoveryCount?: number };
  message?: string;
};

export type CreateTournamentOperation = {
  tournamentId: string;
  name: string;
  registrationOpensAt: number;
  registrationClosesAt: number;
  startsAt: number;
  expiresAt: number;
  minEntrants: number;
  maxEntrants: number;
  stakeAmount: string;
};

export interface TournamentOperationsPort {
  list(): Promise<TournamentOperationSnapshot[]>;
  get(tournamentId: string): Promise<TournamentOperationSnapshot | null>;
  create(input: CreateTournamentOperation): Promise<TournamentOperationSnapshot>;
  execute(input: { tournamentId: string; action: TournamentOperationAction }): Promise<TournamentOperationSnapshot>;
}
