import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../App';

const managedAddress = '0x4444444444444444444444444444444444444444';
const env = {
  VITE_ARC_CHAIN_ID: '5042002',
  VITE_ARC_RPC_URL: 'https://rpc.testnet.arc.network',
  VITE_ARC_NETWORK_NAME: 'Arc Testnet',
  VITE_ARENA_API_URL: '/',
};

describe('managed email login', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('requests an OTP, verifies it, and displays the server-managed Circle address', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const path = String(input);
      requests.push({ path, init });
      if (path.endsWith('/api/auth/capabilities')) return new Response(JSON.stringify({ wallet: true, email: true, managedWallet: true }), { status: 200 });
      if (path.endsWith('/api/account') && requests.filter((request) => request.path.endsWith('/api/account')).length === 1) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }
      if (path.endsWith('/api/auth/email/challenge')) return new Response(JSON.stringify({ status: 'code sent' }), { status: 202 });
      if (path.endsWith('/api/auth/email/verify')) return new Response(null, { status: 204 });
      if (path.endsWith('/api/account')) return new Response(JSON.stringify({
        userId: `usr_${'a'.repeat(64)}`,
        principal: `usr_${'b'.repeat(64)}`,
        identity: { kind: 'EMAIL' },
        managedWallet: { state: 'READY', userId: `usr_${'a'.repeat(64)}`, walletId: 'circle-wallet-id', address: managedAddress, blockchain: 'ARC-TESTNET', accountType: 'EOA' },
      }), { status: 200 });
      throw new Error(`unexpected request: ${path}`);
    });

    render(<App env={env} />);
    const login = await screen.findByRole('button', { name: 'Login' });
    expect(screen.getAllByRole('button', { name: 'Login' })).toHaveLength(1);
    fireEvent.click(login);
    expect(screen.getByRole('heading', { name: 'Sign in to Arena ISS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with wallet' })).toBeInTheDocument();
    const emailLogin = screen.getByRole('button', { name: 'Continue with email' });
    await waitFor(() => expect(emailLogin).not.toBeDisabled());
    fireEvent.click(emailLogin);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('We sent a 6-digit code to your email.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    expect(await screen.findByRole('button', { name: /0x4444/i })).toBeInTheDocument();
    expect(requests.find((request) => request.path.endsWith('/api/auth/email/challenge'))?.init?.credentials).toBe('include');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps both methods in one login dialog and explains unavailable email auth', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      wallet: true,
      email: false,
      managedWallet: false,
    }), { status: 200 }));

    render(<App env={env} />);
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(screen.getAllByRole('button', { name: 'Login' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Continue with wallet' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue with email' })).toBeDisabled();
    expect(screen.getByText('Not configured on this server yet')).toBeInTheDocument();
  });
});
