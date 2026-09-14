import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import App from '../App';
import type { AgentApiAdapter, AgentProfile, ArcNetworkConfig, ArcWalletAdapter, CanonicalEntrant, EntrantRegistration, WalletProvider, WalletTransaction } from '../adapters/interfaces';

const account = '0x1111111111111111111111111111111111111111';
const tournamentA = `0x${'a'.repeat(64)}`;
const tournamentB = `0x${'b'.repeat(64)}`;
const tournamentNotRegistered = `0x${'c'.repeat(64)}`;
const entrant = (char: string) => `0x${char.repeat(64)}`;

class CreditsAgentApi implements AgentApiAdapter {
  async listOwnedAgents(): Promise<AgentProfile[]> { return []; }
  async createAgent(): Promise<AgentProfile> { throw new Error('unused'); }
  async prepareRegistration(): Promise<EntrantRegistration & { stakeAmount: string }> { throw new Error('unused'); }
  async listOwnedRegistrations() {
    return [
      { tournamentId: tournamentA, entrantId: entrant('1') },
      { tournamentId: tournamentB, entrantId: entrant('2') },
      { tournamentId: tournamentNotRegistered, entrantId: entrant('3') },
    ];
  }
}

class CreditsWallet implements ArcWalletAdapter {
  withdrawn: string[] = [];
  creditReads = new Map([[tournamentA, 0], [tournamentB, 0]]);
  async getProviders(): Promise<WalletProvider[]> { return [{ name: 'Test Wallet', icon: '', uuid: 'wallet', isInstalled: true, request: async () => [] }]; }
  async connect() { return account; }
  async switchChain() {}
  async getBalance() { return '5000000'; }
  async getAllowance() { return '0'; }
  async getCredit(tournamentId: string) {
    const reads = this.creditReads.get(tournamentId) || 0;
    this.creditReads.set(tournamentId, reads + 1);
    return tournamentId === tournamentB && reads === 0 ? '2500000' : '0';
  }
  async getEntrant(tournamentId: string, entrantId: string): Promise<CanonicalEntrant> {
    return { tournamentId, entrantId, agentId: entrant('d'), agentsVersion: entrant('e'), agentsCommitment: entrant('f'), wallet: account, registered: tournamentId !== tournamentNotRegistered, ranked: false };
  }
  async approveEscrow(): Promise<WalletTransaction> { throw new Error('unused'); }
  async registerEntrant(): Promise<WalletTransaction> { throw new Error('unused'); }
  async withdrawCredit(tournamentId: string): Promise<WalletTransaction> { this.withdrawn.push(tournamentId); return { hash: `0x${'9'.repeat(64)}`, state: 'SUBMITTED' }; }
  async signMessage() { return '0xsigned'; }
  async waitForTransaction() { return 'CONFIRMED' as const; }
  async disconnect() {}
  onAccountsChanged() {}
  removeListener() {}
}

describe('Account tournament credits', () => {
  beforeEach(() => window.history.pushState({}, '', '/account?tab=credits'));

  it('lists canonical participations and offers Claim only for non-zero escrow credit', async () => {
    const wallet = new CreditsWallet();
    const config: ArcNetworkConfig = { chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', escrowAddress: '0x2875BeA04e01EdaAA762987431ad5a87CF11445d' };
    render(<App config={config} walletAdapter={wallet} agentApiAdapter={new CreditsAgentApi()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test Wallet' }));

    expect(await screen.findByText(tournamentA)).toBeInTheDocument();
    expect(screen.getByText(tournamentB)).toBeInTheDocument();
    expect(screen.queryByText(tournamentNotRegistered)).not.toBeInTheDocument();
    expect(screen.getByText('2.5 USDC claimable')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Claim' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));
    expect(await screen.findByText('Claim confirmed.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument());
    expect(wallet.withdrawn).toEqual([tournamentB]);
  });
});
