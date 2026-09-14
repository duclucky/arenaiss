export type Tournament = {
  id: string;
  name: string;
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  prizePool: string;
  demo?: TournamentDemoDetail;
};

export type TournamentDemoRound = {
  name: string;
  status: 'COMPLETE' | 'LIVE' | 'UPCOMING';
  matchCount: number;
  completedCount: number;
};

export type TournamentDemoActivity = {
  id: string;
  time: string;
  label: string;
  detail: string;
  status: 'DONE' | 'CURRENT' | 'PENDING' | 'WARNING';
};

export type TournamentDemoDetail = {
  evidenceSource?: 'LIVE' | 'PREVIEW';
  description: string;
  format: string;
  topic: string;
  entrants: number;
  maxEntrants: number;
  entryFee: string;
  platformFee: string;
  rounds: TournamentDemoRound[];
  payoutRows: { rank: string; share: string; amount: string }[];
  activity: TournamentDemoActivity[];
  settlementNote: string;
};

export type MatchState =
  | 'SCHEDULED'
  | 'WAITING_FOR_OUTPUTS'
  | 'JUDGING'
  | 'ACCEPTED'
  | 'FAILED'
  | 'RETRYABLE'
  | 'FINALIZED'
  | 'TIE'
  | 'RETRY'
  | 'WINNER_ADVANCED';

export type Match = {
  id: string;
  tournamentId: string;
  state: MatchState;
  agentA: string;
  agentB: string;
  winner?: string;
  round: number;
};

export type MatchVerdict = {
  id: string;
  matchId: string;
  winner: 'A' | 'B' | 'TIE';
  reasons: string[];
  summary: string;
  explorerUrl?: string;
  transactionHash?: string;
  source?: 'LIVE' | 'PREVIEW';
  topic?: string;
  rubricVersion?: string;
  attempt?: number;
  finality?: 'SUBMITTED' | 'ACCEPTED' | 'FINALIZED';
  execution?: 'PENDING' | 'SUCCESS' | 'FAILED';
  scoreA?: number;
  scoreB?: number;
  criteria?: MatchCriterion[];
  safetyClass?: string;
  canonicalMatchId?: string;
  attemptId?: string;
  network?: string;
  chainId?: number;
  judgeAddress?: string;
  arcTournamentId?: string;
  arcEscrowAddress?: string;
  grossPoolUsdc?: string;
  netPayoutUsdc?: string;
  platformFeeUsdc?: string;
  arcState?: string;
};

export type MatchCriterion = {
  id: string;
  label: string;
  winner: 'A' | 'B' | 'TIE';
  reason: string;
};

export type LifecycleState =
  | 'PENDING'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'FINALIZED'
  | 'FAILED'
  | 'RETRYABLE'
  | 'UNKNOWN'
  | 'NOT_CONFIGURED';

export interface ArenaReadAdapter {
  listTournaments(): Promise<Tournament[]>;
  getTournament(id: string): Promise<Tournament | null>;
  getMatches(tournamentId: string): Promise<Match[]>;
  getMatch(id: string): Promise<Match | null>;
}

export interface ArenaWriteAdapter {
  registerAgent(tournamentId: string, agentsMd: string): Promise<LifecycleState>;
  enterTournament(tournamentId: string): Promise<LifecycleState>;
  requestRetry(matchId: string): Promise<LifecycleState>;
}

export type AgentProfile = {
  agentId: string;
  name: string;
  agentsVersion: string;
  agentsCommitment: string;
};

export type OwnedRegistration = Pick<EntrantRegistration, 'tournamentId' | 'entrantId'>;

export interface AgentApiAdapter {
  listOwnedAgents(): Promise<AgentProfile[]>;
  listOwnedRegistrations(): Promise<OwnedRegistration[]>;
  createAgent(name: string, agentsMd: string): Promise<AgentProfile>;
  prepareRegistration(tournamentId: string, agentId: string): Promise<EntrantRegistration & { stakeAmount: string }>;
}

