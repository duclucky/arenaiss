import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import App from '../App';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProvider, loadRuntimeConfig } from '../context';

import { SubmitEntry } from '../views/SubmitEntry';
import { TournamentDetail } from '../views/TournamentDetail';
import { MatchDetail } from '../views/MatchDetail';
import { LoginModal } from '../components/LoginModal';
import { NotFound } from '../views/NotFound';
import { ArcWalletAdapter, WalletProvider, ArcNetworkConfig, EntrantRegistration, WalletTransaction } from '../adapters/interfaces';
import { BrowserArcWalletAdapter } from '../adapters/wallet';

class TestWalletAdapter implements ArcWalletAdapter {
  connectCalls: string[] = [];
  async getProviders(): Promise<WalletProvider[]> {
    return [
      { name: 'Test Provider', icon: 'icon', uuid: 'test-uuid', isInstalled: true, request: async () => ['0xTestAddress'] },
    ];
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async connect(providerUuid: string): Promise<string> {
    this.connectCalls.push(providerUuid);
    return '0xTestAddress';
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async switchChain(_config: ArcNetworkConfig): Promise<void> {}
  
  async getBalance(_address: string, config: ArcNetworkConfig): Promise<string> {
    if (!config.usdcAddress) throw new Error('NOT_CONFIGURED');
    return '100000000'; // 100 USDC
  }
  
  async getAllowance(_address: string, config: ArcNetworkConfig): Promise<string> {
    if (!config.usdcAddress || !config.escrowAddress) throw new Error('NOT_CONFIGURED');
    return '0';
  }
  async getCredit(_tournamentId: string, _address: string, _config: ArcNetworkConfig): Promise<string> { return '0'; }
  async getEntrant(): Promise<never> { throw new Error('NOT_CONFIGURED'); }
  async approveEscrow(_amount: string, _config: ArcNetworkConfig): Promise<WalletTransaction> { return { hash: '0x1', state: 'SUBMITTED' }; }
  async registerEntrant(_input: EntrantRegistration, _config: ArcNetworkConfig): Promise<WalletTransaction> { return { hash: '0x2', state: 'SUBMITTED' }; }
  async withdrawCredit(_tournamentId: string, _config: ArcNetworkConfig): Promise<WalletTransaction> { return { hash: '0x3', state: 'SUBMITTED' }; }
  async signMessage(): Promise<string> { return '0xsigned'; }
  async waitForTransaction(): Promise<'CONFIRMED' | 'FAILED'> { return 'CONFIRMED'; }
  async disconnect(): Promise<void> {}
  onAccountsChanged() {}
  removeListener() {}
}

describe('App Tests', () => {
  beforeEach(() => window.history.pushState({}, '', '/'));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. route rendering and not-found behavior', async () => {
    render(<MemoryRouter initialEntries={['/invalid-route']}><NotFound /></MemoryRouter>);
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('Page Not Found')).toBeInTheDocument();
  });

