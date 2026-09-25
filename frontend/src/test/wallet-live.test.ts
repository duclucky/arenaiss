import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => { vi.unstubAllGlobals(); });

  it('keeps safe EIP-6963 image data and rejects remote provider icons', async () => {
    const provider = { request: async () => [] };
    const adapter = new BrowserArcWalletAdapter();
    const safeIcon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'safe-wallet', name: 'Safe Wallet', icon: safeIcon, rdns: 'io.safe' }, provider },
    }));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'remote-icon', name: 'Remote Icon Wallet', icon: 'https://example.com/wallet.svg' }, provider },
    }));

    const providers = await adapter.getProviders();
    expect(providers.find(({ uuid }) => uuid === 'safe-wallet')).toMatchObject({ icon: safeIcon, rdns: 'io.safe' });
    expect(providers.find(({ uuid }) => uuid === 'remote-icon')).toMatchObject({ icon: '' });
    adapter.removeListener();
  });

  it('adds Arc Testnet with native USDC details and switches a MetaMask wallet without the network', async () => {
    const requests: Array<{ method: string; params?: unknown[] }> = [];
    let chainId = '0x1';
    let added = false;
    const provider = {
      request: async (request: { method: string; params?: unknown[] }) => {
        requests.push(request);
        if (request.method === 'eth_requestAccounts') return [account];
        if (request.method === 'eth_chainId') return chainId;
        if (request.method === 'wallet_switchEthereumChain') {
          if (!added) throw { code: 4902 };
          chainId = '0x4cef52';
          return null;
        }
        if (request.method === 'wallet_addEthereumChain') {
          added = true;
          return null;
        }
        return null;
      },
    };
    const adapter = new BrowserArcWalletAdapter();
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'metamask-new', name: 'MetaMask', icon: '' }, provider },
    }));
    await adapter.connect('metamask-new');
    await adapter.switchChain(config);

    expect(requests.map(({ method }) => method)).toEqual([
      'eth_requestAccounts', 'wallet_switchEthereumChain', 'wallet_addEthereumChain',
      'eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId',
    ]);
    expect(requests.find(({ method }) => method === 'wallet_addEthereumChain')?.params?.[0]).toEqual({
      chainId: '0x4cef52', chainName: 'Arc Testnet', rpcUrls: [config.rpcUrl],
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      blockExplorerUrls: ['https://explorer.testnet.arc.io'],
    });
  });

  it('does not add a network when the user rejects the chain switch', async () => {
    const requests: string[] = [];
    const provider = { request: async ({ method }: { method: string }) => {
      requests.push(method);
      if (method === 'eth_requestAccounts') return [account];
      if (method === 'wallet_switchEthereumChain') throw { code: 4001 };
      return null;
    } };
    const adapter = new BrowserArcWalletAdapter();
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'metamask-reject', name: 'MetaMask', icon: '' }, provider },
    }));
    await adapter.connect('metamask-reject');

    await expect(adapter.switchChain(config)).rejects.toMatchObject({ code: 4001 });
    expect(requests).toEqual(['eth_requestAccounts', 'wallet_switchEthereumChain']);
  });

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
    const signature = await adapter.signMessage('Arena challenge');

    expect(approval.state).toBe('SUBMITTED');
    expect(registration.state).toBe('SUBMITTED');
    expect(withdrawal.state).toBe('SUBMITTED');
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

  it('reads Tournament registration and credit from the public Arc RPC without a browser wallet', async () => {
    const entrantId = bytes32('2');
    const agentId = bytes32('3');
    const agentsVersion = bytes32('4');
    const agentsCommitment = bytes32('5');
    let rpcReads = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      rpcReads += 1;
      const result = rpcReads === 1
        ? `0x${(2_500_000n).toString(16).padStart(64, '0')}`
        : `0x${account.slice(2).padStart(64, '0')}${agentId.slice(2)}${agentsVersion.slice(2)}${agentsCommitment.slice(2)}${'1'.padStart(64, '0')}${'0'.repeat(64)}`;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('Request', class { constructor(_input: RequestInfo | URL, _init?: RequestInit) {} } as unknown as typeof Request);
    vi.stubGlobal('fetch', fetcher);
    const adapter = new BrowserArcWalletAdapter();

    expect(await adapter.getCredit(bytes32('1'), account, config)).toBe('2500000');
    await expect(adapter.getEntrant(bytes32('1'), entrantId, config)).resolves.toMatchObject({
      wallet: account, agentId, agentsVersion, agentsCommitment, registered: true, ranked: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await adapter.disconnect();
  });
});
