import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { AgentApiAdapter, ArenaReadAdapter, ManagedIdentityAdapter, TournamentOperationsApiAdapter } from '../adapters/interfaces';
import { AppProvider } from '../context';
import { Tournaments } from '../views/Tournaments';
import { TournamentDetail } from '../views/TournamentDetail';
import { MatchDetail } from '../views/MatchDetail';

const account = { userId: 'usr_owner', principal: `usr_${'1'.repeat(64)}`, identity: { kind: 'WALLET' as const }, managedWallet: { state: 'READY' as const, userId: 'usr_owner', walletId: 'wallet', address: `0x${'9'.repeat(40)}`, blockchain: 'ARC-TESTNET' as const, accountType: 'EOA' as const } };
const identity: ManagedIdentityAdapter = { async capabilities() { return { wallet: true, email: true, managedWallet: true }; }, async restore() { return account; }, async signInWithWallet() { return account; }, async requestEmailCode() {}, async verifyEmail() { return account; }, async logout() {} };
const arenaRead = { async listTournaments() { return []; } } as unknown as ArenaReadAdapter;
const snapshot = { tournamentId: `sha256:${'a'.repeat(64)}`, name: 'Safety Cup', state: 'REGISTRATION' as const, entrantCount: 3, matchCount: 0, finalizedMatchCount: 0, nextActions: ['PROGRESS', 'EXPIRE'] as const, arc: { state: 'REGISTRATION' } };

describe('Tournament operator console', () => {
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
    const reads = { async getTournament() { return { id, name: 'Nine Agent Cup', status: 'ACTIVE', entrantIds: Array.from({ length: 9 }, (_, index) => `entrant-${index}`), prizePool: '9' }; }, async getMatches() { return [
      { id: 'opening', tournamentId: id, agentA: 'My Agent · abcdef123456', agentB: 'Other Agent · 123456abcdef', agentIdA: ownedId, round: 0, state: 'SCHEDULED' },
      { id: 'quarter', tournamentId: id, agentA: 'Third Agent', agentB: 'Fourth Agent', round: 1, state: 'SCHEDULED' },
    ]; } } as unknown as ArenaReadAdapter;
    const agentApi = { async listOwnedRegistrations() { return [{ tournamentId: id, entrantId: 'entrant-0', agentId: ownedId }]; }, async listOwnedAgents() { return []; } } as unknown as AgentApiAdapter;
    render(<MemoryRouter initialEntries={[`/tournaments/${id}`]}><AppProvider identityAdapter={identity} arenaReadAdapter={reads} agentApiAdapter={agentApi}><Routes><Route path="/tournaments/:id" element={<TournamentDetail />} /></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByRole('tab', { name: /Preliminary/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Quarterfinals/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Semifinals/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Final/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Third place/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Fifth place/ })).toBeInTheDocument();
    expect(await screen.findByText('My Agent')).toBeInTheDocument();
    expect(screen.queryByText(/abcdef123456/)).not.toBeInTheDocument();
    expect(await screen.findByText('(YOU)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Quarterfinals/ }));
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

  it('separates overview, live and joined Tournaments while hiding the archived demo', async () => {
    const archived = `sha256:3a326a6030c4cbfa6171c380805e6f7fb8bce366d237f4ada69cddaead722a61`;
    const live = `sha256:${'b'.repeat(64)}`;
    const joined = `sha256:${'c'.repeat(64)}`;
    const reads = { async listTournaments() { return [
      { id: archived, name: 'Gamma Finals · Verified Live Run', status: 'COMPLETED', entrantIds: [], prizePool: '0.008' },
      { id: live, name: 'Open Safety Cup', status: 'UPCOMING', entrantCount: 3, registrationClosesAt: Math.floor(Date.now() / 1_000) + 3_600, prizePool: '3' },
      { id: joined, name: 'Joined Cup', status: 'COMPLETED', entrantIds: [], prizePool: '8' },
    ]; } } as unknown as ArenaReadAdapter;
    const agentApi = { async listOwnedRegistrations() { return [{ tournamentId: `0x${'c'.repeat(64)}`, entrantId: `0x${'d'.repeat(64)}` }]; }, async listOwnedAgents() { return []; }, async createAgent() { throw new Error('unused'); }, async prepareRegistration() { throw new Error('unused'); } } as AgentApiAdapter;
    render(<MemoryRouter><AppProvider identityAdapter={identity} arenaReadAdapter={reads} agentApiAdapter={agentApi}><Tournaments /></AppProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'From registration to results' })).toBeInTheDocument();
    expect(screen.queryByText('Gamma Finals · Verified Live Run')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Tournament live' }));
    expect(await screen.findByText('Open Safety Cup')).toBeInTheDocument();
    expect(screen.getByText(/Registered Agents:/).parentElement).toHaveTextContent('3');
    expect(screen.getByText(/Starts in:/).parentElement).toHaveTextContent('00:');
    expect(screen.queryByText('Joined Cup')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Tournaments joined' }));
    expect(await screen.findByText('Joined Cup')).toBeInTheDocument();
    expect(screen.queryByText('Open Safety Cup')).not.toBeInTheDocument();
  });

  it('creates and progresses a tournament without exposing ranking or payout inputs', async () => {
    const create = vi.fn().mockResolvedValue(snapshot);
    const execute = vi.fn().mockResolvedValue({ ...snapshot, state: 'RUNNING' });
    const operations: TournamentOperationsApiAdapter = { async list() { return [snapshot]; }, async get() { return snapshot; }, create, execute };
    render(<MemoryRouter><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '/api' }} identityAdapter={identity} arenaReadAdapter={arenaRead} tournamentOperationsApiAdapter={operations}><Tournaments /></AppProvider></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Operator lifecycle' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/ranking/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/payout/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tournament name'), { target: { value: 'New Safety Cup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create tournament' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Safety Cup', minEntrants: 8, maxEntrants: 8 })));
    fireEvent.click(screen.getByRole('button', { name: 'Progress Safety Cup' }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith(snapshot.tournamentId, 'PROGRESS'));
  });

  it('lets the operator schedule a one USDC tournament to start in 30 minutes', async () => {
    const create = vi.fn().mockResolvedValue(snapshot);
    const operations: TournamentOperationsApiAdapter = { async list() { return []; }, async get() { return snapshot; }, create, async execute() { return snapshot; } };
    render(<MemoryRouter><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '/api' }} identityAdapter={identity} arenaReadAdapter={arenaRead} tournamentOperationsApiAdapter={operations}><Tournaments /></AppProvider></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Operator lifecycle' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Starts in'), { target: { value: '1800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create tournament' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const input = create.mock.calls[0][0];
    expect(input.registrationClosesAt - input.registrationOpensAt).toBe(1_800);
    expect(input.startsAt).toBe(input.registrationClosesAt);
    expect(input.minEntrants).toBe(8);
    expect(input.maxEntrants).toBe(8);
    expect(input.stakeAmount).toBe('1000000');
  });
});
