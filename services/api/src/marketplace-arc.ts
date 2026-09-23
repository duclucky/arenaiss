import { createPublicClient, createWalletClient, parseAbi, parseEventLogs, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { WalletTransactionResult } from './managed-identity.ts';
import { arcTestnet } from 'viem/chains';
import type { MarketplaceArcSnapshot } from './service.ts';
import { arcReadTransport, arcWriteTransport } from './arc-rpc.ts';
import { sharedTransactionSubmissionCoordinator, type TransactionSubmissionCoordinator } from '../../../packages/operations/src/concurrency.ts';

const IDENTITY_REGISTRY_ABI = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)']);
const MARKETPLACE_ABI = parseAbi(['function operator() view returns (address)', 'function platformRecipient() view returns (address)', 'function listings(uint256) view returns (uint256 tokenId, bytes32 agentId, bytes32 version, bytes32 commitment, bytes32 eligibilityDigest, address seller, uint128 price, uint64 expiresAt, uint8 state)', 'function eligibility(bytes32) view returns (uint256 tokenId, bytes32 agentId, bytes32 version, bytes32 commitment, uint64 validUntil, bool consumed)', 'function creditOf(address) view returns (uint256)', 'function approveEligibility(bytes32 digest,uint256 tokenId,bytes32 agentId,bytes32 version,bytes32 commitment,uint64 validUntil)', 'function withdraw()', 'event ListingCreated(uint256 indexed listingId, uint256 indexed tokenId, bytes32 indexed agentId, address seller, uint256 price, uint64 expiresAt, bytes32 eligibilityDigest)']);
const STATES = ['NONE', 'ACTIVE', 'SOLD', 'CANCELLED'] as const;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface MarketplaceChainPort { snapshot(listingId: string): Promise<MarketplaceArcSnapshot>; resolveCreatedListingId?(txHash: string): Promise<string>; creditOf?(account: string): Promise<string>; approveEligibility?(input: { digest: string; tokenId: string; agentId: string; version: string; commitment: string; validUntil: number }): Promise<WalletTransactionResult>; operatorCredit?(): Promise<string>; withdrawOperatorCredit?(): Promise<WalletTransactionResult>; }

export class ViemMarketplaceChainPort implements MarketplaceChainPort {
  private readonly identityRegistry: Address;
  private readonly marketplace: Address;
  private readonly client;
  private readonly walletClient;
  private readonly account;
  private readonly transactions: TransactionSubmissionCoordinator;

  constructor(input: { rpcUrl: string; identityRegistryAddress: string; marketplaceAddress: string; privateKey?: string; transactions?: TransactionSubmissionCoordinator }) {
    if (!ADDRESS.test(input.identityRegistryAddress) || !ADDRESS.test(input.marketplaceAddress) || new URL(input.rpcUrl).protocol !== 'https:') throw new Error('invalid Arc marketplace configuration');
    this.identityRegistry = input.identityRegistryAddress as Address;
    this.marketplace = input.marketplaceAddress as Address;
    this.client = createPublicClient({ chain: arcTestnet, transport: arcReadTransport(input.rpcUrl) });
    this.account = input.privateKey ? privateKeyToAccount(input.privateKey as Hex) : undefined;
    this.walletClient = this.account ? createWalletClient({ account: this.account, chain: arcTestnet, transport: arcWriteTransport(input.rpcUrl) }) : undefined;
    this.transactions = input.transactions ?? sharedTransactionSubmissionCoordinator;
  }

  async snapshot(listingId: string): Promise<MarketplaceArcSnapshot> {
    if (!/^[1-9][0-9]*$/.test(listingId)) throw new Error('invalid marketplace listing ID');
    if (await this.client.getChainId() !== 5_042_002) throw new Error('wrong Arc chain');
    const listing = await this.client.readContract({ address: this.marketplace, abi: MARKETPLACE_ABI, functionName: 'listings', args: [BigInt(listingId)] });
    const [tokenId, agentBytes, versionBytes, commitmentBytes, , seller, price, expiresAt, stateCode] = listing;
    if (agentBytes === `0x${'0'.repeat(64)}` || !STATES[Number(stateCode)] || stateCode === 0) throw new Error('Arc listing not found');
    const owner = await this.client.readContract({ address: this.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: 'ownerOf', args: [tokenId] });
    const state = STATES[Number(stateCode)] === 'ACTIVE' && Number(expiresAt) < Math.floor(Date.now() / 1000) ? 'EXPIRED' : STATES[Number(stateCode)];
    if (state === 'NONE') throw new Error('Arc listing not found');
    return {
      listingId, tokenId: tokenId.toString(), agentId: `sha256:${agentBytes.slice(2)}` as `sha256:${string}`, version: `sha256:${versionBytes.slice(2)}` as `sha256:${string}`,
      commitment: `sha256:${commitmentBytes.slice(2)}` as `sha256:${string}`, sellerAddress: seller.toLowerCase(), buyerAddress: state === 'SOLD' ? owner.toLowerCase() : undefined,
      price: price.toString(), expiresAt: Number(expiresAt), state, registryOwner: owner.toLowerCase(), registryActive: owner !== '0x0000000000000000000000000000000000000000',
    };
  }

