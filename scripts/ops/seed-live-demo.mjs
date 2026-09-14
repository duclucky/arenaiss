import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteRuntimeStore } from '../../packages/persistence/src/sqlite-runtime.ts';
import { ArenaApiService } from '../../services/api/src/service.ts';

export function seedLiveDemo({ databasePath, evidencePath, operator }) {
  const evidence = JSON.parse(readFileSync(resolve(evidencePath), 'utf8'));
  requireEvidence(evidence);
  const runtime = new SqliteRuntimeStore(resolve(databasePath));
  try {
    const api = new ArenaApiService(operator, runtime);
    const tournamentId = `sha256:${evidence.arc.tournamentId.slice(2).toLowerCase()}`;
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
    let matchIndex = 0;
    for (const verdict of finalByMatch.values()) {
      if (!['A_WIN', 'B_WIN', 'TIE'].includes(verdict.result)) throw new Error('unsupported live verdict result');
      const sideA = `Entrant A · ${verdict.matchId.slice(7, 13)}`;
      const sideB = `Entrant B · ${verdict.matchId.slice(-6)}`;
      const tied = verdict.result === 'TIE';
      const winner = tied ? undefined : verdict.result === 'A_WIN' ? sideA : sideB;
      const round = matchIndex < 4 ? 1 : matchIndex < 6 ? 2 : 3;
      api.publishMatch(operator, {
        id: verdict.matchId,
        tournamentId,
        state: tied ? 'TIE' : 'FINALIZED',
        agentA: sideA,
        agentB: sideB,
        winner,
        round,
      });
      api.publishVerdict(operator, {
        id: verdict.attemptId,
        matchId: verdict.matchId,
        winner: tied ? 'TIE' : verdict.result === 'A_WIN' ? 'A' : 'B',
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
    return { tournaments: 1, matches: finalByMatch.size, tournamentId };
  } finally {
    runtime.close();
  }
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
