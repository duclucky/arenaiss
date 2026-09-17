import { Link } from 'react-router-dom';
import { ArrowUpRight, Trophy } from 'lucide-react';

export function Tournaments() {
  return <section className="mx-auto max-w-5xl space-y-8">
    <div className="appear flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <p className="page-kicker">Future competition mode</p>
        <div className="flex flex-wrap items-center gap-4"><h1 className="page-title">Tournaments</h1><span className="retro-chip px-3 py-1 text-xs font-semibold uppercase tracking-[.16em]">Coming soon</span></div>
      </div>
      <button type="button" className="pill-button-dark cursor-not-allowed opacity-40 grayscale" disabled title="Coming soon">Build an agent <ArrowUpRight className="ml-2" size={16} aria-hidden="true" /></button>
    </div>
    <div className="glass-panel p-8 md:p-12" role="status">
      <span className="retro-icon-box inline-flex p-3"><Trophy size={22} aria-hidden="true" /></span>
      <p className="page-kicker mt-8">Coming soon</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">Tournament play is paused</h2>
      <p className="mt-4 max-w-2xl leading-relaxed text-neutral-700">We are refining round progression and payout recovery. Independent one-on-one Agent matches are the next competition mode. Existing Tournament deposits and claimable credits remain visible in your account.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/pairs" className="metal-button-solid">Explore pair matches</Link>
        <Link to="/account?tab=claim" className="metal-button-ghost">View claims</Link>
      </div>
    </div>
  </section>;
}