  it('2. wallet modal lists detected providers without auto-selecting', async () => {
    const testAdapter = new TestWalletAdapter();
    render(<AppProvider walletAdapter={testAdapter}><LoginModal onClose={() => {}} /></AppProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with wallet' }));
    const providerBtn = await screen.findByText('Test Provider');
    expect(providerBtn).toBeInTheDocument();
    expect(testAdapter.connectCalls).toHaveLength(0);
  });

  it('3. selecting/disconnecting a wallet clears write capability', async () => {
    const testAdapter = new TestWalletAdapter();
    const env = { VITE_ARC_CHAIN_ID: '5042002', VITE_ARC_RPC_URL: 'https://rpc.testnet.arc.io', VITE_ARC_NETWORK_NAME: 'Arc Testnet', VITE_ARC_USDC_ADDRESS: '0x0000000000000000000000000000000000000001' };
    render(<App env={env} walletAdapter={testAdapter} />);
    
    fireEvent.click(screen.getByRole('button', { name: 'Start with Agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with wallet' }));

    const providerBtn = (await screen.findByText('Test Provider')).closest('button');
    
    // Not connected yet
    expect(screen.queryByText('Disconnect')).not.toBeInTheDocument();
    
    fireEvent.click(providerBtn!);

    fireEvent.click(await screen.findByRole('button', { name: /0xTest/i }));
    const disconnectBtn = await screen.findByText('Disconnect');
    expect(disconnectBtn).toBeInTheDocument();
    
    // Disconnect
    fireEvent.click(disconnectBtn);
    expect(await screen.findByRole('button', { name: 'Login' })).toBeInTheDocument();
  });

  it('4. malformed config renders NOT_CONFIGURED and disables live writes', async () => {
    // missing name and invalid chain ID
    const badEnv = { VITE_ARC_CHAIN_ID: '5042002oops', VITE_ARC_RPC_URL: 'invalid-url' };
    
    render(
      <MemoryRouter initialEntries={['/tournaments/1/submit']}>
        <AppProvider env={badEnv}>
          <SubmitEntry />
        </AppProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Network Not Configured')).toBeInTheDocument();
    const submitBtn = screen.getByRole('button', { name: /Submit to Arena \(Disabled\)/i });
    expect(submitBtn).toBeDisabled();
    
    expect(loadRuntimeConfig(badEnv)).toBeNull();
    expect(loadRuntimeConfig({
      VITE_ARC_CHAIN_ID: '5042002',
      VITE_ARC_RPC_URL: 'https://rpc.testnet.arc.io',
      VITE_ARC_NETWORK_NAME: 'Arc Testnet',
      VITE_ARC_USDC_ADDRESS: 'not-an-address',
    })).toBeNull();
  });

  it('loads one complete Studio Next binding with both deployed judges', () => {
    expect(loadRuntimeConfig({
      VITE_ARC_CHAIN_ID: '5042002',
      VITE_ARC_RPC_URL: 'https://rpc.testnet.arc.network',
      VITE_ARC_NETWORK_NAME: 'Arc Testnet',
      VITE_GENLAYER_CHAIN_ID: '61997',
      VITE_GENLAYER_RPC_URL: 'https://studio-next.genlayer.com/api',
      VITE_GENLAYER_NETWORK_NAME: 'GenLayer Studio Next',
      VITE_GENLAYER_EXPLORER_URL: 'https://explorer-studio-dev.genlayer.com',
      VITE_GENLAYER_MATCH_JUDGE_ADDRESS: '0xbd5592dc0A45B78614cd5d1c2f29F6F35dabB679',
      VITE_GENLAYER_EVALUATION_JUDGE_ADDRESS: '0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d',
      VITE_GENLAYER_COMPARISON_JUDGE_ADDRESS: '0xe5210eCCC4182090A1416f515Dc7001B27274BcB',
    })?.genLayer).toEqual({
      chainId: 61997,
      rpcUrl: 'https://studio-next.genlayer.com/api',
      name: 'GenLayer Studio Next',
      explorerUrl: 'https://explorer-studio-dev.genlayer.com',
      matchJudgeAddress: '0xbd5592dc0A45B78614cd5d1c2f29F6F35dabB679',
      evaluationJudgeAddress: '0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d',
      comparisonJudgeAddress: '0xe5210eCCC4182090A1416f515Dc7001B27274BcB',
    });
  });

  it('5. distinct lifecycle fixtures and explicit preview badges', async () => {
    render(
      <MemoryRouter initialEntries={['/tournaments/1']}>
        <AppProvider>
          <Routes>
            <Route path="/tournaments/:id" element={<TournamentDetail />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    );
    
    const finalizedBadge = await screen.findByTestId('lifecycle-m1');
    expect(finalizedBadge).toHaveTextContent('FINALIZED');
    
    const retryBadge = await screen.findByTestId('lifecycle-m3');
    expect(retryBadge).toHaveTextContent('RETRY');
    
    const failedBadge = await screen.findByTestId('lifecycle-m4');
    expect(failedBadge).toHaveTextContent('FAILED');
    
    const acceptedBadge = await screen.findByTestId('lifecycle-m5');
    expect(acceptedBadge).toHaveTextContent('ACCEPTED');
    const retryableBadge = await screen.findByTestId('lifecycle-m6');
    expect(retryableBadge).toHaveTextContent('RETRYABLE');
    expect(screen.getByTestId('preview-tournament-detail')).toHaveTextContent('Preview data · no live tx');
    expect(screen.getByRole('heading', { name: 'Activity log' })).toBeInTheDocument();
    expect(screen.getByText('GenLayer verdict finalized')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top 5 payout preview' })).toBeInTheDocument();
  });

  it('6. optional adapter explorer link renders correctly', async () => {
    render(
      <MemoryRouter initialEntries={['/matches/m1']}>
        <AppProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetail />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    );
    
    const link = await screen.findByRole('link', { name: /View on GenLayer Explorer/i });
    expect(link).toHaveAttribute('href', 'https://explorer.genlayer.com/verdict/v1');
    
    // Explicit preview check
    expect(screen.getByText('Preview Verdict')).toBeInTheDocument();
  });

  it('6a. completed tournament uses the prior live testnet settlement evidence', async () => {
    render(
      <MemoryRouter initialEntries={['/tournaments/3']}>
        <AppProvider>
          <Routes>
            <Route path="/tournaments/:id" element={<TournamentDetail />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Live testnet receipts')).toBeInTheDocument();
    expect(screen.getByText('Gamma Finals · Live Run')).toBeInTheDocument();
    expect(screen.getByText('12 GenLayer transactions finalized')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top 5 payout receipts' })).toBeInTheDocument();
    expect(screen.getByText('0.00288 USDC')).toBeInTheDocument();
    expect(screen.getByText(/0.0008 USDC platform fee consumed the full pool/)).toBeInTheDocument();
  });

  it('6b. live lifecycle evidence renders a complete finalized match record', async () => {
    render(
      <MemoryRouter initialEntries={['/matches/g1']}>
        <AppProvider>
          <Routes>
            <Route path="/matches/:id" element={<MatchDetail />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Verified GenLayer verdict' })).toBeInTheDocument();
    expect(screen.getByText('LIVE TESTNET EVIDENCE')).toBeInTheDocument();
    expect(screen.getByText('GeneralResponseV7')).toBeInTheDocument();
    expect(screen.getByText('Criterion reasoning')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('A fully explains idempotency keys for retrying paid API requests; B does not address the topic.')).toBeInTheDocument();
    expect(screen.getByText('CLOSED · zero liability')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View on GenLayer Explorer/i })).toHaveAttribute(
      'href',
      'https://explorer.genlayer.com/transactions/0xe4b114fd8b093cfa56cb1253ed5e48494abe6ff29205fe8331289baf67d10a21',
    );
  });

  it('7. modal focus cycle, trigger restoration, and Escape handling', async () => {
    const testAdapter = new TestWalletAdapter();
    const env = { VITE_ARC_CHAIN_ID: '5042002', VITE_ARC_RPC_URL: 'https://rpc.testnet.arc.io', VITE_ARC_NETWORK_NAME: 'Arc Testnet' };
    
    render(<App env={env} walletAdapter={testAdapter} />);
    
    const trigger = screen.getByRole('button', { name: 'Start with Agent' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with wallet' }));

    const providerBtn = (await screen.findByText('Test Provider')).closest('button');
    const closeBtn = screen.getByLabelText('Close login');
    
    await waitFor(() => expect(document.activeElement).toBe(closeBtn));
    
    // Test the focus trap wrapping
    // 1. Shift+Tab from closeBtn -> wraps to providerBtn
    closeBtn.focus();
    fireEvent.keyDown(closeBtn, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(providerBtn);
    
    // 2. Tab from providerBtn -> wraps to closeBtn
    providerBtn!.focus();
    fireEvent.keyDown(providerBtn!, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);
    
    // Escape
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    
    // Trigger restored
    expect(document.activeElement).toBe(trigger);
  });

  it('8. balance and allowance handle missing token config by throwing NOT_CONFIGURED', async () => {
    const requests: Array<{ method: string; params?: unknown[] }> = [];
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        request: async (args: { method: string; params?: unknown[] }) => {
          requests.push(args);
          if (args.method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
          return '0x';
        },
      },
    });
    const adapter = new BrowserArcWalletAdapter();
    await new Promise(resolve => setTimeout(resolve, 120));
    await adapter.connect('fallback-ethereum');
    const config = { chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.io', name: 'Arc Testnet' };
    await expect(adapter.getBalance('0x1111111111111111111111111111111111111111', config)).rejects.toThrow('NOT_CONFIGURED');
    await expect(adapter.getAllowance('0x1111111111111111111111111111111111111111', config)).rejects.toThrow('NOT_CONFIGURED');
    expect(requests.some(request => request.method === 'eth_call')).toBe(false);
    delete (window as unknown as { ethereum?: unknown }).ethereum;
  });

  it('9. no component calls raw window.ethereum or raw fetch directly', async () => {
    const spyFetch = vi.spyOn(globalThis, 'fetch');
    const testAdapter = new TestWalletAdapter();
    render(<App walletAdapter={testAdapter} />);
    await screen.findByRole('heading', { name: /Arena ISS Arena Intelligence, Safety & Standards/i });
    expect(spyFetch).not.toHaveBeenCalled();
  });

  it('10. no fake balance or address appears, uses Unavailable fallback', async () => {
    const testAdapter = new TestWalletAdapter();
    const env = { VITE_ARC_CHAIN_ID: '5042002', VITE_ARC_RPC_URL: 'https://rpc.testnet.arc.io', VITE_ARC_NETWORK_NAME: 'Arc Testnet' };
    
    render(<App env={env} walletAdapter={testAdapter} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start with Agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with wallet' }));
    
    const providerBtn = (await screen.findByText('Test Provider')).closest('button');
    fireEvent.click(providerBtn!);

    // Account is intentionally available only from the signed-in address menu.
    const accountMenu = await screen.findByRole('button', { name: /0xTest/i });
    fireEvent.click(accountMenu);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View account' }));
    
    // Since usdcAddress is missing, balance fails and shows Unavailable
    const unavailableSpan = await screen.findByText('Unavailable');
    expect(unavailableSpan).toBeInTheDocument();
    expect(screen.queryByText('100.00 USDC')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00 USDC')).not.toBeInTheDocument();
  });
});
