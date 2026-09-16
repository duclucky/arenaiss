import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AgentApiAdapter, EvaluationApiAdapter, ManagedIdentityAdapter, MarketplaceApiAdapter } from '../adapters/interfaces';
import { AppProvider } from '../context';
import { Marketplace } from '../views/Marketplace';

const address = '0x4444444444444444444444444444444444444444';
const digest = (char: string) => `sha256:${char.repeat(64)}`;
const agentId = digest('1'); const version = digest('2'); const commitment = digest('3'); const certificateDigest = digest('4');
const account = { userId: 'user', principal: address, identity: { kind: 'EMAIL' as const }, managedWallet: { state: 'READY' as const, userId: 'user', walletId: 'wallet', address, blockchain: 'ARC-TESTNET' as const, accountType: 'SCA' as const } };
const identity: ManagedIdentityAdapter = { async capabilities() { return { wallet: true, email: true, managedWallet: true }; }, async restore() { return account; }, async signInWithWallet() { return account; }, async requestEmailCode() {}, async verifyEmail() { return account; }, async logout() {} };
const agentApi: AgentApiAdapter = { async listOwnedAgents() { return [{ agentId, name: 'Safety Scout', agentsVersion: version, agentsCommitment: commitment }]; }, async listOwnedRegistrations() { return []; }, async createAgent() { throw new Error('not used'); }, async prepareRegistration() { throw new Error('not used'); } };
const campaigns = ['5', '6'].map((char) => ({ schema: 'arena-evaluation-campaign-v1', campaignId: digest(char), agentVersionId: version, packId: digest('7'), packVersion: '1.0.0', rubricVersion: 'v1', state: 'FINALIZED', items: [] }));
const evaluationApi = { async listCampaigns() { return campaigns; } } as unknown as EvaluationApiAdapter;
const certificate = { schema: 'arena-marketplace-certificate-v1', certificateDigest, evidenceDigest: digest('8'), owner: address, agentId, agentVersionId: version, agentsCommitment: commitment, packId: digest('7'), packVersion: '1.0.0', rubricVersion: 'v1', coverageBps: 10000, overallScore: 90, dimensionScores: {}, maxSpread: 0, issuedAt: 1, expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400, state: 'APPROVED' as const };
const eligible = { ...certificate, certificateDigest: digest('9'), state: 'ELIGIBLE' as const };
const sold = { schema: 'arena-marketplace-listing-v1', listingId: '1', certificateDigest, agentId, agentVersionId: version, agentsCommitment: commitment, name: 'Safety Scout', sellerAddress: '0x5555555555555555555555555555555555555555', price: '1000000', expiresAt: certificate.expiresAt, state: 'SOLD' as const };
const ownedActive = { ...sold, listingId: '2', sellerAddress: address, price: '2000000', state: 'ACTIVE' as const };
const createEligibility = vi.fn().mockResolvedValue(certificate);
const createListing = vi.fn().mockResolvedValue(sold);
const getDelivery = vi.fn().mockResolvedValue({ agentId, agentVersionId: version, agentsCommitment: commitment, agentsMd: '# Private Agent' });
const withdrawCredit = vi.fn().mockResolvedValue({ transactionId: 'withdraw', state: 'COMPLETE', txHash: `0x${'a'.repeat(64)}` });
const approveCertificate = vi.fn().mockResolvedValue({ ...eligible, state: 'APPROVED' });
const withdrawOperatorCredit = vi.fn().mockResolvedValue({ transactionId: 'platform-withdraw', state: 'COMPLETE' });
const cancelListing = vi.fn().mockResolvedValue({ ...ownedActive, state: 'CANCELLED' });
const marketplaceApi: MarketplaceApiAdapter = { async listListings() { return [sold, ownedActive]; }, async listCertificates() { return [certificate]; }, async listPurchases() { return [sold]; }, async getCredit() { return { amount: '990000' }; }, withdrawCredit, async listOperatorCertificates() { return [eligible]; }, approveCertificate, async getOperatorCredit() { return { amount: '10000' }; }, withdrawOperatorCredit, cancelListing, createEligibility, createListing, async buy() { return sold; }, getDelivery };
const config = { chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', genLayer: { chainId: 61997 as const, rpcUrl: 'https://studio-next.genlayer.com/api', name: 'Studio Next', explorerUrl: 'https://explorer-studio-dev.genlayer.com', evaluationJudgeAddress: '0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d' as const, comparisonJudgeAddress: '0xe5210eCCC4182090A1416f515Dc7001B27274BcB' as const } };
function mount(api: MarketplaceApiAdapter = marketplaceApi) { render(<MemoryRouter><AppProvider config={config} identityAdapter={identity} agentApiAdapter={agentApi} evaluationApiAdapter={evaluationApi} marketplaceApiAdapter={api}><Marketplace /></AppProvider></MemoryRouter>); }

describe('Marketplace website UX', () => {
  it('selects an owned Agent and its finalized Evo campaigns without asking for raw digests or judge address', async () => {
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Sell my Agent' }));
    expect(await screen.findByRole('option', { name: 'Safety Scout' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Agent to certify'), { target: { value: agentId } });
    expect(screen.getByText(/2 finalized Evo campaigns available/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Version digest')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('GenLayer judge address')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check eligibility' }));
    await waitFor(() => expect(createEligibility).toHaveBeenCalledWith(expect.objectContaining({ agentId, agentsVersion: version, campaignIds: campaigns.map((row) => row.campaignId), judgeAddress: config.genLayer.evaluationJudgeAddress })));
  });

  it('shows Marketplace prices in USDC and converts decimal entry to six-decimal base units', async () => {
    mount();
    expect(await screen.findByText('1.000000 USDC')).toBeInTheDocument();
    expect(screen.queryByText('Listing #1')).not.toBeInTheDocument();
    expect(screen.queryByText(certificateDigest)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(certificateDigest.slice(0, 20)))).not.toBeInTheDocument();
    expect(screen.queryByText(eligible.certificateDigest)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Sell my Agent' }));
    fireEvent.change(screen.getByLabelText('Approved certificate'), { target: { value: certificateDigest } });
    fireEvent.change(screen.getByLabelText('Price (USDC)'), { target: { value: '2.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'List on Arc' }));
    await waitFor(() => expect(createListing).toHaveBeenCalledWith(expect.objectContaining({ price: '2500000' })));
  });

  it('shows private delivery only for a canonical purchase returned by the buyer-private endpoint', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open purchased Agent Safety Scout' }));
    expect(await screen.findByRole('heading', { name: 'Purchased Agent' })).toBeInTheDocument();
    expect(screen.getByText('# Private Agent')).toBeInTheDocument();
    expect(screen.queryByText(/Listing #/)).not.toBeInTheDocument();
    expect(getDelivery).toHaveBeenCalledWith('1');
  });

  it('moves seller proceeds to Account Claim instead of duplicating withdrawal controls', async () => {
    mount();
    expect(await screen.findByRole('tab', { name: 'Agents for sale' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Withdraw Marketplace proceeds' })).not.toBeInTheDocument();
    expect(withdrawCredit).not.toHaveBeenCalled();
  });

  it('shows operator approval with score and coverage before the Arc transaction', async () => {
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Sell my Agent' }));
    expect(await screen.findByRole('heading', { name: 'Operator review' })).toBeInTheDocument();
    expect(screen.getByText(/90\/100.*100% coverage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve certificate on Arc' }));
    await waitFor(() => expect(approveCertificate).toHaveBeenCalledWith(eligible.certificateDigest));
    expect(screen.getByText('0.010000 USDC platform credit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw platform fee' }));
    await waitFor(() => expect(withdrawOperatorCredit).toHaveBeenCalled());
    expect(await screen.findByText(/Platform withdrawal confirmed/i)).toBeInTheDocument();
  });

  it('lets only the current seller cancel an active Arc listing', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Safety Scout listing' }));
    await waitFor(() => expect(cancelListing).toHaveBeenCalledWith('2', expect.any(String)));
    expect(screen.getAllByRole('button', { name: 'Cancel Safety Scout listing' })).toHaveLength(1);
  });

  it('offers a safe retry for the original buyer or seller while an Arc write is unresolved', async () => {
    const buy = vi.fn().mockResolvedValue({ ...sold, state: 'BUY_SUBMITTED' });
    mount({ ...marketplaceApi, async listListings() { return [
      { ...sold, listingId: '3', state: 'BUY_SUBMITTED', buyerAddress: address },
      { ...ownedActive, state: 'CANCEL_SUBMITTED' },
    ]; }, buy });
    fireEvent.click(await screen.findByRole('button', { name: 'Resume Safety Scout purchase' }));
    await waitFor(() => expect(buy).toHaveBeenCalledWith('3', expect.any(String), expect.any(String)));
    fireEvent.click(screen.getByRole('button', { name: 'Retry Safety Scout cancellation' }));
    await waitFor(() => expect(cancelListing).toHaveBeenCalledWith('2', expect.any(String)));
  });
});
