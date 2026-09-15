import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const ARC_CHAIN_ID = 5_042_002;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const EXPECTED_OWNER = "0xC495ef51618D03267A1f227aFe5b27B38c748272";

function privateKey() {
  const value = process.env.ARC_PRIVATE_KEY || process.env.STUDIONET_PRIVATE_KEY;
  if (!value || !/^(0x)?[0-9a-fA-F]{64}$/.test(value)) throw new Error("Arc deployer private key is missing or invalid");
  return value.startsWith("0x") ? value : `0x${value}`;
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const artifact = (path) => JSON.parse(readFileSync(path, "utf8"));

async function deployed(publicClient, walletClient, account, contractArtifact, args) {
  const hash = await walletClient.deployContract({ account, abi: contractArtifact.abi, bytecode: contractArtifact.bytecode.object, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("contract deployment failed");
  return { address: getAddress(receipt.contractAddress), hash, receipt };
}

async function main() {
  const registryArtifact = artifact("artifacts/arc/AgentRegistryV2.sol/AgentRegistryV2.json");
  const marketplaceArtifact = artifact("artifacts/arc/AgentMarketplace.sol/AgentMarketplace.json");
  const account = privateKeyToAccount(privateKey());
  if (getAddress(account.address) !== getAddress(EXPECTED_OWNER)) throw new Error("parent env key is not the configured Arena owner");
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });
  if (await publicClient.getChainId() !== ARC_CHAIN_ID) throw new Error("wrong Arc chain");
  if (await publicClient.getBalance({ address: account.address }) === 0n) throw new Error("owner has no Arc native USDC for gas");

  const registry = await deployed(publicClient, walletClient, account, registryArtifact, [account.address]);
  const marketplace = await deployed(publicClient, walletClient, account, marketplaceArtifact, [ARC_USDC, registry.address, account.address, account.address]);
  const configureHash = await walletClient.writeContract({ account, address: registry.address, abi: registryArtifact.abi, functionName: "configureMarketplace", args: [marketplace.address] });
  const configureReceipt = await publicClient.waitForTransactionReceipt({ hash: configureHash, confirmations: 1, timeout: 120_000 });
  if (configureReceipt.status !== "success") throw new Error("marketplace configuration failed");

  const [administrator, configuredMarketplace, usdc, boundRegistry, operator, platformRecipient, feeBps, registryCode, marketplaceCode] = await Promise.all([
    publicClient.readContract({ address: registry.address, abi: registryArtifact.abi, functionName: "administrator" }),
    publicClient.readContract({ address: registry.address, abi: registryArtifact.abi, functionName: "marketplace" }),
    publicClient.readContract({ address: marketplace.address, abi: marketplaceArtifact.abi, functionName: "usdc" }),
    publicClient.readContract({ address: marketplace.address, abi: marketplaceArtifact.abi, functionName: "registry" }),
    publicClient.readContract({ address: marketplace.address, abi: marketplaceArtifact.abi, functionName: "operator" }),
    publicClient.readContract({ address: marketplace.address, abi: marketplaceArtifact.abi, functionName: "platformRecipient" }),
    publicClient.readContract({ address: marketplace.address, abi: marketplaceArtifact.abi, functionName: "PLATFORM_FEE_BPS" }),
    publicClient.getCode({ address: registry.address }), publicClient.getCode({ address: marketplace.address }),
  ]);
  const expected = getAddress(account.address);
  if (getAddress(administrator) !== expected || getAddress(configuredMarketplace) !== marketplace.address || getAddress(usdc) !== getAddress(ARC_USDC)
    || getAddress(boundRegistry) !== registry.address || getAddress(operator) !== expected || getAddress(platformRecipient) !== expected || feeBps !== 100n
    || !registryCode || registryCode === "0x" || !marketplaceCode || marketplaceCode === "0x") throw new Error("Arc marketplace readback mismatch");

  process.stdout.write(`${JSON.stringify({ schema: "arena-marketplace-deployment-v1", network: "arc-testnet", chain_id: ARC_CHAIN_ID, usdc: ARC_USDC,
    owner: expected, registry: { address: registry.address, deployment_transaction: registry.hash, block_number: Number(registry.receipt.blockNumber), gas_used: registry.receipt.gasUsed.toString(), source_sha256: sha256(readFileSync("contracts/arc/AgentRegistryV2.sol")), runtime_bytecode_sha256: sha256(Buffer.from(registryCode.slice(2), "hex")) },
    marketplace: { address: marketplace.address, deployment_transaction: marketplace.hash, configure_transaction: configureHash, block_number: Number(marketplace.receipt.blockNumber), configure_block_number: Number(configureReceipt.blockNumber), gas_used: marketplace.receipt.gasUsed.toString(), configure_gas_used: configureReceipt.gasUsed.toString(), platform_fee_bps: Number(feeBps), source_sha256: sha256(readFileSync("contracts/arc/AgentMarketplace.sol")), runtime_bytecode_sha256: sha256(Buffer.from(marketplaceCode.slice(2), "hex")) }, status: "DEPLOYED_UNAUDITED_TESTNET" })}\n`);
}
main().catch((error) => { process.stderr.write(`${JSON.stringify({ status: "FAILED", error: error instanceof Error ? error.message : "unknown error" })}\n`); process.exitCode = 1; });
