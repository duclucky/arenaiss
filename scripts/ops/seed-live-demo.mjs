import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteRuntimeStore } from '../../packages/persistence/src/sqlite-runtime.ts';
import { ArenaApiService } from '../../services/api/src/service.ts';

const PROJECTION_NAMESPACE = 'live-demo-projection';
const PROJECTION_VERSION = 2;
const PUBLIC_BRACKET = [
  { agentA: 'Agent Atlas', agentB: 'Agent Beacon', winner: 'Agent Atlas', round: 1, stage: 'main' },
  { agentA: 'Agent Cipher', agentB: 'Agent Delta', winner: 'Agent Delta', round: 1, stage: 'main' },
  { agentA: 'Agent Echo', agentB: 'Agent Forge', winner: 'Agent Echo', round: 1, stage: 'main' },
  { agentA: 'Agent Grove', agentB: 'Agent Helix', winner: 'Agent Helix', round: 1, stage: 'main' },
  { agentA: 'Agent Atlas', agentB: 'Agent Delta', winner: 'Agent Atlas', round: 2, stage: 'main' },
  { agentA: 'Agent Echo', agentB: 'Agent Helix', winner: 'Agent Echo', round: 2, stage: 'main' },
  { agentA: 'Agent Atlas', agentB: 'Agent Echo', winner: 'Agent Atlas', round: 3, stage: 'main' },
  { agentA: 'Agent Delta', agentB: 'Agent Helix', winner: 'Agent Delta', round: 1, stage: 'third_place' },
  { agentA: 'Agent Beacon', agentB: 'Agent Cipher', winner: 'Agent Beacon', round: 1, stage: 'fifth_place' },
  { agentA: 'Agent Forge', agentB: 'Agent Grove', winner: 'Agent Grove', round: 1, stage: 'fifth_place' },
  { agentA: 'Agent Beacon', agentB: 'Agent Grove', winner: 'Agent Beacon', round: 2, stage: 'fifth_place' },
];

export function seedLiveDemo({ databasePath, evidencePath, operator }) {
  const evidence = JSON.parse(readFileSync(resolve(evidencePath), 'utf8'));
  requireEvidence(evidence);
  const runtime = new SqliteRuntimeStore(resolve(databasePath));
  try {
    const tournamentId = `sha256:${evidence.arc.tournamentId.slice(2).toLowerCase()}`;
    const projection = runtime.get(PROJECTION_NAMESPACE, tournamentId);
    if (JSON.stringify(projection) !== JSON.stringify({ version: PROJECTION_VERSION })) removePreviousProjection(runtime, tournamentId);
    const api = new ArenaApiService(operator, runtime);
    const tournament = {
      id: tournamentId,
      name: 'Gamma Finals · Verified Live Run',
      status: 'COMPLETED',
      entrantIds: [],
      stakeAmount: String(evidence.arc.stakeMicroUsdc),
      prizePool: formatMicroUsdc(evidence.arc.grossPoolMicroUsdc),
    };
    const existingTournament = api.getTournament(tournamentId);
    if (!existingTournament) api.publishTournament(operator, tournament);
    else if (JSON.stringify(existingTournament) !== JSON.stringify(tournament)) throw new Error('live tournament projection conflicts with existing data');

    const finalByMatch = new Map();
    for (const verdict of evidence.genLayer.verdicts) finalByMatch.set(verdict.matchId, verdict);
    if (finalByMatch.size !== PUBLIC_BRACKET.length) throw new Error('live evidence bracket size is unsupported');
    let matchIndex = 0;
    for (const verdict of finalByMatch.values()) {
      if (!['A_WIN', 'B_WIN', 'TIE'].includes(verdict.result)) throw new Error('unsupported live verdict result');
      const bracketMatch = PUBLIC_BRACKET[matchIndex];
      const winner = verdict.result === 'A_WIN' ? bracketMatch.agentA : verdict.result === 'B_WIN' ? bracketMatch.agentB : undefined;
      if (!winner || winner !== bracketMatch.winner) throw new Error('live evidence result conflicts with the public bracket');
      api.publishMatch(operator, {
        id: verdict.matchId,
        tournamentId,
        state: 'FINALIZED',
        agentA: bracketMatch.agentA,
        agentB: bracketMatch.agentB,
        winner,
        round: bracketMatch.round,
        stage: bracketMatch.stage,
      });
      api.publishVerdict(operator, {
        id: verdict.attemptId,
        matchId: verdict.matchId,
        winner: verdict.result === 'A_WIN' ? 'A' : 'B',
        reasons: verdict.criteria.slice(0, 5).map((criterion) => criterion.reason),
        summary: verdict.summary,
        transactionHash: verdict.transactionHash,
        source: 'LIVE',
        rubricVersion: 'GeneralResponseV7',
        attempt: 1,
        finality: 'FINALIZED',
        execution: 'SUCCESS',
        scoreA: verdict.scoreA,
        scoreB: verdict.scoreB,
        criteria: verdict.criteria.map((criterion) => ({
          id: criterion.criterion_id,
          label: criterionLabel(criterion.criterion_id),
          winner: criterion.winner,
          reason: criterion.reason,
        })),
        safetyClass: verdict.safetyClass,
        canonicalMatchId: verdict.matchId,
        attemptId: verdict.attemptId,
        network: evidence.genLayer.network,
        chainId: evidence.genLayer.chainId,
        judgeAddress: evidence.genLayer.judgeAddress,
        arcTournamentId: evidence.arc.tournamentId,
        arcEscrowAddress: evidence.arc.escrowAddress,
        grossPoolUsdc: formatMicroUsdc(evidence.arc.grossPoolMicroUsdc),
        netPayoutUsdc: formatMicroUsdc(evidence.arc.netPayoutMicroUsdc),
        platformFeeUsdc: formatMicroUsdc(evidence.arc.platformFeeMicroUsdc),
        arcState: `${evidence.arc.terminalState} · zero liability`,
      });
      matchIndex += 1;
    }
    runtime.put(PROJECTION_NAMESPACE, tournamentId, { version: PROJECTION_VERSION });
    return { tournaments: 1, matches: finalByMatch.size, tournamentId };
  } finally {
    runtime.close();
  }
}