  async resolveCreatedListingId(txHash: string): Promise<string> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('invalid marketplace transaction hash');
    if (await this.client.getChainId() !== 5_042_002) throw new Error('wrong Arc chain');
    const receipt = await this.client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    const events = parseEventLogs({ abi: MARKETPLACE_ABI, logs: receipt.logs, eventName: 'ListingCreated' });
    if (events.length !== 1) throw new Error('Arc listing creation event unavailable');
    return events[0].args.listingId.toString();
  }

  async creditOf(account: string): Promise<string> {
    if (!ADDRESS.test(account)) throw new Error('invalid marketplace beneficiary');
    if (await this.client.getChainId() !== 5_042_002) throw new Error('wrong Arc chain');
    return (await this.client.readContract({ address: this.marketplace, abi: MARKETPLACE_ABI, functionName: 'creditOf', args: [account as Address] })).toString();
  }

  async approveEligibility(input: { digest: string; tokenId: string; agentId: string; version: string; commitment: string; validUntil: number }): Promise<WalletTransactionResult> {
    if (!this.walletClient || !this.account) throw new Error('marketplace operator signer unavailable');
    const digest = digestBytes32(input.digest); const agentId = digestBytes32(input.agentId); const version = digestBytes32(input.version); const commitment = digestBytes32(input.commitment);
    const existing = await this.client.readContract({ address: this.marketplace, abi: MARKETPLACE_ABI, functionName: 'eligibility', args: [digest] });
    if (existing[1] !== `0x${'0'.repeat(64)}`) return { transactionId: `arc-readback:${input.digest}`, state: 'COMPLETE' };
    if (!/^[1-9][0-9]*$/.test(input.tokenId)) throw new Error('invalid ERC-8004 token ID');
    const operator = await this.client.readContract({ address: this.marketplace, abi: MARKETPLACE_ABI, functionName: 'operator' });
    if (operator.toLowerCase() !== this.account.address.toLowerCase()) throw new Error('configured signer is not Marketplace operator');
    const hash = await this.transactions.submit({ network: 'ARC', chainId: 5_042_002, signerAddress: this.account.address }, () => this.walletClient!.writeContract({ address: this.marketplace, abi: MARKETPLACE_ABI, functionName: 'approveEligibility', args: [digest, BigInt(input.tokenId), agentId, version, commitment, BigInt(input.validUntil)] }));
    const receipt = await this.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('Marketplace eligibility approval reverted');
    return { transactionId: hash, state: 'COMPLETE', txHash: hash, explorerUrl: `https://testnet.arcscan.app/tx/${hash}` };
  }

  async operatorCredit(): Promise<string> {
    const recipient = await this.requirePlatformSigner();
    return this.creditOf(recipient);
  }

  async withdrawOperatorCredit(): Promise<WalletTransactionResult> {
    if (!this.walletClient || !this.account) throw new Error('marketplace operator signer unavailable');
    await this.requirePlatformSigner();
    if (BigInt(await this.creditOf(this.account.address)) === 0n) throw new Error('no Marketplace platform credit');
    const hash = await this.transactions.submit({ network: 'ARC', chainId: 5_042_002, signerAddress: this.account.address }, () => this.walletClient!.writeContract({ address: this.marketplace, abi: MARKETPLACE_ABI, functionName: 'withdraw' }));
    const receipt = await this.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('Marketplace platform withdrawal reverted');
    return { transactionId: hash, state: 'COMPLETE', txHash: hash, explorerUrl: `https://testnet.arcscan.app/tx/${hash}` };
  }

  private async requirePlatformSigner(): Promise<string> {
    if (!this.account) throw new Error('marketplace operator signer unavailable');
    const recipient = await this.client.readContract({ address: this.marketplace, abi: MARKETPLACE_ABI, functionName: 'platformRecipient' });
    if (recipient.toLowerCase() !== this.account.address.toLowerCase()) throw new Error('configured signer is not Marketplace platform recipient');
    return recipient;
  }
}

function digestBytes32(value: string): `0x${string}` {
  if (!DIGEST.test(value)) throw new Error('invalid Marketplace digest');
  return `0x${value.slice(7)}`;
}

export function marketplaceConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(environment.ARC_MARKETPLACE_ADDRESS && environment.ARC_ERC8004_IDENTITY_REGISTRY_ADDRESS && environment.ARC_TESTNET_RPC_URL);
}
