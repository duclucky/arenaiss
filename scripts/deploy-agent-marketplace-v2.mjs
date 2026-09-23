import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const ARC_CHAIN_ID = 5_042_002;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const DEFAULT_IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const EXPECTED_OWNER = "0xC495ef51618D03267A1f227aFe5b27B38c748272";

function privateKey() {
  const value = process.env.ARC_PRIVATE_KEY || process.env.GENLAYER_OWNER_PRIVATE_KEY || process.env.STUDIONET_PRIVATE_KEY;
  if (!value || !/^(0x)?[0-9a-fA-F]{64}$/.test(value)) throw new Error("Arc deployer private key is missing or invalid");
  return value.startsWith("0x") ? value : `0x${value}`;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function main() {
  const artifact = JSON.parse(readFileSync("artifacts/arc/AgentMarketplaceV2.sol/AgentMarketplaceV2.json", "utf8"));
  const account = privateKeyToAccount(privateKey());
  const identityRegistry = getAddress(process.env.ARC_ERC8004_IDENTITY_REGISTRY_ADDRESS || DEFAULT_IDENTITY_REGISTRY);
  if (getAddress(account.address) !== getAddress(EXPECTED_OWNER)) throw new Error("environment key is not the configured Arena owner");

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });
  if (await publicClient.getChainId() !== ARC_CHAIN_ID) throw new Error("wrong Arc chain");
  if (await publicClient.getBalance({ address: account.address }) === 0n) throw new Error("owner has no Arc native USDC for gas");
  const identityCode = await publicClient.getCode({ address: identityRegistry });
  if (!identityCode || identityCode === "0x") throw new Error("ERC-8004 Identity Registry is not deployed");

  const hash = await walletClient.deployContract({
    account,
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [ARC_USDC, identityRegistry, account.address, account.address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("contract deployment failed");
  const marketplace = getAddress(receipt.contractAddress);

  const [usdc, boundRegistry, operator, platformRecipient, feeBps, marketplaceCode] = await Promise.all([
    publicClient.readContract({ address: marketplace, abi: artifact.abi, functionName: "usdc" }),
    publicClient.readContract({ address: marketplace, abi: artifact.abi, functionName: "identityRegistry" }),
    publicClient.readContract({ address: marketplace, abi: artifact.abi, functionName: "operator" }),
    publicClient.readContract({ address: marketplace, abi: artifact.abi, functionName: "platformRecipient" }),
    publicClient.readContract({ address: marketplace, abi: artifact.abi, functionName: "PLATFORM_FEE_BPS" }),
    publicClient.getCode({ address: marketplace }),
  ]);
  const expected = getAddress(account.address);
  if (getAddress(usdc) !== getAddress(ARC_USDC) || getAddress(boundRegistry) !== identityRegistry || getAddress(operator) !== expected
    || getAddress(platformRecipient) !== expected || feeBps !== 100n || !marketplaceCode || marketplaceCode === "0x") throw new Error("Arc Marketplace V2 readback mismatch");

  process.stdout.write(`${JSON.stringify({
    schema: "arena-marketplace-deployment-v2",
    network: "arc-testnet",
    chain_id: ARC_CHAIN_ID,
    usdc: ARC_USDC,
    erc8004_identity_registry: identityRegistry,
    owner: expected,
    marketplace: {
      address: marketplace,
      deployment_transaction: hash,
      block_number: Number(receipt.blockNumber),
      gas_used: receipt.gasUsed.toString(),
      platform_fee_bps: Number(feeBps),
      source_sha256: sha256(readFileSync("contracts/arc/AgentMarketplaceV2.sol")),
      runtime_bytecode_sha256: sha256(Buffer.from(marketplaceCode.slice(2), "hex")),
    },
    status: "DEPLOYED_ARC_STUDIO_REVIEWED_TESTNET",
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAILED", error: error instanceof Error ? error.message : "unknown error" })}\n`);
  process.exitCode = 1;
});
