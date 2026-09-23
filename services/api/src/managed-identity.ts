import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_ID = /^usr_[0-9a-f]{64}$/;
const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_ENTRIES = 10_000;

export type LoginIdentityKind = 'WALLET' | 'EMAIL';
export type ManagedWallet = {
  state: 'READY'; userId: string; walletId: string; address: string;
  blockchain: 'ARC-TESTNET'; accountType: 'SCA';
};
export type ManagedAccount = {
  userId: string;
  principal: string;
  identity: { kind: LoginIdentityKind };
  managedWallet: ManagedWallet;
};
export type CctpTransferState = 'PENDING' | 'APPROVING' | 'BURNING' | 'SUBMITTED' | 'FAILED' | 'RECOVERY_REQUIRED';
export type CctpTransferOperation = {
  operationId: string;
  state: CctpTransferState;
  sourceChain: string;
  amount: string;
  transactionId?: string;
  txHash?: string;
  explorerUrl?: string;
  message?: string;
  updatedAt: number;
};
export type UsdcTransferState = 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'RECOVERY_REQUIRED';
export type UsdcTransferOperation = {
  operationId: string; state: UsdcTransferState; destinationAddress: string; amount: string;
  transactionId?: string; txHash?: string; explorerUrl?: string; message?: string; updatedAt: number;
};
export type CircleWalletPort = {
  createWallet(input: { userId: string; idempotencyKey: string }): Promise<{ walletId: string; address: string }>;
  listUsdcBalances(input: { walletId: string; address: string }): Promise<UsdcBalance[]>;
  transferUsdc(input: { walletId: string; destinationAddress: string; amount: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  getTransfer(transactionId: string): Promise<WalletTransactionResult>;
  holdEvaluationFee(input: { walletId: string; escrowAddress: string; campaignId: string; amountUsdc: string; approvalIdempotencyKey: string; depositIdempotencyKey: string }): Promise<{ approval: WalletTransactionResult; deposit: WalletTransactionResult }>;
  claimEvaluationTimeoutRefund(input: { walletId: string; escrowAddress: string; campaignId: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  bridgeUsdcToArc(input: { walletId: string; address: string; sourceChain: string; amount: string; approvalIdempotencyKey: string; burnIdempotencyKey: string; onProgress?: (state: Extract<CctpTransferState, 'APPROVING' | 'BURNING'>) => void }): Promise<WalletTransactionResult>;
  registerAgent(input: { walletId: string; registryAddress: string; agentId: string; agentsVersion: string; agentsCommitment: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  registerErc8004Agent?(input: { walletId: string; registryAddress: string; agentUri: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  giveErc8004Feedback?(input: { walletId: string; registryAddress: string; agentId: string; value: number; valueDecimals: number; tag1: string; tag2: string; endpoint: string; feedbackUri: string; feedbackHash: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  deactivateAgent(input: { walletId: string; registryAddress: string; agentId: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  withdrawTournamentCredit(input: { walletId: string; escrowAddress: string; tournamentId: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  claimTournamentRefund(input: { walletId: string; escrowAddress: string; tournamentId: string; entrantId: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  registerTournamentEntrant(input: { walletId: string; escrowAddress: string; stakeAmount: string; tournamentId: string; entrantId: string; agentId: string; agentsVersion: string; agentsCommitment: string; approvalIdempotencyKey: string; registrationIdempotencyKey: string }): Promise<WalletTransactionResult>;
  marketplaceCreateListing(input: { walletId: string; marketplaceAddress: string; agentId: string; version: string; commitment: string; certificateDigest: string; price: string; expiresAt: number; idempotencyKey: string }): Promise<WalletTransactionResult>;
  marketplaceCancel(input: { walletId: string; marketplaceAddress: string; listingId: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  marketplaceBuy(input: { walletId: string; marketplaceAddress: string; listingId: string; price: string; approvalIdempotencyKey: string; buyIdempotencyKey: string }): Promise<WalletTransactionResult>;
  marketplaceWithdraw(input: { walletId: string; marketplaceAddress: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  pairCreate(input: { walletId: string; escrowAddress: string; roomId: string; version: string; stake: string; joinDeadline: number; resolutionDeadline: number; approvalKey: string; executionKey: string }): Promise<WalletTransactionResult>;
  pairJoin(input: { walletId: string; escrowAddress: string; roomId: string; version: string; stake: string; approvalKey: string; executionKey: string }): Promise<WalletTransactionResult>;
  pairAction(input: { walletId: string; escrowAddress: string; roomId: string; kind: 'CANCEL' | 'REQUEST_CANCEL' | 'EXPIRE' | 'WITHDRAW'; executionKey: string }): Promise<WalletTransactionResult>;
};
export type UsdcBalance = { chain: string; label: string; amount: string; isArc: boolean; available: boolean };
export type WalletTransactionResult = { transactionId: string; state: string; txHash?: string; explorerUrl?: string };
export type EmailLoginSender = { sendLoginCode(email: string, code: string): Promise<void> };

type IdentityRecord = { identityKey: string; kind: LoginIdentityKind; userId: string; principal: string; createdAt: number };
type WalletOperation = {
  state: 'PENDING' | 'READY' | 'FAILED'; userId: string; idempotencyKey: string;
  walletId?: string; address?: string; blockchain: 'ARC-TESTNET'; accountType: 'EOA' | 'SCA'; updatedAt: number;
};
type CctpTransferRecord = CctpTransferOperation & {
  userId: string;
  walletId: string;
  address: string;
  approvalIdempotencyKey?: string;
  burnIdempotencyKey?: string;
  idempotencyKey?: string;
};
type UsdcTransferRecord = UsdcTransferOperation & { userId: string; walletId: string; idempotencyKey: string };
type EmailChallenge = { digest: Buffer; expiresAt: number; attempts: number };

export type ManagedIdentityOptions = {
  runtime: SqliteRuntimeStore;
  identityPepper: string;
  circleWallets: CircleWalletPort;
  emailSender: EmailLoginSender;
  generateEmailCode?: () => string;
  now?: () => number;
  agentRegistryAddress?: string;
  marketplaceAddress?: string;
  evaluationEscrowAddress?: string;
  tournamentEscrowAddress?: string;
  pairEscrowAddress?: string;
};

export class ManagedIdentityService {
  private readonly runtime: SqliteRuntimeStore;
  private readonly pepper: string;
  private readonly circleWallets: CircleWalletPort;
  private readonly emailSender: EmailLoginSender;
  private readonly generateEmailCode: () => string;
  private readonly now: () => number;
  private readonly agentRegistryAddress?: string;
  private readonly marketplaceAddress?: string;
  private readonly evaluationEscrowAddress?: string;
  private readonly tournamentEscrowAddress?: string;
  private readonly pairEscrowAddress?: string;
  private readonly emailChallenges = new Map<string, EmailChallenge>();
  private readonly provisioning = new Map<string, Promise<ManagedWallet>>();
  private readonly cctpTransfers = new Map<string, Promise<void>>();
  private readonly usdcTransfers = new Map<string, Promise<void>>();

  constructor(options: ManagedIdentityOptions) {
    if (Buffer.byteLength(options.identityPepper || '', 'utf8') < 32) throw new Error('ARENA_IDENTITY_PEPPER is invalid');
    this.runtime = options.runtime;
    this.pepper = options.identityPepper;
    this.circleWallets = options.circleWallets;
    this.emailSender = options.emailSender;
    this.generateEmailCode = options.generateEmailCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, '0'));
    this.now = options.now ?? Date.now;
    this.agentRegistryAddress = options.agentRegistryAddress ? requireAddress(options.agentRegistryAddress) : undefined;
    this.marketplaceAddress = options.marketplaceAddress ? requireAddress(options.marketplaceAddress) : undefined;
    this.evaluationEscrowAddress = options.evaluationEscrowAddress ? requireAddress(options.evaluationEscrowAddress) : undefined;
    this.tournamentEscrowAddress = options.tournamentEscrowAddress ? requireAddress(options.tournamentEscrowAddress) : undefined;
    this.pairEscrowAddress = options.pairEscrowAddress ? requireAddress(options.pairEscrowAddress) : undefined;
  }

  async loginWallet(address: string): Promise<ManagedAccount> {
    const normalized = requireAddress(address);
    return this.login(`wallet:${normalized}`, 'WALLET', normalized);
  }

  async requestEmailCode(value: string): Promise<void> {
    this.pruneEmailChallenges();
    const email = requireEmail(value);
    const identityKey = this.emailIdentityKey(email);
    if (!this.emailChallenges.has(identityKey) && this.emailChallenges.size >= OTP_MAX_ENTRIES) throw new Error('email authentication capacity reached');
    const code = this.generateEmailCode();
    if (!/^\d{6}$/.test(code)) throw new Error('email code generator is invalid');
    this.emailChallenges.set(identityKey, {
      digest: this.codeDigest(identityKey, code), expiresAt: this.now() + OTP_TTL_MS, attempts: 0,
    });
    try {
      await this.emailSender.sendLoginCode(email, code);
    } catch (error) {
      this.emailChallenges.delete(identityKey);
      throw error;
    }
  }

  async loginEmail(value: string, code: string): Promise<ManagedAccount> {
    this.pruneEmailChallenges();
    const email = requireEmail(value);
    const identityKey = this.emailIdentityKey(email);
    const challenge = this.emailChallenges.get(identityKey);
    if (!challenge || challenge.expiresAt <= this.now() || challenge.attempts >= OTP_MAX_ATTEMPTS || !/^\d{6}$/.test(code)) {
      this.emailChallenges.delete(identityKey);
      throw new Error('unauthorized');
    }
    challenge.attempts += 1;
    const candidate = this.codeDigest(identityKey, code);
    if (!timingSafeEqual(challenge.digest, candidate)) {
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) this.emailChallenges.delete(identityKey);
      throw new Error('unauthorized');
    }
    this.emailChallenges.delete(identityKey);
    const principal = `usr_${createHash('sha256').update(identityKey).digest('hex')}`;
    return this.login(identityKey, 'EMAIL', principal);
  }

  private pruneEmailChallenges(): void {
    const now = this.now();
    for (const [key, value] of this.emailChallenges) if (value.expiresAt <= now) this.emailChallenges.delete(key);
  }

  async getAccount(userId: string, kind: LoginIdentityKind): Promise<ManagedAccount> {
    if (!USER_ID.test(userId)) throw new Error('unauthorized');
    const identity = this.runtime.list<IdentityRecord>('auth-identities').find((record) => record.userId === userId && record.kind === kind);
    if (!identity) throw new Error('unauthorized');
    const wallet = await this.ensureWallet(userId);
    return { userId, principal: identity.principal, identity: { kind }, managedWallet: wallet };
  }

  async listUsdcBalances(userId: string): Promise<UsdcBalance[]> {
    const wallet = this.requireReadyWallet(userId);
    return this.circleWallets.listUsdcBalances({ walletId: wallet.walletId, address: wallet.address });
  }

  async startUsdcTransfer(userId: string, destinationAddress: string, amount: string): Promise<UsdcTransferOperation> {
    const wallet = this.requireReadyWallet(userId);
    const destination = requireAddress(destinationAddress);
    const normalizedAmount = requireUsdcAmount(amount);
    const operation = this.runtime.transaction(() => {
      const activeId = this.runtime.get<string>('circle-usdc-active', userId);
      const active = activeId ? this.runtime.get<UsdcTransferRecord>('circle-usdc-transfers', activeId) : undefined;
      if (active && !['CONFIRMED', 'FAILED'].includes(active.state)) return active;
      if (activeId) this.runtime.delete('circle-usdc-active', userId);
      const created: UsdcTransferRecord = { operationId: randomUUID(), state: 'PENDING', userId,
        walletId: wallet.walletId, destinationAddress: destination, amount: normalizedAmount,
        idempotencyKey: randomUUID(), updatedAt: this.now() };
      this.runtime.put('circle-usdc-transfers', created.operationId, created);
      this.runtime.put('circle-usdc-active', userId, created.operationId);
      return created;
    });
    if (operation.destinationAddress !== destination || operation.amount !== normalizedAmount) throw new Error('unresolved USDC transfer must be reconciled first');
    if (operation.state === 'PENDING') await this.runUsdcTransfer(operation.operationId);
    return this.publicUsdcTransfer(this.runtime.get<UsdcTransferRecord>('circle-usdc-transfers', operation.operationId)!);
  }

  async getUsdcTransfer(userId: string, operationId: string): Promise<UsdcTransferOperation> {
    const operation = this.runtime.get<UsdcTransferRecord>('circle-usdc-transfers', requireIdentifier(operationId, 'operation ID'));
    if (!operation || operation.userId !== userId) throw new Error('USDC transfer not found');
    if (operation.state === 'SUBMITTED' && operation.transactionId) {
      try {
        const current = await this.circleWallets.getTransfer(operation.transactionId);
        if (current.transactionId !== operation.transactionId || (operation.txHash && current.txHash && operation.txHash.toLowerCase() !== current.txHash.toLowerCase())) {
          this.updateUsdcTransfer(operation.operationId, { state: 'RECOVERY_REQUIRED', message: 'Transfer reference mismatch. Reconcile the Circle and Arc transaction before another withdrawal.' });
        } else if (current.state === 'COMPLETE' && current.txHash) {
          this.updateUsdcTransfer(operation.operationId, { state: 'CONFIRMED', txHash: current.txHash, explorerUrl: current.explorerUrl });
        } else if (['FAILED', 'DENIED', 'CANCELLED'].includes(current.state)) {
          this.updateUsdcTransfer(operation.operationId, { state: 'FAILED', message: 'Circle reports that the transfer did not complete.' });
        } else {
          this.updateUsdcTransfer(operation.operationId, { txHash: current.txHash ?? operation.txHash, explorerUrl: current.explorerUrl ?? operation.explorerUrl });
        }
      } catch { /* Keep the submitted transaction visible; a read failure must not trigger another send. */ }
    }
    return this.publicUsdcTransfer(this.runtime.get<UsdcTransferRecord>('circle-usdc-transfers', operation.operationId)!);
  }

  listUsdcTransfers(userId: string): UsdcTransferOperation[] {
    return this.runtime.list<UsdcTransferRecord>('circle-usdc-transfers')
      .filter((operation) => operation.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt || b.operationId.localeCompare(a.operationId))
      .slice(0, 20).map((operation) => this.publicUsdcTransfer(operation));
  }

  async resumeUsdcTransfers(): Promise<void> {
    await Promise.all(this.runtime.list<UsdcTransferRecord>('circle-usdc-transfers')
      .filter((operation) => operation.state === 'PENDING').map((operation) => this.runUsdcTransfer(operation.operationId)));
  }

  private runUsdcTransfer(operationId: string): Promise<void> {
    const active = this.usdcTransfers.get(operationId);
    if (active) return active;
    const run = this.performUsdcTransfer(operationId).finally(() => {
      if (this.usdcTransfers.get(operationId) === run) this.usdcTransfers.delete(operationId);
    });
    this.usdcTransfers.set(operationId, run);
    return run;
  }

  private async performUsdcTransfer(operationId: string): Promise<void> {
    const operation = this.runtime.get<UsdcTransferRecord>('circle-usdc-transfers', operationId);
    if (!operation || operation.state !== 'PENDING') return;
    try {
      const result = await this.circleWallets.transferUsdc({ walletId: operation.walletId,
        destinationAddress: operation.destinationAddress, amount: operation.amount, idempotencyKey: operation.idempotencyKey });
      if (!result.transactionId) throw new Error('Circle transfer reference missing');
      this.updateUsdcTransfer(operationId, { state: 'SUBMITTED', transactionId: result.transactionId,
        txHash: result.txHash, explorerUrl: result.explorerUrl });
    } catch {
      this.updateUsdcTransfer(operationId, { state: 'RECOVERY_REQUIRED', message: 'Transfer outcome is uncertain. Reconcile the Circle and Arc transaction before another withdrawal.' });
    }
  }

  private updateUsdcTransfer(operationId: string, patch: Partial<UsdcTransferRecord>): void {
    this.runtime.transaction(() => {
      const current = this.runtime.get<UsdcTransferRecord>('circle-usdc-transfers', operationId);
      if (!current || ['CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED'].includes(current.state)) return;
      const next = { ...current, ...patch, updatedAt: this.now() };
      this.runtime.put('circle-usdc-transfers', operationId, next);
      if (['CONFIRMED', 'FAILED'].includes(next.state) && this.runtime.get<string>('circle-usdc-active', current.userId) === operationId) this.runtime.delete('circle-usdc-active', current.userId);
    });
  }

  private publicUsdcTransfer(operation: UsdcTransferRecord): UsdcTransferOperation {
    const { operationId, state, destinationAddress, amount, transactionId, txHash, explorerUrl, message, updatedAt } = operation;
    return { operationId, state, destinationAddress, amount, transactionId, txHash, explorerUrl, message, updatedAt };
  }

  async holdEvaluationFee(input: { userId: string; campaignId: string; amountUsdc: string; approvalIdempotencyKey: string; depositIdempotencyKey: string }): Promise<{ approval: WalletTransactionResult; deposit: WalletTransactionResult }> {
    const wallet = this.requireReadyWallet(input.userId);
    if (!this.evaluationEscrowAddress) throw new Error('evaluation fee escrow unavailable');
    const { userId: _userId, ...fee } = input;
    return this.circleWallets.holdEvaluationFee({ walletId: wallet.walletId, escrowAddress: this.evaluationEscrowAddress, ...fee });
  }

  async claimEvaluationTimeoutRefund(userId: string, campaignId: string, idempotencyKey: string): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    if (!this.evaluationEscrowAddress) throw new Error('evaluation fee escrow unavailable');
    return this.circleWallets.claimEvaluationTimeoutRefund({ walletId: wallet.walletId, escrowAddress: this.evaluationEscrowAddress, campaignId, idempotencyKey });
  }

  async startBridgeUsdcToArc(userId: string, sourceChain: string, amount: string): Promise<CctpTransferOperation> {
    const wallet = this.requireReadyWallet(userId);
    const normalizedSource = requireIdentifier(sourceChain, 'source chain');
    const normalizedAmount = requireUsdcAmount(amount);
    await this.requireSourceBalance(wallet, normalizedSource, normalizedAmount);
    const operation: CctpTransferRecord = {
      operationId: randomUUID(),
      state: 'PENDING',
      userId,
      walletId: wallet.walletId,
      address: wallet.address,
      sourceChain: normalizedSource,
      amount: normalizedAmount,
      approvalIdempotencyKey: randomUUID(),
      burnIdempotencyKey: randomUUID(),
      updatedAt: this.now(),
    };
    this.runtime.put('circle-cctp-transfers', operation.operationId, operation);
    void this.runCctpTransfer(operation.operationId).catch(() => undefined);
    return this.publicCctpOperation(operation);
  }

  getCctpTransfer(userId: string, operationId: string): CctpTransferOperation {
    const operation = this.runtime.get<CctpTransferRecord>('circle-cctp-transfers', requireIdentifier(operationId, 'operation ID'));
    if (!operation || operation.userId !== userId) throw new Error('CCTP transfer not found');
    return this.publicCctpOperation(operation);
  }

  listCctpTransfers(userId: string): CctpTransferOperation[] {
    return this.runtime.list<CctpTransferRecord>('circle-cctp-transfers')
      .filter((operation) => operation.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt || b.operationId.localeCompare(a.operationId))
      .slice(0, 20)
      .map((operation) => this.publicCctpOperation(operation));
  }

  async resumeCctpTransfers(): Promise<void> {
    const resumable = this.runtime.list<CctpTransferRecord>('circle-cctp-transfers')
      .filter((operation) => ['PENDING', 'APPROVING', 'BURNING'].includes(operation.state));
    await Promise.all(resumable.map((operation) => this.runCctpTransfer(operation.operationId)));
  }

  async registerAgent(userId: string, input: { agentId: string; agentsVersion: string; agentsCommitment: string; idempotencyKey: string }): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    if (!this.agentRegistryAddress) throw new Error('agent registry unavailable');
    return this.circleWallets.registerAgent({ walletId: wallet.walletId, registryAddress: this.agentRegistryAddress, ...input });
  }

  async registerErc8004Agent(userId: string, input: { registryAddress: string; agentUri: string; idempotencyKey: string }): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    if (!this.circleWallets.registerErc8004Agent) throw new Error('ERC-8004 identity unavailable');
    return this.circleWallets.registerErc8004Agent({ walletId: wallet.walletId, ...input });
  }

  async giveErc8004Feedback(evaluatorWalletId: string, input: { registryAddress: string; agentId: string; value: number; valueDecimals: number; tag1: string; tag2: string; endpoint: string; feedbackUri: string; feedbackHash: string; idempotencyKey: string }): Promise<WalletTransactionResult> {
    if (!this.circleWallets.giveErc8004Feedback) throw new Error('ERC-8004 reputation unavailable');
    return this.circleWallets.giveErc8004Feedback({ walletId: requireIdentifier(evaluatorWalletId, 'ERC-8004 evaluator wallet ID'), ...input });
  }

  async deactivateAgent(userId: string, agentId: string, idempotencyKey: string): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    if (!this.agentRegistryAddress) throw new Error('agent registry unavailable');
    return this.circleWallets.deactivateAgent({ walletId: wallet.walletId, registryAddress: this.agentRegistryAddress, agentId, idempotencyKey });
  }

  async withdrawTournamentCredit(userId: string, tournamentId: string, idempotencyKey: string): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    if (!this.tournamentEscrowAddress) throw new Error('tournament escrow unavailable');
    return this.circleWallets.withdrawTournamentCredit({ walletId: wallet.walletId, escrowAddress: this.tournamentEscrowAddress, tournamentId, idempotencyKey });
  }

  async claimTournamentRefund(userId: string, tournamentId: string, entrantId: string, idempotencyKey: string): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    if (!this.tournamentEscrowAddress) throw new Error('tournament escrow unavailable');
    return this.circleWallets.claimTournamentRefund({ walletId: wallet.walletId, escrowAddress: this.tournamentEscrowAddress, tournamentId, entrantId, idempotencyKey });
  }

  async registerTournamentEntrant(userId: string, input: { stakeAmount: string; tournamentId: string; entrantId: string; agentId: string; agentsVersion: string; agentsCommitment: string }): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    if (!this.tournamentEscrowAddress) throw new Error('tournament escrow unavailable');
    const operationKey = `${userId}|${input.tournamentId}|${input.entrantId}`;
    this.runtime.putIfAbsent('circle-tournament-registrations', operationKey, { approvalIdempotencyKey: randomUUID(), registrationIdempotencyKey: randomUUID() });
    const keys = this.runtime.get<{ approvalIdempotencyKey: string; registrationIdempotencyKey: string }>('circle-tournament-registrations', operationKey)!;
    return this.circleWallets.registerTournamentEntrant({ walletId: wallet.walletId, escrowAddress: this.tournamentEscrowAddress, ...input, ...keys });
  }

  async marketplaceCreateListing(userId: string, input: { agentId: string; version: string; commitment: string; certificateDigest: string; price: string; expiresAt: number; idempotencyKey: string }): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId); if (!this.marketplaceAddress) throw new Error('marketplace unavailable');
    return this.circleWallets.marketplaceCreateListing({ walletId: wallet.walletId, marketplaceAddress: this.marketplaceAddress, ...input });
  }

  async marketplaceBuy(userId: string, listingId: string, price: string, approvalIdempotencyKey: string, buyIdempotencyKey: string): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId); if (!this.marketplaceAddress) throw new Error('marketplace unavailable');
    return this.circleWallets.marketplaceBuy({ walletId: wallet.walletId, marketplaceAddress: this.marketplaceAddress, listingId, price, approvalIdempotencyKey, buyIdempotencyKey });
  }

  async marketplaceCancel(userId: string, listingId: string, idempotencyKey: string): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId); if (!this.marketplaceAddress) throw new Error('marketplace unavailable');
    return this.circleWallets.marketplaceCancel({ walletId: wallet.walletId, marketplaceAddress: this.marketplaceAddress, listingId, idempotencyKey });
  }

  async marketplaceWithdraw(userId: string, idempotencyKey: string): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId); if (!this.marketplaceAddress) throw new Error('marketplace unavailable');
    return this.circleWallets.marketplaceWithdraw({ walletId: wallet.walletId, marketplaceAddress: this.marketplaceAddress, idempotencyKey });
  }

  pairAccount(userId: string): { address: string } {
    return { address: this.requireReadyWallet(userId).address };
  }

  async pairCreate(userId: string, input: { escrowAddress: string; roomId: string; version: string; stake: string; joinDeadline: number; resolutionDeadline: number; approvalKey: string; executionKey: string }): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    if (!this.pairEscrowAddress || input.escrowAddress.toLowerCase() !== this.pairEscrowAddress) throw new Error('pair escrow unavailable');
    return this.circleWallets.pairCreate({ walletId: wallet.walletId, ...input });
  }

  async pairJoin(userId: string, input: { escrowAddress: string; roomId: string; version: string; stake: string; approvalKey: string; executionKey: string }): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    if (!this.pairEscrowAddress || input.escrowAddress.toLowerCase() !== this.pairEscrowAddress) throw new Error('pair escrow unavailable');
    return this.circleWallets.pairJoin({ walletId: wallet.walletId, ...input });
  }

  async pairAction(userId: string, input: { escrowAddress: string; roomId: string; kind: 'CANCEL' | 'REQUEST_CANCEL' | 'EXPIRE' | 'WITHDRAW'; executionKey: string }): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    if (!this.pairEscrowAddress || input.escrowAddress.toLowerCase() !== this.pairEscrowAddress) throw new Error('pair escrow unavailable');
    return this.circleWallets.pairAction({ walletId: wallet.walletId, ...input });
  }

  async pairActionForPrincipal(principal: string, input: { escrowAddress: string; roomId: string; kind: 'REQUEST_CANCEL' | 'WITHDRAW'; executionKey: string }): Promise<WalletTransactionResult> {
    const identity = this.runtime.list<IdentityRecord>('auth-identities').find((record) => record.principal === principal);
    if (!identity) throw new Error('pair participant identity is unavailable');
    return this.pairAction(identity.userId, input);
  }

  private async login(identityKey: string, kind: LoginIdentityKind, principal: string): Promise<ManagedAccount> {
    let identity = this.runtime.get<IdentityRecord>('auth-identities', identityKey);
    if (!identity) {
      const userId = `usr_${createHash('sha256').update(`arena-user-v1|${identityKey}`).digest('hex')}`;
      identity = { identityKey, kind, userId, principal, createdAt: this.now() };
      this.runtime.putIfAbsent('auth-identities', identityKey, identity);
      identity = this.runtime.get<IdentityRecord>('auth-identities', identityKey)!;
    }
    const managedWallet = await this.ensureWallet(identity.userId);
    return { userId: identity.userId, principal: identity.principal, identity: { kind: identity.kind }, managedWallet };
  }

  private ensureWallet(userId: string): Promise<ManagedWallet> {
    const ready = this.readyWallet(userId);
    if (ready) return Promise.resolve(ready);
    const active = this.provisioning.get(userId);
    if (active) return active;
    const operation = this.provisionWallet(userId).finally(() => this.provisioning.delete(userId));
    this.provisioning.set(userId, operation);
    return operation;
  }

  private async provisionWallet(userId: string): Promise<ManagedWallet> {
    const existing = this.runtime.get<WalletOperation>('circle-wallets', userId);
    if (existing?.accountType === 'EOA') {
      this.runtime.putIfAbsent('circle-wallets-legacy', userId, existing);
    }
    const pending: WalletOperation = (existing?.accountType === 'SCA' ? existing : undefined) ?? {
      state: 'PENDING', userId, idempotencyKey: randomUUID(), blockchain: 'ARC-TESTNET', accountType: 'SCA', updatedAt: this.now(),
    };
    pending.state = 'PENDING';
    pending.updatedAt = this.now();
    this.runtime.put('circle-wallets', userId, pending);
    try {
      const created = await this.circleWallets.createWallet({ userId, idempotencyKey: pending.idempotencyKey });
      const walletId = requireIdentifier(created.walletId, 'Circle wallet ID');
      const address = requireAddress(created.address);
      const ready: WalletOperation = { ...pending, state: 'READY', walletId, address, updatedAt: this.now() };
      this.runtime.put('circle-wallets', userId, ready);
      return ready as ManagedWallet;
    } catch (error) {
      this.runtime.put('circle-wallets', userId, { ...pending, state: 'FAILED', updatedAt: this.now() });
      throw new Error('managed wallet provisioning failed', { cause: error });
    }
  }

  private readyWallet(userId: string): ManagedWallet | undefined {
    const record = this.runtime.get<WalletOperation>('circle-wallets', userId);
    if (!record || record.accountType !== 'SCA' || record.state !== 'READY' || !record.walletId || !record.address) return undefined;
    return record as ManagedWallet;
  }

  private requireReadyWallet(userId: string): ManagedWallet {
    const wallet = this.readyWallet(userId);
    if (!wallet) throw new Error('managed wallet unavailable');
    return wallet;
  }

  private async requireSourceBalance(wallet: ManagedWallet, sourceChain: string, amount: string): Promise<void> {
    const balances = await this.circleWallets.listUsdcBalances({ walletId: wallet.walletId, address: wallet.address });
    const source = balances.find((row) => row.chain === sourceChain);
    if (!source?.available) throw new Error('source chain has no available USDC');
    if (BigInt(decimalToBaseUnits(source.amount)) < BigInt(decimalToBaseUnits(amount))) throw new Error('source chain USDC balance is insufficient');
  }

  private updateCctpTransfer(operationId: string, patch: Partial<CctpTransferRecord>): CctpTransferRecord | undefined {
    const current = this.runtime.get<CctpTransferRecord>('circle-cctp-transfers', operationId);
    if (!current || ['SUBMITTED', 'FAILED', 'RECOVERY_REQUIRED'].includes(current.state)) return current;
    const state = patch.state && cctpStateRank(patch.state) < cctpStateRank(current.state) ? current.state : patch.state;
    const next = { ...current, ...patch, ...(state ? { state } : {}), updatedAt: this.now() };
    this.runtime.put('circle-cctp-transfers', operationId, next);
    return next;
  }

  private runCctpTransfer(operationId: string): Promise<void> {
    const active = this.cctpTransfers.get(operationId);
    if (active) return active;
    const run = this.performCctpTransfer(operationId).finally(() => {
      if (this.cctpTransfers.get(operationId) === run) this.cctpTransfers.delete(operationId);
    });
    this.cctpTransfers.set(operationId, run);
    return run;
  }

  private async performCctpTransfer(operationId: string): Promise<void> {
    let operation = this.runtime.get<CctpTransferRecord>('circle-cctp-transfers', operationId);
    if (!operation || !['PENDING', 'APPROVING', 'BURNING'].includes(operation.state)) return;
    const approvalIdempotencyKey = operation.approvalIdempotencyKey ?? operation.idempotencyKey;
    if (!approvalIdempotencyKey) {
      this.updateCctpTransfer(operationId, { state: 'RECOVERY_REQUIRED', message: 'CCTP approval identity is unavailable.' });
      return;
    }
    if (!operation.burnIdempotencyKey && operation.state === 'BURNING') {
      this.updateCctpTransfer(operationId, { state: 'RECOVERY_REQUIRED', message: 'Legacy CCTP burn requires manual reconciliation.' });
      return;
    }
    const burnIdempotencyKey = operation.burnIdempotencyKey ?? randomUUID();
    operation = this.updateCctpTransfer(operationId, { approvalIdempotencyKey, burnIdempotencyKey }) ?? operation;
    try {
      const result = await this.circleWallets.bridgeUsdcToArc({
        walletId: operation.walletId,
        address: operation.address,
        sourceChain: operation.sourceChain,
        amount: operation.amount,
        approvalIdempotencyKey,
        burnIdempotencyKey,
        onProgress: (state) => this.updateCctpTransfer(operationId, { state }),
      });
      this.updateCctpTransfer(operationId, { ...result, state: 'SUBMITTED' });
    } catch {
      this.updateCctpTransfer(operationId, {
        state: 'RECOVERY_REQUIRED',
        message: 'CCTP transfer failed. Check the source transaction and try again only after reconciliation.',
      });
    }
  }

  private publicCctpOperation(operation: CctpTransferRecord): CctpTransferOperation {
    const { operationId, state, sourceChain, amount, transactionId, txHash, explorerUrl, message, updatedAt } = operation;
    return { operationId, state, sourceChain, amount, transactionId, txHash, explorerUrl, message, updatedAt };
  }

  private emailIdentityKey(email: string): string {
    return `email:${createHmac('sha256', this.pepper).update(email).digest('hex')}`;
  }

  private codeDigest(identityKey: string, code: string): Buffer {
    return createHmac('sha256', this.pepper).update(`${identityKey}|${code}`).digest();
  }
}

function cctpStateRank(state: CctpTransferState): number {
  return ({ PENDING: 0, APPROVING: 1, BURNING: 2, SUBMITTED: 3, FAILED: 3, RECOVERY_REQUIRED: 3 })[state];
}

function requireUsdcAmount(value: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new Error('invalid USDC amount');
  const [whole, fraction = ''] = value.split('.');
  const baseUnits = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0');
  if (baseUnits <= 0n || baseUnits > 1_000_000_000_000n) throw new Error('invalid USDC amount');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function decimalToBaseUnits(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0')).toString();
}

function requireAddress(value: string): string {
  if (!ADDRESS.test(value)) throw new Error('invalid address');
  return value.toLowerCase();
}

function requireEmail(value: string): string {
  if (typeof value !== 'string') throw new Error('invalid email');
  const normalized = value.trim().toLowerCase();
  if (!EMAIL.test(normalized) || Buffer.byteLength(normalized, 'utf8') > 254) throw new Error('invalid email');
  return normalized;
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 160 || /[\u0000-\u001f]/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}
