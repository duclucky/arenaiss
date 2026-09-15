import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import type { EvaluationSettlementPort } from './evaluation-execution.ts';
import type { WalletTransactionResult } from './managed-identity.ts';

const ABI = [
  { type: 'function', name: 'payments', stateMutability: 'view', inputs: [{ name: 'campaignId', type: 'bytes32' }], outputs: [{ name: 'payer', type: 'address' }, { name: 'depositedAt', type: 'uint64' }, { name: 'state', type: 'uint8' }] },
  { type: 'function', name: 'release', stateMutability: 'nonpayable', inputs: [{ name: 'campaignId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'refund', stateMutability: 'nonpayable', inputs: [{ name: 'campaignId', type: 'bytes32' }], outputs: [] },
] as const;

export class ViemEvoFeeSettlement implements EvaluationSettlementPort {
  private readonly address: `0x${string}`;
  private readonly account;
  private readonly publicClient;
  private readonly walletClient;

  constructor(input: { privateKey: string; escrowAddress: string; rpcUrl?: string }) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.privateKey)) throw new TypeError('Arc operator private key is invalid');
    if (!/^0x[0-9a-fA-F]{40}$/.test(input.escrowAddress)) throw new TypeError('evaluation escrow address is invalid');
    this.address = input.escrowAddress as `0x${string}`;
    this.account = privateKeyToAccount(input.privateKey as Hex);
    const transport = http(input.rpcUrl || 'https://rpc.testnet.arc.network');
    this.publicClient = createPublicClient({ chain: arcTestnet, transport });
    this.walletClient = createWalletClient({ account: this.account, chain: arcTestnet, transport });
  }

  release(campaignId: string): Promise<WalletTransactionResult> { return this.settle(campaignId, 'release', 2); }
  refund(campaignId: string): Promise<WalletTransactionResult> { return this.settle(campaignId, 'refund', 3); }

  private async settle(campaignId: string, functionName: 'release' | 'refund', terminalState: number): Promise<WalletTransactionResult> {
    const digest = digestBytes32(campaignId);
    const state = await this.paymentState(digest);
    if (Number(state) === terminalState) return { transactionId: `arc-readback:${campaignId}`, state: 'COMPLETE' };
    if (Number(state) !== 1) throw new Error('evaluation fee is not held on Arc');
    if (await this.publicClient.getChainId() !== 5_042_002) throw new Error('unexpected Arc chain ID');
    try {
      const hash = await this.walletClient.writeContract({ address: this.address, abi: ABI, functionName, args: [digest] });
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      if (receipt.status !== 'success') throw new Error(`evaluation fee ${functionName} reverted`);
      return { transactionId: hash, state: 'COMPLETE', txHash: hash, explorerUrl: `https://testnet.arcscan.app/tx/${hash}` };
    } catch (error) {
      if (Number(await this.paymentState(digest)) === terminalState) return { transactionId: `arc-readback:${campaignId}`, state: 'COMPLETE' };
      throw error;
    }
  }

  private async paymentState(campaignId: `0x${string}`): Promise<number> {
    const [, , state] = await this.publicClient.readContract({ address: this.address, abi: ABI, functionName: 'payments', args: [campaignId] });
    return Number(state);
  }
}

function digestBytes32(value: string): `0x${string}` {
  if (!/^sha256:[0-9a-fA-F]{64}$/.test(value)) throw new Error('invalid evaluation campaign digest');
  return `0x${value.slice(7).toLowerCase()}`;
}
