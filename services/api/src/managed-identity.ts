import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_ID = /^usr_[0-9a-f]{64}$/;
const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

export type LoginIdentityKind = 'WALLET' | 'EMAIL';
export type ManagedWallet = {
  state: 'READY'; userId: string; walletId: string; address: string;
  blockchain: 'ARC-TESTNET'; accountType: 'EOA';
};
export type ManagedAccount = {
  userId: string;
  principal: string;
  identity: { kind: LoginIdentityKind };
  managedWallet: ManagedWallet;
};
export type CircleWalletPort = {
  createWallet(input: { userId: string; idempotencyKey: string }): Promise<{ walletId: string; address: string }>;
  listUsdcBalances(input: { walletId: string; address: string }): Promise<UsdcBalance[]>;
  transferUsdc(input: { walletId: string; destinationAddress: string; amount: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
  bridgeUsdcToArc(input: { walletId: string; address: string; sourceChain: string; amount: string; idempotencyKey: string }): Promise<WalletTransactionResult>;
};
export type UsdcBalance = { chain: string; label: string; amount: string; isArc: boolean; available: boolean };
export type WalletTransactionResult = { transactionId: string; state: string; txHash?: string; explorerUrl?: string };
export type EmailLoginSender = { sendLoginCode(email: string, code: string): Promise<void> };

type IdentityRecord = { identityKey: string; kind: LoginIdentityKind; userId: string; principal: string; createdAt: number };
type WalletOperation = {
  state: 'PENDING' | 'READY' | 'FAILED'; userId: string; idempotencyKey: string;
  walletId?: string; address?: string; blockchain: 'ARC-TESTNET'; accountType: 'EOA'; updatedAt: number;
};
type EmailChallenge = { digest: Buffer; expiresAt: number; attempts: number };

export type ManagedIdentityOptions = {
  runtime: SqliteRuntimeStore;
  identityPepper: string;
  circleWallets: CircleWalletPort;
  emailSender: EmailLoginSender;
  generateEmailCode?: () => string;
  now?: () => number;
};

export class ManagedIdentityService {
  private readonly runtime: SqliteRuntimeStore;
  private readonly pepper: string;
  private readonly circleWallets: CircleWalletPort;
  private readonly emailSender: EmailLoginSender;
  private readonly generateEmailCode: () => string;
  private readonly now: () => number;
  private readonly emailChallenges = new Map<string, EmailChallenge>();
  private readonly provisioning = new Map<string, Promise<ManagedWallet>>();

  constructor(options: ManagedIdentityOptions) {
    if (Buffer.byteLength(options.identityPepper || '', 'utf8') < 32) throw new Error('ARENA_IDENTITY_PEPPER is invalid');
    this.runtime = options.runtime;
    this.pepper = options.identityPepper;
    this.circleWallets = options.circleWallets;
    this.emailSender = options.emailSender;
    this.generateEmailCode = options.generateEmailCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, '0'));
    this.now = options.now ?? Date.now;
  }

  async loginWallet(address: string): Promise<ManagedAccount> {
    const normalized = requireAddress(address);
    return this.login(`wallet:${normalized}`, 'WALLET', normalized);
  }

  async requestEmailCode(value: string): Promise<void> {
    const email = requireEmail(value);
    const identityKey = this.emailIdentityKey(email);
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

  getAccount(userId: string, kind: LoginIdentityKind): ManagedAccount {
    if (!USER_ID.test(userId)) throw new Error('unauthorized');
    const identity = this.runtime.list<IdentityRecord>('auth-identities').find((record) => record.userId === userId && record.kind === kind);
    if (!identity) throw new Error('unauthorized');
    const wallet = this.readyWallet(userId);
    if (!wallet) throw new Error('managed wallet unavailable');
    return { userId, principal: identity.principal, identity: { kind }, managedWallet: wallet };
  }

  async listUsdcBalances(userId: string): Promise<UsdcBalance[]> {
    const wallet = this.requireReadyWallet(userId);
    return this.circleWallets.listUsdcBalances({ walletId: wallet.walletId, address: wallet.address });
  }

  async transferUsdc(userId: string, destinationAddress: string, amount: string): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    return this.circleWallets.transferUsdc({
      walletId: wallet.walletId,
      destinationAddress: requireAddress(destinationAddress),
      amount: requireUsdcAmount(amount),
      idempotencyKey: randomUUID(),
    });
  }

  async bridgeUsdcToArc(userId: string, sourceChain: string, amount: string): Promise<WalletTransactionResult> {
    const wallet = this.requireReadyWallet(userId);
    return this.circleWallets.bridgeUsdcToArc({
      walletId: wallet.walletId,
      address: wallet.address,
      sourceChain: requireIdentifier(sourceChain, 'source chain'),
      amount: requireUsdcAmount(amount),
      idempotencyKey: randomUUID(),
    });
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
    const pending: WalletOperation = existing ?? {
      state: 'PENDING', userId, idempotencyKey: randomUUID(), blockchain: 'ARC-TESTNET', accountType: 'EOA', updatedAt: this.now(),
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
    if (!record || record.state !== 'READY' || !record.walletId || !record.address) return undefined;
    return record as ManagedWallet;
  }

  private requireReadyWallet(userId: string): ManagedWallet {
    const wallet = this.readyWallet(userId);
    if (!wallet) throw new Error('managed wallet unavailable');
    return wallet;
  }

  private emailIdentityKey(email: string): string {
    return `email:${createHmac('sha256', this.pepper).update(email).digest('hex')}`;
  }

  private codeDigest(identityKey: string, code: string): Buffer {
    return createHmac('sha256', this.pepper).update(`${identityKey}|${code}`).digest();
  }
}

function requireUsdcAmount(value: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new Error('invalid USDC amount');
  const [whole, fraction = ''] = value.split('.');
  const baseUnits = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0');
  if (baseUnits <= 0n || baseUnits > 1_000_000_000_000n) throw new Error('invalid USDC amount');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
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
