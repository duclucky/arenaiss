import { useEffect, useState } from 'react';
import { CircleAlert, ExternalLink, LoaderCircle, ShieldCheck } from 'lucide-react';

import type { GenLayerNetworkConfig } from '../adapters/interfaces';
import { verifyStudioNextDeployments, type StudioNextDeploymentStatus } from '../adapters/genlayer-deployment';

export type StudioNextDeploymentProps = {
  config?: GenLayerNetworkConfig;
  verify?: (config: GenLayerNetworkConfig) => Promise<StudioNextDeploymentStatus>;
};

const unavailable: StudioNextDeploymentStatus = {
  state: 'UNAVAILABLE',
  matchJudgeVerified: false,
  evaluationJudgeVerified: false,
};

export function StudioNextDeployment({ config, verify = verifyStudioNextDeployments }: StudioNextDeploymentProps) {
  const [status, setStatus] = useState<StudioNextDeploymentStatus | null>(null);

  useEffect(() => {
    if (!config) return;
    let active = true;
    setStatus(null);
    verify(config).then((result) => {
      if (active) setStatus(result);
    }).catch(() => {
      if (active) setStatus(unavailable);
    });
    return () => { active = false; };
  }, [config, verify]);

  if (!config) {
    return <div role="alert" className="glass-panel flex gap-3 rounded-[28px] border-amber-800/35 p-6">
      <CircleAlert className="shrink-0 text-amber-900" size={21} aria-hidden="true" />
      <div><h2 className="font-semibold">Studio Next is not configured</h2><p className="mt-1 text-sm text-neutral-700">Contract verification is unavailable until the complete runtime binding is supplied.</p></div>
    </div>;
  }

  const verified = status?.state === 'VERIFIED';
  const statusCopy = status === null ? 'Verifying on Studio Next…'
    : verified ? `Verified on chain ${status.chainId}`
      : status.state === 'WRONG_CHAIN' ? `Wrong chain returned (${status.chainId ?? 'unknown'})`
        : status.state === 'SOURCE_MISMATCH' ? 'Deployed source does not match the reviewed build'
          : 'Studio Next verification is temporarily unavailable';

  return <section className={`glass-panel rounded-[28px] p-6 md:p-8 ${verified ? 'border-emerald-800/35' : ''}`} aria-labelledby="studio-next-title">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div className="flex min-w-0 gap-3">
        {status === null ? <LoaderCircle className="mt-0.5 shrink-0 animate-spin" size={22} aria-hidden="true" />
          : verified ? <ShieldCheck className="mt-0.5 shrink-0 text-emerald-800" size={22} aria-hidden="true" />
            : <CircleAlert className="mt-0.5 shrink-0 text-amber-900" size={22} aria-hidden="true" />}
        <div><p className="page-kicker">Onchain verification</p><h2 id="studio-next-title" className="text-xl font-bold">Studio Next deployment</h2><p role="status" aria-live="polite" className="mt-2 text-sm font-semibold">{statusCopy}</p></div>
      </div>
      <a className="metal-button-ghost inline-flex items-center gap-2" href={config.explorerUrl} target="_blank" rel="noreferrer">Open Studio Next explorer <ExternalLink size={15} aria-hidden="true" /></a>
    </div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <ContractFact label="Arena Match Judge" address={config.matchJudgeAddress} verified={status?.matchJudgeVerified} />
      <ContractFact label="Agent Evaluation Judge" address={config.evaluationJudgeAddress} verified={status?.evaluationJudgeVerified} />
    </div>
    <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-600">
      <span>RPC: {config.rpcUrl}</span><span>Transaction Kit RC2 · genlayer-js RC1</span>
    </div>
  </section>;
}

function ContractFact({ label, address, verified }: { label: string; address: string; verified?: boolean }) {
  return <div className="retro-inset min-w-0 p-4"><div className="flex items-center justify-between gap-3"><p className="text-[10px] uppercase tracking-wider">{label}</p>{verified !== undefined && <span className="text-xs font-semibold">{verified ? 'Source matched' : 'Not matched'}</span>}</div><code className="mt-2 block break-all text-xs">{address}</code></div>;
}
