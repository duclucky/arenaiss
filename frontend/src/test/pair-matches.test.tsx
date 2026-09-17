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
  expect(screen.queryByText('No open rooms.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry rooms' }));
  await waitFor(() => expect(screen.getByText('No open rooms.')).toBeInTheDocument());
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
  render(<MemoryRouter initialEntries={['/pairs/completed']}><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }} identityAdapter={identity} agentApiAdapter={agentApi}><PairMatches view="completed" /></AppProvider></MemoryRouter>);
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
  render(<MemoryRouter initialEntries={['/pairs/completed']}><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }} identityAdapter={identity} agentApiAdapter={agentApi}><PairMatches view="completed" /></AppProvider></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Creator deposit' })).toHaveAttribute('href', `https://testnet.arcscan.app/tx/${hashes[0]}`);
  expect(screen.getByRole('link', { name: 'Challenger deposit' })).toHaveAttribute('href', `https://testnet.arcscan.app/tx/${hashes[1]}`);
  expect(screen.getByRole('link', { name: 'Arc settlement' })).toHaveAttribute('href', `https://testnet.arcscan.app/tx/${hashes[2]}`);
});

it.each([
  { view: 'open', shown: ['a'], hidden: ['b', 'c', 'd'] },
  { view: 'mine', shown: ['b', 'c'], hidden: ['a', 'd'] },
  { view: 'completed', shown: ['c', 'd'], hidden: ['a', 'b'] },
] as const)('shows the $view room subpage with its own room list', async ({ view, shown, hidden }) => {
  const rooms = [
    { roomId: `sha256:${'a'.repeat(64)}`, creatorWallet: `0x${'1'.repeat(40)}`, state: 'OPEN' },
    { roomId: `sha256:${'b'.repeat(64)}`, creatorWallet: wallet, state: 'JOINED' },
    { roomId: `sha256:${'c'.repeat(64)}`, creatorWallet: wallet, state: 'SETTLED' },
    { roomId: `sha256:${'d'.repeat(64)}`, creatorWallet: `0x${'1'.repeat(40)}`, state: 'REFUNDABLE' },
  ].map((item) => ({ ...item, stake: '10000', joinDeadline: 1_999_999_999, resolutionDeadline: 2_000_000_000 }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, async json() {
    if (url.endsWith('/config')) return { enabled: true };
    if (url.endsWith('/credit')) return { amount: '0' };
    return rooms;
  } })));
  render(<MemoryRouter initialEntries={[`/pairs/${view}`]}><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }} identityAdapter={identity} agentApiAdapter={agentApi}><PairMatches view={view} /></AppProvider></MemoryRouter>);
  for (const name of ['Open rooms', 'My rooms', 'Completed']) expect(screen.getByRole('link', { name })).toHaveAttribute('href', `/pairs/${name === 'Open rooms' ? 'open' : name === 'My rooms' ? 'mine' : 'completed'}`);
  for (const digit of shown) expect(await screen.findByText(new RegExp(`Room sha256:${digit.repeat(64)}`))).toBeInTheDocument();
  for (const digit of hidden) expect(screen.queryByText(new RegExp(`Room sha256:${digit.repeat(64)}`))).not.toBeInTheDocument();
});

it('shows that a joined room started automatically and exposes its current stage', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, async json() {
    if (url.endsWith('/config')) return { enabled: true };
    return [{ roomId: `sha256:${'9'.repeat(64)}`, creator: account.principal, creatorWallet: wallet,
      creatorAgentId: `sha256:${'a'.repeat(64)}`, stake: '10000', joinDeadline: 1_999_999_999,
      resolutionDeadline: 2_000_000_000, state: 'JOINED', evaluationStage: 'RUNNING_AGENTS' }];
  } })));
  render(<MemoryRouter initialEntries={['/pairs/mine']}><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }} identityAdapter={identity} agentApiAdapter={agentApi}><PairMatches view="mine" /></AppProvider></MemoryRouter>);
  expect(await screen.findByText('Match started automatically. Both Agents are producing responses.')).toBeInTheDocument();
});

it('explains when the bounded evaluation retries are exhausted', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, async json() {
    if (url.endsWith('/config')) return { enabled: true };
    return [{ roomId: `sha256:${'8'.repeat(64)}`, creator: account.principal, creatorWallet: wallet,
      creatorAgentId: `sha256:${'a'.repeat(64)}`, stake: '10000', joinDeadline: 1_999_999_999,
      resolutionDeadline: 2_000_000_000, state: 'JOINED', evaluationStage: 'RETRYING', evaluationAttempts: 3, retryAt: 1_999_999_000 }];
  } })));
  render(<MemoryRouter initialEntries={['/pairs/mine']}><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }} identityAdapter={identity} agentApiAdapter={agentApi}><PairMatches view="mine" /></AppProvider></MemoryRouter>);
  expect(await screen.findByText(/Evaluation paused after 3 failed attempts/)).toHaveTextContent(/Both players can approve an early refund/);
});

it('does not request or render participant room history before login', async () => {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, async json() {
    if (url.endsWith('/config')) return { enabled: true };
    return [{ roomId: `sha256:${'7'.repeat(64)}`, creatorWallet: `0x${'1'.repeat(40)}`, stake: '10000', state: 'SETTLED' }];
  } }));
  vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter initialEntries={['/pairs/completed']}><AppProvider config={{ chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><PairMatches view="completed" /></AppProvider></MemoryRouter>);
  expect(await screen.findByText('Log in to see rooms you created or joined.')).toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/api/pair-rooms/mine'))).toBe(false);
  expect(screen.queryByText(new RegExp(`sha256:${'7'.repeat(64)}`))).not.toBeInTheDocument();
});
