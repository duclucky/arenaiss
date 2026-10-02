import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const certificate = { schema: 'arena-marketplace-certificate-v1', certificateDigest, evidenceDigest: digest('8'), owner: address, agentId, agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: '42', packId: digest('7'), packVersion: '1.0.0', rubricVersion: 'v1', coverageBps: 10000, overallScore: 90, dimensionScores: {}, maxSpread: 0, issuedAt: 1, expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400, state: 'APPROVED' as const };
const eligible = { ...certificate, certificateDigest: digest('9'), state: 'ELIGIBLE' as const };
const sold = { schema: 'arena-marketplace-listing-v1', listingId: '1', certificateDigest, agentId, agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: '42', name: 'Purchased Scout', sellerAddress: '0x5555555555555555555555555555555555555555', price: '1000000', expiresAt: certificate.expiresAt, state: 'SOLD' as const };
const ownedActive = { ...sold, name: 'Safety Scout', listingId: '2', sellerAddress: address, price: '2000000', state: 'ACTIVE' as const };
const createEligibility = vi.fn().mockResolvedValue(certificate);
const createListing = vi.fn().mockResolvedValue(sold);
const getDelivery = vi.fn().mockResolvedValue({ agentId, agentVersionId: version, agentsCommitment: commitment, agentsMd: '# Private Agent' });
const withdrawCredit = vi.fn().mockResolvedValue({ transactionId: 'withdraw', state: 'COMPLETE', txHash: `0x${'a'.repeat(64)}` });
const approveCertificate = vi.fn().mockResolvedValue({ ...eligible, state: 'APPROVED' });
const withdrawOperatorCredit = vi.fn().mockResolvedValue({ transactionId: 'platform-withdraw', state: 'COMPLETE' });
const cancelListing = vi.fn().mockResolvedValue({ ...ownedActive, state: 'CANCELLED' });
const marketplaceApi: MarketplaceApiAdapter = { async listListings() { return [sold, ownedActive]; }, async listOwnedListings() { return [ownedActive]; }, async listCertificates() { return [certificate]; }, async listPurchases() { return [sold]; }, async getCredit() { return { amount: '990000' }; }, withdrawCredit, async listOperatorCertificates() { return [eligible]; }, approveCertificate, async getOperatorCredit() { return { amount: '10000' }; }, withdrawOperatorCredit, cancelListing, createEligibility, createListing, async buy() { return sold; }, getDelivery };
const config = { chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', genLayer: { chainId: 61997 as const, rpcUrl: 'https://studio-next.genlayer.com/api', name: 'Studio Next', explorerUrl: 'https://explorer-studio-dev.genlayer.com', evaluationJudgeAddress: '0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d' as const, comparisonJudgeAddress: '0xe5210eCCC4182090A1416f515Dc7001B27274BcB' as const } };
function mount(api: MarketplaceApiAdapter = marketplaceApi, agents: AgentApiAdapter = agentApi, initialEntry = '/marketplace') { render(<MemoryRouter initialEntries={[initialEntry]}><AppProvider config={config} identityAdapter={identity} agentApiAdapter={agents} evaluationApiAdapter={evaluationApi} marketplaceApiAdapter={api}><Marketplace /></AppProvider></MemoryRouter>); }

describe('Marketplace website UX', () => {
  it('explains evaluation eligibility and the platform fee without internal Evo terminology', async () => {
    mount(marketplaceApi, agentApi, '/marketplace?view=sell');
    expect(await screen.findByText(/passed Arena ISS evaluation/i)).toBeInTheDocument();
    expect(screen.getByText('Platform fee · 1%')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Safety Scout' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Agent to certify'), { target: { value: agentId } });
    expect(screen.getByText(/2 finalized evaluations available/i)).toBeInTheDocument();
    expect(screen.queryByText(/\bEvo\b/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Version digest')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('GenLayer judge address')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check eligibility' }));
    await waitFor(() => expect(createEligibility).toHaveBeenCalledWith(expect.objectContaining({ agentId, agentsVersion: version, campaignIds: campaigns.map((row) => row.campaignId), judgeAddress: config.genLayer.evaluationJudgeAddress })));
  });

  it('explains every failed Marketplace eligibility rule and the next step', async () => {
    const rejectedEligibility = vi.fn().mockRejectedValue(new Error('Agent version is not marketplace eligible: CRITICAL_POLICY_FINDING,SCORE_SPREAD_ABOVE_THRESHOLD'));
    mount({ ...marketplaceApi, createEligibility: rejectedEligibility }, agentApi, '/marketplace?view=sell');
    fireEvent.change(await screen.findByLabelText('Agent to certify'), { target: { value: agentId } });
    fireEvent.click(screen.getByRole('button', { name: 'Check eligibility' }));

    expect(await screen.findByRole('heading', { name: 'This Agent version is not eligible yet' })).toBeInTheDocument();
    expect(screen.getByText(/at least one evaluation run contains a blocking policy finding/i)).toBeInTheDocument();
    expect(screen.getByText(/highest and lowest evaluation scores is greater than the allowed 20 points/i)).toBeInTheDocument();
    expect(screen.getByText(/review the failed runs, update this Agent version, then complete two new evaluations/i)).toBeInTheDocument();
    expect(screen.getByText('CRITICAL POLICY FINDING')).toBeInTheDocument();
    expect(screen.getByText('SCORE SPREAD ABOVE THRESHOLD')).toBeInTheDocument();
  });

  it('immediately selects an automatically approved certificate without reloading certificate data', async () => {
    const listCertificates = vi.fn().mockResolvedValue([]);
    const automaticEligibility = vi.fn().mockResolvedValue(certificate);
    mount({ ...marketplaceApi, listCertificates, createEligibility: automaticEligibility,
      async listOperatorCertificates() { return []; } }, agentApi, '/marketplace?view=sell');
    fireEvent.change(await screen.findByLabelText('Agent to certify'), { target: { value: agentId } });
    fireEvent.click(screen.getByRole('button', { name: 'Check eligibility' }));

    const approved = await screen.findByRole('option', { name: 'Approved Agent · 90/100' });
    expect(approved).toBeInTheDocument();
    expect(screen.getByLabelText('Approved certificate')).toHaveValue(certificateDigest);
    expect(screen.getByRole('button', { name: 'List on Arc' })).toBeEnabled();
    expect(listCertificates).toHaveBeenCalledTimes(1);
  });

  it('offers an explicit safe resume for a persisted Marketplace listing intent', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 6 * 86400;
    const resumeCreateListing = vi.fn().mockResolvedValue(ownedActive);
    const recoveryApi = {
      ...marketplaceApi,
      async listListings() { return []; },
      async listOwnedListings() { return []; },
      async listPurchases() { return []; },
      async listListingIntents() { return [{ certificateDigest, agentId, agentVersionId: version, agentsCommitment: commitment,
        erc8004TokenId: '42', price: '3000000', expiresAt, state: 'PREPARED' as const }]; },
      createListing: resumeCreateListing,
    };
    mount(recoveryApi as MarketplaceApiAdapter, agentApi, '/marketplace?view=sell');

    const recovery = await screen.findByRole('region', { name: 'Listing recovery' });
    expect(within(recovery).getByText('3.000000 USDC')).toBeInTheDocument();
    const expiry = new Date(expiresAt * 1000).toLocaleString();
    expect(within(recovery).getByText((_content, node) => node?.tagName === 'P' && Boolean(node.textContent?.includes(expiry)))).toBeInTheDocument();
    fireEvent.click(within(recovery).getByRole('button', { name: 'Resume listing attempt' }));
    await waitFor(() => expect(resumeCreateListing).toHaveBeenCalledWith(expect.objectContaining({
      certificateDigest, agentId, agentsVersion: version, agentsCommitment: commitment,
      price: '3000000', expiresAt,
    })));
  });

  it('shows seller-owned listings that are hidden from the public Marketplace', async () => {
    const submitted = { ...ownedActive, state: 'SUBMITTED' as const };
    mount({ ...marketplaceApi, async listListings() { return []; }, async listOwnedListings() { return [submitted]; } },
      agentApi, '/marketplace?view=sell');

    const records = await screen.findByRole('region', { name: 'My listing records' });
    expect(within(records).getByRole('heading', { name: 'Safety Scout' })).toBeInTheDocument();
    expect(within(records).getByText('SUBMITTED')).toBeInTheDocument();
    expect(within(records).getByText(/Awaiting Arc confirmation/i)).toBeInTheDocument();
  });

  it('shows Marketplace prices in USDC and converts decimal entry to six-decimal base units', async () => {
    mount();
    const publicListings = await screen.findByRole('region', { name: 'Agents for sale' });
    expect(within(publicListings).getByText('2.000000 USDC')).toBeInTheDocument();
    expect(within(publicListings).getByRole('heading', { name: 'Safety Scout' })).toBeInTheDocument();
    const actions = within(publicListings).getByRole('group', { name: 'Safety Scout listing actions' });
    expect(within(actions).getByRole('button', { name: 'View details' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Cancel Safety Scout listing' })).toBeInTheDocument();
    expect(within(publicListings).queryByText('View metrics and history')).not.toBeInTheDocument();
    expect(within(publicListings).queryByRole('heading', { name: 'Purchased Scout' })).not.toBeInTheDocument();
    expect(within(publicListings).queryByText('SOLD')).not.toBeInTheDocument();
    const purchases = screen.getByRole('region', { name: 'My purchased Agents' });
    expect(within(purchases).getByRole('heading', { name: 'Purchased Scout' })).toBeInTheDocument();
    expect(screen.queryByText('Listing #1')).not.toBeInTheDocument();
    expect(screen.queryByText(certificateDigest)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(certificateDigest.slice(0, 20)))).not.toBeInTheDocument();
    expect(screen.queryByText(eligible.certificateDigest)).not.toBeInTheDocument();
    cleanup();
    mount(marketplaceApi, agentApi, '/marketplace?view=sell');
    await screen.findByRole('option', { name: 'Approved Agent · 90/100' });
    fireEvent.change(screen.getByLabelText('Approved certificate'), { target: { value: certificateDigest } });
    fireEvent.change(screen.getByLabelText('Price (USDC)'), { target: { value: '2.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'List on Arc' }));
    await waitFor(() => expect(createListing).toHaveBeenCalledWith(expect.objectContaining({ price: '2500000' })));
  });

  it('keeps public details and purchase as two separate listing actions', async () => {
    const buyerListing = { ...ownedActive, sellerAddress: '0x5555555555555555555555555555555555555555' };
    mount({ ...marketplaceApi, async listListings() { return [buyerListing]; }, async listOwnedListings() { return []; } });

    const actions = await screen.findByRole('group', { name: 'Safety Scout listing actions' });
    expect(within(actions).getByRole('button', { name: 'View details' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Buy for 2.000000 USDC' })).toBeInTheDocument();
  });

  it('requires an explicit purchase review before submitting the Arc transaction', async () => {
    const buyerListing = { ...ownedActive, sellerAddress: '0x5555555555555555555555555555555555555555' };
    const buy = vi.fn().mockResolvedValue({ ...buyerListing, state: 'BUY_SUBMITTED' });
    mount({ ...marketplaceApi, async listListings() { return [buyerListing]; }, async listOwnedListings() { return []; }, buy });

    fireEvent.click(await screen.findByRole('button', { name: 'Buy for 2.000000 USDC' }));
    expect(buy).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Review purchase' });
    expect(within(dialog).getByText('ERC-8004 #42')).toBeInTheDocument();
    expect(within(dialog).getByText('2.000000 USDC')).toBeInTheDocument();
    expect(within(dialog).getByText('Arc Testnet')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm purchase' }));
    await waitFor(() => expect(buy).toHaveBeenCalledWith('2', expect.any(String), expect.any(String)));
  });

  it('loads the public profile bound to the exact Marketplace listing', async () => {
    const listPublicAgents = vi.fn();
    const getListingProfile = vi.fn().mockResolvedValue({
      agentId, name: 'Safety Scout', agentsVersion: version, agentsCommitment: commitment,
      active: true, marketplaceListed: true,
      stats: { latestEvaluationScore: 95, tournamentCount: 0, adversarialMatchCount: 0 },
      activity: { evaluations: [], pairMatches: [], tournaments: [] },
      erc8004Identity: {
        schema: 'arena-erc8004-identity-v1', network: 'Arc Testnet', chainId: 5042002,
        registryAddress: address, tokenId: '42', ownerAddress: address, agentUri: 'https://example.test/agent.json',
        transaction: { transactionId: 'identity', state: 'COMPLETE' },
      },
    });
    mount({ ...marketplaceApi, getListingProfile }, { ...agentApi, listPublicAgents });

    fireEvent.click(await screen.findByRole('button', { name: 'View details' }));
    expect(await screen.findByRole('dialog', { name: 'Safety Scout' })).toBeInTheDocument();
    expect(getListingProfile).toHaveBeenCalledWith('2');
    expect(listPublicAgents).not.toHaveBeenCalled();
  });

  it('opens a public Agent profile with metrics and history without loading private AGENTS.md', async () => {
    const getAgent = vi.fn();
    const listPublicAgents = vi.fn().mockResolvedValue([{
      agentId, name: 'Safety Scout', agentsVersion: version, agentsCommitment: commitment,
      active: true, marketplaceListed: true,
      stats: { latestEvaluationScore: 94, tournamentCount: 2, adversarialMatchCount: 3 },
      activity: {
        evaluations: [
          { campaignId: digest('a'), state: 'FINALIZED', createdAt: 1_790_000_000_000, overallScore: 94, scenarioCount: 4 },
          { campaignId: digest('e'), state: 'PENDING', createdAt: 1_791_000_000_000, overallScore: null, scenarioCount: 4 },
        ],
        pairMatches: [
          { roomId: digest('b'), state: 'SETTLED', role: 'CREATOR', createdAt: 1_790_000_000 },
          { roomId: digest('d'), state: 'REFUNDABLE', role: 'CREATOR', createdAt: 1_789_000_000 },
        ],
        tournaments: [{ id: digest('c'), name: 'Safety Finals', status: 'COMPLETED' }],
      },
      erc8004Identity: {
        schema: 'arena-erc8004-identity-v1', network: 'Arc Testnet', chainId: 5042002,
        registryAddress: address, tokenId: '42', ownerAddress: address, agentUri: 'https://example.test/agent.json',
        transaction: { transactionId: 'identity', state: 'COMPLETE' },
      },
      erc8004Reputation: { state: 'COMPLETE', value: 94 },
    }]);
    mount(marketplaceApi, { ...agentApi, listPublicAgents, getAgent });

    const trigger = await screen.findByRole('button', { name: 'View details' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Safety Scout' });
    expect(within(dialog).getAllByText('94/100')).toHaveLength(3);
    expect(within(dialog).getByText('2', { selector: 'dd' })).toBeInTheDocument();
    expect(within(dialog).getByText('3', { selector: 'dd' })).toBeInTheDocument();
    const evaluationHistory = within(dialog).getByRole('heading', { name: 'Evaluation history' }).closest('section')!;
    const pairHistory = within(dialog).getByRole('heading', { name: 'Pair match history' }).closest('section')!;
    expect(evaluationHistory).toBeInTheDocument();
    expect(within(evaluationHistory).queryByText('PENDING')).not.toBeInTheDocument();
    expect(within(evaluationHistory).getAllByRole('listitem')).toHaveLength(1);
    expect(within(pairHistory).getByText('SETTLED')).toBeInTheDocument();
    expect(within(pairHistory).queryByText('REFUNDABLE')).not.toBeInTheDocument();
    expect(evaluationHistory.querySelector('li')).toHaveClass('marketplace-history-card');
    expect(pairHistory.querySelector('li')).toHaveClass('marketplace-history-card');
    const closeButton = within(dialog).getByRole('button', { name: 'Close dialog' });
    expect(closeButton.parentElement).toHaveClass('marketplace-modal-header');
    expect(dialog).toHaveClass('max-w-3xl', 'overflow-hidden');
    expect(dialog.parentElement).toHaveClass('z-[110]');
    expect(within(dialog).getByText('Safety Finals')).toBeInTheDocument();
    expect(within(dialog).queryByText('# Private Agent')).not.toBeInTheDocument();
    expect(listPublicAgents).toHaveBeenCalledTimes(1);
    expect(getAgent).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Safety Scout' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('loads public Agent evidence for an anonymous visitor without an injected Agent adapter', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/capabilities')) return new Response(JSON.stringify({ schema: 'arena-capabilities-v1', tournament: { visible: true, operationEnabled: true, registrationEnabled: true }, pair: { enabled: true }, evaluation: { enabled: true } }), { status: 200 });
      if (url.endsWith('/api/public/agents')) return new Response(JSON.stringify([{
        agentId, name: 'Safety Scout', agentsVersion: version, agentsCommitment: commitment,
        stats: { latestEvaluationScore: 91, tournamentCount: 1, adversarialMatchCount: 2 },
        activity: { evaluations: [], pairMatches: [], tournaments: [] },
      }]), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      render(<MemoryRouter><AppProvider config={{ ...config, apiUrl: 'https://arena.example' }} marketplaceApiAdapter={marketplaceApi}><Marketplace /></AppProvider></MemoryRouter>);
      fireEvent.click(await screen.findByRole('button', { name: 'View details' }));

      const dialog = await screen.findByRole('dialog', { name: 'Safety Scout' });
      expect(within(dialog).getByText('91/100')).toBeInTheDocument();
      expect(within(dialog).queryByText(/not available on this server/i)).not.toBeInTheDocument();
      expect(fetcher).toHaveBeenCalledWith('https://arena.example/api/public/agents', expect.objectContaining({ method: 'GET' }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows private delivery only for a canonical purchase returned by the buyer-private endpoint', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open purchased Agent Purchased Scout' }));
    expect(await screen.findByRole('heading', { name: 'Purchased Agent' })).toBeInTheDocument();
    expect(screen.getByText('# Private Agent')).toBeInTheDocument();
    expect(screen.queryByText(/Listing #/)).not.toBeInTheDocument();
    expect(getDelivery).toHaveBeenCalledWith('1');
  });

  it('moves seller proceeds to Account Claim instead of duplicating withdrawal controls', async () => {
    mount();
    expect(await screen.findByRole('region', { name: 'Agents for sale' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw Marketplace proceeds' })).not.toBeInTheDocument();
    expect(withdrawCredit).not.toHaveBeenCalled();
  });

  it('shows operator approval with score and coverage before the Arc transaction', async () => {
    mount(marketplaceApi, agentApi, '/marketplace?view=sell');
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
    const recoveryApi: MarketplaceApiAdapter = { ...marketplaceApi,
      async listListings() { return []; },
      async listPurchases() { return [{ ...sold, listingId: '3', state: 'BUY_SUBMITTED', buyerAddress: address }]; },
      async listOwnedListings() { return [{ ...ownedActive, state: 'CANCEL_SUBMITTED' }]; },
      buy };
    mount(recoveryApi);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume Purchased Scout purchase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm purchase' }));
    await waitFor(() => expect(buy).toHaveBeenCalledWith('3', expect.any(String), expect.any(String)));
    cleanup();
    mount(recoveryApi, agentApi, '/marketplace?view=sell');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry Safety Scout cancellation' }));
    await waitFor(() => expect(cancelListing).toHaveBeenCalledWith('2', expect.any(String)));
  });
});
