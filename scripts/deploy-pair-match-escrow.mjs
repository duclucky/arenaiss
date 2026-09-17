import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, getAddress, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';

const CHAIN_ID = 5_042_002;
const USDC = getAddress('0x3600000000000000000000000000000000000000');
const OPERATOR = getAddress('0xC495ef51618D03267A1f227aFe5b27B38c748272');
const sha256 = (input) => createHash('sha256').update(input).digest('hex');

async function main() {
  const rawKey = process.env.ARC_PRIVATE_KEY || process.env.STUDIONET_PRIVATE_KEY;
  if (!rawKey || !/^(0x)?[0-9a-fA-F]{64}$/.test(rawKey)) throw new Error('Arc operator signer is missing or invalid');
  const account = privateKeyToAccount(rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`);
  if (getAddress(account.address) !== OPERATOR) throw new Error('Arc deployer does not match the configured pair operator');
  const source = readFileSync('contracts/arc/PairMatchEscrow.sol');
  const artifact = JSON.parse(readFileSync('artifacts/arc/PairMatchEscrow.sol/PairMatchEscrow.json', 'utf8'));
  const bytecode = artifact.bytecode?.object;
  if (typeof bytecode !== 'string' || !bytecode.startsWith('0x') || bytecode.length <= 2) throw new Error('compiled PairMatchEscrow bytecode is missing');
  const rpc = process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network';
  if (new URL(rpc).protocol !== 'https:') throw new Error('Arc RPC must use HTTPS');
  const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(rpc) });
  if (await client.getChainId() !== CHAIN_ID) throw new Error('wrong Arc chain');
  if (await client.getBalance({ address: account.address }) === 0n) throw new Error('operator has no Arc USDC gas balance');
  const transactionHash = await wallet.deployContract({ account, abi: artifact.abi, bytecode, args: [USDC, OPERATOR] });
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('pair escrow deployment failed');
  const address = getAddress(receipt.contractAddress);
  const [usdc, operator, code] = await Promise.all([
    client.readContract({ address, abi: artifact.abi, functionName: 'usdc' }),
    client.readContract({ address, abi: artifact.abi, functionName: 'operator' }),
    client.getCode({ address }),
  ]);
  if (getAddress(usdc) !== USDC || getAddress(operator) !== OPERATOR || !code || code === '0x') throw new Error('pair escrow deployment readback mismatch');
  process.stdout.write(`${JSON.stringify({ schema: 'arena-pair-escrow-deployment-v1', network: 'arc-testnet', chain_id: CHAIN_ID,
    address, deployment_transaction: transactionHash, block_number: Number(receipt.blockNumber), gas_used: receipt.gasUsed.toString(),
    usdc: getAddress(usdc), operator: getAddress(operator), source_sha256: sha256(source),
    runtime_bytecode_sha256: sha256(Buffer.from(code.slice(2), 'hex')), status: 'DEPLOYED_UNAUDITED_TESTNET' })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', error: error instanceof Error ? error.message : 'unknown error' })}\n`);
  process.exitCode = 1;
});
