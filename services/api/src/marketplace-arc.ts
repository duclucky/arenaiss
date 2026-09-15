import { createPublicClient, http, parseAbi, parseEventLogs, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';
import type { MarketplaceArcSnapshot } from './service.ts';

const REGISTRY_ABI = parseAbi(['function agents(bytes32) view returns (address owner, bytes32 version, bytes32 commitment, bool active)']);
const MARKETPLACE_ABI = parseAbi(['function listings(uint256) view returns (bytes32 agentId, bytes32 version, bytes32 commitment, bytes32 eligibilityDigest, address seller, uint128 price, uint64 expiresAt, uint8 state)', 'event ListingCreated(uint256 indexed listingId, bytes32 indexed agentId, address indexed seller, uint256 price, uint64 expiresAt, bytes32 eligibilityDigest)']);
const STATES = ['NONE', 'ACTIVE', 'SOLD', 'CANCELLED'] as const;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface MarketplaceChainPort { snapshot(listingId: string): Promise<MarketplaceArcSnapshot>; resolveCreatedListingId?(txHash: string): Promise<string>; }

export class ViemMarketplaceChainPort implements MarketplaceChainPort {
  private readonly registry: Address;
  private readonly marketplace: Address;
  private readonly client;

  constructor(input: { rpcUrl: string; registryAddress: string; marketplaceAddress: string }) {
    if (!ADDRESS.test(input.registryAddress) || !ADDRESS.test(input.marketplaceAddress) || new URL(input.rpcUrl).protocol !== 'https:') throw new Error('invalid Arc marketplace configuration');
    this.registry = input.registryAddress as Address;
    this.marketplace = input.marketplaceAddress as Address;
    this.client = createPublicClient({ chain: arcTestnet, transport: http(input.rpcUrl) });
  }

  async snapshot(listingId: string): Promise<MarketplaceArcSnapshot> {
    if (!/^[1-9][0-9]*$/.test(listingId)) throw new Error('invalid marketplace listing ID');
    if (await this.client.getChainId() !== 5_042_002) throw new Error('wrong Arc chain');
    const listing = await this.client.readContract({ address: this.marketplace, abi: MARKETPLACE_ABI, functionName: 'listings', args: [BigInt(listingId)] });
    const [agentBytes, versionBytes, commitmentBytes, , seller, price, expiresAt, stateCode] = listing;
    if (agentBytes === `0x${'0'.repeat(64)}` || !STATES[Number(stateCode)] || stateCode === 0) throw new Error('Arc listing not found');
    const agent = await this.client.readContract({ address: this.registry, abi: REGISTRY_ABI, functionName: 'agents', args: [agentBytes] });
    const [owner, version, commitment, active] = agent;
    const state = STATES[Number(stateCode)] === 'ACTIVE' && Number(expiresAt) < Math.floor(Date.now() / 1000) ? 'EXPIRED' : STATES[Number(stateCode)];
    if (state === 'NONE') throw new Error('Arc listing not found');
    return {
      listingId, agentId: `sha256:${agentBytes.slice(2)}` as `sha256:${string}`, version: `sha256:${versionBytes.slice(2)}` as `sha256:${string}`,
      commitment: `sha256:${commitmentBytes.slice(2)}` as `sha256:${string}`, sellerAddress: seller.toLowerCase(), buyerAddress: state === 'SOLD' ? owner.toLowerCase() : undefined,
      price: price.toString(), expiresAt: Number(expiresAt), state, registryOwner: owner.toLowerCase(), registryActive: active && version === versionBytes && commitment === commitmentBytes,
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
}

export function marketplaceConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(environment.ARC_MARKETPLACE_ADDRESS && environment.ARC_AGENT_REGISTRY_V2_ADDRESS && environment.ARC_TESTNET_RPC_URL);
}
