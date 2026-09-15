import { createAccount, createClient } from "genlayer-js";
import type { ComparisonJudgePort, ComparisonJudgeSubmission } from "./comparison-tracker.ts";
import { studioNextChain } from "./studio-next.ts";

type WriteInput = { address: string; functionName: string; args: unknown[] };
type FeeQuote = { distribution: unknown; messageAllocations: unknown; feeValue: bigint };
type Client = {
  estimateTransactionFeesForWrite(input: WriteInput): Promise<FeeQuote>;
  writeContract(input: WriteInput & { fees: FeeQuote }): Promise<string>;
  getTransaction(input: { hash: string }): Promise<unknown>;
  readContract(input: { address: string; functionName: string; args: unknown[]; jsonSafeReturn: true }): Promise<unknown>;
};

export class SdkComparisonJudgePort implements ComparisonJudgePort {
  private readonly client: Client;
  constructor(client: Client) { this.client = client; }
  async submit(value: ComparisonJudgeSubmission, judgeAddress: string): Promise<string> {
    const input = { address: judgeAddress, functionName: "submit_comparison", args: [value.matchId, value.attemptId, value.agentVersionIdA, value.agentVersionIdB, value.mode, value.agentsMdA, value.agentsMdB, value.scenarioJson, value.responseJsonA, value.responseJsonB, value.agentsDigestA, value.agentsDigestB, value.scenarioDigest, value.responseDigestA, value.responseDigestB, value.rubricVersion] };
    const fees = await this.client.estimateTransactionFeesForWrite(input);
    return this.client.writeContract({ ...input, fees });
  }
  getReceipt(transactionHash: string): Promise<unknown> { return this.client.getTransaction({ hash: transactionHash }); }
  getComparison(judgeAddress: string, matchId: string, attemptId: string): Promise<unknown> { return this.client.readContract({ address: judgeAddress, functionName: "get_comparison", args: [matchId, attemptId], jsonSafeReturn: true }); }
}

export function createStudioNextComparisonJudgePort(privateKey: string): SdkComparisonJudgePort {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new TypeError("GenLayer private key is invalid");
  return new SdkComparisonJudgePort(createClient({ chain: studioNextChain(), account: createAccount(privateKey as `0x${string}`) }) as unknown as Client);
}
