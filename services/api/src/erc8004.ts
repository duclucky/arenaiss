import { randomUUID } from 'node:crypto';
import { createPublicClient, decodeEventLog, keccak256, parseAbi, toBytes, type Address, type Hash } from 'viem';
import { arcTestnet } from 'viem/chains';
import type { AgentDraft } from './service.ts';
import type { LoginIdentityKind, ManagedIdentityService } from './managed-identity.ts';
import { arcReadTransport } from './arc-rpc.ts';
import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { SoloCampaignRecord } from '../../../packages/evaluation/src/solo-runner.ts';
import type { WalletTransactionResult } from './managed-identity.ts';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REGISTERED_ABI = parseAbi([
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
]);
const IDENTITY_ABI = parseAbi([
  'function ownerOf(uint256 agentId) view returns (address)',
  'function tokenURI(uint256 agentId) view returns (string)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
]);
const REPUTATION_ABI = parseAbi([
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)',
]);

export const ARC_TESTNET_ERC8004_IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
export const ARC_TESTNET_ERC8004_REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713';

export type Erc8004IdentityBinding = {
  schema: 'arena-erc8004-identity-v1';
  network: 'Arc Testnet';
  chainId: 5_042_002;
  registryAddress: string;
  tokenId: string;
  ownerAddress: string;
  agentUri: string;
  transaction: { transactionId: string; state: string; txHash?: string; explorerUrl?: string };
};

export type Erc8004IdentityCoordinator = {
  applicationUrl: string;
  register(input: { userId: string; identityKind: 'WALLET' | 'EMAIL'; draft: AgentDraft }): Promise<{
    transaction: Erc8004IdentityBinding['transaction'];
    binding: Erc8004IdentityBinding;
  }>;
};

export type Erc8004CanonicalIdentity = { tokenId: string; ownerAddress: string; agentUri: string; agentWallet: string };
export interface Erc8004ReadPort {
  confirmRegistration(input: { txHash: string; ownerAddress: string; agentUri: string }): Promise<Erc8004CanonicalIdentity>;
}

export class ViemErc8004ReadPort implements Erc8004ReadPort {
  private readonly registryAddress: Address;
  private readonly client;

  constructor(input: { rpcUrl: string; registryAddress: string }) {
    if (!ADDRESS.test(input.registryAddress) || new URL(input.rpcUrl).protocol !== 'https:') throw new Error('invalid ERC-8004 Arc configuration');
    this.registryAddress = input.registryAddress as Address;
    this.client = createPublicClient({ chain: arcTestnet, transport: arcReadTransport(input.rpcUrl) });
  }

  async confirmRegistration(input: { txHash: string; ownerAddress: string; agentUri: string }): Promise<Erc8004CanonicalIdentity> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash) || !ADDRESS.test(input.ownerAddress)) throw new Error('invalid ERC-8004 registration confirmation');
    if (await this.client.getChainId() !== 5_042_002) throw new Error('wrong Arc chain');
    const code = await this.client.getBytecode({ address: this.registryAddress });
    if (!code || code === '0x') throw new Error('ERC-8004 Identity Registry has no bytecode');
    const receipt = await this.client.getTransactionReceipt({ hash: input.txHash as Hash });
    const tokenId = parseRegisteredAgentId(receipt, { registryAddress: this.registryAddress, owner: input.ownerAddress, agentUri: input.agentUri });
    const numericId = BigInt(tokenId);
    const [ownerAddress, agentUri, agentWallet] = await Promise.all([
      this.client.readContract({ address: this.registryAddress, abi: IDENTITY_ABI, functionName: 'ownerOf', args: [numericId] }),
      this.client.readContract({ address: this.registryAddress, abi: IDENTITY_ABI, functionName: 'tokenURI', args: [numericId] }),
      this.client.readContract({ address: this.registryAddress, abi: IDENTITY_ABI, functionName: 'getAgentWallet', args: [numericId] }),
    ]);
    if (ownerAddress.toLowerCase() !== input.ownerAddress.toLowerCase() || agentUri !== input.agentUri) throw new Error('ERC-8004 canonical identity readback mismatch');
    return { tokenId, ownerAddress: ownerAddress.toLowerCase(), agentUri, agentWallet: agentWallet.toLowerCase() };
  }
}

export class Erc8004IdentityService implements Erc8004IdentityCoordinator {
  readonly applicationUrl: string;
  private readonly publicBaseUrl: string;
  private readonly registryAddress: string;
  private readonly managedIdentity: Pick<ManagedIdentityService, 'getAccount' | 'registerErc8004Agent'>;
  private readonly chain: Erc8004ReadPort;

