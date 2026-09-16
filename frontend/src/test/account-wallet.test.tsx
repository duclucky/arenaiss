import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProvider } from '../context';
import { Layout } from '../components/Layout';
import { Account } from '../views/Account';
import { Home } from '../views/Home';
import type { ManagedAccount, ManagedIdentityAdapter } from '../adapters/interfaces';

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
    getCctpTransfer: async () => ({ operationId: '11111111-1111-4111-8111-111111111111', state: 'SUBMITTED', sourceChain: 'BASE-SEPOLIA', amount: '1', transactionId: 'bridge-1', txHash: `0x${'1'.repeat(64)}`, explorerUrl: `https://sepolia.basescan.org/tx/0x${'1'.repeat(64)}`, updatedAt: 2 }),
  };
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

  it('keeps Arc wallet withdrawal available while CCTP initiation is hidden', async () => {
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={identity()} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);

    expect(await screen.findByText('Arena ISS wallet', { selector: 'label' })).toBeInTheDocument();
    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary' });
    expect(primaryNavigation).toBeInTheDocument();
    expect(within(primaryNavigation).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Agents',
      'Evaluations',
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
    expect(screen.queryByRole('heading', { name: 'Bridge USDC to Arc Testnet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bridge to Arc Testnet' })).not.toBeInTheDocument();
    expect(screen.queryByText(/CCTP deposits burn USDC/)).not.toBeInTheDocument();
    fireEvent.click(balancesToggle);
    expect(balancesToggle).toHaveAttribute('aria-expanded', 'true');
    const balancesList = screen.getByRole('list', { name: 'USDC balances by network' });
    expect(balancesList).toBeInTheDocument();
    expect(within(balancesList).getByText('Base Sepolia')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy wallet address' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(address));
    expect(screen.queryByLabelText('Source network')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Withdraw' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recipient wallet').closest('form')).toHaveClass('wallet-action-form');
    expect(screen.getByRole('button', { name: 'Withdraw USDC' })).toBeInTheDocument();
  });

  it('restores a pending CCTP operation after page reload', async () => {
    const operation = { operationId: '11111111-1111-4111-8111-111111111111', state: 'APPROVING' as const, sourceChain: 'BASE-SEPOLIA', amount: '1', updatedAt: 2 };
    const restoredIdentity = { ...identity(), listCctpTransfers: vi.fn().mockResolvedValue([operation]) };
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={restoredIdentity} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);
    expect(await screen.findByText(/Approving USDC spend on the source network/i)).toBeInTheDocument();
    expect(restoredIdentity.listCctpTransfers).toHaveBeenCalledTimes(1);
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
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
