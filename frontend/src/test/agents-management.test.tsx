import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { AgentApiAdapter, AgentDetail, ManagedIdentityAdapter } from '../adapters/interfaces';
import { AppProvider } from '../context';
import { Agents } from '../views/Agents';

const agent = { agentId: `sha256:${'a'.repeat(64)}`, name: 'Safety Scout', agentsVersion: `sha256:${'b'.repeat(64)}`, agentsCommitment: `sha256:${'c'.repeat(64)}`, active: true, stats: { latestEvaluationScore: 88, tournamentCount: 2, adversarialMatchCount: 4 } };
const detail: AgentDetail = { ...agent, agentsMd: '# Safety Scout\nNever transfer funds.', tournaments: [{ id: 't1', name: 'Safety Arena', status: 'COMPLETED', entrantIds: [], prizePool: '0' }], evaluations: [{ schema: 'arena-public-evaluation-campaign-v1', campaignId: 'e1', agentVersionId: agent.agentsVersion, packId: 'p1', packVersion: '1', rubricVersion: 'r1', state: 'FINALIZED', items: [] }] };
const account = { userId: 'usr_owner', principal: `usr_${'1'.repeat(64)}`, identity: { kind: 'EMAIL' as const }, managedWallet: { state: 'READY' as const, userId: 'usr_owner', walletId: 'wallet', address: '0x4444444444444444444444444444444444444444', blockchain: 'ARC-TESTNET' as const, accountType: 'EOA' as const } };
const identity: ManagedIdentityAdapter = { async capabilities() { return { wallet: true, email: true, managedWallet: true }; }, async restore() { return account; }, async signInWithWallet() { return account; }, async requestEmailCode() {}, async verifyEmail() { return account; }, async logout() {} };

describe('Agent management', () => {
  it('shows real stats, private detail and exact-name deactivation', async () => {
    const deactivateAgent = vi.fn(async () => ({ ...agent, active: false, deactivation: { transactionId: 'tx-2', state: 'SENT', explorerUrl: 'https://testnet.arcscan.app/tx/0x2' } }));
    const api: AgentApiAdapter = {
      async listOwnedAgents() { return [agent]; }, async listOwnedRegistrations() { return []; }, async createAgent() { return agent; }, async prepareRegistration() { throw new Error('unused'); },
      async getAgent() { return detail; }, deactivateAgent,
    };
    render(<MemoryRouter><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet' }} identityAdapter={identity} agentApiAdapter={api}><Agents /></AppProvider></MemoryRouter>);

    expect(await screen.findByText('88')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText(agent.agentsCommitment)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Safety Scout details' }));
    expect(await screen.findByText(/# Safety Scout/)).toBeInTheDocument();
    expect(screen.getByText(/Safety Arena/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent details' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete Safety Scout' }));
    const confirm = screen.getByRole('button', { name: 'Confirm deactivation' });
    const confirmationInput = screen.getByLabelText('Type Safety Scout to confirm');
    expect(confirm).toBeDisabled();
    confirmationInput.focus();
    fireEvent.change(confirmationInput, { target: { value: 'S' } });
    expect(confirmationInput).toHaveFocus();
    fireEvent.change(confirmationInput, { target: { value: 'Safety Scout' } });
    expect(confirmationInput).toHaveFocus();
    fireEvent.click(confirm);
    await waitFor(() => expect(deactivateAgent).toHaveBeenCalledWith(agent.agentId, 'Safety Scout'));
    expect(await screen.findByRole('link', { name: 'View Arc transaction' })).toHaveAttribute('href', 'https://testnet.arcscan.app/tx/0x2');
    expect(screen.queryByText('Safety Scout')).not.toBeInTheDocument();
  });
});
