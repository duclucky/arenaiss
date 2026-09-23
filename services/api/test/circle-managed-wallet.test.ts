import assert from 'node:assert/strict';
import test from 'node:test';

import { CircleManagedWalletAdapter } from '../src/circle-managed-wallet.ts';

test('Circle adapter creates exactly one Arc Testnet SCA for automatic Gas Station sponsorship', async () => {
  const lookups: any[] = [];
  const calls: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async listWallets(input: any) {
      lookups.push(input);
      return { data: { wallets: [] } };
    },
    async createWallets(input: any) {
      calls.push(input);
      return { data: { wallets: [{ id: 'wallet-id', address: '0x1111111111111111111111111111111111111111' }] } };
    },
  } as any, 'wallet-set-id');

  const result = await adapter.createWallet({
    userId: `usr_${'a'.repeat(64)}`,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  });

  assert.deepEqual(lookups, [{
    blockchain: 'ARC-TESTNET',
    walletSetId: 'wallet-set-id',
    refId: `usr_${'a'.repeat(64)}`,
  }]);
  assert.deepEqual(calls, [{
    accountType: 'SCA',
    blockchains: ['ARC-TESTNET'],
    count: 1,
    walletSetId: 'wallet-set-id',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    metadata: [{ name: 'Arena ISS managed wallet', refId: `usr_${'a'.repeat(64)}` }],
  }]);
  assert.deepEqual(result, { walletId: 'wallet-id', address: '0x1111111111111111111111111111111111111111' });
});

test('Circle adapter restores the existing live Arc Testnet SCA by stable Arena user refId', async () => {
  let creates = 0;
  const adapter = new CircleManagedWalletAdapter({
    async listWallets() {
      return { data: { wallets: [{
        id: 'existing-wallet-id', address: '0x2222222222222222222222222222222222222222',
        blockchain: 'ARC-TESTNET', accountType: 'SCA', state: 'LIVE',
        walletSetId: 'wallet-set-id', refId: `usr_${'c'.repeat(64)}`,
      }] } };
    },
    async createWallets() {
      creates += 1;
      return { data: { wallets: [] } };
    },
  } as any, 'wallet-set-id');

  const result = await adapter.createWallet({
    userId: `usr_${'c'.repeat(64)}`,
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
  });

  assert.equal(creates, 0);
  assert.deepEqual(result, {
    walletId: 'existing-wallet-id',
    address: '0x2222222222222222222222222222222222222222',
  });
});

test('Circle adapter fails closed when managed wallet recovery is ambiguous', async () => {
  let creates = 0;
  const userId = `usr_${'d'.repeat(64)}`;
  const adapter = new CircleManagedWalletAdapter({
    async listWallets() {
      return { data: { wallets: [
        { id: 'old-wallet', address: '0x3333333333333333333333333333333333333333', blockchain: 'ARC-TESTNET', accountType: 'SCA', state: 'LIVE', walletSetId: 'wallet-set-id', refId: userId },
        { id: 'new-wallet', address: '0x4444444444444444444444444444444444444444', blockchain: 'ARC-TESTNET', accountType: 'SCA', state: 'LIVE', walletSetId: 'wallet-set-id', refId: userId },
      ] } };
    },
    async createWallets() {
      creates += 1;
      return { data: { wallets: [] } };
    },
  } as any, 'wallet-set-id');

  await assert.rejects(
    adapter.createWallet({ userId, idempotencyKey: '33333333-3333-4333-8333-333333333333' }),
    /ambiguous managed wallet recovery/,
  );
  assert.equal(creates, 0);
});

test('Circle adapter fails closed when Circle returns a non-canonical recovery candidate', async () => {
  let creates = 0;
  const userId = `usr_${'e'.repeat(64)}`;
  const adapter = new CircleManagedWalletAdapter({
    async listWallets() {
      return { data: { wallets: [{
        id: 'frozen-wallet', address: '0x5555555555555555555555555555555555555555',
        blockchain: 'ARC-TESTNET', accountType: 'SCA', state: 'FROZEN',
        walletSetId: 'wallet-set-id', refId: userId,
      }] } };
    },
    async createWallets() {
      creates += 1;
      return { data: { wallets: [] } };
    },
  } as any, 'wallet-set-id');

  await assert.rejects(
    adapter.createWallet({ userId, idempotencyKey: '44444444-4444-4444-8444-444444444444' }),
    /invalid managed wallet recovery/,
  );
  assert.equal(creates, 0);
});

