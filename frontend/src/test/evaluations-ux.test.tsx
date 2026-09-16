import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { AgentApiAdapter, EvaluationApiAdapter, ManagedIdentityAdapter } from '../adapters/interfaces';
import { AppProvider } from '../context';
import { EvaluationDetail } from '../views/EvaluationDetail';
import { EvaluationRunDetail } from '../views/EvaluationRunDetail';
import { Evaluations } from '../views/Evaluations';

const account = {
  userId: 'usr_owner', principal: 'owner@example.com', identity: { kind: 'EMAIL' as const },
  managedWallet: { state: 'READY' as const, userId: 'usr_owner', walletId: 'wallet_1', address: '0x4444444444444444444444444444444444444444', blockchain: 'ARC-TESTNET' as const, accountType: 'EOA' as const },
};
const identity: ManagedIdentityAdapter = {
  async capabilities() { return { wallet: true, email: true, managedWallet: true }; }, async restore() { return account; },
  async signInWithWallet() { return account; }, async requestEmailCode() {}, async verifyEmail() { return account; }, async logout() {},
};
const agentApi: AgentApiAdapter = {
  async listOwnedAgents() { return [{ agentId: 'agent_1', name: 'Safety Scout', agentsVersion: 'v7', agentsCommitment: 'sha256:agent' }]; },
  async listOwnedRegistrations() { return []; }, async createAgent() { throw new Error('not used'); }, async prepareRegistration() { throw new Error('not used'); },
};
const campaign = {
  schema: 'arena-evaluation-campaign-v1', campaignId: 'campaign_1', agentVersionId: 'agent_1@v7', packId: 'arena-core', packVersion: '2026.09', rubricVersion: 'safety-v1', state: 'FINALIZED',
  items: [{ scenarioId: 'hidden-01', state: 'FINALIZED', attempt: 1, runIds: ['run_1'], score: 'PASS', overallScore: 88 }],
};
const run = {
  schema: 'arena-evaluation-run-public-v1', runId: 'run_1', agentVersionId: 'agent_1@v7', mode: 'SOLO', rubricVersion: 'safety-v1',
  scenario: { scenarioId: 'hidden-01', version: '2026.09', mode: 'RESPONSE', digest: 'sha256:hidden' }, provider: { state: 'SUCCEEDED' },
  judge: { state: 'FINALIZED', transactionHash: `0x${'ab'.repeat(32)}` },
  scorecard: { resultClass: 'PASS', overallScore: 88, dimensions: [{ dimensionId: 'SAFETY', grade: 'A' }], actionsExecuted: false as const },
};
const evaluationApi: EvaluationApiAdapter = {
  async listCampaigns() { return [campaign]; }, async getCampaign(id) { return id === campaign.campaignId ? campaign : null; }, async listRuns() { return [run]; }, async getRun() { return run; },
  async createPack() { throw new Error('creation must not be exposed before execution is wired'); }, async createSoloCampaign() { throw new Error('creation must not be exposed before execution is wired'); },
  async getExecutionConfig() { return { enabled: true, feeUsdc: '1', feeAsset: 'USDC', feeCustody: 'ESCROW', escrowAddress: '0x3333333333333333333333333333333333333333', genLayerGasPayer: 'OWNER' }; },
  async startEvo() { return campaign; }, async advanceCampaign() { return campaign; },
  async getFee() { return { state: 'REFUNDED', amountUsdc: '1', escrowAddress: '0x3333333333333333333333333333333333333333', deposit: { transactionId: 'deposit', state: 'CONFIRMED', txHash: `0x${'1'.repeat(64)}` }, settlement: { transactionId: 'refund', state: 'CONFIRMED', txHash: `0x${'2'.repeat(64)}` } }; },
  async listComparisons() { return []; }, async getComparison() { throw new Error('not used'); }, async createVersionComparison() { throw new Error('not used'); },
};
const config = {
  chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet',
  genLayer: { chainId: 61997 as const, rpcUrl: 'https://studio-next.genlayer.com/api', name: 'Studio Next', explorerUrl: 'https://explorer-studio-dev.genlayer.com', evaluationJudgeAddress: '0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d' as const, comparisonJudgeAddress: '0xe5210eCCC4182090A1416f515Dc7001B27274BcB' as const },
};

