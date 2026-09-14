import { describe, expect, it } from 'vitest';

import { BrowserArcWalletAdapter } from '../adapters/wallet';
import type { ArcNetworkConfig } from '../adapters/interfaces';

const account = '0x1111111111111111111111111111111111111111';
const config: ArcNetworkConfig = {
  chainId: 5_042_002,
  rpcUrl: 'https://rpc.testnet.arc.network',
  name: 'Arc Testnet',
  usdcAddress: '0x3600000000000000000000000000000000000000',
  escrowAddress: '0x2875BeA04e01EdaAA762987431ad5a87CF11445d',
};
const bytes32 = (suffix: string) => `0x${suffix.padStart(64, '0')}`;

describe('live Arc wallet adapter', () => {
  it('uses the selected account client and encodes approve, register and withdrawal writes', async () => {
    const requests: Array<{ method: string; params?: unknown[] }> = [];
    const provider = {
      request: async (request: { method: string; params?: unknown[] }) => {
        requests.push(request);
        if (request.method === 'eth_requestAccounts') return [account];
        if (request.method === 'eth_chainId') return '0x4cef52';
        if (request.method === 'eth_call') return `0x${'0'.repeat(60)}03e8`;
        if (request.method === 'personal_sign') return `0x${'cd'.repeat(65)}`;
        if (request.method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`;
        return null;
      },
    };
    const adapter = new BrowserArcWalletAdapter();
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'wallet-a', name: 'Wallet A', icon: '' }, provider },
    }));
    await adapter.connect('wallet-a');

    const approval = await adapter.approveEscrow('250000', config);
    const registration = await adapter.registerEntrant({
      tournamentId: bytes32('1'),
      entrantId: bytes32('2'),
      agentId: bytes32('3'),
      agentsVersion: bytes32('4'),
      agentsCommitment: bytes32('5'),
    }, config);
    const withdrawal = await adapter.withdrawCredit(bytes32('1'), config);
    const credit = await adapter.getCredit(bytes32('1'), account, config);
    const signature = await adapter.signMessage('Arena challenge');

    expect(approval.state).toBe('SUBMITTED');
    expect(registration.state).toBe('SUBMITTED');
    expect(withdrawal.state).toBe('SUBMITTED');
    expect(credit).toBe('1000');
    expect(signature).toBe(`0x${'cd'.repeat(65)}`);
    const writes = requests.filter((request) => request.method === 'eth_sendTransaction');
    expect(writes).toHaveLength(3);
    expect(writes[0].params?.[0]).toMatchObject({ from: account, to: config.usdcAddress });
    expect(writes[1].params?.[0]).toMatchObject({ from: account, to: config.escrowAddress });
    expect(writes[2].params?.[0]).toMatchObject({ from: account, to: config.escrowAddress });
  });

  it('rejects malformed bytes32 values and amounts before wallet I/O', async () => {
    const requests: string[] = [];
    const provider = {
      request: async ({ method }: { method: string }) => {
        requests.push(method);
        if (method === 'eth_requestAccounts') return [account];
        return null;
      },
    };
    const adapter = new BrowserArcWalletAdapter();
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'wallet-b', name: 'Wallet B', icon: '' }, provider },
    }));
    await adapter.connect('wallet-b');
    const before = requests.length;

    await expect(adapter.approveEscrow('-1', config)).rejects.toThrow('INVALID_AMOUNT');
    await expect(adapter.withdrawCredit('not-bytes32', config)).rejects.toThrow('INVALID_BYTES32');
    expect(requests).toHaveLength(before);
  });
});