test('Circle adapter rejects incomplete or multiple-wallet responses', async () => {
  const adapter = new CircleManagedWalletAdapter({
    async listWallets() { return { data: { wallets: [] } }; },
    async createWallets() { return { data: { wallets: [] } }; },
  } as any, 'wallet-set-id');
  await assert.rejects(
    adapter.createWallet({ userId: `usr_${'b'.repeat(64)}`, idempotencyKey: 'idempotency-key' }),
    /invalid wallet response/,
  );
});

test('Circle adapter registers and deactivates an Agent through the Arc registry', async () => {
  const executions: any[] = [];
  const waits: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async createContractExecutionTransaction(input: any) { executions.push(input); return { data: { id: `tx-${executions.length}` } }; },
    async getTransaction(input: any) { waits.push(input); return { data: { transaction: { id: input.id, state: 'COMPLETE', txHash: `0x${String(executions.length).repeat(64)}` } } }; },
  } as any, 'wallet-set-id');
  const registryAddress = '0x3333333333333333333333333333333333333333';
  const agentId = `sha256:${'a'.repeat(64)}`;
  const agentsVersion = `sha256:${'b'.repeat(64)}`;
  const agentsCommitment = `sha256:${'c'.repeat(64)}`;

  const registered = await adapter.registerAgent({ walletId: 'wallet-id', registryAddress, agentId, agentsVersion, agentsCommitment, idempotencyKey: 'register-key' });
  const deactivated = await adapter.deactivateAgent({ walletId: 'wallet-id', registryAddress, agentId, idempotencyKey: 'deactivate-key' });

  assert.equal(executions[0].abiFunctionSignature, 'registerAgent(bytes32,bytes32,bytes32)');
  assert.deepEqual(executions[0].abiParameters, [`0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`, `0x${'c'.repeat(64)}`]);
  assert.equal(executions[1].abiFunctionSignature, 'deactivateAgent(bytes32)');
  assert.deepEqual(executions[1].abiParameters, [`0x${'a'.repeat(64)}`]);
  assert.match(registered.explorerUrl!, /^https:\/\/testnet\.arcscan\.app\/tx\//);
  assert.match(deactivated.explorerUrl!, /^https:\/\/testnet\.arcscan\.app\/tx\//);
  assert.deepEqual(waits.map((row) => row.waitForState), ['COMPLETE', 'COMPLETE']);
});

test('Circle adapter registers ERC-8004 identity and writes reputation with exact official ABI', async () => {
  const executions: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async createContractExecutionTransaction(input: any) { executions.push(input); return { data: { id: `erc8004-${executions.length}`, state: 'INITIATED' } }; },
    async getTransaction({ id }: any) { return { data: { transaction: { id, state: 'COMPLETE', txHash: `0x${String(executions.length).repeat(64)}` } } }; },
  } as any, 'wallet-set-id');

  const identity = await adapter.registerErc8004Agent({
    walletId: 'agent-wallet', registryAddress: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    agentUri: 'https://arenaiss.xyz/api/agents/agent/erc8004.json', idempotencyKey: 'identity-key',
  });
  const reputation = await adapter.giveErc8004Feedback({
    walletId: 'evaluator-wallet', registryAddress: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    agentId: '17', value: 88, valueDecimals: 0, tag1: 'arena-evo', tag2: 'AgentEvaluationV5', endpoint: '',
    feedbackUri: 'https://arenaiss.xyz/api/evaluations/campaign/erc8004-feedback.json', feedbackHash: `0x${'a'.repeat(64)}`,
    idempotencyKey: 'feedback-key',
  });

  assert.deepEqual(executions.map(({ walletId, contractAddress, abiFunctionSignature, abiParameters, idempotencyKey }) => ({ walletId, contractAddress, abiFunctionSignature, abiParameters, idempotencyKey })), [
    { walletId: 'agent-wallet', contractAddress: '0x8004A818BFB912233c491871b3d84c89A494BD9e', abiFunctionSignature: 'register(string)', abiParameters: ['https://arenaiss.xyz/api/agents/agent/erc8004.json'], idempotencyKey: 'identity-key' },
    { walletId: 'evaluator-wallet', contractAddress: '0x8004B663056A597Dffe9eCcC1965A193B7388713', abiFunctionSignature: 'giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)', abiParameters: ['17', '88', '0', 'arena-evo', 'AgentEvaluationV5', '', 'https://arenaiss.xyz/api/evaluations/campaign/erc8004-feedback.json', `0x${'a'.repeat(64)}`], idempotencyKey: 'feedback-key' },
  ]);
  assert.equal(identity.state, 'COMPLETE');
  assert.equal(reputation.state, 'COMPLETE');
});

