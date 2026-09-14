import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

import type { CircleWalletPort } from './managed-identity.ts';

type CircleClient = {
  createWallets(input: {
    accountType: 'EOA'; blockchains: ['ARC-TESTNET']; count: 1; walletSetId: string;
    idempotencyKey: string; metadata: [{ name: string; refId: string }];
  }): Promise<{ data?: { wallets?: Array<{ id?: string; address?: string }> } }>;
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
      accountType: 'EOA',
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
}

export function circleManagedWalletFromSecrets(input: { apiKey: string; entitySecret: string; walletSetId: string }): CircleManagedWalletAdapter {
  const client = initiateDeveloperControlledWalletsClient({ apiKey: input.apiKey, entitySecret: input.entitySecret });
  return new CircleManagedWalletAdapter(client, input.walletSetId);
}
