import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';
import type { AgentApiAdapter, AgentProfile, ArcNetworkConfig, ArcWalletAdapter, EntrantRegistration, ManagedIdentityAdapter, WalletProvider, WalletTransaction } from '../adapters/interfaces';

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const bytes32 = (char: string) => `0x${char.repeat(64)}`;

class AgentApi implements AgentApiAdapter {
  agent: AgentProfile = { agentId: digest('b'), name: 'Strategist', agentsVersion: digest('c'), agentsCommitment: digest('d') };
  async listOwnedAgents() { return [this.agent]; }
  async listOwnedRegistrations() { return []; }
  async createAgent() { return this.agent; }
  async prepareRegistration(tournamentId: string, agentId: string) {
    expect(tournamentId).toBe(digest('a')); expect(agentId).toBe(this.agent.agentId);
    return { tournamentId: bytes32('a'), entrantId: bytes32('e'), agentId: bytes32('b'), agentsVersion: bytes32('c'), agentsCommitment: bytes32('d'), stakeAmount: '100000' };
  }
}

class Wallet implements ArcWalletAdapter {
  approvals: string[] = []; registrations: EntrantRegistration[] = []; entrantReads = 0;
  async getProviders(): Promise<WalletProvider[]> { return [{ name: 'Wallet', icon: '', uuid: 'wallet', isInstalled: true, request: async () => [] }]; }
  async connect() { return '0x1111111111111111111111111111111111111111'; }
  async switchChain() {}
  async getBalance() { return '1000000'; }
  async getAllowance() { return '0'; }
  async getCredit() { return '0'; }
  async getEntrant(tournamentId: string, entrantId: string) { this.entrantReads += 1; return { tournamentId, entrantId, agentId: bytes32('b'), agentsVersion: bytes32('c'), agentsCommitment: bytes32('d'), wallet: '0x1111111111111111111111111111111111111111', registered: true, ranked: false }; }
  async approveEscrow(amount: string): Promise<WalletTransaction> { this.approvals.push(amount); return { hash: `0x${'1'.repeat(64)}`, state: 'SUBMITTED' }; }
  async registerEntrant(input: EntrantRegistration): Promise<WalletTransaction> { this.registrations.push(input); return { hash: `0x${'2'.repeat(64)}`, state: 'SUBMITTED' }; }
  async withdrawCredit(): Promise<WalletTransaction> { throw new Error('unused'); }
  async signMessage() { return '0xsigned'; }
  async waitForTransaction() { return 'CONFIRMED' as const; }
  async disconnect() {}
  onAccountsChanged() {}
  removeListener() {}
}

describe('Arc registration screen', () => {
  beforeEach(() => window.history.pushState({}, '', `/tournaments/${digest('a')}/submit`));
  it('loads an owned agent, confirms exact stake, approves USDC, registers and reports confirmation', async () => {
    const wallet = new Wallet();
    const config: ArcNetworkConfig = { chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', usdcAddress: '0x3600000000000000000000000000000000000000', escrowAddress: '0x2875BeA04e01EdaAA762987431ad5a87CF11445d' };
    render(<App config={config} walletAdapter={wallet} agentApiAdapter={new AgentApi()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with wallet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Wallet' }));
    const option = await screen.findByRole('option', { name: 'Strategist' });
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: option.getAttribute('value') } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve and enter' }));
    expect(await screen.findByText('Registration confirmed on Arc.')).toBeInTheDocument();
    expect(wallet.approvals).toEqual(['100000']);
    expect(wallet.registrations).toHaveLength(1);
    expect(wallet.entrantReads).toBe(1);
  });

  it('registers through the Circle managed wallet when the session uses managed custody', async () => {
    const registerTournamentEntrant = vi.fn().mockResolvedValue({ transactionId: 'entry', state: 'COMPLETE', txHash: `0x${'3'.repeat(64)}` });
    const managedAccount = { userId: 'usr_owner', principal: 'owner@example.com', identity: { kind: 'EMAIL' as const }, managedWallet: { state: 'READY' as const, userId: 'usr_owner', walletId: 'wallet', address: '0x4444444444444444444444444444444444444444', blockchain: 'ARC-TESTNET' as const, accountType: 'SCA' as const } };
    const identity: ManagedIdentityAdapter = { async capabilities() { return { wallet: true, email: true, managedWallet: true }; }, async restore() { return managedAccount; }, async signInWithWallet() { return managedAccount; }, async requestEmailCode() {}, async verifyEmail() { return managedAccount; }, registerTournamentEntrant, async logout() {} };
    const config: ArcNetworkConfig = { chainId: 5_042_002, rpcUrl: 'https://rpc.testnet.arc.network', name: 'Arc Testnet', usdcAddress: '0x3600000000000000000000000000000000000000', escrowAddress: '0x2875BeA04e01EdaAA762987431ad5a87CF11445d' };
    render(<App config={config} identityAdapter={identity} agentApiAdapter={new AgentApi()} />);
    const option = await screen.findByRole('option', { name: 'Strategist' });
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: option.getAttribute('value') } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter with managed wallet' }));
    expect(await screen.findByText('Registration confirmed on Arc.')).toBeInTheDocument();
    expect(registerTournamentEntrant).toHaveBeenCalledWith(digest('a'), digest('b'));
  });
});
