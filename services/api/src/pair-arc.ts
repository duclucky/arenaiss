import { createHash } from 'node:crypto';
import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';
import type { ChainRoom, PairChainPort } from './pair-rooms.ts';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const RUNTIME_SHA256 = '15c9b43ed44c7bf6278848e1d70608c548524b59c3e8990ddb400ad2d0ab07db';
const ABI = parseAbi([
  'function usdc() view returns (address)',
  'function operator() view returns (address)',
  'function getRoom(bytes32) view returns ((address creator,address challenger,bytes32 creatorAgentVersion,bytes32 challengerAgentVersion,uint128 stake,uint64 joinDeadline,uint64 resolutionDeadline,uint8 state,address winner,bytes32 verdictDigest,bool creatorCancelRequested,bool challengerCancelRequested))',
  'function creditOf(bytes32,address) view returns (uint256)',
]);
const TOKEN = parseAbi(['function balanceOf(address) view returns (uint256)']);

export class ArcPairChainPort implements PairChainPort {
  readonly escrowAddress: string;
  private readonly expectedOperator: string;
  private readonly client;

  constructor(input: { escrowAddress: string; expectedOperator: string; rpcUrl?: string }) {
    const rpcUrl = input.rpcUrl ?? 'https://rpc.testnet.arc.network';
    if (!ADDRESS.test(input.escrowAddress) || /^0x0{40}$/i.test(input.escrowAddress)
      || !ADDRESS.test(input.expectedOperator) || /^0x0{40}$/i.test(input.expectedOperator)
      || new URL(rpcUrl).protocol !== 'https:') throw new Error('invalid pair escrow configuration');
    this.escrowAddress = input.escrowAddress;
    this.expectedOperator = input.expectedOperator;
    this.client = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
  }

  async assertReady(): Promise<void> {
    await this.requireArc();
    const address = this.escrowAddress as Address;
    const code = await this.client.getBytecode({ address });
    if (!code || code === '0x') throw new Error('pair escrow is not deployed on Arc Testnet');
    if (createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex') !== RUNTIME_SHA256) throw new Error('pair escrow runtime bytecode mismatch');
    const [usdc, operator] = await Promise.all([
      this.client.readContract({ address, abi: ABI, functionName: 'usdc' }),
      this.client.readContract({ address, abi: ABI, functionName: 'operator' }),
    ]);
    if (usdc.toLowerCase() !== ARC_USDC || operator.toLowerCase() !== this.expectedOperator.toLowerCase()) throw new Error('pair escrow configuration mismatch');
  }

  private async requireArc(): Promise<void> {
    if (await this.client.getChainId() !== 5_042_002) throw new Error('wrong Arc chain');
  }

  async balanceOf(wallet: string): Promise<bigint> {
    if (!ADDRESS.test(wallet)) throw new Error('invalid wallet');
    await this.requireArc();
    return this.client.readContract({ address: ARC_USDC, abi: TOKEN, functionName: 'balanceOf', args: [wallet as Address] });
  }

  async getRoom(roomId: string): Promise<ChainRoom> {
    if (!DIGEST.test(roomId)) throw new Error('invalid room ID');
    await this.requireArc();
    const room = await this.client.readContract({ address: this.escrowAddress as Address, abi: ABI, functionName: 'getRoom', args: [`0x${roomId.slice(7)}`] });
    return {
      creator: room.creator, challenger: room.challenger, creatorAgentVersion: room.creatorAgentVersion,
      challengerAgentVersion: room.challengerAgentVersion, stake: room.stake, joinDeadline: Number(room.joinDeadline),
      resolutionDeadline: Number(room.resolutionDeadline), state: Number(room.state), winner: room.winner, verdictDigest: room.verdictDigest,
    };
  }

  async creditOf(roomId: string, wallet: string): Promise<bigint> {
    if (!DIGEST.test(roomId) || !ADDRESS.test(wallet)) throw new Error('invalid pair credit request');
    await this.requireArc();
    return this.client.readContract({ address: this.escrowAddress as Address, abi: ABI, functionName: 'creditOf', args: [`0x${roomId.slice(7)}`, wallet as Address] });
  }
}
