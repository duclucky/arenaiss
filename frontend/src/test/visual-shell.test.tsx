import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';
import type { ArenaReadAdapter, ArcWalletAdapter, Match, Tournament, WalletProvider, WalletTransaction } from '../adapters/interfaces';

class VisualWallet implements ArcWalletAdapter {
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
  async waitForTransaction(): Promise<'CONFIRMED' | 'FAILED'> { return 'FAILED'; }
  async disconnect(): Promise<void> {}
  onAccountsChanged(): void {}
  removeListener(): void {}
}

class RecoveringArenaRead implements ArenaReadAdapter {
  calls = 0;
  async listTournaments(): Promise<Tournament[]> {
    this.calls += 1;
    if (this.calls === 1) throw new Error('temporary read failure');
    return [{ id: 't1', name: 'Recovered Arena', status: 'ACTIVE', prizePool: '900' }];
  }
  async getTournament(): Promise<Tournament | null> { return null; }
  async getMatches(): Promise<Match[]> { return []; }
  async getMatch(): Promise<Match | null> { return null; }
}

describe('Arena ISS visual shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    window.history.pushState({}, '', '/');
  });

  it('renders the Arena ISS platform message without duplicate page actions', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
    const { container } = render(<App walletAdapter={new VisualWallet()} />);

    const heading = await screen.findByRole('heading', { name: /Arena ISS Arena Intelligence, Safety & Standards\. Test AI agents on practical tasks and safety rules\. Join tournaments\. Buy or sell agents that pass evaluation\./i });
    expect(heading.querySelectorAll('[data-hero-line]')).toHaveLength(4);
    expect(heading.querySelector('[data-hero-line="brand"]')).toHaveTextContent('Arena ISS');
    expect(heading.querySelector('[data-hero-line="standard"]')).toHaveTextContent('Arena Intelligence, Safety & Standards.');
    expect(heading.querySelector('[data-hero-line="promise"]')).toHaveTextContent('Test AI agents on practical tasks and safety rules.');
    expect(heading.querySelector('[data-hero-line="detail"]')).toHaveTextContent('Join tournaments. Buy or sell agents that pass evaluation.');
    expect(screen.queryByRole('link', { name: 'Arena ISS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Arena ISS technology ticker' })).not.toBeInTheDocument();
    expect(container.querySelector('.site-header')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tournaments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Agents' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Evaluations' })).not.toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start with Agent' });
    expect(screen.getByRole('link', { name: 'Read Docs' })).toHaveAttribute('href', '/docs');
    expect(screen.getByRole('img', { name: 'Arc' })).toHaveAttribute('src', '/brand/arc-logo-dark.svg');
    expect(screen.getByText('USDC settlement on Arc Testnet')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'GenLayer' })).toHaveAttribute('src', '/brand/genlayer-logo-black.svg');
    expect(screen.getByText('AI verdicts in GenVM')).toBeInTheDocument();
    const platformStrip = screen.getByRole('group', { name: 'Settlement and evaluation networks' });
    expect(platformStrip).toHaveClass('hero-platforms');
    expect(platformStrip.querySelectorAll('.hero-platform-card')).toHaveLength(2);
    fireEvent.click(start);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Explore tournaments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Build an agent' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Trusted-operator MVP/i)).not.toBeInTheDocument();
    const canvas = container.querySelector<HTMLCanvasElement>('canvas.hero-canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas).toHaveAttribute('data-frame-count', '97');
    expect(canvas).toHaveAttribute('data-frame-source', '/hero-sequence/frame-001.webp');
    expect(container.querySelector('video')).not.toBeInTheDocument();
  });

  it('keeps deliberate frame selection but suppresses parallax when reduced motion is requested', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    try {
      const { container } = render(<App walletAdapter={new VisualWallet()} />);
      const canvas = container.querySelector<HTMLCanvasElement>('canvas.hero-canvas');
      fireEvent.pointerMove(window, { clientX: window.innerWidth * .75, pointerType: 'mouse' });
      expect(canvas).toHaveAttribute('data-target-frame', '72');
      expect(canvas).toHaveAttribute('data-rendered-frame', '0');
      expect(canvas?.style.getPropertyValue('--hero-shift-x')).toBe('');
      expect(canvas?.style.getPropertyValue('--hero-shift-y')).toBe('');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('coalesces pointer input and eases the canvas toward the requested image frame', () => {
    const frames: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;

    let unmount: () => void = () => undefined;
    try {
      const rendered = render(<App walletAdapter={new VisualWallet()} />);
      unmount = rendered.unmount;
      const canvas = rendered.container.querySelector<HTMLCanvasElement>('canvas.hero-canvas');

      fireEvent.pointerMove(window, { clientX: window.innerWidth * .75, pointerType: 'mouse' });
      expect(frames).toHaveLength(1);
      expect(canvas).toHaveAttribute('data-target-frame', '72');
      expect(canvas).toHaveAttribute('data-rendered-frame', '0');

      act(() => frames.shift()?.(16));
      const firstFrame = Number(canvas?.dataset.renderedFrame);
      expect(firstFrame).toBeGreaterThan(0);
      expect(firstFrame).toBeLessThan(72);
      expect(frames).toHaveLength(1);

      fireEvent.pointerMove(window, { clientX: window.innerWidth * .85, pointerType: 'mouse' });
      expect(canvas).toHaveAttribute('data-target-frame', '82');
      expect(Number(canvas?.dataset.renderedFrame)).toBe(firstFrame);
      expect(frames).toHaveLength(1);

      act(() => frames.shift()?.(32));
      expect(Number(canvas?.dataset.renderedFrame)).toBeGreaterThan(firstFrame);
      expect(Number(canvas?.dataset.renderedFrame)).toBeLessThan(82);
    } finally {
      unmount();
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  it('adds compositor-only parallax while the image frame sequence renders', () => {
    const frames: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;

    let unmount: () => void = () => undefined;
    try {
      const rendered = render(<App walletAdapter={new VisualWallet()} />);
      unmount = rendered.unmount;
      const canvas = rendered.container.querySelector<HTMLCanvasElement>('canvas.hero-canvas');

      fireEvent.pointerMove(window, { clientX: window.innerWidth * .75, clientY: window.innerHeight * .25, pointerType: 'mouse' });
      expect(frames).toHaveLength(1);
      act(() => frames.shift()?.(16));

      expect(Number.parseFloat(canvas!.style.getPropertyValue('--hero-shift-x'))).toBeGreaterThan(0);
      expect(Number.parseFloat(canvas!.style.getPropertyValue('--hero-shift-y'))).toBeLessThan(0);
      expect(frames).toHaveLength(1);
    } finally {
      unmount();
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  it('uses the same editorial shell on inner product pages', async () => {
    window.history.pushState({}, '', '/tournaments');
    const { container } = render(<App walletAdapter={new VisualWallet()} />);

    expect(await screen.findByRole('heading', { name: 'Tournaments' })).toBeInTheDocument();
    expect(container.querySelector('.app-shell')).toHaveAttribute('data-surface', 'editorial');
    expect(container.querySelector('.brand-mark')).toHaveAttribute('src', '/brand/arena-iss-mark.png');
    expect(container.querySelector('.brand-star')).not.toBeInTheDocument();
    expect(container.querySelector('.page-kicker')).toHaveTextContent('Future competition mode');
    expect(screen.getByRole('button', { name: 'Build an agent' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Explore pair matches' })).toHaveAttribute('href', '/pairs');
  });

  it('does not expose product navigation before login', async () => {
    render(<App walletAdapter={new VisualWallet()} />);
    expect(await screen.findByRole('button', { name: 'Start with Agent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('shows the paused Tournament page without loading an obsolete live list', async () => {
    window.history.pushState({}, '', '/tournaments');
    const arenaRead = new RecoveringArenaRead();
    render(<App walletAdapter={new VisualWallet()} arenaReadAdapter={arenaRead} />);
    expect(await screen.findByRole('heading', { name: 'Tournament play is paused' })).toBeInTheDocument();
    expect(arenaRead.calls).toBe(0);
  });
});