test('Circle adapter withdraws a Tournament credit through the beneficiary SCA', async () => {
  const executions: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async createContractExecutionTransaction(input: any) { executions.push(input); return { data: { id: 'claim-id' } }; },
    async getTransaction() { return { data: { transaction: { id: 'claim-id', state: 'COMPLETE', txHash: `0x${'7'.repeat(64)}` } } }; },
  } as any, 'wallet-set-id');
  await adapter.withdrawTournamentCredit({ walletId: 'wallet-id', escrowAddress: '0x4444444444444444444444444444444444444444', tournamentId: `sha256:${'a'.repeat(64)}`, idempotencyKey: 'claim-key' });
  assert.equal(executions[0].abiFunctionSignature, 'withdrawCredit(bytes32)');
  assert.deepEqual(executions[0].abiParameters, [`0x${'a'.repeat(64)}`]);
});

test('Circle adapter opens the registered Tournament refund credit through the beneficiary SCA', async () => {
  const executions: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async createContractExecutionTransaction(input: any) { executions.push(input); return { data: { id: 'refund-id' } }; },
    async getTransaction() { return { data: { transaction: { id: 'refund-id', state: 'COMPLETE', txHash: `0x${'8'.repeat(64)}` } } }; },
  } as any, 'wallet-set-id');
  await adapter.claimTournamentRefund({ walletId: 'wallet-id', escrowAddress: '0x4444444444444444444444444444444444444444', tournamentId: `0x${'a'.repeat(64)}`, entrantId: `0x${'b'.repeat(64)}`, idempotencyKey: 'refund-key' });
  assert.equal(executions[0].abiFunctionSignature, 'claimRefund(bytes32,bytes32)');
  assert.deepEqual(executions[0].abiParameters, [`0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`]);
});

test('Circle adapter approves the stake and registers a Tournament entrant through the managed SCA', async () => {
  const executions: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async createContractExecutionTransaction(input: any) { executions.push(input); return { data: { id: `entry-${executions.length}` } }; },
    async getTransaction({ id }: any) { return { data: { transaction: { id, state: 'COMPLETE', txHash: `0x${String(executions.length).repeat(64)}` } } }; },
  } as any, 'wallet-set-id');
  await adapter.registerTournamentEntrant({
    walletId: 'wallet-id', escrowAddress: '0x4444444444444444444444444444444444444444', stakeAmount: '1000000',
    tournamentId: `0x${'a'.repeat(64)}`, entrantId: `0x${'b'.repeat(64)}`, agentId: `0x${'c'.repeat(64)}`,
    agentsVersion: `0x${'d'.repeat(64)}`, agentsCommitment: `0x${'e'.repeat(64)}`,
    approvalIdempotencyKey: 'approve-key', registrationIdempotencyKey: 'register-key',
  });
  assert.deepEqual(executions.map((row) => ({ address: row.contractAddress, signature: row.abiFunctionSignature, parameters: row.abiParameters })), [
    { address: '0x3600000000000000000000000000000000000000', signature: 'approve(address,uint256)', parameters: ['0x4444444444444444444444444444444444444444', '1000000'] },
    { address: '0x4444444444444444444444444444444444444444', signature: 'register(bytes32,bytes32,bytes32,bytes32,bytes32)', parameters: [`0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`, `0x${'c'.repeat(64)}`, `0x${'d'.repeat(64)}`, `0x${'e'.repeat(64)}`] },
  ]);
});

test('Circle adapter reads Arc plus non-zero crosschain USDC balances and submits Arc withdrawal', async () => {
  const transfers: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async deriveWallet({ blockchain }: any) { return { data: { wallet: { id: blockchain, address: '0x1111111111111111111111111111111111111111' } } }; },
    async getWalletTokenBalance({ id }: any) {
      const amount = id === 'wallet-id' ? '2.5' : id === 'BASE-SEPOLIA' ? '1' : '0';
      const blockchain = id === 'wallet-id' ? 'ARC-TESTNET' : id;
      return { data: { tokenBalances: [{ amount, token: {
        id: `${blockchain}-usdc-token-id`, blockchain, symbol: 'USDC', isNative: false,
        tokenAddress: blockchain === 'ARC-TESTNET' ? '0x3600000000000000000000000000000000000000' : undefined,
      } }] } };
    },
    async createTransaction(input: any) { transfers.push(input); return { data: { id: 'transaction-id', state: 'INITIATED' } }; },
    async getTransaction() { return { data: { transaction: { id: 'transaction-id', state: 'SENT', txHash: `0x${'3'.repeat(64)}` } } }; },
  } as any, 'wallet-set-id');

  const balances = await adapter.listUsdcBalances({ walletId: 'wallet-id', address: '0x1111111111111111111111111111111111111111' });
  assert.deepEqual(balances.map(({ chain, amount }) => ({ chain, amount })), [
    { chain: 'ARC-TESTNET', amount: '2.5' }, { chain: 'BASE-SEPOLIA', amount: '1' },
  ]);
  const result = await adapter.transferUsdc({ walletId: 'wallet-id', destinationAddress: '0x2222222222222222222222222222222222222222', amount: '1.25', idempotencyKey: '11111111-1111-4111-8111-111111111111' });
  assert.equal(result.transactionId, 'transaction-id');
  assert.equal(transfers[0].tokenId, 'ARC-TESTNET-usdc-token-id');
  assert.equal('tokenAddress' in transfers[0], false);
  assert.deepEqual(transfers[0].amount, ['1.25']);
});

