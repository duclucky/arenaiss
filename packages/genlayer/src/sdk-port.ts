import { createAccount, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

import type { GenLayerPort, JudgePair } from './tracker.ts';

type SdkClient = {
  estimateTransactionFeesForWrite(input: WriteInput): Promise<FeeQuote>;
  writeContract(input: WriteInput & { fees: FeeQuote }): Promise<string>;
  getTransaction(input: { hash: string }): Promise<unknown>;
  readContract(input: { address: string; functionName: string; args: unknown[]; jsonSafeReturn: true }): Promise<unknown>;
};
type WriteInput = { address: string; functionName: string; args: unknown[] };
type FeeQuote = { distribution: unknown; messageAllocations: unknown; feeValue: bigint };

export class SdkGenLayerPort implements GenLayerPort {
  private client: SdkClient;
  constructor(client: SdkClient) { this.client = client; }

  async submit(pair: JudgePair, judgeAddress: string): Promise<string> {
    const input = {
      address: judgeAddress,
      functionName: 'submit_match',
      args: [pair.matchId, pair.attemptId, pair.topic, pair.outputA, pair.outputB, pair.outputADigest, pair.outputBDigest, pair.rubricVersion],
    };
    const fees = await this.client.estimateTransactionFeesForWrite(input);
    return this.client.writeContract({ ...input, fees });
  }

  getReceipt(txHash: string): Promise<unknown> {
    return this.client.getTransaction({ hash: txHash });
  }

  getResult(judgeAddress: string, matchId: string, attemptId: string): Promise<unknown> {
    return this.client.readContract({
      address: judgeAddress,
      functionName: 'get_match_result',
      args: [matchId, attemptId],
      jsonSafeReturn: true,
    });
  }
}

export function createStudionetGenLayerPort(privateKey: string): SdkGenLayerPort {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('GenLayer operator private key is invalid');
  const account = createAccount(privateKey as `0x${string}`);
  return new SdkGenLayerPort(createClient({ chain: studionet, account }) as unknown as SdkClient);
}
