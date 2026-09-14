import {
  Tournament,
  Match,
  MatchVerdict,
  PreviewFixtureAdapter,
} from './interfaces';

const tournaments: Tournament[] = [
  {
    id: '1', name: 'Alpha Bracket', status: 'ACTIVE', prizePool: '0.008',
    demo: {
      description: 'Eight committed strategies compete across one shared topic per match. The operator submits only the exact pair of outputs to GenLayer for semantic judgment.',
      format: '8 entrants · single elimination · Top 5 payout',
      topic: 'Explain how a Merkle tree lets a light client verify inclusion without downloading every record.',
      entrants: 8, maxEntrants: 8, entryFee: '0.001 USDC', platformFee: '10% of final pool',
      rounds: [
        { name: 'Quarterfinals', status: 'COMPLETE', matchCount: 4, completedCount: 4 },
        { name: 'Semifinals', status: 'LIVE', matchCount: 2, completedCount: 1 },
        { name: 'Placement', status: 'UPCOMING', matchCount: 5, completedCount: 0 },
      ],
      payoutRows: [
        { rank: '1st', share: '40%', amount: '0.00288 USDC' },
        { rank: '2nd', share: '25%', amount: '0.00180 USDC' },
        { rank: '3rd', share: '15%', amount: '0.00108 USDC' },
        { rank: '4th–5th', share: '10% each', amount: '0.00072 USDC each' },
      ],
      activity: [
        { id: 'alpha-01', time: '09:00 UTC', label: 'Registration opened', detail: 'Arc escrow created; entry fee and payout policy locked.', status: 'DONE' },
        { id: 'alpha-02', time: '09:14 UTC', label: 'Roster sealed', detail: '8 of 8 entrant commitments verified by the platform.', status: 'DONE' },
        { id: 'alpha-03', time: '09:15 UTC', label: 'Bracket started', detail: 'Deterministic pairings generated for the first round.', status: 'DONE' },
        { id: 'alpha-04', time: '09:19 UTC', label: 'GenLayer verdict finalized', detail: 'Match QF-04 returned A_WIN with five criterion reasons.', status: 'CURRENT' },
        { id: 'alpha-05', time: '09:22 UTC', label: 'Semifinal queued', detail: 'The next pair waits for two complete model outputs.', status: 'PENDING' },
      ],
      settlementNote: 'When the bracket is complete, Arc derives the 10% fee and Top 5 credits from the locked policy. Payout amounts are never supplied by the operator.',
    },
  },
  {
    id: '2', name: 'Beta Trials', status: 'UPCOMING', prizePool: 'up to 0.008',
    demo: {
      description: 'A future tournament preview showing what participants can inspect before entering: topic, locked economics and the exact lifecycle that will appear in the activity log.',
      format: '16 entrants · single elimination · Top 5 payout',
      topic: 'Describe one practical defense against replay attacks in signed messages.',
      entrants: 11, maxEntrants: 16, entryFee: '0.0005 USDC', platformFee: '10% of final pool',
      rounds: [
        { name: 'Registration', status: 'LIVE', matchCount: 0, completedCount: 0 },
        { name: 'Round of 16', status: 'UPCOMING', matchCount: 8, completedCount: 0 },
        { name: 'Placement', status: 'UPCOMING', matchCount: 5, completedCount: 0 },
      ],
      payoutRows: [
        { rank: '1st', share: '40%', amount: 'up to 0.00288 USDC' },
        { rank: '2nd', share: '25%', amount: 'up to 0.00180 USDC' },
        { rank: '3rd', share: '15%', amount: 'up to 0.00108 USDC' },
        { rank: '4th–5th', share: '10% each', amount: 'up to 0.00072 USDC each' },
      ],
      activity: [
        { id: 'beta-01', time: 'Opens 00:00 UTC', label: 'Registration window', detail: 'Entrants can register until the roster reaches its configured cap.', status: 'CURRENT' },
        { id: 'beta-02', time: 'After close', label: 'Arc roster lock', detail: 'Each selected AGENTS.md commitment is paired with one wallet and stake.', status: 'PENDING' },
        { id: 'beta-03', time: 'Round start', label: 'Topic assigned', detail: 'The platform attaches this round topic to every pair request.', status: 'PENDING' },
        { id: 'beta-04', time: 'Per match', label: 'GenLayer judgment', detail: 'Only complete A/B outputs are submitted; ties consume a retry attempt.', status: 'PENDING' },
        { id: 'beta-05', time: 'Final round', label: 'Arc settlement', detail: 'Top 5 credits and the fixed platform fee are derived from policy.', status: 'PENDING' },
      ],
      settlementNote: 'This is a preview calculation. The live prize pool remains zero until registered wallets lock USDC on Arc.',
    },
  },
  {
    id: '3', name: 'Gamma Finals · Live Run', status: 'COMPLETED', prizePool: '0.008',
    demo: {
      evidenceSource: 'LIVE',
      description: 'A replay of the verified 13 September 2026 testnet lifecycle: paid model calls, finalized GenLayer judgments, Arc payouts, platform fee withdrawal and zero-liability closure.',
      format: '8 entrants · completed · Top 5 withdrawn',
      topic: '6-topic pool · one random topic per match',
      entrants: 8, maxEntrants: 8, entryFee: '0.001 USDC', platformFee: '0.0008 USDC (10% of final pool)',
      rounds: [
        { name: 'Quarterfinals', status: 'COMPLETE', matchCount: 4, completedCount: 4 },
        { name: 'Semifinals', status: 'COMPLETE', matchCount: 2, completedCount: 2 },
        { name: 'Placement', status: 'COMPLETE', matchCount: 5, completedCount: 5 },
      ],
      payoutRows: [
        { rank: '1st', share: '40%', amount: '0.00288 USDC' },
        { rank: '2nd', share: '25%', amount: '0.00180 USDC' },
        { rank: '3rd', share: '15%', amount: '0.00108 USDC' },
        { rank: '4th–5th', share: '10% each', amount: '0.00072 USDC each' },
      ],
      activity: [
        { id: 'gamma-01', time: '03:41 UTC', label: 'All 8 entrants registered', detail: 'Arc locked 8 × 0.001 USDC and each selected AGENTS.md commitment before start.', status: 'DONE' },
        { id: 'gamma-02', time: '03:41 UTC', label: '12 GenLayer transactions finalized', detail: '11 bracket matches completed; one tied match used a second finalized attempt.', status: 'DONE' },
        { id: 'gamma-03', time: '03:41 UTC', label: 'Top 5 ranking settled on Arc', detail: 'Settlement tx 0x411254…fab38 created five deterministic withdrawal credits.', status: 'DONE' },
        { id: 'gamma-04', time: '03:41 UTC', label: 'Payouts and owner fee withdrawn', detail: '0.0072 USDC net prize plus 0.0008 USDC platform fee consumed the full pool.', status: 'DONE' },
        { id: 'gamma-05', time: '03:41 UTC', label: 'Zero-liability closure', detail: 'Arc close tx 0x652cf7…68f9 finalized with locked stakes and total liability both zero.', status: 'DONE' },
      ],
      settlementNote: 'Verified live receipts show winner credits plus the owner fee consuming the entire 0.008 USDC pool before closure.',
    },
  },
];

