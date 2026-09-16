import { randomBytes } from 'node:crypto';

import type { ArenaApiService } from './service.ts';
import { ManagedIdentityService, type LoginIdentityKind, type ManagedIdentityOptions } from './managed-identity.ts';
import type { MarketplaceChainPort } from './marketplace-arc.ts';
import type { EvaluationExecutionService } from './evaluation-execution.ts';
import type { TournamentOperationAction, TournamentOperationsPort } from './tournament-operations.ts';

type Headers = Record<string, string>;
export type ApiRequest = { method: string; path: string; headers?: Headers; body?: Record<string, unknown> };
export type ApiResponse = { status: number; headers: Headers; body?: any };
export type SignatureVerifier = (input: { address: string; message: string; signature: string }) => Promise<boolean>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CHALLENGE_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;

export class ArenaHttpApi {
  private service: ArenaApiService;
  private verifySignature: SignatureVerifier;
  private challenges = new Map<string, { message: string; expiresAt: number }>();
  private sessions = new Map<string, { principal: string; userId?: string; identityKind?: LoginIdentityKind; expiresAt: number }>();
  private managedIdentity?: ManagedIdentityService;
  private marketplaceChain?: MarketplaceChainPort;

  private evaluationExecution?: EvaluationExecutionService;
  private tournamentOperations?: TournamentOperationsPort;

