import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { AgentApiAdapter, ArenaReadAdapter, ManagedIdentityAdapter } from '../adapters/interfaces';
import { AppProvider } from '../context';
import { Tournaments } from '../views/Tournaments';
import { TournamentDetail } from '../views/TournamentDetail';
import { MatchDetail } from '../views/MatchDetail';

const account = { userId: 'usr_owner', principal: `usr_${'1'.repeat(64)}`, identity: { kind: 'WALLET' as const }, managedWallet: { state: 'READY' as const, userId: 'usr_owner', walletId: 'wallet', address: `0x${'9'.repeat(40)}`, blockchain: 'ARC-TESTNET' as const, accountType: 'EOA' as const } };
const identity: ManagedIdentityAdapter = { async capabilities() { return { wallet: true, email: true, managedWallet: true }; }, async restore() { return account; }, async signInWithWallet() { return account; }, async requestEmailCode() {}, async verifyEmail() { return account; }, async logout() {} };

describe('Tournament operator console', () => {
  it('marks Tournaments as coming soon and disables the build Agent action', () => {
    render(<MemoryRouter><AppProvider><Tournaments /></AppProvider></MemoryRouter>);
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Build an agent' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /Build an agent/ })).not.toBeInTheDocument();
  });

  it('shows UTC registration deadline and hides registration after the roster closes', async () => {
    const id = `sha256:${'e'.repeat(64)}`;
    const reads = { async getTournament() { return { id, name: 'Arena ISS Daily', status: 'ACTIVE', entrantIds: [], prizePool: '8', registrationClosesAt: Date.UTC(2026, 8, 17) / 1_000 }; }, async getMatches() { return []; } } as unknown as ArenaReadAdapter;
    render(<MemoryRouter initialEntries={[`/tournaments/${id}`]}><AppProvider arenaReadAdapter={reads}><Routes><Route path="/tournaments/:id" element={<TournamentDetail />} /></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Arena ISS Daily' })).toBeInTheDocument();
    expect(screen.getByText('Registration closed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Register Agent' })).not.toBeInTheDocument();
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
  });

  it('shows the reproducible Arc pairing proof and verification links when available', async () => {
    const id = `sha256:${'e'.repeat(64)}`;
    const bracketSeed = { schema: 'arena-bracket-seed-v2' as const, seedDigest: `sha256:${'a'.repeat(64)}`, rosterDigest: `sha256:${'b'.repeat(64)}`, entropyBlockHash: `0x${'c'.repeat(64)}`, entropyBlockNumber: '123' };
    const reads = { async getTournament() { return { id, name: 'Proof Cup', status: 'ACTIVE', entrantIds: Array.from({ length: 9 }, (_, index) => `entrant-${index}`), entrantCount: 9, prizePool: '9', bracketSeed }; }, async getMatches() { return []; } } as unknown as ArenaReadAdapter;
    render(<MemoryRouter initialEntries={[`/tournaments/${id}`]}><AppProvider arenaReadAdapter={reads}><Routes><Route path="/tournaments/:id" element={<TournamentDetail />} /></Routes></AppProvider></MemoryRouter>);
    const proof = await screen.findByRole('region', { name: 'Public pairing proof' });
    expect(proof).toHaveTextContent(bracketSeed.seedDigest);
    expect(proof).toHaveTextContent(bracketSeed.rosterDigest);
    expect(proof).toHaveTextContent(bracketSeed.entropyBlockHash);
    expect(screen.getByRole('link', { name: 'How to verify pairing' })).toHaveAttribute('href', '/docs#tournament');
    expect(screen.getByRole('link', { name: 'View block' })).toHaveAttribute('href', 'https://testnet.arcscan.app/block/123');
    expect(screen.getByText(/1 preliminary match; 7 Agents advance/)).toBeInTheDocument();
  });

  it('explains a paused tournament while preserving published pairings', async () => {
    const id = `sha256:${'e'.repeat(64)}`;
    const reads = { async getTournament() { return { id, name: 'Paused Cup', status: 'ACTIVE', operationState: 'RECOVERY_REQUIRED', entrantIds: Array(9).fill('entrant'), prizePool: '9' }; }, async getMatches() { return [{ id: 'match-1', tournamentId: id, agentA: 'Agent A', agentB: 'Agent B', round: 0, state: 'SCHEDULED' }]; } } as unknown as ArenaReadAdapter;
    render(<MemoryRouter initialEntries={[`/tournaments/${id}`]}><AppProvider arenaReadAdapter={reads}><Routes><Route path="/tournaments/:id" element={<TournamentDetail />} /></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByRole('status')).toHaveTextContent('processing is paused');
    expect(screen.getByText('Agent A')).toBeInTheDocument();
    expect(screen.queryByText('No matches scheduled yet.')).not.toBeInTheDocument();
  });

  it('shows each round of a nine entrant bracket and marks the signed-in owner without entrant suffixes', async () => {
    const id = `sha256:${'e'.repeat(64)}`;
    const ownedId = `sha256:${'a'.repeat(64)}`;
    const reads = { async getTournament() { return { id, name: 'Nine Agent Cup', status: 'ACTIVE', entrantIds: Array.from({ length: 9 }, (_, index) => `entrant-${index}`), prizePool: '9', bracketRevision: 2 }; }, async getMatches() { return [
      { id: 'opening', tournamentId: id, agentA: 'My Agent · abcdef123456', agentB: 'Other Agent · 123456abcdef', agentIdA: ownedId, round: 1, state: 'SCHEDULED' },
      { id: 'second', tournamentId: id, agentA: 'Third Agent', agentB: 'Fourth Agent', round: 2, state: 'SCHEDULED' },
    ]; } } as unknown as ArenaReadAdapter;
    const agentApi = { async listOwnedRegistrations() { return [{ tournamentId: id, entrantId: 'entrant-0', agentId: ownedId }]; }, async listOwnedAgents() { return []; } } as unknown as AgentApiAdapter;
    render(<MemoryRouter initialEntries={[`/tournaments/${id}`]}><AppProvider identityAdapter={identity} arenaReadAdapter={reads} agentApiAdapter={agentApi}><Routes><Route path="/tournaments/:id" element={<TournamentDetail />} /></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByRole('tab', { name: /Round 1/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Round 2/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Round 3/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Final/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Third place/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Fifth place/ })).toBeInTheDocument();
    expect(await screen.findByText('My Agent')).toBeInTheDocument();
    expect(screen.queryByText(/abcdef123456/)).not.toBeInTheDocument();
    expect(await screen.findByText('(YOU)')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Preliminary/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Round 2/ }));
    expect(screen.getByText('Third Agent')).toBeInTheDocument();
    expect(screen.queryByText('My Agent')).not.toBeInTheDocument();
  });

  it('shows a public match lifecycle log before the verdict is final', async () => {
    const id = `sha256:${'f'.repeat(64)}`;
    const reads = { async getMatch() { return { id, tournamentId: `sha256:${'e'.repeat(64)}`, agentA: 'Alpha · abcdef123456', agentB: 'Beta · 123456abcdef', round: 0, state: 'JUDGING', events: [{ state: 'SCHEDULED', at: 1_789_603_200 }, { state: 'JUDGING', at: 1_789_603_230 }] }; } } as unknown as ArenaReadAdapter;
    render(<MemoryRouter initialEntries={[`/matches/${id}`]}><AppProvider arenaReadAdapter={reads}><Routes><Route path="/matches/:id" element={<MatchDetail />} /></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Match activity' })).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('GenLayer judging')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText(/abcdef123456/)).not.toBeInTheDocument();
  });

  it('directs players from the paused Tournament page to pair matches and existing claims', () => {
    render(<MemoryRouter><AppProvider><Tournaments /></AppProvider></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Tournament play is paused' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore pair matches' })).toHaveAttribute('href', '/pairs');
    expect(screen.getByRole('link', { name: 'View claims' })).toHaveAttribute('href', '/account?tab=claim');
  });

  it('does not offer new Tournament registration or operator creation while paused', () => {
    render(<MemoryRouter><AppProvider><Tournaments /></AppProvider></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Create tournament' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Register Agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Tournament live' })).not.toBeInTheDocument();
  });
});
