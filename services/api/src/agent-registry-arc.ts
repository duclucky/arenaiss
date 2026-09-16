import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';

const ABI = parseAbi(['function agents(bytes32) view returns (address owner, bytes32 version, bytes32 commitment, bool active)']);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGEST = /^sha256:[0-9a-fA-F]{64}$/;

export type AgentRegistryRecord = { owner: string; active: boolean };
export interface AgentRegistryPort { readAgent(agentId: string): Promise<AgentRegistryRecord>; }

export class ViemAgentRegistryPort implements AgentRegistryPort {
  private readonly address: Address;
  private readonly client;

  constructor(input: { rpcUrl: string; address: string }) {
    if (!ADDRESS.test(input.address) || new URL(input.rpcUrl).protocol !== 'https:') throw new Error('invalid Arc Agent registry configuration');
    this.address = input.address as Address;
    this.client = createPublicClient({ chain: arcTestnet, transport: http(input.rpcUrl) });
  }

  async readAgent(agentId: string): Promise<AgentRegistryRecord> {
    if (!DIGEST.test(agentId)) throw new Error('invalid Agent identity');
    if (await this.client.getChainId() !== 5_042_002) throw new Error('wrong Arc chain');
    const [owner, , , active] = await this.client.readContract({ address: this.address, abi: ABI, functionName: 'agents', args: [`0x${agentId.slice(7)}`] });
    return { owner: owner.toLowerCase(), active };
  }
}