export type EvaluationScenario = {
  schema: 'arena-test-scenario-v1'; scenarioId: string; version: string; level: 'RESPONSE' | 'ACTION_DECISION';
  objective: string; context: string; constraints: string[];
  availableActions: Array<{ actionId: string; description: string; argumentKeys: string[]; requiresConfirmation: boolean }>;
  forbiddenActionIds: string[]; confirmationRequiredActionIds: string[]; maxProposedActions: number;
};
export type EvaluationPack = { schema: string; packId: string; version: string; name: string; scenarioIds: string[]; scenarioCount: number };
export type EvaluationCampaign = { schema: string; campaignId: string; agentVersionId: string; packId: string; packVersion: string; rubricVersion: string; state: string; items: Array<{ scenarioId: string; state: string; attempt: number; runIds: string[]; score?: string; overallScore?: number }> };
export type EvaluationRun = { schema: string; runId: string; agentVersionId: string; mode: string; rubricVersion: string; scenario: { scenarioId: string; version: string; mode: string; digest: string }; provider: { state: string }; judge: { state: string; transactionHash?: string }; scorecard?: { resultClass: string; overallScore: number; dimensions: Array<{ dimensionId: string; grade: string }>; actionsExecuted: false } };
export interface EvaluationApiAdapter {
  listCampaigns(): Promise<EvaluationCampaign[]>;
  getCampaign(campaignId: string): Promise<EvaluationCampaign | null>;
  listRuns(): Promise<EvaluationRun[]>;
  getRun(runId: string, privateView?: boolean): Promise<EvaluationRun & { scenario: Record<string, unknown>; provider: Record<string, unknown>; scorecard?: Record<string, unknown> }>;
  createPack(input: { packId: string; version: string; name: string; scenarios: EvaluationScenario[] }): Promise<EvaluationPack>;
  createSoloCampaign(input: { campaignId: string; agentId: string; agentsVersion: string; packId: string; packVersion: string; runtimePolicy: { model: string; maxOutputTokens: number; temperature: number; maxProviderAttempts: number } }): Promise<EvaluationCampaign>;
}

export type ArcNetworkConfig = {
  chainId: number;
  rpcUrl: string;
  name: string;
  usdcAddress?: string;
  escrowAddress?: string;
  apiUrl?: string;
  genLayerExplorerUrl?: string;
  genLayer?: GenLayerNetworkConfig;
};

export type GenLayerNetworkConfig = {
  chainId: 61997;
  rpcUrl: string;
  name: string;
  explorerUrl: string;
  matchJudgeAddress: `0x${string}`;
  evaluationJudgeAddress: `0x${string}`;
};

export type EntrantRegistration = {
  tournamentId: string;
  entrantId: string;
  agentId: string;
  agentsVersion: string;
  agentsCommitment: string;
};

export type WalletTransaction = {
  hash: string;
  state: 'SUBMITTED';
};

export type CanonicalEntrant = EntrantRegistration & {
  wallet: string;
  registered: boolean;
  ranked: boolean;
};

export type WalletProvider = {
  name: string;
  icon: string;
  uuid: string;
  isInstalled: boolean;
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  on?: (eventName: string, handler: (...args: any[]) => void) => void;
  removeListener?: (eventName: string, handler: (...args: any[]) => void) => void;
};

export interface ArcWalletAdapter {
  getProviders(): Promise<WalletProvider[]>;
  connect(providerUuid: string): Promise<string>;
  switchChain(config: ArcNetworkConfig): Promise<void>;
  getBalance(address: string, config: ArcNetworkConfig): Promise<string>;
  getAllowance(address: string, config: ArcNetworkConfig): Promise<string>;
  getCredit(tournamentId: string, address: string, config: ArcNetworkConfig): Promise<string>;
  getEntrant(tournamentId: string, entrantId: string, config: ArcNetworkConfig): Promise<CanonicalEntrant>;
  approveEscrow(amount: string, config: ArcNetworkConfig): Promise<WalletTransaction>;
  registerEntrant(input: EntrantRegistration, config: ArcNetworkConfig): Promise<WalletTransaction>;
  withdrawCredit(tournamentId: string, config: ArcNetworkConfig): Promise<WalletTransaction>;
  signMessage(message: string): Promise<string>;
  waitForTransaction(hash: string, config: ArcNetworkConfig): Promise<'CONFIRMED' | 'FAILED'>;
  disconnect(): Promise<void>;
  onAccountsChanged(callback: (accounts: string[]) => void): void;
  removeListener(): void;
}

export interface GenLayerReadAdapter {
  getMatchVerdict(canonicalId: string): Promise<MatchVerdict | null>;
}

export interface PreviewFixtureAdapter extends ArenaReadAdapter, GenLayerReadAdapter {}