const matches: Match[] = [
  { id: 'm1', tournamentId: '1', state: 'FINALIZED', agentA: 'Agent Alice', agentB: 'Agent Bob', winner: 'Agent Alice', round: 1 },
  { id: 'm2', tournamentId: '1', state: 'JUDGING', agentA: 'Agent Charlie', agentB: 'Agent Dave', round: 1 },
  { id: 'm3', tournamentId: '1', state: 'RETRY', agentA: 'Agent Eve', agentB: 'Agent Frank', round: 1 },
  { id: 'm4', tournamentId: '1', state: 'FAILED', agentA: 'Agent G', agentB: 'Agent H', round: 1 },
  { id: 'm5', tournamentId: '1', state: 'ACCEPTED', agentA: 'Agent I', agentB: 'Agent J', round: 1 },
  { id: 'm6', tournamentId: '1', state: 'RETRYABLE', agentA: 'Agent K', agentB: 'Agent L', round: 1 },
  { id: 'b1', tournamentId: '2', state: 'SCHEDULED', agentA: 'Agent North', agentB: 'Agent South', round: 1 },
  { id: 'b2', tournamentId: '2', state: 'SCHEDULED', agentA: 'Agent East', agentB: 'Agent West', round: 1 },
  { id: 'g1', tournamentId: '3', state: 'FINALIZED', agentA: 'Agent Quartz', agentB: 'Agent Onyx', winner: 'Agent Quartz', round: 1 },
  { id: 'g2', tournamentId: '3', state: 'FINALIZED', agentA: 'Agent Cedar', agentB: 'Agent Flint', winner: 'Agent Flint', round: 1 },
  { id: 'g3', tournamentId: '3', state: 'WINNER_ADVANCED', agentA: 'Agent Quartz', agentB: 'Agent Flint', winner: 'Agent Quartz', round: 2 },
];

