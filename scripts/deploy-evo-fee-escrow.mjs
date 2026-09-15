import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const ARC_CHAIN_ID = 5_042_002;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const EXPECTED_OPERATOR = "0xC495ef51618D03267A1f227aFe5b27B38c748272";
const FIXED_FEE = 1_000_000n;
const REFUND_DELAY = 86_400n;

function privateKey() {
  const value = process.env.ARC_PRIVATE_KEY || process.env.GENLAYER_OWNER_PRIVATE_KEY || process.env.STUDIONET_PRIVATE_KEY;
  if (!value || !/^(0x)?[0-9a-fA-F]{64}$/.test(value)) throw new Error("Arc deployer private key is missing or invalid");
  return value.startsWith("0x") ? value : `0x${value}`;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function main() {
  const source = readFileSync("contracts/arc/EvoFeeEscrow.sol");
  const artifact = JSON.parse(readFileSync("artifacts/arc/EvoFeeEscrow.sol/EvoFeeEscrow.json", "utf8"));
  const account = privateKeyToAccount(privateKey());
  if (getAddress(account.address) !== getAddress(EXPECTED_OPERATOR)) throw new Error("deployer is not the configured Arena operator");

  const rpcUrl = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) });
  if (await publicClient.getChainId() !== ARC_CHAIN_ID) throw new Error("wrong Arc chain");
  if (await publicClient.getBalance({ address: account.address }) === 0n) throw new Error("operator has no Arc native USDC for gas");

  const deploymentTransaction = await walletClient.deployContract({
    account,
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [ARC_USDC, account.address, account.address, FIXED_FEE, REFUND_DELAY],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Evo fee escrow deployment failed");
  const address = getAddress(receipt.contractAddress);

  const [usdc, operator, feeRecipient, fixedFee, refundDelay, runtimeCode] = await Promise.all([
    publicClient.readContract({ address, abi: artifact.abi, functionName: "usdc" }),
    publicClient.readContract({ address, abi: artifact.abi, functionName: "operator" }),
    publicClient.readContract({ address, abi: artifact.abi, functionName: "feeRecipient" }),
    publicClient.readContract({ address, abi: artifact.abi, functionName: "fixedFee" }),
    publicClient.readContract({ address, abi: artifact.abi, functionName: "refundDelay" }),
    publicClient.getCode({ address }),
  ]);
  if (getAddress(usdc) !== getAddress(ARC_USDC) || getAddress(operator) !== getAddress(EXPECTED_OPERATOR)
    || getAddress(feeRecipient) !== getAddress(EXPECTED_OPERATOR) || fixedFee !== FIXED_FEE || refundDelay !== REFUND_DELAY
    || !runtimeCode || runtimeCode === "0x") throw new Error("Evo fee escrow readback mismatch");

  process.stdout.write(`${JSON.stringify({
    schema: "arena-evo-fee-escrow-deployment-v1",
    network: "arc-testnet",
    chain_id: ARC_CHAIN_ID,
    address,
    deployment_transaction: deploymentTransaction,
    block_number: Number(receipt.blockNumber),
    gas_used: receipt.gasUsed.toString(),
    usdc: getAddress(usdc),
    operator: getAddress(operator),
    fee_recipient: getAddress(feeRecipient),
    fixed_fee_base_units: fixedFee.toString(),
    refund_delay_seconds: refundDelay.toString(),
    source_sha256: sha256(source),
    runtime_bytecode_sha256: sha256(Buffer.from(runtimeCode.slice(2), "hex")),
    status: "DEPLOYED_UNAUDITED_TESTNET",
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAILED", error: error instanceof Error ? error.message : "unknown error" })}\n`);
  process.exitCode = 1;
});
