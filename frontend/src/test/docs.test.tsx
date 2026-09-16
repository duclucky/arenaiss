import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';

describe('Arena ISS product documentation', () => {
  it('explains the current evaluation product and its trust boundaries', async () => {
    window.history.pushState({}, '', '/docs');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Evaluate agents with evidence, not vibes.' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Documentation sections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How an evaluation works' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What the server sends to the provider' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What the provider must return' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How GenLayer reaches a verdict' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AgentEvaluationJudge flow' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ArenaComparisonJudge flow' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Legacy ArenaMatchJudge flow' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Who decides what' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evaluation fees, judgment, and refunds' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Marketplace' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Networks and contracts' })).toBeInTheDocument();

    const dimensions = screen.getByRole('list', { name: 'Scorecard dimensions' });
    for (const label of [
      'Instruction adherence',
      'Reasoning quality',
      'Action selection',
      'Rule compliance',
      'Task completion',
      'Safety',
    ]) {
      expect(within(dimensions).getByText(label)).toBeInTheDocument();
    }

    expect(screen.getByText(/1 USDC is held in the evaluation fee escrow/i)).toBeInTheDocument();
    expect(screen.getByText(/fixed 1% platform fee/i)).toBeInTheDocument();
    expect(screen.getByText(/trusted operator/i)).toBeInTheDocument();
    expect(screen.getByText(/including AGENTS.md bytes for Agent evaluations and Tournament comparisons/i)).toBeInTheDocument();
    expect(screen.queryByText(/does not receive private AGENTS.md/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Both injected wallets and Arena managed Circle wallets can register/i)).toBeInTheDocument();
    expect(screen.getByText(/eligible evaluation timeout refunds are claimable through Account/i)).toBeInTheDocument();
    expect(screen.getByText('arena-evaluation-input-v1')).toBeInTheDocument();
    expect(screen.getByText('arena-evaluation-output-v1')).toBeInTheDocument();
    expect(screen.queryByText('arena-generation-input-v2')).not.toBeInTheDocument();
    expect(screen.getByText(/single-Agent runs can use the fallback after a timeout, rate limit, or temporary upstream failure/i)).toBeInTheDocument();
    expect(screen.getByText(/Tournament retries the whole pair on the fallback route only when a primary call times out/i)).toBeInTheDocument();
    expect(screen.getByText(/A critical policy finding or a FAIL grade in safety or rule compliance sets the effective score to 0/i)).toBeInTheDocument();
    expect(screen.getByText(/Marketplace eligibility requires 12 finalized runs/i)).toBeInTheDocument();
    expect(screen.getByText(/registration closes at 00:00 UTC/i)).toBeInTheDocument();
    expect(screen.getByText(/8 to 32 registered Agents/i)).toBeInTheDocument();
    expect(screen.getByText(/10% platform fee/i)).toBeInTheDocument();
    expect(screen.getByText(/40%.*25%.*15%.*10%.*10%/i)).toBeInTheDocument();
    expect(screen.getByText(/a leader proposes a scorecard or comparison/i)).toBeInTheDocument();
    expect(screen.getByText(/a second validator audits the proposal/i)).toBeInTheDocument();
    expect(screen.getByText(/does not read hidden chain of thought/i)).toBeInTheDocument();
    expect(screen.queryByText(/trustless/i)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(String.fromCodePoint(0x2014));
  });

  it('publishes the canonical testnet deployments and capability status', async () => {
    window.history.pushState({}, '', '/docs');
    render(<App />);

    const evoEscrow = await screen.findByRole('link', { name: /EvoFeeEscrow/i });
    expect(evoEscrow).toHaveAttribute('href', expect.stringContaining('0xa7693481E17736F1617b3a6dc199aA31D86398E9'));

    const evaluationJudge = screen.getByRole('link', { name: /AgentEvaluationJudge/i });
    expect(evaluationJudge).toHaveAttribute('href', expect.stringContaining('0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d'));

    expect(screen.getByText('Active · Agent evaluation')).toBeInTheDocument();
    expect(screen.getByText('Active · Tournament and comparison')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'GenLayer Studio development preview' })).toBeInTheDocument();
    expect(screen.getByText(/formerly reached through the Studio Next alias/i)).toBeInTheDocument();
    expect(screen.queryByText('Archived historical contract')).not.toBeInTheDocument();
  });
});
