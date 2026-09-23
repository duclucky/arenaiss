import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { AgentApiAdapter, AgentDetail, EvaluationApiAdapter, ManagedIdentityAdapter } from '../adapters/interfaces';
import { AppProvider } from '../context';
import { Agents } from '../views/Agents';

const agent = { agentId: `sha256:${'a'.repeat(64)}`, name: 'Safety Scout', agentsVersion: `sha256:${'b'.repeat(64)}`, agentsCommitment: `sha256:${'c'.repeat(64)}`, active: true, stats: { latestEvaluationScore: 88, tournamentCount: 2, adversarialMatchCount: 4 } };
const oldVersion = `sha256:${'d'.repeat(64)}`;
const detail: AgentDetail = { ...agent, agentsMd: '# Safety Scout\nNever transfer funds.', versions: [{ agentsVersion: oldVersion, agentsCommitment: `sha256:${'e'.repeat(64)}`, createdAt: 1 }, { agentsVersion: agent.agentsVersion, agentsCommitment: agent.agentsCommitment, createdAt: 2 }], tournaments: [{ id: 't1', name: 'Safety Arena', status: 'COMPLETED', entrantIds: [], prizePool: '0' }], evaluations: [{ schema: 'arena-public-evaluation-campaign-v1', campaignId: `sha256:${'1'.repeat(64)}`, agentVersionId: oldVersion, packId: 'p1', packVersion: '1', rubricVersion: 'r1', state: 'FINALIZED', items: [] }, { schema: 'arena-public-evaluation-campaign-v1', campaignId: `sha256:${'2'.repeat(64)}`, agentVersionId: agent.agentsVersion, packId: 'p1', packVersion: '1', rubricVersion: 'r1', state: 'FINALIZED', items: [] }] };
const account = { userId: 'usr_owner', principal: `usr_${'1'.repeat(64)}`, identity: { kind: 'EMAIL' as const }, managedWallet: { state: 'READY' as const, userId: 'usr_owner', walletId: 'wallet', address: '0x4444444444444444444444444444444444444444', blockchain: 'ARC-TESTNET' as const, accountType: 'EOA' as const } };
const identity: ManagedIdentityAdapter = { async capabilities() { return { wallet: true, email: true, managedWallet: true }; }, async restore() { return account; }, async signInWithWallet() { return account; }, async requestEmailCode() {}, async verifyEmail() { return account; }, async logout() {} };

describe('Agent management', () => {
  it('shows the canonical ERC-8004 identity and finalized reputation evidence', async () => {
    const portable = {
      ...detail,
      erc8004Identity: {
        schema: 'arena-erc8004-identity-v1' as const, network: 'Arc Testnet' as const, chainId: 5_042_002 as const,
        registryAddress: '0x8004A818BFB912233c491871b3d84c89A494BD9e', tokenId: '42',
        ownerAddress: '0x4444444444444444444444444444444444444444', agentUri: 'https://arenaiss.xyz/api/agents/a/erc8004.json',
        transaction: { transactionId: 'identity', state: 'COMPLETE', explorerUrl: 'https://testnet.arcscan.app/tx/0x1' },
      },
      erc8004Reputation: { state: 'COMPLETE' as const, value: 88, feedbackIndex: 1, transaction: { transactionId: 'feedback', state: 'COMPLETE', explorerUrl: 'https://testnet.arcscan.app/tx/0x2' } },
    };
    const api: AgentApiAdapter = {
      async listOwnedAgents() { return [portable]; }, async listOwnedRegistrations() { return []; }, async createAgent() { return portable; }, async prepareRegistration() { throw new Error('unused'); }, async getAgent() { return portable; },
    };
    render(<MemoryRouter><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet' }} identityAdapter={identity} agentApiAdapter={api}><Agents /></AppProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Safety Scout details' }));
    expect(await screen.findByText('ERC-8004 #42')).toBeInTheDocument();
    expect(screen.getByText('Reputation 88 / 100')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View identity transaction' })).toHaveAttribute('href', 'https://testnet.arcscan.app/tx/0x1');
    expect(screen.getByRole('link', { name: 'View reputation transaction' })).toHaveAttribute('href', 'https://testnet.arcscan.app/tx/0x2');
  });

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

  it('compares two finalized Agent versions with the locked regression policy', async () => {
    const api: AgentApiAdapter = {
      async listOwnedAgents() { return [agent]; }, async listOwnedRegistrations() { return []; }, async createAgent() { return agent; }, async prepareRegistration() { throw new Error('unused'); }, async getAgent() { return detail; },
    };
    const result = { schema: 'arena-version-comparison-v1' as const, comparisonId: `sha256:${'f'.repeat(64)}`, inputDigest: `sha256:${'0'.repeat(64)}`, status: 'PASS' as const, agentId: agent.agentId, baselineVersionId: oldVersion, candidateVersionId: agent.agentsVersion, coverageBps: 10_000, findings: [], baseline: { overallScore: 80 }, candidate: { overallScore: 88 } };
    const createVersionComparison = vi.fn().mockResolvedValue(result);
    const evaluationApi = { async listComparisons() { return []; }, createVersionComparison } as unknown as EvaluationApiAdapter;
    render(<MemoryRouter><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet' }} identityAdapter={identity} agentApiAdapter={api} evaluationApiAdapter={evaluationApi}><Agents /></AppProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Safety Scout details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Compare versions' }));
    await waitFor(() => expect(createVersionComparison).toHaveBeenCalledWith(expect.objectContaining({ agentId: agent.agentId, baselineVersionId: oldVersion, candidateVersionId: agent.agentsVersion, baselineCampaignIds: [`sha256:${'1'.repeat(64)}`], candidateCampaignIds: [`sha256:${'2'.repeat(64)}`], policy: expect.objectContaining({ requiredRunsPerScenario: 1, minimumScenarioCoverageBps: 10_000 }) })));
    expect(await screen.findByText('PASS')).toBeInTheDocument();
    expect(screen.getByText(/Baseline 80/)).toBeInTheDocument();
    expect(screen.getByText(/Candidate 88/)).toBeInTheDocument();
  });
});