  constructor(input: { publicBaseUrl: string; registryAddress: string; managedIdentity: Pick<ManagedIdentityService, 'getAccount' | 'registerErc8004Agent'>; chain: Erc8004ReadPort }) {
    this.publicBaseUrl = requireHttpUrl(input.publicBaseUrl, 'public base URL');
    if (!ADDRESS.test(input.registryAddress)) throw new Error('invalid ERC-8004 Identity Registry');
    this.registryAddress = input.registryAddress;
    this.applicationUrl = `${this.publicBaseUrl}/agents`;
    this.managedIdentity = input.managedIdentity;
    this.chain = input.chain;
  }

  async register(input: { userId: string; identityKind: LoginIdentityKind; draft: AgentDraft }) {
    const account = await this.managedIdentity.getAccount(input.userId, input.identityKind);
    const agentUri = `${this.publicBaseUrl}/api/agents/${encodeURIComponent(input.draft.agentId)}/erc8004.json`;
    const transaction = await this.managedIdentity.registerErc8004Agent(input.userId, {
      registryAddress: this.registryAddress, agentUri, idempotencyKey: input.draft.idempotencyKey,
    });
    if (!transaction.txHash) throw new Error('ERC-8004 registration transaction hash is unavailable');
    const canonical = await this.chain.confirmRegistration({ txHash: transaction.txHash, ownerAddress: account.managedWallet.address, agentUri });
    return {
      transaction,
      binding: {
        schema: 'arena-erc8004-identity-v1' as const, network: 'Arc Testnet' as const, chainId: 5_042_002 as const,
        registryAddress: this.registryAddress.toLowerCase(), tokenId: canonical.tokenId,
        ownerAddress: canonical.ownerAddress, agentUri: canonical.agentUri, transaction,
      },
    };
  }
}

export type Erc8004RegistrationFile = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';
  name: string;
  description: string;
  image: string;
  services: Array<{ name: 'web'; endpoint: string }>;
  x402Support: false;
  active: boolean;
  registrations: Array<{ agentId: number; agentRegistry: string }>;
  supportedTrust: ['reputation'];
  arena: { agentId: string; agentsVersion: string; agentsCommitment: string };
};

export type Erc8004FeedbackRecord = {
  schema: 'arena-erc8004-feedback-v1';
  campaignId: string;
  agentVersionId: string;
  tokenId: string;
  identityRegistryAddress: string;
  reputationRegistryAddress: string;
  evaluatorAddress: string;
  value: number;
  valueDecimals: 0;
  tag1: 'arena-evo';
  tag2: string;
  feedbackUri: string;
  feedbackHash: `0x${string}`;
  idempotencyKey: string;
  createdAt: number;
  scenarioScores: Array<{ scenarioId: string; overallScore: number }>;
  state: 'PENDING' | 'FAILED' | 'COMPLETE';
  transaction?: WalletTransactionResult;
  feedbackIndex?: number;
  error?: string;
};

export type Erc8004FeedbackDocument = {
  agentRegistry: string;
  agentId: number;
  clientAddress: string;
  createdAt: string;
  value: number;
  valueDecimals: 0;
  tag1: 'arena-evo';
  tag2: string;
  arena: { campaignId: string; agentVersionId: string; scenarioScores: Array<{ scenarioId: string; overallScore: number }> };
};

type Erc8004FeedbackWriter = { giveFeedback(input: {
  registryAddress: string; agentId: string; value: number; valueDecimals: number; tag1: string; tag2: string;
  endpoint: string; feedbackUri: string; feedbackHash: string; idempotencyKey: string;
}): Promise<WalletTransactionResult> };
type Erc8004ReputationReadPort = { confirmFeedback(input: {
  txHash: string; agentId: string; evaluatorAddress: string; value: number; valueDecimals: number; tag1: string; tag2: string;
}): Promise<{ feedbackIndex: number }> };