  constructor(service: ArenaApiService, verifySignature: SignatureVerifier, managedIdentityOptions?: ManagedIdentityOptions, marketplaceChain?: MarketplaceChainPort, evaluationExecution?: EvaluationExecutionService, managedIdentityService?: ManagedIdentityService, tournamentOperations?: TournamentOperationsPort) {
    this.service = service;
    this.verifySignature = verifySignature;
    this.marketplaceChain = marketplaceChain;
    this.evaluationExecution = evaluationExecution;
    this.tournamentOperations = tournamentOperations;
    this.managedIdentity = managedIdentityService ?? (managedIdentityOptions ? new ManagedIdentityService(managedIdentityOptions) : undefined);
    void this.managedIdentity?.resumeCctpTransfers().catch(() => undefined);
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    try {
      if (request.method === 'POST' && request.path === '/api/auth/challenge') return this.challenge(request.body);
      if (request.method === 'GET' && request.path === '/api/auth/capabilities') return this.json(200, { wallet: true, email: Boolean(this.managedIdentity), managedWallet: Boolean(this.managedIdentity) });
      if (request.method === 'POST' && request.path === '/api/auth/verify') return await this.verify(request.body);
      if (request.method === 'POST' && request.path === '/api/auth/email/challenge') {
        if (!this.managedIdentity) throw new Error('email authentication unavailable');
        await this.managedIdentity.requestEmailCode(requireString(request.body?.email));
        return this.json(202, { status: 'code sent' });
      }
      if (request.method === 'POST' && request.path === '/api/auth/email/verify') return await this.verifyEmail(request.body);
      if (request.method === 'POST' && request.path === '/api/auth/logout') return this.logout(request.headers);
      if (request.path === '/api/tournament-operations') {
        this.requireOperator(request.headers);
        if (!this.tournamentOperations) throw new Error('tournament operations unavailable');
        if (request.method === 'GET') return this.json(200, await this.tournamentOperations.list());
        if (request.method === 'POST') {
          const body = request.body || {};
          requireExactKeys(body, ['tournamentId', 'name', 'registrationOpensAt', 'registrationClosesAt', 'startsAt', 'expiresAt', 'minEntrants', 'maxEntrants', 'stakeAmount']);
          const input = {
            tournamentId: requireDigest(body.tournamentId), name: requireBoundedString(body.name, 1, 96),
            registrationOpensAt: requirePositiveInteger(body.registrationOpensAt), registrationClosesAt: requirePositiveInteger(body.registrationClosesAt),
            startsAt: requirePositiveInteger(body.startsAt), expiresAt: requirePositiveInteger(body.expiresAt),
            minEntrants: requirePositiveInteger(body.minEntrants), maxEntrants: requirePositiveInteger(body.maxEntrants), stakeAmount: requireUint(body.stakeAmount),
          };
          if (!(input.registrationOpensAt < input.registrationClosesAt && input.registrationClosesAt <= input.startsAt && input.startsAt < input.expiresAt)
            || input.minEntrants < 8 || input.maxEntrants > 32 || input.minEntrants > input.maxEntrants) throw new Error('invalid tournament policy');
          return this.json(201, await this.tournamentOperations.create(input));
        }
      }
      const tournamentOperation = request.path.match(/^\/api\/tournament-operations\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && tournamentOperation) {
        this.requireOperator(request.headers); if (!this.tournamentOperations) throw new Error('tournament operations unavailable');
        const snapshot = await this.tournamentOperations.get(tournamentOperation[1]);
        return snapshot ? this.json(200, snapshot) : this.json(404, { error: 'not found' });
      }
      const tournamentAction = request.path.match(/^\/api\/tournament-operations\/(sha256:[0-9a-fA-F]{64})\/actions\/(PROGRESS|SETTLE|EXPIRE|REFUND)$/);
      if (request.method === 'POST' && tournamentAction) {
        this.requireOperator(request.headers); if (!this.tournamentOperations) throw new Error('tournament operations unavailable');
        requireExactKeys(request.body || {}, []);
        const tournamentId = requireDigest(tournamentAction[1]); const action = tournamentAction[2] as TournamentOperationAction;
        const current = await this.tournamentOperations.get(tournamentId);
        if (!current || !current.nextActions.includes(action)) throw new Error('tournament action is not allowed');
        return this.json(202, await this.tournamentOperations.execute({ tournamentId, action }));
      }
      if (request.method === 'GET' && request.path === '/api/account') {
        const session = this.requireSessionRecord(request.headers);
        if (!this.managedIdentity || !session.userId || !session.identityKind) throw new Error('managed wallet unavailable');
        return this.json(200, await this.managedIdentity.getAccount(session.userId, session.identityKind));
      }
      if (request.method === 'GET' && request.path === '/api/account/usdc-balances') {
        const session = this.requireManagedSession(request.headers);
        return this.json(200, await this.managedIdentity!.listUsdcBalances(session.userId!));
      }
      if (request.method === 'POST' && request.path === '/api/account/usdc-transfers') {
        const session = this.requireManagedSession(request.headers);
        return this.json(202, await this.managedIdentity!.transferUsdc(session.userId!, requireString(request.body?.destinationAddress), requireString(request.body?.amount)));
      }
      if (request.method === 'POST' && request.path === '/api/account/cctp-transfers') {
        const session = this.requireManagedSession(request.headers);
        return this.json(202, await this.managedIdentity!.startBridgeUsdcToArc(session.userId!, requireString(request.body?.sourceChain), requireString(request.body?.amount)));
      }
      const cctpTransferMatch = request.path.match(/^\/api\/account\/cctp-transfers\/([0-9a-fA-F-]{36})$/);
      if (request.method === 'GET' && cctpTransferMatch) {
        const session = this.requireManagedSession(request.headers);
        return this.json(200, this.managedIdentity!.getCctpTransfer(session.userId!, cctpTransferMatch[1]));
      }
      if (request.method === 'GET' && request.path === '/api/tournaments') return this.json(200, this.service.listTournaments());
      if (request.method === 'GET' && request.path === '/api/marketplace/listings') return this.json(200, await this.reconcileMarketplaceListings());
      if (request.method === 'GET' && request.path === '/api/marketplace/my-purchases') { const buyer = this.requireSession(request.headers); await this.reconcileMarketplaceListings(); return this.json(200, this.service.listOwnedMarketplacePurchases(buyer)); }
      if (request.method === 'GET' && request.path === '/api/marketplace/certificates') { const owner = this.requireSession(request.headers); return this.json(200, this.service.listOwnedMarketplaceCertificates(owner)); }
      if (request.method === 'GET' && request.path === '/api/marketplace/operator/certificates') { const operator = this.requireSession(request.headers); return this.json(200, this.service.listMarketplaceCertificatesForOperator(operator)); }
      if (request.method === 'GET' && request.path === '/api/marketplace/operator/credit') { const operator = this.requireSession(request.headers); if (operator.toLowerCase() !== this.service.operatorAddress || !this.marketplaceChain?.operatorCredit) throw new Error('unauthorized operator'); return this.json(200, { amount: await this.marketplaceChain.operatorCredit() }); }
      if (request.method === 'POST' && request.path === '/api/marketplace/operator/credit/withdraw') { const operator = this.requireSession(request.headers); if (operator.toLowerCase() !== this.service.operatorAddress || !this.marketplaceChain?.withdrawOperatorCredit) throw new Error('unauthorized operator'); return this.json(200, await this.marketplaceChain.withdrawOperatorCredit()); }
      if (request.method === 'POST' && request.path === '/api/marketplace/eligibility') {
        const owner = this.requireSession(request.headers); const body = request.body || {};
        return this.json(201, this.service.createMarketplaceEligibility(owner, { agentId: requireDigest(body.agentId), agentsVersion: requireDigest(body.agentsVersion), campaignIds: requireStringArray(body.campaignIds) as `sha256:${string}`[], issuedAt: requireInteger(body.issuedAt), expiresAt: requireInteger(body.expiresAt), network: requireString(body.network), chainId: requireInteger(body.chainId), judgeAddress: requireAddress(body.judgeAddress) }));
      }
      const certificateMatch = request.path.match(/^\/api\/marketplace\/certificates\/(sha256:[0-9a-fA-F]{64})\/approve$/);
      if (request.method === 'POST' && certificateMatch) { const operator = this.requireSession(request.headers); if (operator.toLowerCase() !== this.service.operatorAddress || !this.marketplaceChain?.approveEligibility) throw new Error('unauthorized operator'); const certificate = this.service.listMarketplaceCertificatesForOperator(operator).find((row) => row.certificateDigest === certificateMatch[1]); if (!certificate) throw new Error('marketplace certificate not found'); const transaction = await this.marketplaceChain.approveEligibility({ digest: certificate.certificateDigest, agentId: certificate.agentId, version: certificate.agentVersionId, commitment: certificate.agentsCommitment, validUntil: certificate.expiresAt }); return this.json(200, this.service.approveMarketplaceEligibility(operator, certificate.certificateDigest, transaction)); }
      if (request.method === 'GET' && request.path === '/api/marketplace/my-listings') { const owner = this.requireSession(request.headers); return this.json(200, this.service.listMarketplaceListings().filter((row) => row.sellerAddress.toLowerCase() === owner.toLowerCase())); }
      if (request.method === 'POST' && request.path === '/api/marketplace/listings') {
        const session = this.requireManagedSession(request.headers); const body = request.body || {}; if (!this.managedIdentity) throw new Error('marketplace unavailable');
        const transaction = await this.managedIdentity.marketplaceCreateListing(session.userId!, { agentId: requireDigest(body.agentId), version: requireDigest(body.agentsVersion), commitment: requireDigest(body.agentsCommitment), certificateDigest: requireDigest(body.certificateDigest), price: requireUint(body.price), expiresAt: requireInteger(body.expiresAt), idempotencyKey: requireString(body.idempotencyKey) });
        const account = await this.managedIdentity.getAccount(session.userId!, session.identityKind!);
        const requestedListingId = requireString(body.listingId);
        const listingId = transaction.txHash && this.marketplaceChain?.resolveCreatedListingId ? await this.marketplaceChain.resolveCreatedListingId(transaction.txHash) : requestedListingId;
        const listing = this.service.createMarketplaceListing(session.principal, { listingId, certificateDigest: requireDigest(body.certificateDigest), sellerAddress: account.managedWallet.address, price: requireUint(body.price), expiresAt: requireInteger(body.expiresAt), transaction });
        return this.json(202, listing);
      }
      const listingCancel = request.path.match(/^\/api\/marketplace\/listings\/([1-9][0-9]*)\/cancel$/);
      if (request.method === 'POST' && listingCancel) {
        const session = this.requireManagedSession(request.headers); if (!this.managedIdentity || !this.marketplaceChain) throw new Error('marketplace unavailable');
        const listing = this.service.listMarketplaceListings().find((row) => row.listingId === listingCancel[1]);
        if (!listing || listing.state !== 'ACTIVE') throw new Error('active marketplace listing unavailable');
        const account = await this.managedIdentity.getAccount(session.userId!, session.identityKind!);
        if (listing.sellerAddress.toLowerCase() !== account.managedWallet.address.toLowerCase()) throw new Error('marketplace seller required');
        await this.managedIdentity.marketplaceCancel(session.userId!, listing.listingId, requireString(request.body?.idempotencyKey));
        const snapshot = await this.marketplaceChain.snapshot(listing.listingId);
        return this.json(200, this.service.publishMarketplaceListing(this.service.operatorAddress, snapshot));
      }
      const listingBuy = request.path.match(/^\/api\/marketplace\/listings\/([1-9][0-9]*)\/buy$/);
      if (request.method === 'POST' && listingBuy) { const session = this.requireManagedSession(request.headers); if (!this.managedIdentity) throw new Error('marketplace unavailable'); const listing = this.service.listMarketplaceListings().find((row) => row.listingId === listingBuy[1]); if (!listing) throw new Error('marketplace listing unavailable'); const transaction = await this.managedIdentity.marketplaceBuy(session.userId!, listingBuy[1], listing.price, requireString(request.body?.approvalIdempotencyKey), requireString(request.body?.buyIdempotencyKey)); const account = await this.managedIdentity.getAccount(session.userId!, session.identityKind!); const projected = this.service.submitMarketplacePurchase(session.principal, listingBuy[1], account.managedWallet.address, transaction); return this.json(202, projected); }
      const listingDelivery = request.path.match(/^\/api\/marketplace\/listings\/([1-9][0-9]*)\/delivery$/);
      if (request.method === 'GET' && listingDelivery) { const session = this.requireSessionRecord(request.headers); if (!this.marketplaceChain) throw new Error('marketplace unavailable'); const snapshot = await this.marketplaceChain.snapshot(listingDelivery[1]); this.service.publishMarketplaceListing(this.service.operatorAddress, snapshot); return this.json(200, this.service.getMarketplaceDelivery(session.principal, listingDelivery[1], snapshot)); }
      if (request.method === 'GET' && request.path === '/api/marketplace/credit') { const session = this.requireManagedSession(request.headers); if (!this.marketplaceChain?.creditOf || !this.managedIdentity) throw new Error('marketplace credit unavailable'); const account = await this.managedIdentity.getAccount(session.userId!, session.identityKind!); return this.json(200, { amount: await this.marketplaceChain.creditOf(account.managedWallet.address) }); }
      if (request.method === 'POST' && request.path === '/api/marketplace/credit/withdraw') { const session = this.requireManagedSession(request.headers); if (!this.marketplaceChain?.creditOf || !this.managedIdentity) throw new Error('marketplace credit unavailable'); const account = await this.managedIdentity.getAccount(session.userId!, session.identityKind!); if (BigInt(await this.marketplaceChain.creditOf(account.managedWallet.address)) === 0n) throw new Error('no marketplace credit'); return this.json(202, await this.managedIdentity.marketplaceWithdraw(session.userId!, requireString(request.body?.idempotencyKey))); }
      const tournamentMatch = request.path.match(/^\/api\/tournaments\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && tournamentMatch) {
        const tournament = this.service.getTournament(tournamentMatch[1]);
        return tournament ? this.json(200, tournament) : this.json(404, { error: 'not found' });
      }
      const tournamentMatches = request.path.match(/^\/api\/tournaments\/(sha256:[0-9a-fA-F]{64})\/matches$/);
      if (request.method === 'GET' && tournamentMatches) return this.json(200, this.service.listMatches(tournamentMatches[1]));
      const publicMatch = request.path.match(/^\/api\/matches\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && publicMatch) {
        const match = this.service.getMatch(publicMatch[1]);
        return match ? this.json(200, match) : this.json(404, { error: 'not found' });
      }
      const publicVerdict = request.path.match(/^\/api\/matches\/(sha256:[0-9a-fA-F]{64})\/verdict$/);
      if (request.method === 'GET' && publicVerdict) {
        const verdict = this.service.getVerdict(publicVerdict[1]);
        return verdict ? this.json(200, verdict) : this.json(404, { error: 'not found' });
      }
      if (request.method === 'GET' && request.path === '/api/evaluation-runs') {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.listOwnedEvaluationRuns(owner));
      }
      if (request.method === 'GET' && request.path === '/api/evaluation-config') {
        return this.json(200, this.evaluationExecution?.config() ?? { enabled: false, feeAsset: 'USDC', genLayerGasPayer: 'OWNER' });
      }
      if (request.method === 'POST' && request.path === '/api/evaluation-campaigns/evo') {
        const session = this.requireManagedSession(request.headers);
        if (!this.evaluationExecution) throw new Error('evaluation execution unavailable');
        const body = request.body || {};
        const created = this.service.createEvoCampaign(session.principal, { agentId: requireDigest(body.agentId), agentsVersion: requireDigest(body.agentsVersion), model: this.evaluationExecution.model });
        const campaign = await this.evaluationExecution.start(session.userId!, session.principal, created.campaignId);
        return this.json(202, campaign);
      }
      if (request.method === 'POST' && request.path === '/api/evaluation-packs') {
        const owner = this.requireSession(request.headers);
        const body = request.body || {};
        return this.json(201, this.service.createEvaluationPack(owner, {
          packId: requireString(body.packId) as `sha256:${string}`,
          version: requireString(body.version),
          name: requireString(body.name),
          scenarios: body.scenarios as any,
        }));
      }
      if (request.method === 'POST' && request.path === '/api/evaluation-campaigns') {
        const owner = this.requireSession(request.headers);
        const body = request.body || {};
        return this.json(201, this.service.createSoloCampaign(owner, {
          campaignId: requireString(body.campaignId) as `sha256:${string}`,
          agentId: requireString(body.agentId) as `sha256:${string}`,
          agentsVersion: requireString(body.agentsVersion) as `sha256:${string}`,
          packId: requireString(body.packId) as `sha256:${string}`,
          packVersion: requireString(body.packVersion),
          runtimePolicy: body.runtimePolicy as any,
        }));
      }
      const evaluationStart = request.path.match(/^\/api\/evaluation-campaigns\/(sha256:[0-9a-fA-F]{64})\/start$/);
      if (request.method === 'POST' && evaluationStart) {
        const session = this.requireManagedSession(request.headers);
        if (!this.evaluationExecution) throw new Error('evaluation execution unavailable');
        const campaign = await this.evaluationExecution.start(session.userId!, session.principal, evaluationStart[1]);
        return this.json(202, campaign);
      }
      const evaluationAdvance = request.path.match(/^\/api\/evaluation-campaigns\/(sha256:[0-9a-fA-F]{64})\/advance$/);
      if (request.method === 'POST' && evaluationAdvance) {
        const session = this.requireSessionRecord(request.headers);
        if (!this.evaluationExecution) throw new Error('evaluation execution unavailable');
        return this.json(202, await this.evaluationExecution.advance(session.principal, evaluationAdvance[1]));
      }
      const evaluationFee = request.path.match(/^\/api\/evaluation-campaigns\/(sha256:[0-9a-fA-F]{64})\/fee$/);
      if (request.method === 'GET' && evaluationFee) {
        const session = this.requireSession(request.headers);
        if (!this.evaluationExecution) throw new Error('evaluation execution unavailable');
        const campaign = this.service.getPublicEvaluationCampaign(evaluationFee[1] as `sha256:${string}`);
        const fee = this.evaluationExecution.getFee(evaluationFee[1]);
        if (!campaign || !fee || fee.owner.toLowerCase() !== session.toLowerCase()) return this.json(404, { error: 'not found' });
        return this.json(200, publicEvaluationFee(fee));
      }
      const evaluationTimeoutRefund = request.path.match(/^\/api\/evaluation-campaigns\/(sha256:[0-9a-fA-F]{64})\/fee\/timeout-refund$/);
      if (request.method === 'POST' && evaluationTimeoutRefund) {
        const session = this.requireManagedSession(request.headers);
        if (!this.evaluationExecution || !this.managedIdentity) throw new Error('evaluation execution unavailable');
        const fee = this.evaluationExecution.getFee(evaluationTimeoutRefund[1]);
        if (!fee || fee.owner.toLowerCase() !== session.principal.toLowerCase()) throw new Error('evaluation fee not found');
        const settlement = await this.managedIdentity.claimEvaluationTimeoutRefund(session.userId!, evaluationTimeoutRefund[1], requireString(request.body?.idempotencyKey));
        return this.json(200, publicEvaluationFee(this.evaluationExecution.recordTimeoutRefund(session.principal, evaluationTimeoutRefund[1], settlement)));
      }
      if (request.method === 'GET' && request.path === '/api/evaluation-campaigns') {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.listOwnedEvaluationCampaigns(owner));
      }
      if (request.method === 'POST' && request.path === '/api/evaluation-comparisons') {
        const owner = this.requireSession(request.headers);
        const body = request.body || {};
        return this.json(201, this.service.createVersionComparison(owner, {
          comparisonId: requireString(body.comparisonId) as `sha256:${string}`,
          agentId: requireString(body.agentId) as `sha256:${string}`,
          baselineVersionId: requireString(body.baselineVersionId) as `sha256:${string}`,
          candidateVersionId: requireString(body.candidateVersionId) as `sha256:${string}`,
          baselineCampaignIds: requireStringArray(body.baselineCampaignIds) as `sha256:${string}`[],
          candidateCampaignIds: requireStringArray(body.candidateCampaignIds) as `sha256:${string}`[],
          policy: body.policy as any,
        }));
      }
      if (request.method === 'GET' && request.path === '/api/evaluation-comparisons') {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.listOwnedVersionComparisons(owner));
      }
      const versionComparison = request.path.match(/^\/api\/evaluation-comparisons\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && versionComparison) {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.getOwnedVersionComparison(owner, versionComparison[1] as `sha256:${string}`));
      }
      const publicCampaign = request.path.match(/^\/api\/evaluation-campaigns\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && publicCampaign) {
        const campaign = this.service.getPublicEvaluationCampaign(publicCampaign[1] as `sha256:${string}`);
        return campaign ? this.json(200, campaign) : this.json(404, { error: 'not found' });
      }
      const privateEvaluationRun = request.path.match(/^\/api\/evaluation-runs\/(sha256:[0-9a-fA-F]{64})\/private$/);
      if (request.method === 'GET' && privateEvaluationRun) {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.getPrivateEvaluationRun(owner, privateEvaluationRun[1] as `sha256:${string}`));
      }
      const publicEvaluationRun = request.path.match(/^\/api\/evaluation-runs\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && publicEvaluationRun) {
        const run = this.service.getPublicEvaluationRun(publicEvaluationRun[1] as `sha256:${string}`);
        return run ? this.json(200, run) : this.json(404, { error: 'not found' });
      }
      if (request.method === 'GET' && request.path === '/api/agents') {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.listOwnedAgents(owner));
      }
      const agentMatch = request.path.match(/^\/api\/agents\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && agentMatch) {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.getAgentDetail(owner, agentMatch[1] as `sha256:${string}`));
      }
      if (request.method === 'DELETE' && agentMatch) {
        const session = this.requireSessionRecord(request.headers);
        const agentId = agentMatch[1] as `sha256:${string}`;
        const exactName = requireString(request.body?.name);
        const idempotencyKey = this.service.prepareAgentDeactivation(session.principal, agentId, exactName);
        const transaction = this.managedIdentity
          ? await this.managedIdentity.deactivateAgent(this.requireManagedSession(request.headers).userId!, agentId, idempotencyKey)
          : undefined;
        return this.json(202, this.service.deactivateAgent(session.principal, agentId, exactName, transaction));
      }
      if (request.method === 'GET' && request.path === '/api/registrations') {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.listOwnedRegistrations(owner));
      }
      if (request.method === 'POST' && request.path === '/api/agents') {
        const session = this.requireSessionRecord(request.headers);
        const body = request.body || {};
        const draft = this.service.prepareAgentCreation(session.principal, requireString(body.name), requireString(body.agentsMd));
        const transaction = this.managedIdentity
          ? await this.managedIdentity.registerAgent(this.requireManagedSession(request.headers).userId!, draft)
          : undefined;
        const created = this.service.commitAgentCreation(session.principal, draft, transaction);
        return this.json(201, created);
      }
      const registrationMatch = request.path.match(/^\/api\/tournaments\/(sha256:[0-9a-fA-F]{64})\/registrations$/);
      if (request.method === 'POST' && registrationMatch) {
        const owner = this.requireSession(request.headers);
        const agentId = requireString(request.body?.agentId);
        return this.json(200, this.service.prepareRegistration(owner, registrationMatch[1] as `sha256:${string}`, agentId as `sha256:${string}`));
      }
      return this.json(404, { error: 'not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request failed';
      const status = message === 'unauthorized' ? 401 : message.endsWith('unavailable') || message === 'managed wallet provisioning failed' ? 503 : 400;
      return this.json(status, { error: message });
    }
  }

  private challenge(body: Record<string, unknown> | undefined): ApiResponse {
    const address = requireAddress(body?.address);
    const nonce = randomBytes(24).toString('hex');
    const message = `Arena ISS sign-in\nAddress: ${address}\nNonce: ${nonce}`;
    this.challenges.set(address, { message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
    return this.json(200, { address, message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  }

  private async verify(body: Record<string, unknown> | undefined): Promise<ApiResponse> {
    const address = requireAddress(body?.address);
    const signature = requireString(body?.signature);
    const challenge = this.challenges.get(address);
    this.challenges.delete(address);
    if (!challenge || challenge.expiresAt <= Date.now()) throw new Error('unauthorized');
    if (!await this.verifySignature({ address, message: challenge.message, signature })) throw new Error('unauthorized');
    const account = this.managedIdentity ? await this.managedIdentity.loginWallet(address) : undefined;
    return this.createSession(account?.principal ?? address, account?.userId, account?.identity.kind);
  }

  private async verifyEmail(body: Record<string, unknown> | undefined): Promise<ApiResponse> {
    if (!this.managedIdentity) throw new Error('email authentication unavailable');
    const account = await this.managedIdentity.loginEmail(requireString(body?.email), requireString(body?.code));
    return this.createSession(account.principal, account.userId, account.identity.kind);
  }

  private createSession(principal: string, userId?: string, identityKind?: LoginIdentityKind): ApiResponse {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { principal, userId, identityKind, expiresAt: Date.now() + SESSION_TTL_MS });
    return { status: 204, headers: { 'set-cookie': `arena_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}` } };
  }

  private logout(headers: Headers | undefined): ApiResponse {
    const token = this.sessionToken(headers);
    if (token) this.sessions.delete(token);
    return { status: 204, headers: { 'set-cookie': 'arena_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' } };
  }

  private requireSession(headers: Headers | undefined): string {
    return this.requireSessionRecord(headers).principal;
  }

  private requireSessionRecord(headers: Headers | undefined) {
    const token = this.sessionToken(headers);
    if (!token) throw new Error('unauthorized');
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      throw new Error('unauthorized');
    }
    return session;
  }

  private requireManagedSession(headers: Headers | undefined) {
    const session = this.requireSessionRecord(headers);
    if (!this.managedIdentity || !session.userId || !session.identityKind) throw new Error('managed wallet unavailable');
    return session;
  }

  private requireOperator(headers: Headers | undefined): string {
    const principal = this.requireSession(headers);
    if (principal.toLowerCase() !== this.service.operatorAddress) throw new Error('unauthorized');
    return principal;
  }

  private sessionToken(headers: Headers | undefined): string | undefined {
    const cookie = headers?.cookie || '';
    return cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('arena_session='))?.slice(14);
  }

  private json(status: number, body: any): ApiResponse {
    return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body };
  }

  private async reconcileMarketplaceListings(): Promise<any[]> {
    if (!this.marketplaceChain) return this.service.listMarketplaceListings();
    for (const listing of this.service.listMarketplaceListings()) {
      if (listing.state === 'SUBMITTED' || listing.state === 'BUY_SUBMITTED') {
        try { this.service.publishMarketplaceListing(this.service.operatorAddress, await this.marketplaceChain.snapshot(listing.listingId)); } catch { /* pending Arc transaction remains projected */ }
      }
    }
    return this.service.listMarketplaceListings();
  }
}