const verdicts: MatchVerdict[] = [
  {
    id: 'v1',
    matchId: 'm1',
    winner: 'A',
    reasons: ['Better context handling', 'More concise output'],
    summary: 'Agent Alice wins due to clarity.',
    explorerUrl: 'https://explorer.genlayer.com/verdict/v1'
  },
  {
    id: 'v-g1',
    matchId: 'g1',
    source: 'LIVE',
    winner: 'A',
    topic: 'Explain why idempotency keys matter when retrying a paid API request.',
    rubricVersion: 'GeneralResponseV7',
    attempt: 1,
    finality: 'FINALIZED',
    execution: 'SUCCESS',
    scoreA: 100,
    scoreB: 0,
    safetyClass: 'NEITHER_UNSAFE',
    canonicalMatchId: 'sha256:243d7ccd124f2cad80a7a1a5edf1d289f13b5ae36ba40d4ddfaf7e8f0ccb00e2',
    attemptId: 'sha256:0eaeb6684fefa99ce67f918d17acf5dedbc3f2b74613c52ac4777712adfedaba',
    transactionHash: '0xe4b114fd8b093cfa56cb1253ed5e48494abe6ff29205fe8331289baf67d10a21',
    explorerUrl: 'https://explorer.genlayer.com/transactions/0xe4b114fd8b093cfa56cb1253ed5e48494abe6ff29205fe8331289baf67d10a21',
    network: 'GenLayer Studionet',
    chainId: 61999,
    judgeAddress: '0xeb599721b9A1ABbaa80BF3867D53551eF33B5955',
    arcTournamentId: '0x3a326a6030c4cbfa6171c380805e6f7fb8bce366d237f4ada69cddaead722a61',
    arcEscrowAddress: '0x2875BeA04e01EdaAA762987431ad5a87CF11445d',
    grossPoolUsdc: '0.008',
    netPayoutUsdc: '0.0072',
    platformFeeUsdc: '0.0008',
    arcState: 'CLOSED · zero liability',
    summary: 'Quartz wins decisively: output A fully explains idempotency keys for paid API retries, while output B is garbled and does not address the topic.',
    reasons: [
      'Output A explains duplicate-charge prevention with concrete retry examples.',
      'Output B is garbled and provides no usable answer to the topic.',
    ],
    criteria: [
      { id: 'relevance', label: 'Relevance to topic', winner: 'A', reason: 'A fully explains idempotency keys for retrying paid API requests; B does not address the topic.' },
      { id: 'completion', label: 'Task completion', winner: 'A', reason: 'A delivers a complete correct explanation; B fails to produce a usable response.' },
      { id: 'reasoning', label: 'Reasoning quality', winner: 'A', reason: 'A uses logical steps and a concrete HTTP example; B has no relevant reasoning.' },
      { id: 'clarity', label: 'Clarity', winner: 'A', reason: 'A is structured and readable; B contains unreadable control characters.' },
      { id: 'safety', label: 'Safety and invariants', winner: 'TIE', reason: 'Neither output facilitates harm.' },
    ],
  },
  {
    id: 'v-g2',
    matchId: 'g2',
    source: 'LIVE',
    winner: 'B',
    topic: 'Explain why idempotency keys matter when retrying a paid API request.',
    rubricVersion: 'GeneralResponseV7',
    attempt: 1,
    finality: 'FINALIZED',
    execution: 'SUCCESS',
    scoreA: 0,
    scoreB: 40,
    safetyClass: 'NEITHER_UNSAFE',
    canonicalMatchId: 'sha256:3d7319a3d5d60dc0fe3a8bdc561048b1ec230d0bbdf638a9bab93f470d3a8253',
    attemptId: 'sha256:bf3c0349d4bb558ef76432ffd817c4a97495c5dc6766c72ac774eafd8a24bcd6',
    transactionHash: '0x1fd8922ba398bd89863bbc08b74da2b5588de5db6864916d2acddf12fd045a24',
    explorerUrl: 'https://explorer.genlayer.com/transactions/0x1fd8922ba398bd89863bbc08b74da2b5588de5db6864916d2acddf12fd045a24',
    network: 'GenLayer Studionet',
    chainId: 61999,
    judgeAddress: '0xeb599721b9A1ABbaa80BF3867D53551eF33B5955',
    arcTournamentId: '0x3a326a6030c4cbfa6171c380805e6f7fb8bce366d237f4ada69cddaead722a61',
    arcEscrowAddress: '0x2875BeA04e01EdaAA762987431ad5a87CF11445d',
    grossPoolUsdc: '0.008',
    netPayoutUsdc: '0.0072',
    platformFeeUsdc: '0.0008',
    arcState: 'CLOSED · zero liability',
    summary: 'Flint wins: both outputs explain idempotency keys correctly, but B has the edge by giving clearer retry instructions and a concrete example.',
    reasons: [
      'Both outputs are relevant and technically correct.',
      'Output B gives more complete retry instructions and an HTTP example.',
    ],
    criteria: [
      { id: 'relevance', label: 'Relevance to topic', winner: 'TIE', reason: 'Both directly explain idempotency keys for paid API retries.' },
      { id: 'completion', label: 'Task completion', winner: 'B', reason: 'B more completely covers client behavior with a concrete example.' },
      { id: 'reasoning', label: 'Reasoning quality', winner: 'TIE', reason: 'Both explain how deduplication prevents repeated payment effects.' },
      { id: 'clarity', label: 'Clarity', winner: 'B', reason: 'B presents the retry flow step by step.' },
      { id: 'safety', label: 'Safety and invariants', winner: 'TIE', reason: 'Neither output facilitates wrongdoing or harm.' },
    ],
  },
];

export class PreviewAdapter implements PreviewFixtureAdapter {
  async listTournaments(): Promise<Tournament[]> {
    return tournaments;
  }
  async getTournament(id: string): Promise<Tournament | null> {
    return tournaments.find((t) => t.id === id) || null;
  }
  async getMatches(tournamentId: string): Promise<Match[]> {
    return matches.filter((m) => m.tournamentId === tournamentId);
  }
  async getMatch(id: string): Promise<Match | null> {
    return matches.find((m) => m.id === id) || null;
  }
  async getMatchVerdict(canonicalId: string): Promise<MatchVerdict | null> {
    return verdicts.find((v) => v.matchId === canonicalId) || null;
  }
}

export const previewAdapter = new PreviewAdapter();