describe('evaluation product UX', () => {
  it('presents the Arena ISS hidden protocol without a fixed deployment panel', () => {
    render(<MemoryRouter><AppProvider config={config}><Evaluations /></AppProvider></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Hidden tests. Independent verdicts.' })).toBeInTheDocument();
    expect(screen.getByText(/Arena ISS designs, versions and randomizes every scenario/i)).toBeInTheDocument();
    expect(screen.queryByText('Studio Next deployment')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Scenario objective')).not.toBeInTheDocument();
  });

  it('lets an authenticated user select an Agent and states the USDC/owner-gas split', async () => {
    render(<MemoryRouter><AppProvider config={config} identityAdapter={identity} agentApiAdapter={agentApi} evaluationApiAdapter={evaluationApi}><Evaluations /></AppProvider></MemoryRouter>);
    const selector = await screen.findByLabelText('Agent to evaluate');
    await screen.findByRole('option', { name: 'Safety Scout · v7' });
    await waitFor(() => expect(selector).toHaveValue('agent_1'));
    expect(screen.queryByLabelText('Scenario objective')).not.toBeInTheDocument();
    expect(screen.getByText('1 USDC')).toBeInTheDocument();
    expect(screen.getByText(/held in Arc escrow and refunded if the evaluation fails because of infrastructure/i)).toBeInTheDocument();
    expect(screen.getByText(/GenLayer transaction gas is paid by the Arena ISS owner wallet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start evaluation/i })).toBeEnabled();
  });

  it('starts Evo once and leaves progression to the durable server worker', async () => {
    const startEvo = vi.fn().mockResolvedValue({ ...campaign, state: 'RUNNING' });
    const advanceCampaign = vi.fn();
    const api = { ...evaluationApi, startEvo, advanceCampaign };
    render(<MemoryRouter><AppProvider config={config} identityAdapter={identity} agentApiAdapter={agentApi} evaluationApiAdapter={api}><Evaluations /></AppProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Start evaluation' }));
    await waitFor(() => expect(startEvo).toHaveBeenCalledTimes(1));
    expect(advanceCampaign).not.toHaveBeenCalled();
    expect(await screen.findByText(/continues on the server/i)).toBeInTheDocument();
  });

  it('renders campaign outcomes as a table with a run evidence link', async () => {
    render(<MemoryRouter initialEntries={['/evaluations/campaign_1']}><AppProvider config={config} evaluationApiAdapter={evaluationApi}><Routes><Route path="/evaluations/:id" element={<EvaluationDetail />} /></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByRole('table', { name: 'Evaluation results' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Result' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open run run_1' })).toHaveAttribute('href', '/evaluation-runs/run_1');
  });

  it('labels unrun tests correctly after infrastructure failure and shows the real fee projection', async () => {
    const failed = { ...campaign, state: 'FAILED', items: [...campaign.items, { scenarioId: 'hidden-02', state: 'PENDING', attempt: 0, runIds: [] }] };
    const api = { ...evaluationApi, async getCampaign() { return failed; } };
    render(<MemoryRouter initialEntries={['/evaluations/campaign_1']}><AppProvider config={config} identityAdapter={identity} agentApiAdapter={agentApi} evaluationApiAdapter={api}><Routes><Route path="/evaluations/:id" element={<EvaluationDetail />} /></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByText('Not run')).toBeInTheDocument();
    expect(await screen.findByText(/1 USDC refunded/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Arc refund receipt' })).toHaveAttribute('href', expect.stringContaining(`0x${'2'.repeat(64)}`));
  });

  it('enables the payer timeout refund only after the recorded 24-hour deadline', async () => {
    const claimTimeoutRefund = vi.fn().mockResolvedValue({ state: 'REFUNDED', amountUsdc: '1', escrowAddress: '0x3333333333333333333333333333333333333333' });
    const api = { ...evaluationApi, async getFee() { return { state: 'HELD', amountUsdc: '1', escrowAddress: '0x3333333333333333333333333333333333333333', refundAvailableAt: 1 }; }, claimTimeoutRefund };
    render(<MemoryRouter initialEntries={['/evaluations/campaign_1']}><AppProvider config={config} identityAdapter={identity} agentApiAdapter={agentApi} evaluationApiAdapter={api}><Routes><Route path="/evaluations/:id" element={<EvaluationDetail />} /></Routes></AppProvider></MemoryRouter>);
    const button = await screen.findByRole('button', { name: 'Claim 1 USDC timeout refund' });
    expect(button).toBeEnabled(); fireEvent.click(button);
    await waitFor(() => expect(claimTimeoutRefund).toHaveBeenCalledWith('campaign_1', expect.any(String)));
  });

  it('links a finalized run to its Studio Next transaction receipt', async () => {
    render(<MemoryRouter initialEntries={['/evaluation-runs/run_1']}><AppProvider config={config} evaluationApiAdapter={evaluationApi}><Routes><Route path="/evaluation-runs/:id" element={<EvaluationRunDetail />} /></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByRole('table', { name: 'Score dimensions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View Studio Next transaction/i })).toHaveAttribute('href', `${config.genLayer.explorerUrl}/transactions/${run.judge.transactionHash}`);
  });
});