export function parseNewFeedbackIndex(
  receipt: { status?: string; logs?: Array<{ address?: string; topics?: readonly `0x${string}`[]; data?: `0x${string}` }> },
  expected: { reputationRegistryAddress: string; agentId: string; evaluatorAddress: string; value: number; valueDecimals: number; tag1: string; tag2: string },
): number {
  if (receipt.status !== 'success') throw new Error('ERC-8004 reputation transaction did not succeed');
  const matches: bigint[] = [];
  for (const log of receipt.logs ?? []) {
    if (log.address?.toLowerCase() !== expected.reputationRegistryAddress.toLowerCase() || !log.topics || log.data === undefined) continue;
    try {
      const decoded = decodeEventLog({ abi: REPUTATION_ABI, eventName: 'NewFeedback', topics: log.topics, data: log.data, strict: true });
      const args = decoded.args;
      if (args.agentId.toString() === expected.agentId && args.clientAddress.toLowerCase() === expected.evaluatorAddress.toLowerCase()
        && args.value === BigInt(expected.value) && args.valueDecimals === expected.valueDecimals
        && args.tag1 === expected.tag1 && args.tag2 === expected.tag2) matches.push(args.feedbackIndex);
    } catch {
      // Ignore unrelated registry events.
    }
  }
  if (matches.length !== 1 || matches[0] < 1n || matches[0] > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('receipt does not contain exactly one matching NewFeedback event');
  return Number(matches[0]);
}

export class ViemErc8004ReputationReadPort implements Erc8004ReputationReadPort {
  private readonly registryAddress: Address;
  private readonly client;

  constructor(input: { rpcUrl: string; registryAddress: string }) {
    if (!ADDRESS.test(input.registryAddress) || new URL(input.rpcUrl).protocol !== 'https:') throw new Error('invalid ERC-8004 Reputation Registry configuration');
    this.registryAddress = input.registryAddress as Address;
    this.client = createPublicClient({ chain: arcTestnet, transport: arcReadTransport(input.rpcUrl) });
  }

  async confirmFeedback(input: { txHash: string; agentId: string; evaluatorAddress: string; value: number; valueDecimals: number; tag1: string; tag2: string }): Promise<{ feedbackIndex: number }> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash) || !ADDRESS.test(input.evaluatorAddress)) throw new Error('invalid ERC-8004 feedback confirmation');
    if (await this.client.getChainId() !== 5_042_002) throw new Error('wrong Arc chain');
    const code = await this.client.getBytecode({ address: this.registryAddress });
    if (!code || code === '0x') throw new Error('ERC-8004 Reputation Registry has no bytecode');
    const receipt = await this.client.getTransactionReceipt({ hash: input.txHash as Hash });
    const feedbackIndex = parseNewFeedbackIndex(receipt, { reputationRegistryAddress: this.registryAddress, ...input });
    const [value, valueDecimals, tag1, tag2, isRevoked] = await this.client.readContract({
      address: this.registryAddress, abi: REPUTATION_ABI, functionName: 'readFeedback',
      args: [BigInt(input.agentId), input.evaluatorAddress as Address, BigInt(feedbackIndex)],
    });
    if (value !== BigInt(input.value) || valueDecimals !== input.valueDecimals || tag1 !== input.tag1 || tag2 !== input.tag2 || isRevoked) throw new Error('ERC-8004 canonical feedback readback mismatch');
    return { feedbackIndex };
  }
}

export class Erc8004ReputationService {
  private readonly runtime: SqliteRuntimeStore;
  private readonly publicBaseUrl: string;
  private readonly registryAddress: string;
  private readonly evaluatorAddress: string;
  private readonly resolveIdentity: (agentVersionId: string) => Erc8004IdentityBinding | undefined;
  private readonly writer: Erc8004FeedbackWriter;
  private readonly chain: Erc8004ReputationReadPort;
  private readonly active = new Map<string, Promise<Erc8004FeedbackRecord | undefined>>();

  constructor(input: {
    runtime: SqliteRuntimeStore; publicBaseUrl: string; registryAddress: string; evaluatorAddress: string;
    resolveIdentity: (agentVersionId: string) => Erc8004IdentityBinding | undefined;
    writer: Erc8004FeedbackWriter; chain: Erc8004ReputationReadPort;
  }) {
    if (!ADDRESS.test(input.registryAddress) || !ADDRESS.test(input.evaluatorAddress)) throw new Error('invalid ERC-8004 reputation configuration');
    this.runtime = input.runtime;
    this.publicBaseUrl = requireHttpUrl(input.publicBaseUrl, 'public base URL');
    this.registryAddress = input.registryAddress.toLowerCase();
    this.evaluatorAddress = input.evaluatorAddress.toLowerCase();
    this.resolveIdentity = input.resolveIdentity;
    this.writer = input.writer;
    this.chain = input.chain;
  }

