import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ArenaReadAdapter, ManagedIdentityAdapter, TournamentOperationsApiAdapter } from '../adapters/interfaces';
import { AppProvider } from '../context';
import { Tournaments } from '../views/Tournaments';

const account = { userId: 'usr_owner', principal: `usr_${'1'.repeat(64)}`, identity: { kind: 'WALLET' as const }, managedWallet: { state: 'READY' as const, userId: 'usr_owner', walletId: 'wallet', address: `0x${'9'.repeat(40)}`, blockchain: 'ARC-TESTNET' as const, accountType: 'EOA' as const } };
const identity: ManagedIdentityAdapter = { async capabilities() { return { wallet: true, email: true, managedWallet: true }; }, async restore() { return account; }, async signInWithWallet() { return account; }, async requestEmailCode() {}, async verifyEmail() { return account; }, async logout() {} };
const arenaRead = { async listTournaments() { return []; } } as unknown as ArenaReadAdapter;
const snapshot = { tournamentId: `sha256:${'a'.repeat(64)}`, name: 'Safety Cup', state: 'REGISTRATION' as const, entrantCount: 3, matchCount: 0, finalizedMatchCount: 0, nextActions: ['PROGRESS', 'EXPIRE'] as const, arc: { state: 'REGISTRATION' } };

describe('Tournament operator console', () => {
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
});
