import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, getAddress, http, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const ARC_CHAIN_ID = 5_042_002;

function requiredPrivateKey() {
  const value = process.env.ARC_PRIVATE_KEY || process.env.STUDIONET_PRIVATE_KEY;
  if (!value || !/^(0x)?[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Arc deployer private key is missing or invalid");
  }
  return value.startsWith("0x") ? value : `0x${value}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const artifactPath = "artifacts/arc/AgentRegistry.sol/AgentRegistry.json";
  const sourcePath = "contracts/arc/AgentRegistry.sol";
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const source = readFileSync(sourcePath);
  const bytecode = artifact.bytecode?.object;
  if (typeof bytecode !== "string" || !bytecode.startsWith("0x") || bytecode.length <= 2) {
    throw new Error("compiled AgentRegistry bytecode is missing");
  }

  const account = privateKeyToAccount(requiredPrivateKey());
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });
  const chainId = await publicClient.getChainId();
  if (chainId !== ARC_CHAIN_ID) throw new Error(`wrong Arc chain: ${chainId}`);
  if ((await publicClient.getBalance({ address: account.address })) === 0n) {
    throw new Error("Arc deployer has no native USDC for gas");
  }

  const hash = await walletClient.deployContract({ account, abi: artifact.abi, bytecode });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error("AgentRegistry deployment reverted or returned no address");
  }

  const address = getAddress(receipt.contractAddress);
  const [emptyRecord, code] = await Promise.all([
    publicClient.readContract({ address, abi: artifact.abi, functionName: "agents", args: [zeroHash] }),
    publicClient.getCode({ address }),
  ]);
  if (!Array.isArray(emptyRecord) || emptyRecord.length !== 4 || emptyRecord[0] !== "0x0000000000000000000000000000000000000000") {
    throw new Error("AgentRegistry readback mismatch");
  }
  if (!code || code === "0x") throw new Error("AgentRegistry runtime bytecode is missing");

  process.stdout.write(`${JSON.stringify({
    network: "arc-testnet",
    chain_id: chainId,
    contract: "AgentRegistry",
    address,
    deployment_transaction: hash,
    block_number: Number(receipt.blockNumber),
    deployer: account.address,
    gas_used: receipt.gasUsed.toString(),
    effective_gas_price_wei: receipt.effectiveGasPrice.toString(),
    source_sha256: sha256(source),
    creation_bytecode_sha256: sha256(Buffer.from(bytecode.slice(2), "hex")),
    runtime_bytecode_sha256: sha256(Buffer.from(code.slice(2), "hex")),
    status: "DEPLOYED_UNAUDITED_REGISTRY",
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    status: "FAILED",
    error: error instanceof Error ? error.message : "unknown error",
  })}\n`);
  process.exitCode = 1;
});