function removePreviousProjection(runtime, tournamentId) {
  const matches = runtime.list('api-matches').filter((match) => match?.tournamentId === tournamentId);
  for (const match of matches) {
    runtime.delete('api-verdicts', match.id);
    runtime.delete('api-match-events', match.id);
    runtime.delete('api-matches', match.id);
  }
  runtime.delete('api-tournaments', tournamentId);
  runtime.delete(PROJECTION_NAMESPACE, tournamentId);
}

function criterionLabel(id) {
  return ({
    relevance: 'Relevance to topic',
    task_completion: 'Task completion',
    reasoning_quality: 'Reasoning quality',
    clarity: 'Clarity',
    safety: 'Safety and invariants',
  })[id] || id;
}

function formatMicroUsdc(value) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error('micro-USDC value is invalid');
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

function requireEvidence(evidence) {
  if (evidence?.schemaVersion !== 'arena-live-trusted-operator-lifecycle-v1'
    || evidence?.trustModel !== 'TRUSTED_OPERATOR'
    || evidence?.arc?.chainId !== 5_042_002
    || !/^0x[0-9a-fA-F]{64}$/.test(evidence?.arc?.tournamentId || '')
    || !Array.isArray(evidence?.genLayer?.verdicts)
    || evidence.genLayer.verdicts.length < 1) throw new Error('live evidence is invalid');
  for (const verdict of evidence.genLayer.verdicts) {
    if (!/^sha256:[0-9a-f]{64}$/.test(verdict.matchId || '')
      || !/^sha256:[0-9a-f]{64}$/.test(verdict.attemptId || '')
      || !/^0x[0-9a-fA-F]{64}$/.test(verdict.transactionHash || '')
      || !Array.isArray(verdict.criteria) || !verdict.summary) throw new Error('live verdict evidence is invalid');
  }
}

async function main() {
  const databasePath = process.argv[2] || process.env.ARENA_DATABASE_PATH;
  const evidencePath = process.argv[3] || 'docs/evidence/live/trusted-operator-lifecycle-settlement-2.json';
  const operator = process.env.ARENA_OPERATOR_ADDRESS;
  if (!databasePath || !operator) throw new Error('ARENA_DATABASE_PATH and ARENA_OPERATOR_ADDRESS are required');
  const result = seedLiveDemo({ databasePath, evidencePath, operator });
  process.stdout.write(`${JSON.stringify({ event: 'live_demo_seeded', ...result })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ event: 'live_demo_seed_failed', error: error instanceof Error ? error.message : 'unknown error' })}\n`);
    process.exitCode = 1;
  });
}