test('Circle adapter holds an Evo fee through completed Arc approval and escrow deposit', async () => {
  const executions: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async createContractExecutionTransaction(input: any) { executions.push(input); return { data: { id: `fee-${executions.length}` } }; },
    async getTransaction({ id, waitForState }: any) { return { data: { transaction: { id, state: waitForState, txHash: `0x${String(executions.length).repeat(64)}` } } }; },
  } as any, 'wallet-set-id');

  const result = await adapter.holdEvaluationFee({
    walletId: 'wallet-id', escrowAddress: '0x4444444444444444444444444444444444444444',
    campaignId: `sha256:${'a'.repeat(64)}`, amountUsdc: '1.25',
    approvalIdempotencyKey: '11111111-1111-4111-8111-111111111111',
    depositIdempotencyKey: '22222222-2222-4222-8222-222222222222',
  });

  assert.deepEqual(executions.map((row) => ({ contractAddress: row.contractAddress, signature: row.abiFunctionSignature, parameters: row.abiParameters, key: row.idempotencyKey })), [
    { contractAddress: '0x3600000000000000000000000000000000000000', signature: 'approve(address,uint256)', parameters: ['0x4444444444444444444444444444444444444444', '1250000'], key: '11111111-1111-4111-8111-111111111111' },
    { contractAddress: '0x4444444444444444444444444444444444444444', signature: 'deposit(bytes32)', parameters: [`0x${'a'.repeat(64)}`], key: '22222222-2222-4222-8222-222222222222' },
  ]);
  assert.equal(result.approval.state, 'COMPLETE');
  assert.equal(result.deposit.state, 'COMPLETE');
});

test('Circle adapter cancels a Marketplace listing through the seller SCA', async () => {
  const executions: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async createContractExecutionTransaction(input: any) { executions.push(input); return { data: { id: 'cancel-id' } }; },
    async getTransaction() { return { data: { transaction: { id: 'cancel-id', state: 'COMPLETE', txHash: `0x${'5'.repeat(64)}` } } }; },
  } as any, 'wallet-set-id');

  const result = await adapter.marketplaceCancel({
    walletId: 'wallet-id', marketplaceAddress: '0x4444444444444444444444444444444444444444',
    listingId: '7', idempotencyKey: '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(executions[0].abiFunctionSignature, 'cancel(uint256)');
  assert.deepEqual(executions[0].abiParameters, ['7']);
  assert.equal(result.state, 'COMPLETE');
});

test('Circle adapter reuses separately persisted approval and burn idempotency keys', async () => {
  const executions: any[] = [];
  const progress: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    { finalityThreshold: 1000, minimumFee: 0, forwardFee: { med: '1' } },
  ]), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const adapter = new CircleManagedWalletAdapter({
      async deriveWallet({ blockchain }: any) {
        return { data: { wallet: { id: blockchain, address: '0x1111111111111111111111111111111111111111' } } };
      },
      async createContractExecutionTransaction(input: any) {
        executions.push(input);
        return { data: { id: executions.length === 1 ? 'approval-id' : 'burn-id' } };
      },
      async getTransaction({ id }: any) {
        return { data: { transaction: { id, state: id === 'approval-id' ? 'COMPLETE' : 'SENT', txHash: id === 'burn-id' ? `0x${'4'.repeat(64)}` : undefined } } };
      },
    } as any, 'wallet-set-id');

    const result = await adapter.bridgeUsdcToArc({
      walletId: 'wallet-id',
      address: '0x1111111111111111111111111111111111111111',
      sourceChain: 'BASE-SEPOLIA',
      amount: '1',
      approvalIdempotencyKey: '11111111-1111-4111-8111-111111111111',
      burnIdempotencyKey: '22222222-2222-4222-8222-222222222222',
      onProgress: (state: string) => progress.push(state),
    } as any);

    assert.equal(executions[0].idempotencyKey, '11111111-1111-4111-8111-111111111111');
    assert.equal(executions[1].idempotencyKey, '22222222-2222-4222-8222-222222222222');
    assert.deepEqual(progress, ['APPROVING', 'BURNING']);
    assert.equal(result.txHash, `0x${'4'.repeat(64)}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
