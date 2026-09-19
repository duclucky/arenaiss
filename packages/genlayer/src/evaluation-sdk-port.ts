import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

import type { EvaluationJudgePort, EvaluationJudgeSubmission } from "../../evaluation/src/run-tracker.ts";
import { studioNextChain } from "./studio-next.ts";
import { sharedTransactionSubmissionCoordinator, type TransactionSubmissionCoordinator, type TransactionSubmissionLane } from "../../operations/src/concurrency.ts";

type EvaluationSdkClient = {
  estimateTransactionFeesForWrite(input: EvaluationWriteInput): Promise<FeeQuote>;
  writeContract(input: EvaluationWriteInput & { fees: FeeQuote }): Promise<string>;
  getTransaction(input: { hash: string }): Promise<unknown>;
  readContract(input: { address: string; functionName: string; args: unknown[]; jsonSafeReturn: true }): Promise<unknown>;
};
type EvaluationWriteInput = { address: string; functionName: string; args: unknown[] };
type FeeQuote = { distribution: unknown; messageAllocations: unknown; feeValue: bigint };

export class SdkAgentEvaluationPort implements EvaluationJudgePort {
  private readonly client: EvaluationSdkClient;
  private readonly submission?: { coordinator: TransactionSubmissionCoordinator; lane: TransactionSubmissionLane };

  constructor(client: EvaluationSdkClient, submission?: { coordinator: TransactionSubmissionCoordinator; lane: TransactionSubmissionLane }) {
    this.client = client;
    this.submission = submission;
  }

  async submit(submission: EvaluationJudgeSubmission, judgeAddress: string): Promise<string> {
    const input = {
      address: judgeAddress,
      functionName: "submit_evaluation",
      args: [
        submission.runId,
        submission.agentVersionId,
        submission.mode,
        submission.agentsMd,
        submission.scenarioJson,
        submission.responseJson,
        submission.agentsDigest,
        submission.scenarioDigest,
        submission.responseDigest,
        submission.rubricVersion,
      ],
    };
    const fees = await this.client.estimateTransactionFeesForWrite(input);
    const send = () => this.client.writeContract({ ...input, fees });
    return this.submission ? this.submission.coordinator.submit(this.submission.lane, send) : send();
  }

  getReceipt(transactionHash: string): Promise<unknown> {
    return this.client.getTransaction({ hash: transactionHash });
  }

  getEvaluation(judgeAddress: string, runId: string): Promise<unknown> {
    return this.client.readContract({ address: judgeAddress, functionName: "get_evaluation", args: [runId], jsonSafeReturn: true });
  }
}

export function createStudionetAgentEvaluationPort(privateKey: string, coordinator: TransactionSubmissionCoordinator = sharedTransactionSubmissionCoordinator): SdkAgentEvaluationPort {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new TypeError("GenLayer private key is invalid");
  const account = createAccount(privateKey as `0x${string}`);
  const client = createClient({ chain: studionet, account });
  return new SdkAgentEvaluationPort(client as unknown as EvaluationSdkClient, { coordinator, lane: { network: "GENLAYER", chainId: Number(studionet.id), signerAddress: account.address } });
}

export function createStudioDevAgentEvaluationPort(privateKey: string, coordinator: TransactionSubmissionCoordinator = sharedTransactionSubmissionCoordinator): SdkAgentEvaluationPort {
  return createStudioNextAgentEvaluationPort(privateKey, coordinator);
}

export function createStudioNextAgentEvaluationPort(privateKey: string, coordinator: TransactionSubmissionCoordinator = sharedTransactionSubmissionCoordinator): SdkAgentEvaluationPort {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new TypeError("GenLayer private key is invalid");
  const account = createAccount(privateKey as `0x${string}`);
  const client = createClient({ chain: studioNextChain(), account });
  return new SdkAgentEvaluationPort(client as unknown as EvaluationSdkClient, { coordinator, lane: { network: "GENLAYER", chainId: 61_997, signerAddress: account.address } });
}
