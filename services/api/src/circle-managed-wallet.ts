import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import type { CircleWalletPort, UsdcBalance, WalletTransactionResult } from './managed-identity.ts';

const ARC_USDC = '0x3600000000000000000000000000000000000000';
const TOKEN_MESSENGER_V2 = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const FORWARD_HOOK = '0x636374702d666f72776172640000000000000000000000000000000000000000';
const CHAINS = [
  { chain: 'ARC-TESTNET', label: 'Arc Testnet', usdc: ARC_USDC, domain: 26, isArc: true, fast: false },
  { chain: 'ETH-SEPOLIA', label: 'Ethereum Sepolia', usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', domain: 0, isArc: false, fast: true },
  { chain: 'BASE-SEPOLIA', label: 'Base Sepolia', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', domain: 6, isArc: false, fast: true },
  { chain: 'ARB-SEPOLIA', label: 'Arbitrum Sepolia', usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', domain: 3, isArc: false, fast: true },
  { chain: 'AVAX-FUJI', label: 'Avalanche Fuji', usdc: '0x5425890298aed601595a70AB815c96711a31Bc65', domain: 1, isArc: false, fast: false },
  { chain: 'OP-SEPOLIA', label: 'OP Sepolia', usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', domain: 2, isArc: false, fast: true },
  { chain: 'MATIC-AMOY', label: 'Polygon Amoy', usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', domain: 7, isArc: false, fast: false },
  { chain: 'UNI-SEPOLIA', label: 'Unichain Sepolia', usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F', domain: 10, isArc: false, fast: false },
  { chain: 'MONAD-TESTNET', label: 'Monad Testnet', usdc: '0x534b2f3A21130d7a60830c2Df862319e593943A3', domain: 15, isArc: false, fast: false },
] as const;

type CircleClient = {
  createWallets(input: {
    accountType: 'SCA'; blockchains: ['ARC-TESTNET']; count: 1; walletSetId: string;
    idempotencyKey: string; metadata: [{ name: string; refId: string }];
  }): Promise<{ data?: { wallets?: Array<{ id?: string; address?: string }> } }>;
  deriveWallet(input: { id: string; blockchain: string }): Promise<{ data?: { wallet?: { id?: string; address?: string } } }>;
  getWalletTokenBalance(input: { id: string }): Promise<{ data?: { tokenBalances?: Array<{ amount?: string; token?: { id?: string; blockchain?: string; symbol?: string; tokenAddress?: string; isNative?: boolean } }> } }>;
  createTransaction(input: Record<string, unknown>): Promise<{ data?: { id?: string; state?: string } }>;
  createContractExecutionTransaction(input: Record<string, unknown>): Promise<{ data?: { id?: string; state?: string } }>;
  getTransaction(input: { id: string; waitForState?: string; waitForTxHash?: boolean; pollingInterval?: number }): Promise<{ data?: { transaction?: { id?: string; state?: string; txHash?: string } } }>;
};

export class CircleManagedWalletAdapter implements CircleWalletPort {
  private readonly client: CircleClient;
  private readonly walletSetId: string;

  constructor(client: CircleClient, walletSetId: string) {
    if (!walletSetId || walletSetId.length > 160) throw new Error('CIRCLE_WALLET_SET_ID is invalid');
    this.client = client;
    this.walletSetId = walletSetId;
  }

  async createWallet(input: { userId: string; idempotencyKey: string }) {
    const response = await this.client.createWallets({
      accountType: 'SCA',
      blockchains: ['ARC-TESTNET'],
      count: 1,
      walletSetId: this.walletSetId,
      idempotencyKey: input.idempotencyKey,
      metadata: [{ name: 'Arena ISS managed wallet', refId: input.userId }],
    });
    const wallet = response.data?.wallets?.[0];
    if (!wallet?.id || !wallet.address || response.data?.wallets?.length !== 1) throw new Error('Circle returned an invalid wallet response');
    return { walletId: wallet.id, address: wallet.address };
  }

  async listUsdcBalances(input: { walletId: string; address: string }): Promise<UsdcBalance[]> {
    const rows = await Promise.all(CHAINS.map(async (config) => {
      try {
        const walletId = config.isArc ? input.walletId : await this.derivedWalletId(input.walletId, input.address, config.chain);
        const response = await this.client.getWalletTokenBalance({ id: walletId });
        const token = response.data?.tokenBalances?.find((balance) => !balance.token?.isNative
          && (balance.token?.tokenAddress?.toLowerCase() === config.usdc.toLowerCase() || balance.token?.symbol === 'USDC'));
        return { chain: config.chain, label: config.label, amount: normalizeCircleAmount(token?.amount), isArc: config.isArc, available: true };
      } catch {
        return { chain: config.chain, label: config.label, amount: '0', isArc: config.isArc, available: false };
      }
    }));
    return rows.filter((row) => row.isArc || (row.available && BigInt(decimalToBaseUnits(row.amount)) > 0n));
  }

  async transferUsdc(input: { walletId: string; destinationAddress: string; amount: string; idempotencyKey: string }): Promise<WalletTransactionResult> {
    const balances = await this.client.getWalletTokenBalance({ id: input.walletId });
    const usdc = balances.data?.tokenBalances?.find((balance) => !balance.token?.isNative
      && balance.token?.blockchain === 'ARC-TESTNET'
      && balance.token?.tokenAddress?.toLowerCase() === ARC_USDC.toLowerCase());
    if (!usdc?.token?.id) throw new Error('Circle did not return Arc USDC token metadata');
    const response = await this.client.createTransaction({
      walletId: input.walletId,
      tokenId: usdc.token.id,
      destinationAddress: input.destinationAddress,
      amount: [input.amount],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      idempotencyKey: input.idempotencyKey,
      refId: 'arena-iss-usdc-withdrawal',
    });
    const transactionId = response.data?.id;
    if (!transactionId) throw new Error('Circle returned an invalid transaction response');
    const submitted = await this.client.getTransaction({ id: transactionId, waitForTxHash: true, pollingInterval: 1000 });
    const result = this.transactionResult(submitted.data?.transaction, 'https://testnet.arcscan.app/tx/');
    if (!result.txHash) throw new Error('Circle did not return an Arc USDC transaction hash');
    return result;
  }

  async holdEvaluationFee(input: { walletId: string; escrowAddress: string; campaignId: string; amountUsdc: string; approvalIdempotencyKey: string; depositIdempotencyKey: string }): Promise<{ approval: WalletTransactionResult; deposit: WalletTransactionResult }> {
    const amount = decimalToBaseUnits(input.amountUsdc);
    const approval = await this.executeComplete(input.walletId, ARC_USDC, 'approve(address,uint256)', [input.escrowAddress, amount], input.approvalIdempotencyKey, 'arena-iss-evo-fee-approve');
    const deposit = await this.executeComplete(input.walletId, input.escrowAddress, 'deposit(bytes32)', [digestBytes32(input.campaignId)], input.depositIdempotencyKey, 'arena-iss-evo-fee-deposit');
    return { approval, deposit };
  }

  async registerAgent(input: { walletId: string; registryAddress: string; agentId: string; agentsVersion: string; agentsCommitment: string; idempotencyKey: string }): Promise<WalletTransactionResult> {
    return this.executeRegistry(input.walletId, input.registryAddress, 'registerAgent(bytes32,bytes32,bytes32)', [digestBytes32(input.agentId), digestBytes32(input.agentsVersion), digestBytes32(input.agentsCommitment)], input.idempotencyKey, 'arena-iss-agent-register');
  }

  async deactivateAgent(input: { walletId: string; registryAddress: string; agentId: string; idempotencyKey: string }): Promise<WalletTransactionResult> {
    return this.executeRegistry(input.walletId, input.registryAddress, 'deactivateAgent(bytes32)', [digestBytes32(input.agentId)], input.idempotencyKey, 'arena-iss-agent-deactivate');
  }

  async marketplaceCreateListing(input: { walletId: string; marketplaceAddress: string; agentId: string; version: string; commitment: string; certificateDigest: string; price: string; expiresAt: number; idempotencyKey: string }): Promise<WalletTransactionResult> {
    return this.executeRegistry(input.walletId, input.marketplaceAddress, 'createListing(bytes32,bytes32,bytes32,bytes32,uint128,uint64)', [digestBytes32(input.agentId), digestBytes32(input.version), digestBytes32(input.commitment), digestBytes32(input.certificateDigest), input.price, String(input.expiresAt)], input.idempotencyKey, 'arena-iss-marketplace-listing');
  }

  async marketplaceBuy(input: { walletId: string; marketplaceAddress: string; listingId: string; price: string; approvalIdempotencyKey: string; buyIdempotencyKey: string }): Promise<WalletTransactionResult> {
    const balances = await this.client.getWalletTokenBalance({ id: input.walletId });
    const token = balances.data?.tokenBalances?.find((balance) => !balance.token?.isNative && balance.token?.blockchain === 'ARC-TESTNET' && balance.token?.tokenAddress?.toLowerCase() === ARC_USDC.toLowerCase());
    if (!token?.token?.id) throw new Error('Circle did not return Arc USDC token metadata');
    const approval = await this.client.createContractExecutionTransaction({ walletId: input.walletId, contractAddress: ARC_USDC, abiFunctionSignature: 'approve(address,uint256)', abiParameters: [input.marketplaceAddress, input.price], fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }, idempotencyKey: input.approvalIdempotencyKey, refId: 'arena-iss-marketplace-approve' });
    if (!approval.data?.id) throw new Error('Circle returned an invalid marketplace approval response');
    await this.client.getTransaction({ id: approval.data.id, waitForState: 'COMPLETE', pollingInterval: 1000 });
    return this.executeRegistry(input.walletId, input.marketplaceAddress, 'buy(uint256)', [input.listingId], input.buyIdempotencyKey, 'arena-iss-marketplace-buy');
  }

  async bridgeUsdcToArc(input: { walletId: string; address: string; sourceChain: string; amount: string; approvalIdempotencyKey: string; burnIdempotencyKey: string; onProgress?: (state: 'APPROVING' | 'BURNING') => void }): Promise<WalletTransactionResult> {
    const config = CHAINS.find((chain) => chain.chain === input.sourceChain && chain.fast);
    if (!config) throw new Error('unsupported CCTP source chain');
    const sourceWalletId = await this.derivedWalletId(input.walletId, input.address, config.chain);
    const amount = BigInt(decimalToBaseUnits(input.amount));
    const feeResponse = await fetch(`https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/${config.domain}/26?forward=true`, { headers: { accept: 'application/json' } });
    if (!feeResponse.ok) throw new Error('CCTP fee quote unavailable');
    const quotes = await feeResponse.json() as Array<{ finalityThreshold?: number; minimumFee?: number; forwardFee?: { med?: number | string } }>;
    const quote = quotes.find((item) => item.finalityThreshold === 1000);
    if (!quote || quote.forwardFee?.med === undefined || quote.minimumFee === undefined) throw new Error('CCTP fast forwarding unavailable');
    const forwardFee = BigInt(quote.forwardFee.med);
    const protocolFee = (amount * BigInt(Math.round(quote.minimumFee * 100))) / 1_000_000n;
    const maxFee = forwardFee + protocolFee;
    const totalAmount = amount + maxFee;
    const approval = await this.client.createContractExecutionTransaction({
      walletId: sourceWalletId, contractAddress: config.usdc,
      abiFunctionSignature: 'approve(address,uint256)', abiParameters: [TOKEN_MESSENGER_V2, totalAmount.toString()],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }, idempotencyKey: input.approvalIdempotencyKey, refId: 'arena-iss-cctp-approve',
    });
    const approvalId = approval.data?.id;
    if (!approvalId) throw new Error('Circle did not create CCTP approval');
    input.onProgress?.('APPROVING');
    await this.client.getTransaction({ id: approvalId, waitForState: 'COMPLETE', pollingInterval: 1500 });
    input.onProgress?.('BURNING');
    const recipient = `0x${'0'.repeat(24)}${input.address.slice(2).toLowerCase()}`;
    const burn = await this.client.createContractExecutionTransaction({
      walletId: sourceWalletId, contractAddress: TOKEN_MESSENGER_V2,
      abiFunctionSignature: 'depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)',
      abiParameters: [totalAmount.toString(), 26, recipient, config.usdc, ZERO_BYTES32, maxFee.toString(), 1000, FORWARD_HOOK],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }, idempotencyKey: input.burnIdempotencyKey, refId: 'arena-iss-cctp-to-arc',
    });
    const burnId = burn.data?.id;
    if (!burnId) throw new Error('Circle did not create CCTP burn');
    const submitted = await this.client.getTransaction({ id: burnId, waitForTxHash: true, pollingInterval: 1000 });
    const result = this.transactionResult(submitted.data?.transaction, sourceExplorer(config.chain));
    if (!result.txHash) throw new Error('Circle did not return a CCTP burn transaction hash');
    return result;
  }

  private async derivedWalletId(walletId: string, expectedAddress: string, blockchain: string): Promise<string> {
    const response = await this.client.deriveWallet({ id: walletId, blockchain });
    const wallet = response.data?.wallet;
    if (!wallet?.id || wallet.address?.toLowerCase() !== expectedAddress.toLowerCase()) throw new Error('Circle returned an invalid derived wallet');
    return wallet.id;
  }

  private async executeRegistry(walletId: string, contractAddress: string, abiFunctionSignature: string, abiParameters: string[], idempotencyKey: string, refId: string): Promise<WalletTransactionResult> {
    const response = await this.client.createContractExecutionTransaction({
      walletId, contractAddress, abiFunctionSignature, abiParameters,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }, idempotencyKey, refId,
    });
    if (!response.data?.id) throw new Error('Circle returned an invalid transaction response');
    const submitted = await this.client.getTransaction({ id: response.data.id, waitForTxHash: true, pollingInterval: 1000 });
    if (!submitted.data?.transaction?.txHash) throw new Error('Circle did not return an Arc transaction hash');
    return this.transactionResult(submitted.data?.transaction, 'https://testnet.arcscan.app/tx/');
  }

  private async executeComplete(walletId: string, contractAddress: string, abiFunctionSignature: string, abiParameters: string[], idempotencyKey: string, refId: string): Promise<WalletTransactionResult> {
    const response = await this.client.createContractExecutionTransaction({ walletId, contractAddress, abiFunctionSignature, abiParameters, fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }, idempotencyKey, refId });
    if (!response.data?.id) throw new Error('Circle returned an invalid transaction response');
    const completed = await this.client.getTransaction({ id: response.data.id, waitForState: 'COMPLETE', pollingInterval: 1000 });
    const result = this.transactionResult(completed.data?.transaction, 'https://testnet.arcscan.app/tx/');
    if (result.state !== 'COMPLETE' || !result.txHash) throw new Error('Circle Arc contract execution did not complete');
    return result;
  }

  private transactionResult(data: { id?: string; state?: string; txHash?: string } | undefined, explorerBase: string): WalletTransactionResult {
    if (!data?.id) throw new Error('Circle returned an invalid transaction response');
    return { transactionId: data.id, state: data.state || 'INITIATED', txHash: data.txHash, explorerUrl: data.txHash ? `${explorerBase}${data.txHash}` : undefined };
  }
}

function normalizeCircleAmount(value: string | undefined): string {
  return value && /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) ? value : '0';
}

function decimalToBaseUnits(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0')).toString();
}

function digestBytes32(value: string): string {
  if (!/^sha256:[0-9a-fA-F]{64}$/.test(value)) throw new Error('invalid agent digest');
  return `0x${value.slice(7).toLowerCase()}`;
}

function sourceExplorer(chain: string): string {
  return ({
    'ETH-SEPOLIA': 'https://sepolia.etherscan.io/tx/', 'BASE-SEPOLIA': 'https://sepolia.basescan.org/tx/',
    'ARB-SEPOLIA': 'https://sepolia.arbiscan.io/tx/', 'AVAX-FUJI': 'https://testnet.snowtrace.io/tx/',
    'OP-SEPOLIA': 'https://sepolia-optimism.etherscan.io/tx/', 'MATIC-AMOY': 'https://amoy.polygonscan.com/tx/',
  } as Record<string, string>)[chain] || '';
}

export function circleManagedWalletFromSecrets(input: { apiKey: string; entitySecret: string; walletSetId: string }): CircleManagedWalletAdapter {
  const client = initiateDeveloperControlledWalletsClient({ apiKey: input.apiKey, entitySecret: input.entitySecret });
  return new CircleManagedWalletAdapter(client, input.walletSetId);
}
