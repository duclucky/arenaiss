import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProvider } from '../context';
import { Layout } from '../components/Layout';
import { Account } from '../views/Account';
import { Home } from '../views/Home';
import type { AgentApiAdapter, EntrantRegistration, ManagedAccount, ManagedIdentityAdapter } from '../adapters/interfaces';

const address = '0xe6dbe479ecbb295bdd955d672fd5076dc34e2513';
const account: ManagedAccount = {
  userId: `usr_${'a'.repeat(64)}`, principal: `usr_${'b'.repeat(64)}`, identity: { kind: 'EMAIL' },
  managedWallet: { state: 'READY', userId: `usr_${'a'.repeat(64)}`, walletId: 'wallet-id', address, blockchain: 'ARC-TESTNET', accountType: 'SCA' },
};

function identity(): ManagedIdentityAdapter {
  return {
    capabilities: async () => ({ wallet: true, email: true, managedWallet: true }), restore: async () => account,
    signInWithWallet: async () => account, requestEmailCode: async () => {}, verifyEmail: async () => account, logout: async () => {},
    listUsdcBalances: async () => [
      { chain: 'ARC-TESTNET', label: 'Arc Testnet', amount: '2.5', isArc: true, available: true },
      { chain: 'BASE-SEPOLIA', label: 'Base Sepolia', amount: '1', isArc: false, available: true },
    ],
    transferUsdc: async () => ({ operationId: '22222222-2222-4222-8222-222222222222', destinationAddress: address,
      amount: '0.25', transactionId: 'transfer-1', state: 'SUBMITTED', updatedAt: 1 }),
    listUsdcTransfers: async () => [],
    getUsdcTransfer: async () => ({ operationId: '22222222-2222-4222-8222-222222222222', destinationAddress: address,
      amount: '0.25', transactionId: 'transfer-1', state: 'SUBMITTED', updatedAt: 1 }),
    bridgeUsdcToArc: async () => ({ operationId: '11111111-1111-4111-8111-111111111111', state: 'PENDING', sourceChain: 'BASE-SEPOLIA', amount: '1', updatedAt: 1 }),
    getCctpEligibility: async () => ({ eligible: false, source: 'NONE' }),
    listCctpTransfers: async () => [],
    getCctpTransfer: async () => ({ operationId: '11111111-1111-4111-8111-111111111111', state: 'SUBMITTED', sourceChain: 'BASE-SEPOLIA', amount: '1', transactionId: 'bridge-1', txHash: `0x${'1'.repeat(64)}`, explorerUrl: `https://sepolia.basescan.org/tx/0x${'1'.repeat(64)}`, updatedAt: 2 }),
  };
}

function tournamentAccess(eligible: boolean): AgentApiAdapter {
  return {
    listOwnedAgents: async () => [],
    listOwnedRegistrations: async () => eligible ? [{ tournamentId: `sha256:${'a'.repeat(64)}`, entrantId: `sha256:${'b'.repeat(64)}`, agentId: `sha256:${'c'.repeat(64)}` }] : [],
    createAgent: async () => { throw new Error('unused'); },
    prepareRegistration: async (): Promise<EntrantRegistration & { stakeAmount: string }> => { throw new Error('unused'); },
  } as AgentApiAdapter;
}

