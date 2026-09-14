import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StudioNextDeployment } from '../components/StudioNextDeployment';
import type { GenLayerNetworkConfig } from '../adapters/interfaces';

const config: GenLayerNetworkConfig = {
  chainId: 61997,
  rpcUrl: 'https://studio-next.genlayer.com/api',
  name: 'GenLayer Studio Next',
  explorerUrl: 'https://explorer-studio-dev.genlayer.com',
  matchJudgeAddress: '0xbd5592dc0A45B78614cd5d1c2f29F6F35dabB679',
  evaluationJudgeAddress: '0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d',
};

describe('Studio Next deployment card', () => {
  it('shows a publicly verifiable binding for both deployed judges', async () => {
    const verify = vi.fn().mockResolvedValue({
      state: 'VERIFIED',
      chainId: 61997,
      matchJudgeVerified: true,
      evaluationJudgeVerified: true,
    });

    render(<StudioNextDeployment config={config} verify={verify} />);

    expect(screen.getByRole('status')).toHaveTextContent('Verifying on Studio Next');
    expect(await screen.findByText('Verified on chain 61997')).toBeInTheDocument();
    expect(screen.getByText(config.matchJudgeAddress)).toBeInTheDocument();
    expect(screen.getByText(config.evaluationJudgeAddress)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Studio Next explorer' })).toHaveAttribute('href', config.explorerUrl);
    expect(screen.getByText('Transaction Kit RC2 · genlayer-js RC1')).toBeInTheDocument();
  });

  it('does not imply a deployment when runtime configuration is absent', () => {
    render(<StudioNextDeployment />);
    expect(screen.getByRole('alert')).toHaveTextContent('Studio Next is not configured');
    expect(screen.queryByText(/Verified on chain/)).not.toBeInTheDocument();
  });
});