  get(campaignId: string): Erc8004FeedbackRecord | undefined {
    return this.runtime.get<Erc8004FeedbackRecord>('erc8004-feedbacks', campaignId);
  }

  getFeedbackDocument(campaignId: string): Erc8004FeedbackDocument {
    const record = this.get(campaignId);
    if (!record) throw new Error('ERC-8004 feedback not found');
    const tokenId = BigInt(record.tokenId);
    if (tokenId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ERC-8004 token ID is outside JSON safe range');
    return {
      agentRegistry: `eip155:5042002:${record.identityRegistryAddress}`,
      agentId: Number(tokenId), clientAddress: `eip155:5042002:${record.evaluatorAddress}`,
      createdAt: new Date(record.createdAt).toISOString(), value: record.value, valueDecimals: 0,
      tag1: record.tag1, tag2: record.tag2,
      arena: { campaignId: record.campaignId, agentVersionId: record.agentVersionId, scenarioScores: structuredClone(record.scenarioScores) },
    };
  }

  async recordFinalizedCampaign(campaign: SoloCampaignRecord): Promise<Erc8004FeedbackRecord | undefined> {
    if (campaign.state !== 'FINALIZED') return undefined;
    let record = this.get(campaign.campaignId);
    if (!record) {
      const identity = this.resolveIdentity(campaign.agent.versionId);
      if (!identity) return undefined;
      if (identity.ownerAddress.toLowerCase() === this.evaluatorAddress) throw new Error('ERC-8004 evaluator cannot own the evaluated Agent');
      const scenarioScores = campaign.items.map((item) => {
        const overallScore = item.scorecard?.overall_score;
        if (!Number.isSafeInteger(overallScore) || overallScore < 0 || overallScore > 100) throw new Error('finalized campaign has an invalid scorecard');
        return { scenarioId: item.scenarioId, overallScore };
      });
      if (!scenarioScores.length) throw new Error('finalized campaign has no scorecards');
      const value = Math.round(scenarioScores.reduce((sum, item) => sum + item.overallScore, 0) / scenarioScores.length);
      const feedbackUri = `${this.publicBaseUrl}/api/evaluations/${encodeURIComponent(campaign.campaignId)}/erc8004-feedback.json`;
      const createdAt = Date.now();
      const base = {
        schema: 'arena-erc8004-feedback-v1' as const, campaignId: campaign.campaignId, agentVersionId: campaign.agent.versionId,
        tokenId: identity.tokenId, identityRegistryAddress: identity.registryAddress.toLowerCase(), reputationRegistryAddress: this.registryAddress,
        evaluatorAddress: this.evaluatorAddress, value, valueDecimals: 0 as const, tag1: 'arena-evo' as const,
        tag2: campaign.rubricVersion, feedbackUri, idempotencyKey: randomUUID(), createdAt, scenarioScores, state: 'PENDING' as const,
      };
      const document: Erc8004FeedbackDocument = {
        agentRegistry: `eip155:5042002:${base.identityRegistryAddress}`, agentId: Number(BigInt(base.tokenId)),
        clientAddress: `eip155:5042002:${base.evaluatorAddress}`, createdAt: new Date(createdAt).toISOString(),
        value, valueDecimals: 0, tag1: base.tag1, tag2: base.tag2,
        arena: { campaignId: base.campaignId, agentVersionId: base.agentVersionId, scenarioScores },
      };
      record = { ...base, feedbackHash: keccak256(toBytes(JSON.stringify(document))) };
      this.runtime.putIfAbsent('erc8004-feedbacks', campaign.campaignId, record);
      record = this.get(campaign.campaignId)!;
    }
    if (record.state === 'COMPLETE') return record;
    return this.runOnce(record.campaignId);
  }

  async resumePending(): Promise<{ attempted: number; succeeded: number; failed: number }> {
    const records = this.runtime.list<Erc8004FeedbackRecord>('erc8004-feedbacks')
      .filter((record) => record.state !== 'COMPLETE')
      .sort((left, right) => left.campaignId.localeCompare(right.campaignId));
    const results = await Promise.all(records.map((record) => this.runOnce(record.campaignId)));
    const succeeded = results.filter((record) => record?.state === 'COMPLETE').length;
    return { attempted: records.length, succeeded, failed: records.length - succeeded };
  }

  private runOnce(campaignId: string): Promise<Erc8004FeedbackRecord | undefined> {
    const running = this.active.get(campaignId);
    if (running) return running;
    const operation = this.publish(campaignId).finally(() => { if (this.active.get(campaignId) === operation) this.active.delete(campaignId); });
    this.active.set(campaignId, operation);
    return operation;
  }

  private async publish(campaignId: string): Promise<Erc8004FeedbackRecord | undefined> {
    const record = this.get(campaignId);
    if (!record || record.state === 'COMPLETE') return record;
    try {
      const transaction = await this.writer.giveFeedback({
        registryAddress: record.reputationRegistryAddress, agentId: record.tokenId, value: record.value,
        valueDecimals: record.valueDecimals, tag1: record.tag1, tag2: record.tag2, endpoint: '',
        feedbackUri: record.feedbackUri, feedbackHash: record.feedbackHash, idempotencyKey: record.idempotencyKey,
      });
      if (!transaction.txHash) throw new Error('ERC-8004 feedback transaction hash is unavailable');
      const canonical = await this.chain.confirmFeedback({ txHash: transaction.txHash, agentId: record.tokenId, evaluatorAddress: record.evaluatorAddress, value: record.value, valueDecimals: 0, tag1: record.tag1, tag2: record.tag2 });
      const complete = { ...record, state: 'COMPLETE' as const, transaction, feedbackIndex: canonical.feedbackIndex, error: undefined };
      this.runtime.put('erc8004-feedbacks', campaignId, complete);
      return complete;
    } catch (error) {
      const failed = { ...record, state: 'FAILED' as const, error: error instanceof Error ? error.message : 'ERC-8004 feedback failed' };
      this.runtime.put('erc8004-feedbacks', campaignId, failed);
      return failed;
    }
  }
}

export function buildErc8004RegistrationFile(input: {
  name: string;
  active: boolean;
  arenaAgentId: string;
  agentsVersion: string;
  agentsCommitment: string;
  identityRegistry: string;
  tokenId: string;
  chainId: number;
  applicationUrl: string;
}): Erc8004RegistrationFile {
  if (!input.name.trim() || input.name.length > 96 || !DIGEST.test(input.arenaAgentId) || !DIGEST.test(input.agentsVersion)
    || !DIGEST.test(input.agentsCommitment) || !ADDRESS.test(input.identityRegistry)
    || !Number.isSafeInteger(input.chainId) || input.chainId < 1) throw new TypeError('invalid ERC-8004 registration metadata');
  const tokenId = BigInt(input.tokenId);
  if (tokenId < 0n || tokenId > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError('ERC-8004 token ID is outside JSON safe range');
  const applicationUrl = requireHttpUrl(input.applicationUrl, 'application URL');
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: input.name.trim(),
    description: 'Arena ISS Agent evaluation profile. Private instructions are not published.',
    image: '',
    services: [{ name: 'web', endpoint: applicationUrl }],
    x402Support: false,
    active: input.active,
    registrations: [{ agentId: Number(tokenId), agentRegistry: `eip155:${input.chainId}:${input.identityRegistry.toLowerCase()}` }],
    supportedTrust: ['reputation'],
    arena: { agentId: input.arenaAgentId, agentsVersion: input.agentsVersion, agentsCommitment: input.agentsCommitment },
  };
}

export function parseRegisteredAgentId(
  receipt: { status?: string; logs?: Array<{ address?: string; topics?: readonly `0x${string}`[]; data?: `0x${string}` }> },
  expected: { registryAddress: string; owner: string; agentUri: string },
): string {
  if (receipt.status !== 'success') throw new Error('ERC-8004 registration transaction did not succeed');
  if (!ADDRESS.test(expected.registryAddress) || !ADDRESS.test(expected.owner)) throw new TypeError('invalid ERC-8004 receipt expectation');
  const matches: string[] = [];
  for (const log of receipt.logs ?? []) {
    if (log.address?.toLowerCase() !== expected.registryAddress.toLowerCase() || !log.topics || log.data === undefined) continue;
    try {
      const decoded = decodeEventLog({ abi: REGISTERED_ABI, eventName: 'Registered', topics: log.topics, data: log.data, strict: true });
      if (decoded.args.owner.toLowerCase() === expected.owner.toLowerCase() && decoded.args.agentURI === expected.agentUri) matches.push(decoded.args.agentId.toString());
    } catch {
      // Other events from the registry are intentionally ignored.
    }
  }
  if (matches.length !== 1) throw new Error('receipt does not contain exactly one matching Registered event');
  return matches[0];
}

function requireHttpUrl(value: string, label: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError(`invalid ${label}`);
  return url.toString().replace(/\/$/, '');
}