describe('managed Arena ISS wallet account', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  it('keeps the landing header product-free and sends a signed-in user into Agents', async () => {
    render(<MemoryRouter initialEntries={['/']}><AppProvider identityAdapter={identity()} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route index element={<Home />} /></Route></Routes></AppProvider></MemoryRouter>);

    expect(await screen.findByRole('link', { name: 'Start with Agent' })).toHaveAttribute('href', '/agents');
    expect(screen.queryByRole('button', { name: /0xe6db/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Arena ISS technology ticker' })).not.toBeInTheDocument();
  });

  it('opens CCTP initiation for an account with a previous Tournament registration', async () => {
    const bridgeUsdcToArc = vi.fn().mockResolvedValue({ operationId: '11111111-1111-4111-8111-111111111111', state: 'PENDING', sourceChain: 'BASE-SEPOLIA', amount: '0.5', updatedAt: 1 });
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={{ ...identity(), bridgeUsdcToArc, getCctpEligibility: async () => ({ eligible: true, source: 'TOURNAMENT' }) }} agentApiAdapter={tournamentAccess(true)} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);

    expect(await screen.findByText('Arena ISS wallet', { selector: 'label' })).toBeInTheDocument();
    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary' });
    expect(primaryNavigation).toBeInTheDocument();
    expect(within(primaryNavigation).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Agents',
      'Evaluations',
      'Pair matches',
      'Tournaments',
      'Marketplace',
      'Docs',
    ]);
    expect(screen.getByRole('link', { name: 'Tournaments' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Evaluations' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Arena ISS technology ticker' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Account' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Signed in with email/)).not.toBeInTheDocument();
    const balancesToggle = await screen.findByRole('button', { name: 'USDC by network' });
    expect(balancesToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'USDC balances by network' })).not.toBeInTheDocument();
    expect(screen.getByText(/Arena ISS is live on Arc Testnet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Faucet USDC on Arc' })).toHaveAttribute('href', 'https://faucet.circle.com/');
    expect(await screen.findByRole('heading', { name: 'Bridge USDC to Arc Testnet' })).toBeInTheDocument();
    expect(screen.getByText(/CCTP burns testnet USDC on the selected source network/)).toBeInTheDocument();
    const bridgeButton = screen.getByRole('button', { name: 'Bridge to Arc Testnet' });
    expect(bridgeButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Bridge amount (USDC)'), { target: { value: '0.5' } });
    expect(bridgeButton).toBeEnabled();
    fireEvent.click(bridgeButton);
    await waitFor(() => expect(bridgeUsdcToArc).toHaveBeenCalledWith('BASE-SEPOLIA', '0.5'));
    fireEvent.click(balancesToggle);
    expect(balancesToggle).toHaveAttribute('aria-expanded', 'true');
    const balancesList = screen.getByRole('list', { name: 'USDC balances by network' });
    expect(balancesList).toBeInTheDocument();
    expect(within(balancesList).getByText('Base Sepolia')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy wallet address' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(address));
    expect(screen.getByLabelText('Source network')).toHaveValue('BASE-SEPOLIA');
    expect(screen.getByRole('heading', { name: 'Withdraw' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recipient wallet').closest('form')).toHaveClass('wallet-action-form');
    expect(screen.getByRole('button', { name: 'Withdraw USDC' })).toBeInTheDocument();
  });

  it('keeps CCTP initiation closed for an account without Tournament history', async () => {
    const bridgeUsdcToArc = vi.fn();
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={{ ...identity(), bridgeUsdcToArc }} agentApiAdapter={tournamentAccess(false)} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);

    expect(await screen.findByText(/available to accounts that previously registered for a Tournament/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bridge to Arc Testnet' })).not.toBeInTheDocument();
    expect(bridgeUsdcToArc).not.toHaveBeenCalled();
  });

  it('restores a pending CCTP operation after page reload', async () => {
    const operation = { operationId: '11111111-1111-4111-8111-111111111111', state: 'APPROVING' as const, sourceChain: 'BASE-SEPOLIA', amount: '1', updatedAt: 2 };
    const restoredIdentity = { ...identity(), listCctpTransfers: vi.fn().mockResolvedValue([operation]) };
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={restoredIdentity} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByText(/Approving USDC spend on the source network/i)).toBeInTheDocument();
    expect(restoredIdentity.listCctpTransfers).toHaveBeenCalledTimes(1);
  });

  it('shows the persisted source transaction while Circle confirmation is pending', async () => {
    const explorerUrl = `https://sepolia.arbiscan.io/tx/0x${'3'.repeat(64)}`;
    const operation = { operationId: '11111111-1111-4111-8111-111111111111', state: 'APPROVING' as const,
      sourceChain: 'ARB-SEPOLIA', amount: '5', transactionId: 'approval-id', txHash: `0x${'3'.repeat(64)}`,
      explorerUrl, message: 'Approval submitted. Circle is still confirming the source transaction.', updatedAt: 2 };
    const restoredIdentity = { ...identity(), listCctpTransfers: vi.fn().mockResolvedValue([operation]) };
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={restoredIdentity} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByRole('status').some((status) => status.textContent?.includes(operation.message))).toBe(true));
    expect(screen.getByRole('link', { name: 'View source transaction' })).toHaveAttribute('href', explorerUrl);
  });

  it('restores a submitted Arc withdrawal and blocks a duplicate after reload', async () => {
    const operation = { operationId: '11111111-1111-4111-8111-111111111111', state: 'SUBMITTED' as const,
      destinationAddress: '0x2222222222222222222222222222222222222222', amount: '1.25',
      transactionId: 'circle-tx', txHash: `0x${'7'.repeat(64)}`,
      explorerUrl: `https://testnet.arcscan.app/tx/0x${'7'.repeat(64)}`, updatedAt: 2 };
    const restoredIdentity = { ...identity(), listUsdcTransfers: vi.fn().mockResolvedValue([operation]),
      getUsdcTransfer: vi.fn().mockResolvedValue(operation), transferUsdc: vi.fn() };
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={restoredIdentity} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByText(/USDC transfer submitted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw USDC' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'View transaction' })).toHaveAttribute('href', operation.explorerUrl);
    expect(restoredIdentity.transferUsdc).not.toHaveBeenCalled();
  });

  it('does not block Arc withdrawal or lose legacy CCTP status while it is pending', async () => {
    const operation = { operationId: '11111111-1111-4111-8111-111111111111', state: 'APPROVING' as const, sourceChain: 'BASE-SEPOLIA', amount: '1', updatedAt: 2 };
    const restoredIdentity = { ...identity(), listCctpTransfers: vi.fn().mockResolvedValue([operation]), transferUsdc: vi.fn().mockResolvedValue({ transactionId: 'transfer-1', state: 'INITIATED' as const }) };
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={restoredIdentity} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByText(/Approving USDC spend on the source network/i)).toBeInTheDocument();
    const withdraw = screen.getByRole('button', { name: 'Withdraw USDC' });
    expect(withdraw).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Recipient wallet'), { target: { value: '0x1111111111111111111111111111111111111111' } });
    fireEvent.change(screen.getByLabelText('Amount (USDC)'), { target: { value: '0.25' } });
    fireEvent.click(withdraw);
    await waitFor(() => expect(restoredIdentity.transferUsdc).toHaveBeenCalledWith('0x1111111111111111111111111111111111111111', '0.25'));
    expect(screen.getByText(/Approving USDC spend on the source network/i)).toBeInTheDocument();
  });

  it('closes the account menu when clicking elsewhere', async () => {
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={identity()} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);
    const trigger = await screen.findByRole('button', { name: 'Account' });
    expect(trigger).toHaveTextContent('Account');
    expect(trigger).not.toHaveTextContent('Signed in');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
