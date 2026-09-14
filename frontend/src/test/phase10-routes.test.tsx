import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import App from '../App';
import type { ArcWalletAdapter, WalletProvider, WalletTransaction } from '../adapters/interfaces';

class RouteWallet implements ArcWalletAdapter {
  async getProviders(): Promise<WalletProvider[]> { return []; }
  async connect(): Promise<string> { throw new Error('NOT_CONFIGURED'); }
  async switchChain(): Promise<void> {}
  async getBalance(): Promise<string> { return '0'; }
  async getAllowance(): Promise<string> { return '0'; }
  async getCredit(): Promise<string> { return '0'; }
  async getEntrant(): Promise<never> { throw new Error('NOT_CONFIGURED'); }
  async approveEscrow(): Promise<WalletTransaction> { throw new Error('NOT_CONFIGURED'); }
  async registerEntrant(): Promise<WalletTransaction> { throw new Error('NOT_CONFIGURED'); }
  async withdrawCredit(): Promise<WalletTransaction> { throw new Error('NOT_CONFIGURED'); }
  async signMessage(): Promise<string> { throw new Error('NOT_CONFIGURED'); }
  async waitForTransaction(): Promise<'CONFIRMED' | 'FAILED'> { return 'CONFIRMED'; }
  async disconnect(): Promise<void> {}
  onAccountsChanged(): void {}
  removeListener(): void {}
}

describe('phase 10 product routes', () => {
  beforeEach(() => window.history.pushState({}, '', '/'));

  it('keeps Account out of primary navigation until the user signs in', async () => {
    render(<App walletAdapter={new RouteWallet()} />);
    await screen.findByRole('heading', { name: /Arena ISS — Intelligence, Safety & Standards/i });
    expect(screen.getByRole('link', { name: 'Tournaments' })).toHaveAttribute('href', '/tournaments');
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '/agents');
    expect(screen.queryByRole('link', { name: 'Credits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('renders agent creation and redirects the legacy credits route to Account credits', async () => {
    render(<App walletAdapter={new RouteWallet()} />);
    await screen.findByRole('heading', { name: /Arena ISS — Intelligence, Safety & Standards/i });
    fireEvent.click(screen.getByRole('link', { name: 'Agents' }));
    expect(await screen.findByRole('heading', { name: 'My Agents' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Create Agent' }));
    expect(await screen.findByLabelText('Agent name')).toBeInTheDocument();
    expect(screen.getByLabelText('AGENTS.md content')).toBeInTheDocument();
    act(() => {
      window.history.pushState({}, '', '/credits');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('tab', { name: 'Tournament credits' })).toHaveAttribute('aria-selected', 'true');
  });

  it('previews only the portable SKILL.md extension without enabling it', async () => {
    window.history.pushState({}, '', '/agents/new');
    render(<App walletAdapter={new RouteWallet()} />);

    expect(await screen.findByRole('heading', { name: 'Agent extensions' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Upload SKILL.md — coming soon' })).toBeDisabled();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.queryByText('SOUL.md')).not.toBeInTheDocument();
    expect(screen.queryByText('MEMORY.md')).not.toBeInTheDocument();
    expect(screen.queryByText('CAPABILITIES.md')).not.toBeInTheDocument();
  });
});
