import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import type { AgentApiAdapter, ManagedIdentityAdapter } from '../adapters/interfaces';
import { AppProvider } from '../context';
import { PairMatches } from '../views/PairMatches';

const wallet = `0x${'9'.repeat(40)}`;
const account = {
  userId: `usr_${'1'.repeat(64)}`,
  principal: `usr_${'2'.repeat(64)}`,
  identity: { kind: 'EMAIL' as const },
  managedWallet: { state: 'READY' as const, userId: `usr_${'1'.repeat(64)}`, walletId: 'wallet', address: wallet, blockchain: 'ARC-TESTNET' as const, accountType: 'SCA' as const },
};
const identity: ManagedIdentityAdapter = {
  async capabilities() { return { wallet: true, email: true, managedWallet: true }; },
  async restore() { return account; },
  async signInWithWallet() { return account; },
  async requestEmailCode() {},
  async verifyEmail() { return account; },
  async logout() {},
};
const agentApi = { async listOwnedAgents() { return [{ agentId: `sha256:${'a'.repeat(64)}`, agentsVersion: `sha256:${'b'.repeat(64)}`, agentsCommitment: `sha256:${'c'.repeat(64)}`, name: 'Agent One' }]; } } as unknown as AgentApiAdapter;

afterEach(() => { vi.unstubAllGlobals(); });

it('shows cancel and refund for an email owner whose managed wallet funded the open room', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    async json() {
      if (url.endsWith('/config')) return { enabled: true };
      return [{ roomId: `sha256:${'d'.repeat(64)}`, creator: account.principal, creatorWallet: wallet,
        creatorAgentId: `sha256:${'a'.repeat(64)}`, stake: '1000000',
        joinDeadline: 1_999_999_999, resolutionDeadline: 2_000_000_000, state: 'OPEN' }];
    },
  })));
  render(<MemoryRouter><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }} identityAdapter={identity} agentApiAdapter={agentApi}><PairMatches /></AppProvider></MemoryRouter>);
  expect(await screen.findByRole('button', { name: 'Cancel and refund' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Join and deposit' })).not.toBeInTheDocument();
});

it('shows a room read failure and retries the list without implying no rooms exist', async () => {
  let roomReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/config')) return { ok: true, async json() { return { enabled: false }; } };
    roomReads++;
    if (roomReads === 1) throw new Error('temporary room read failure');
    return { ok: true, async json() { return []; } };
  }));
  render(<MemoryRouter><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><PairMatches /></AppProvider></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('temporary room read failure');
  expect(screen.queryByText('No rooms yet.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry rooms' }));
  await waitFor(() => expect(screen.getByText('No rooms yet.')).toBeInTheDocument());
  expect(roomReads).toBeGreaterThan(1);
});

it('shows an onchain refund credit after cancellation and hides the claim after withdrawal', async () => {
  const roomId = `sha256:${'e'.repeat(64)}`;
  let credit = '1000000';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    async json() {
      if (url.endsWith('/config')) return { enabled: true };
      if (url.endsWith('/credit')) return { amount: credit };
      if (url.endsWith('/actions/WITHDRAW') && init?.method === 'POST') { credit = '0'; return { state: 'REFUNDABLE' }; }
      return [{ roomId, creator: account.principal, creatorWallet: wallet, creatorAgentId: `sha256:${'a'.repeat(64)}`,
        stake: '1000000', joinDeadline: 1_999_999_999, resolutionDeadline: 2_000_000_000, state: 'REFUNDABLE' }];
    },
  })));
  render(<MemoryRouter><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }} identityAdapter={identity} agentApiAdapter={agentApi}><PairMatches /></AppProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Claim 1.0 USDC' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Claim 1.0 USDC' })).not.toBeInTheDocument());
});

it('links the two escrow deposits and settlement evidence from one room', async () => {
  const hashes = ['1', '2', '3'].map((digit) => `0x${digit.repeat(64)}`);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, async json() {
    if (url.endsWith('/config')) return { enabled: true };
    return [{ roomId: `sha256:${'f'.repeat(64)}`, creator: account.principal, creatorWallet: wallet,
      creatorAgentId: `sha256:${'a'.repeat(64)}`, stake: '1000000', joinDeadline: 1_999_999_999,
      resolutionDeadline: 2_000_000_000, state: 'SETTLED', createTx: hashes[0], joinTx: hashes[1], settleTx: hashes[2] }];
  } })));
  render(<MemoryRouter><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><PairMatches /></AppProvider></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Creator deposit' })).toHaveAttribute('href', `https://testnet.arcscan.app/tx/${hashes[0]}`);
  expect(screen.getByRole('link', { name: 'Challenger deposit' })).toHaveAttribute('href', `https://testnet.arcscan.app/tx/${hashes[1]}`);
  expect(screen.getByRole('link', { name: 'Arc settlement' })).toHaveAttribute('href', `https://testnet.arcscan.app/tx/${hashes[2]}`);
});