function publicEvaluationFee(fee: { state: string; amountUsdc: string; escrowAddress: string; heldAt?: number; approval?: any; deposit?: any; settlement?: any; error?: string }) {
  return { state: fee.state, amountUsdc: fee.amountUsdc, escrowAddress: fee.escrowAddress, refundAvailableAt: fee.heldAt ? fee.heldAt + 86_400 : undefined, approval: fee.approval, deposit: fee.deposit, settlement: fee.settlement, error: fee.error };
}

function requireAddress(value: unknown): string {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new Error('invalid address');
  return value.toLowerCase();
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid request');
  return value;
}

function requireInteger(value: unknown): number { if (!Number.isSafeInteger(value)) throw new Error('invalid request'); return value as number; }
function requirePositiveInteger(value: unknown): number { const result = requireInteger(value); if (result < 1) throw new Error('invalid request'); return result; }
function requireBoundedString(value: unknown, minimum: number, maximum: number): string { const result = requireString(value).trim(); if (result.length < minimum || result.length > maximum) throw new Error('invalid request'); return result; }
function requireExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void { const accepted = new Set(allowed); if (Object.keys(value).some((key) => !accepted.has(key)) || allowed.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error('unsupported request field'); }
function requireDigest(value: unknown): `sha256:${string}` { if (typeof value !== 'string' || !/^sha256:[0-9a-fA-F]{64}$/.test(value)) throw new Error('invalid digest'); return value.toLowerCase() as `sha256:${string}`; }
function requireUint(value: unknown): string { if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw new Error('invalid amount'); return value; }
function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('invalid request');
  return value;
}
