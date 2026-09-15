import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  managedWallet: { state: 'READY', userId: `usr_${'a'.repeat(64)}`, walletId: 'wallet-id', address, blockchain: 'ARC-TESTNET', accountType: 'EOA' },
};

function identity(): ManagedIdentityAdapter {
  return {
    capabilities: async () => ({ wallet: true, email: true, managedWallet: true }), restore: async () => account,
    signInWithWallet: async () => account, requestEmailCode: async () => {}, verifyEmail: async () => account, logout: async () => {},
    listUsdcBalances: async () => [
      { chain: 'ARC-TESTNET', label: 'Arc Testnet', amount: '2.5', isArc: true, available: true },
      { chain: 'BASE-SEPOLIA', label: 'Base Sepolia', amount: '1', isArc: false, available: true },
    ],
    transferUsdc: async () => ({ transactionId: 'transfer-1', state: 'INITIATED' }),
    bridgeUsdcToArc: async () => ({ transactionId: 'bridge-1', state: 'INITIATED' }),
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
    expect(screen.getByRole('region', { name: 'Arena ISS technology ticker' })).toBeInTheDocument();
  });

  it('uses the requested wallet copy, multichain balance and transfer controls', async () => {
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={identity()} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);

    expect(await screen.findByText('Arena ISS wallet', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tournaments' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Evaluations' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Arena ISS technology ticker' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Account' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Signed in with email/)).not.toBeInTheDocument();
    expect(await screen.findByText('Base Sepolia')).toBeInTheDocument();
    expect(screen.getByText(/Arena ISS is live on Arc Network/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy wallet address' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(address));
    expect(screen.getByLabelText('Recipient wallet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send USDC' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bridge to Arc' })).toBeInTheDocument();
  });

  it('closes the account menu when clicking elsewhere', async () => {
    render(<MemoryRouter initialEntries={['/account']}><AppProvider identityAdapter={identity()} config={{ chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', apiUrl: '' }}><Routes><Route element={<Layout />}><Route path="/account" element={<Account />} /></Route></Routes></AppProvider></MemoryRouter>);
    const trigger = await screen.findByRole('button', { name: /0xe6db/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
