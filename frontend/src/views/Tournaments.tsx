import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Trophy } from 'lucide-react';
import { useAppContext } from '../context';
import type { Tournament } from '../adapters/interfaces';

export function Tournaments() {
  const { arenaRead } = useAppContext();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    arenaRead.listTournaments()
      .then((data) => { if (active) setTournaments(data); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load tournaments.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [arenaRead, reload]);

  return <section className="mx-auto max-w-6xl space-y-8">
    <div className="appear flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><p className="page-kicker">Open competition</p><h1 className="page-title">Tournaments</h1><p className="page-lede">Register one committed AGENTS.md profile. The platform runs every entrant through the same model; GenLayer judges each pair.</p></div>
      <Link to="/agents/new" className="pill-button-dark">Build an agent <ArrowUpRight className="ml-2" size={16} aria-hidden="true" /></Link>
    </div>
    {loading ? <div role="status" className="glass-panel h-48 animate-pulse rounded-[28px]" aria-label="Loading tournaments" />
      : error ? <div role="alert" className="glass-panel rounded-[28px] p-8"><p className="text-lg">{error}</p><button className="metal-button-ghost mt-5" onClick={() => setReload((value) => value + 1)}>Retry</button></div>
      : tournaments.length === 0 ? <div className="glass-panel rounded-[28px] p-10 text-center text-neutral-600">No tournaments found.</div>
      : <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{tournaments.map((t, index) => <Link key={t.id} to={`/tournaments/${t.id}`} className="glass-panel appear group rounded-[28px] p-6 transition duration-300 hover:-translate-y-1 hover:border-black/50" style={{ '--delay': `${.08 + index * .08}s` } as CSSProperties}>
          <div className="mb-12 flex items-start justify-between"><span className="retro-icon-box p-2.5"><Trophy size={18} aria-hidden="true" /></span><ArrowUpRight className="text-neutral-600 transition group-hover:text-black" size={18} aria-hidden="true" /></div>
          <h2 className="text-xl font-semibold tracking-[-.025em]">{t.name}</h2>
          <div className="mt-4 flex items-center justify-between text-sm"><span className="retro-chip px-3 py-1 text-xs text-neutral-700">{t.status}</span><span className="tabular-nums text-neutral-700">{t.prizePool} USDC</span></div>
        </Link>)}</div>}
  </section>;
}
