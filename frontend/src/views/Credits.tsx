import { FormEvent, useState } from 'react';
import { useAppContext } from '../context';

export function Credits() {
  const { account, networkConfig, wallet } = useAppContext();
  const [tournamentId, setTournamentId] = useState('');
  const [credit, setCredit] = useState<string | null>(null);
  const [state, setState] = useState('');

  async function load(event: FormEvent) {
    event.preventDefault(); setState('Loading canonical Arc credit…');
    if (!account || !networkConfig) return setState('Connect a wallet and configure Arc Testnet.');
    try { setCredit(await wallet.getCredit(tournamentId, account, networkConfig)); setState(''); }
    catch (reason) { setState(reason instanceof Error ? reason.message : 'Credit read failed.'); }
  }
  async function withdraw() {
    if (!networkConfig) return;
    setState('Submitting withdrawal…');
    try { const tx = await wallet.withdrawCredit(tournamentId, networkConfig); setState(`Submitted: ${tx.hash}`); }
    catch (reason) { setState(reason instanceof Error ? reason.message : 'Withdrawal failed.'); }
  }

  return <section className="mx-auto max-w-3xl space-y-7">
    <div><p className="page-kicker">Arc settlement</p><h1 className="page-title">USDC Credits</h1><p className="page-lede">Read and withdraw pull-based credits directly from the Arc escrow.</p></div>
    <form onSubmit={load} className="glass-panel space-y-4 rounded-[28px] p-6 md:p-8"><label htmlFor="credit-tournament" className="block text-sm font-semibold">Tournament ID (bytes32)</label><input id="credit-tournament" value={tournamentId} onChange={(e) => setTournamentId(e.target.value)} className="field-control font-mono text-sm" placeholder="0x…" /><button className="metal-button-ghost">Read Arc credit</button></form>
    {credit !== null && <div className="glass-panel rounded-[28px] p-7"><p className="text-sm text-neutral-600">Canonical credit</p><p className="mt-2 text-4xl font-medium tracking-[-.04em] tabular-nums">{formatUsdc(credit)} USDC</p><button onClick={withdraw} disabled={credit === '0'} className="metal-button-solid mt-6">Withdraw credit</button></div>}
    {state && <p role="status" className="glass-panel break-all rounded-2xl p-4 text-sm text-neutral-700">{state}</p>}
  </section>;
}

function formatUsdc(value: string) {
  const amount = BigInt(value); const whole = amount / 1_000_000n; const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}.00`;
}
