import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { initiateSmartContractPlatformClient } from "@circle-fin/smart-contract-platform";
import { createPublicClient, getAddress, http, zeroHash } from "viem";
import { arcTestnet } from "viem/chains";

const ARC_CHAIN_ID = 5_042_002;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deploymentIdempotencyKey(sourceDigest) {
  const bytes = Buffer.from(sourceDigest.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function fundedArcWallet(walletsClient, walletSetId) {
  if (process.env.CIRCLE_DEPLOYER_WALLET_ID) return process.env.CIRCLE_DEPLOYER_WALLET_ID;
  const response = await walletsClient.getWalletsWithBalances({
    blockchain: "ARC-TESTNET",
    walletSetId,
    amountGte: "0.01",
    pageSize: 50,
  });
  const wallets = response.data?.wallets || response.data?.data?.wallets || [];
  const wallet = wallets.find((candidate) => candidate.id && candidate.state === "LIVE");
  if (!wallet?.id) throw new Error("no funded LIVE Arc Testnet wallet is available for deployment");
  return wallet.id;
}

async function waitForContract(client, contractId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await client.getContract({ id: contractId });
    const contract = response.data?.contract || response.data?.data?.contract;
    const status = contract?.status || contract?.deploymentStatus;
    if (status === "COMPLETE") return contract;
    if (status === "FAILED") {
      throw new Error(`Circle deployment failed: ${contract.deploymentErrorReason || contract.deploymentErrorDetails || "unknown reason"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Circle deployment did not complete before timeout");
}

async function main() {
  const apiKey = required("CIRCLE_API_KEY");
  const entitySecret = required("CIRCLE_ENTITY_SECRET");
  const walletSetId = required("CIRCLE_WALLET_SET_ID");
  const artifactPath = "artifacts/arc/AgentRegistry.sol/AgentRegistry.json";
  const sourcePath = "contracts/arc/AgentRegistry.sol";
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const source = readFileSync(sourcePath);
  const bytecode = artifact.bytecode?.object;
  if (typeof bytecode !== "string" || !bytecode.startsWith("0x") || bytecode.length <= 2) {
    throw new Error("compiled AgentRegistry bytecode is missing");
  }

  const sourceDigest = sha256(source);
  const walletsClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  const contractsClient = initiateSmartContractPlatformClient({ apiKey, entitySecret });
  const walletId = await fundedArcWallet(walletsClient, walletSetId);
  const deployed = await contractsClient.deployContract({
    name: "ArenaISSAgentRegistry",
    description: "Unaudited Arc Testnet registry for Arena ISS agent commitments",
    blockchain: "ARC-TESTNET",
    walletId,
    abiJson: JSON.stringify(artifact.abi),
    bytecode,
    constructorParameters: [],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey: deploymentIdempotencyKey(sourceDigest),
    refId: `arena-iss-agent-registry-${sourceDigest.slice(0, 12)}`,
  });
  const contractId = deployed.data?.contractId;
  if (!contractId) throw new Error("Circle returned no contract deployment id");
  const contract = await waitForContract(contractsClient, contractId);
  const address = getAddress(contract.contractAddress || contract.address);
  const txHash = contract.txHash;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) throw new Error("Circle returned no deployment transaction hash");

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  if ((await publicClient.getChainId()) !== ARC_CHAIN_ID) throw new Error("wrong Arc chain");
  const [record, code, receipt] = await Promise.all([
    publicClient.readContract({ address, abi: artifact.abi, functionName: "agents", args: [zeroHash] }),
    publicClient.getCode({ address }),
    publicClient.getTransactionReceipt({ hash: txHash }),
  ]);
  if (!Array.isArray(record) || record.length !== 4 || record[0] !== ZERO_ADDRESS || record[3] !== false) {
    throw new Error("AgentRegistry state readback mismatch");
  }
  if (!code || code === "0x" || receipt.status !== "success") throw new Error("AgentRegistry onchain readback failed");

  process.stdout.write(`${JSON.stringify({
    network: "arc-testnet",
    chain_id: ARC_CHAIN_ID,
    contract: "AgentRegistry",
    circle_contract_id: contractId,
    address,
    deployment_transaction: txHash,
    block_number: Number(receipt.blockNumber),
    deployer: contract.deployerAddress,
    gas_used: receipt.gasUsed.toString(),
    effective_gas_price_wei: receipt.effectiveGasPrice.toString(),
    source_sha256: sourceDigest,
    creation_bytecode_sha256: sha256(Buffer.from(bytecode.slice(2), "hex")),
    runtime_bytecode_sha256: sha256(Buffer.from(code.slice(2), "hex")),
    status: "DEPLOYED_UNAUDITED_REGISTRY",
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAILED", error: error instanceof Error ? error.message : "unknown error" })}\n`);
  process.exitCode = 1;
});
