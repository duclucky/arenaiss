import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatUnits, parseUnits } from 'viem';
import { useAppContext } from '../context';
import type { AgentProfile, EvaluationCampaign, MarketplaceCertificate, MarketplaceListing } from '../adapters/interfaces';

const uuid = () => crypto.randomUUID();
const nowSeconds = () => Math.floor(Date.now() / 1000);
const usdc = (amount: string) => `${Number(formatUnits(BigInt(amount), 6)).toFixed(6)} USDC`;

export function Marketplace() {
  const { account, marketplaceApi, agentApi, evaluationApi, networkConfig } = useAppContext();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [purchases, setPurchases] = useState<MarketplaceListing[]>([]);
  const [certificates, setCertificates] = useState<MarketplaceCertificate[]>([]);
  const [operatorCertificates, setOperatorCertificates] = useState<MarketplaceCertificate[]>([]);
  const [operatorCredit, setOperatorCredit] = useState<string | null>(null);
  const [operatorNotice, setOperatorNotice] = useState('');
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [campaigns, setCampaigns] = useState<EvaluationCampaign[]>([]);
  const [credit, setCredit] = useState('0'); const [creditNotice, setCreditNotice] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const [agentId, setAgentId] = useState('');
  const [listing, setListing] = useState({ certificateDigest: '', price: '', expiresAt: String(nowSeconds() + 7 * 86400) });
  const [delivery, setDelivery] = useState<{ listingId: string; name: string; agentsMd: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    if (!marketplaceApi) return;
    const [next, owned, bought, currentCredit, reviewQueue, platformCredit] = await Promise.all([
      marketplaceApi.listListings(), account ? marketplaceApi.listCertificates() : Promise.resolve([]),
      account && marketplaceApi.listPurchases ? marketplaceApi.listPurchases() : Promise.resolve([]),
      account && marketplaceApi.getCredit ? marketplaceApi.getCredit() : Promise.resolve({ amount: '0' }),
      account && marketplaceApi.listOperatorCertificates ? marketplaceApi.listOperatorCertificates().catch(() => []) : Promise.resolve([]),
      account && marketplaceApi.getOperatorCredit ? marketplaceApi.getOperatorCredit().catch(() => null) : Promise.resolve(null),
    ]);
    setListings(next); setCertificates(owned); setPurchases(bought); setCredit(currentCredit.amount); setOperatorCertificates(reviewQueue); setOperatorCredit(platformCredit?.amount ?? null);
  }
  useEffect(() => {
    let active = true;
    if (!marketplaceApi) return;
    Promise.all([
      marketplaceApi.listListings(), account ? marketplaceApi.listCertificates() : Promise.resolve([]),
      account && marketplaceApi.listPurchases ? marketplaceApi.listPurchases() : Promise.resolve([]),
      account && agentApi ? agentApi.listOwnedAgents() : Promise.resolve([]),
      account && evaluationApi ? evaluationApi.listCampaigns() : Promise.resolve([]),
      account && marketplaceApi.getCredit ? marketplaceApi.getCredit() : Promise.resolve({ amount: '0' }),
      account && marketplaceApi.listOperatorCertificates ? marketplaceApi.listOperatorCertificates().catch(() => []) : Promise.resolve([]),
      account && marketplaceApi.getOperatorCredit ? marketplaceApi.getOperatorCredit().catch(() => null) : Promise.resolve(null),
    ]).then(([next, owned, bought, profiles, records, currentCredit, reviewQueue, platformCredit]) => {
      if (!active) return;
      setListings(next); setCertificates(owned); setPurchases(bought);
      setAgents(profiles); setCampaigns(records); setCredit(currentCredit.amount); setOperatorCertificates(reviewQueue); setOperatorCredit(platformCredit?.amount ?? null);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load Marketplace.'); });
    return () => { active = false; };
  }, [marketplaceApi, account, agentApi, evaluationApi]);

  const selectedAgent = agents.find((row) => row.agentId === agentId);
  const finalized = useMemo(() => campaigns.filter((row) => row.state === 'FINALIZED' && row.agentVersionId === selectedAgent?.agentsVersion), [campaigns, selectedAgent?.agentsVersion]);
  const selectedCertificate = certificates.find((row) => row.certificateDigest === listing.certificateDigest && row.state === 'APPROVED');
  const purchasedIds = new Set(purchases.map((row) => row.listingId));

  async function issueEligibility(event: React.FormEvent) {
    event.preventDefault();
    if (!marketplaceApi || !selectedAgent || finalized.length < 2 || !networkConfig?.genLayer) return;
    setBusy('eligibility'); setError('');
    try {
      await marketplaceApi.createEligibility({ agentId: selectedAgent.agentId, agentsVersion: selectedAgent.agentsVersion, campaignIds: finalized.slice(0, 2).map((row) => row.campaignId), issuedAt: nowSeconds(), expiresAt: nowSeconds() + 30 * 86400, network: 'studio-next', chainId: networkConfig.genLayer.chainId, judgeAddress: networkConfig.genLayer.evaluationJudgeAddress });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Eligibility failed. Check the Evo score and try again.'); }
    finally { setBusy(''); }
  }

  async function createListing(event: React.FormEvent) {
    event.preventDefault();
    if (!marketplaceApi || !selectedCertificate) return;
    setBusy('listing'); setError('');
    try {
      const price = parseUnits(listing.price, 6);
      if (price <= 0n || price > (2n ** 128n - 1n)) throw new Error('Enter a positive USDC price with at most six decimal places.');
      await marketplaceApi.createListing({ listingId: String(Date.now()), certificateDigest: selectedCertificate.certificateDigest, agentId: selectedCertificate.agentId, agentsVersion: selectedCertificate.agentVersionId, agentsCommitment: selectedCertificate.agentsCommitment, price: price.toString(), expiresAt: Number(listing.expiresAt), idempotencyKey: uuid() });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Listing failed. Check the price and certificate.'); }
    finally { setBusy(''); }
  }

  async function buy(row: MarketplaceListing) {
    if (!marketplaceApi) return;
    setBusy(`buy-${row.listingId}`); setError('');
    try { await marketplaceApi.buy(row.listingId, uuid(), uuid()); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Purchase failed. Check the Arc receipt before trying again.'); }
    finally { setBusy(''); }
  }

  async function cancel(row: MarketplaceListing) {
    if (!marketplaceApi?.cancelListing) return;
    setBusy(`cancel-${row.listingId}`); setError('');
    try { await marketplaceApi.cancelListing(row.listingId, uuid()); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Cancellation failed. Check the Arc receipt before trying again.'); }
    finally { setBusy(''); }
  }

  async function openDelivery(row: MarketplaceListing) {
    if (!marketplaceApi) return;
    setBusy(`delivery-${row.listingId}`); setError('');
    try {
      const result = await marketplaceApi.getDelivery(row.listingId);
      setDelivery({ listingId: row.listingId, name: row.name, agentsMd: result.agentsMd });
      window.setTimeout(() => dialogRef.current?.focus(), 0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Delivery unavailable. Verify the Arc purchase has finalized and reload.'); }
    finally { setBusy(''); }
  }

  async function withdrawCredit() {
    if (!marketplaceApi?.withdrawCredit || BigInt(credit) === 0n) return;
    setBusy('withdraw'); setError(''); setCreditNotice('');
    try {
      const result = await marketplaceApi.withdrawCredit(uuid());
      setCreditNotice(`Withdrawal submitted${result.txHash ? ` · ${result.txHash.slice(0, 12)}…` : ''}. Reload after Arc finality to confirm the balance.`);
      const current = await marketplaceApi.getCredit?.(); if (current) setCredit(current.amount);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Withdrawal failed. Check the Arc receipt before trying again.'); }
    finally { setBusy(''); }
  }

  async function approveCertificate(certificateDigest: string) {
    if (!marketplaceApi?.approveCertificate) return;
    setBusy(`approve-${certificateDigest}`); setError('');
    try { await marketplaceApi.approveCertificate(certificateDigest); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Certificate approval failed. Check the Arc receipt before retrying.'); }
    finally { setBusy(''); }
  }

  async function withdrawOperatorCredit() {
    if (!marketplaceApi?.withdrawOperatorCredit || !operatorCredit || BigInt(operatorCredit) === 0n) return;
    setBusy('platform-withdraw'); setError(''); setOperatorNotice('');
    try {
      const result = await marketplaceApi.withdrawOperatorCredit();
      await refresh();
      setOperatorNotice(`Platform withdrawal confirmed${result.txHash ? ` · ${result.txHash.slice(0, 12)}…` : ''}.`);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Platform fee withdrawal failed. Check the Arc receipt before retrying.'); }
    finally { setBusy(''); }
  }

  return <section aria-labelledby="marketplace-heading" className="mx-auto max-w-6xl">
    <p className="page-kicker">Agent Exchange · Arc Testnet</p>
    <div className="flex flex-wrap items-end justify-between gap-6"><div><h1 id="marketplace-heading" className="page-title">Marketplace</h1><p className="page-lede">Buy exact Evo-passed Agent versions. Every sale settles in USDC with a fixed 1% platform fee.</p></div><span className="retro-chip px-3 py-2 text-xs">Arc · 1% fee</span></div>
    {error && <div role="alert" className="mt-8 border border-red-700 bg-red-50 p-4 text-sm">{error} <button type="button" className="ml-3 underline" onClick={() => refresh().catch((cause) => setError(cause instanceof Error ? cause.message : 'Refresh failed.'))}>Refresh state</button></div>}
    <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{listings.map((row) => <article className="glass-panel flex min-h-64 flex-col p-5" key={row.listingId}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs uppercase tracking-widest text-neutral-600">Listing #{row.listingId}</p><h2 className="mt-2 text-2xl font-bold">{row.name}</h2></div><span className="retro-chip px-2 py-1 text-xs">{row.state}</span></div>
      <dl className="mt-8 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-neutral-600">Price</dt><dd className="font-mono font-bold">{usdc(row.price)}</dd></div><div className="flex justify-between gap-3"><dt className="text-neutral-600">Version</dt><dd className="max-w-[14rem] break-all font-mono text-xs">{row.agentVersionId}</dd></div></dl>
      <div className="mt-auto pt-6">{row.state === 'ACTIVE' && account && row.sellerAddress.toLowerCase() === account.toLowerCase() ? <button type="button" className="metal-button-ghost w-full" disabled={busy !== '' || !marketplaceApi?.cancelListing} onClick={() => cancel(row)} aria-label={`Cancel listing ${row.listingId}`}>{busy === `cancel-${row.listingId}` ? 'Cancelling on Arc…' : 'Cancel listing'}</button> : row.state === 'ACTIVE' && account ? <button type="button" className="metal-button-solid w-full" disabled={busy !== ''} onClick={() => buy(row)}>{busy === `buy-${row.listingId}` ? 'Purchase submitting…' : `Buy for ${usdc(row.price)}`}</button> : row.state === 'SOLD' && purchasedIds.has(row.listingId) ? <button type="button" className="metal-button-ghost w-full" disabled={busy !== ''} onClick={() => openDelivery(row)} aria-label={`Open purchased Agent ${row.listingId}`}>{busy === `delivery-${row.listingId}` ? 'Loading delivery…' : 'Open purchased Agent'}</button> : <p className="text-xs text-neutral-600">{row.state === 'ACTIVE' ? 'Sign in to purchase.' : row.state === 'SOLD' ? 'Sold on Arc.' : 'Awaiting Arc confirmation. Reload to check status.'}</p>}</div>
    </article>)}</div>
    {listings.length === 0 && <div className="glass-panel mt-12 p-6 text-neutral-700">No live listings yet. An Agent needs two finalized Evo campaigns and an approved certificate before it can be listed.</div>}
    {account && <section className="glass-panel mt-12 flex flex-wrap items-center justify-between gap-5 p-6" aria-labelledby="marketplace-credit-heading"><div><p className="page-kicker">Seller proceeds</p><h2 id="marketplace-credit-heading" className="mt-1 text-2xl font-bold">{usdc(credit)} available</h2><p className="mt-2 text-sm text-neutral-700">The amount comes directly from AgentMarketplace credit on Arc Testnet.</p>{creditNotice && <p role="status" className="mt-3 text-sm font-semibold">{creditNotice}</p>}</div><button type="button" className="metal-button-solid" disabled={busy !== '' || BigInt(credit) === 0n || !marketplaceApi?.withdrawCredit} onClick={withdrawCredit}>{busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw Marketplace proceeds'}</button></section>}
    {(operatorCertificates.some((row) => row.state === 'ELIGIBLE') || operatorCredit !== null) && <section className="glass-panel mt-12 p-6" aria-labelledby="operator-review-heading"><p className="page-kicker">Restricted operator action</p><div className="flex flex-wrap items-start justify-between gap-5"><div><h2 id="operator-review-heading" className="mt-1 text-2xl font-bold">Operator review</h2><p className="mt-2 text-sm text-neutral-700">Approve only after checking the bound Agent version, score, coverage and expiry. Approval writes the immutable eligibility record to Arc.</p></div>{operatorCredit !== null && <div className="text-right"><p className="font-mono font-bold">{usdc(operatorCredit)} platform credit</p><button type="button" className="metal-button-ghost mt-2" disabled={busy !== '' || BigInt(operatorCredit) === 0n || !marketplaceApi?.withdrawOperatorCredit} onClick={withdrawOperatorCredit}>{busy === 'platform-withdraw' ? 'Withdrawing…' : 'Withdraw platform fee'}</button>{operatorNotice && <p role="status" className="mt-2 text-sm font-semibold">{operatorNotice}</p>}</div>}</div><ul className="mt-5 space-y-3">{operatorCertificates.filter((row) => row.state === 'ELIGIBLE').map((row) => <li key={row.certificateDigest} className="retro-inset flex flex-wrap items-center justify-between gap-4 p-4"><div><p className="break-all font-mono text-xs">{row.certificateDigest}</p><p className="mt-2 font-semibold">{row.overallScore}/100 · {(row.coverageBps / 100).toFixed(0)}% coverage</p><p className="mt-1 text-xs text-neutral-700">Expires {new Date(row.expiresAt * 1000).toLocaleString()}</p></div><button type="button" className="metal-button-solid" disabled={busy !== ''} onClick={() => approveCertificate(row.certificateDigest)}>{busy === `approve-${row.certificateDigest}` ? 'Approving on Arc…' : 'Approve certificate on Arc'}</button></li>)}</ul></section>}
    {account && <div className="mt-14 grid gap-6 lg:grid-cols-2"><form className="glass-panel p-6" onSubmit={issueEligibility}><h2 className="text-xl font-bold">Certify an Evo version</h2><p className="mt-2 text-sm text-neutral-600">Arena ISS checks two completed campaigns for the same version. Digests and Studio Next contract details are filled from verified records.</p>
      <label className="mt-5 block text-sm font-semibold" htmlFor="marketplace-agent">Agent to certify</label><select id="marketplace-agent" className="field-control mt-2 w-full" value={agentId} onChange={(event) => setAgentId(event.target.value)} required><option value="">Select your Agent</option>{agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</select>
      {selectedAgent && <p className="mt-3 text-sm" role="status">{finalized.length} finalized Evo campaigns available for this version. {finalized.length < 2 && <Link className="underline" to="/evaluations">Run Evo again</Link>}</p>}
      {!networkConfig?.genLayer && <p className="mt-3 text-sm text-red-900">Studio Next judge is not configured. Eligibility is unavailable.</p>}
      <button type="submit" className="metal-button-solid mt-6" disabled={busy !== '' || !selectedAgent || finalized.length < 2 || !networkConfig?.genLayer}>{busy === 'eligibility' ? 'Checking…' : 'Check eligibility'}</button>
    </form><form className="glass-panel p-6" onSubmit={createListing}><h2 className="text-xl font-bold">List an approved version</h2><p className="mt-2 text-sm text-neutral-600">Listing executes on Arc. Private AGENTS.md stays server-side until the buyer's canonical sale delivery.</p>
      <label className="mt-5 block text-sm font-semibold" htmlFor="marketplace-certificate">Approved certificate</label><select id="marketplace-certificate" className="field-control mt-2 w-full" value={listing.certificateDigest} onChange={(event) => setListing((current) => ({ ...current, certificateDigest: event.target.value }))} required><option value="">Select certificate</option>{certificates.filter((row) => row.state === 'APPROVED').map((row) => <option key={row.certificateDigest} value={row.certificateDigest}>{row.certificateDigest.slice(0, 20)}… · {row.overallScore}/100</option>)}</select>
      {certificates.some((row) => row.state === 'ELIGIBLE') && <p className="mt-3 text-sm text-neutral-700">Eligible certificate awaiting operator approval.</p>}
      <label className="mt-4 block text-sm font-semibold" htmlFor="marketplace-price">Price (USDC)</label><input id="marketplace-price" className="field-control mt-2 w-full" inputMode="decimal" pattern="^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,6})?$" placeholder="2.50" value={listing.price} onChange={(event) => setListing((current) => ({ ...current, price: event.target.value }))} required aria-describedby="marketplace-price-help"/><p id="marketplace-price-help" className="mt-2 text-xs text-neutral-700">Enter USDC, not base units. Settlement deducts a fixed 1% platform fee from the seller credit.</p>
      <button type="submit" className="metal-button-solid mt-6" disabled={busy !== '' || !selectedCertificate}>{busy === 'listing' ? 'Submitting…' : 'List on Arc'}</button>
    </form></div>}
    {!account && <p className="mt-10 text-sm text-neutral-600">Sign in to certify or list an Agent. <Link to="/agents" className="font-semibold underline">Manage Agents</Link>.</p>}
    {delivery && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDelivery(null); }}><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="marketplace-delivery-heading" className="glass-panel max-h-[85vh] w-full max-w-2xl overflow-auto bg-[#f8f5ee] p-6"><div className="flex items-start justify-between gap-4"><div><h2 id="marketplace-delivery-heading" className="text-2xl font-bold">Purchased Agent</h2><p className="mt-2 text-sm">{delivery.name} · Listing #{delivery.listingId}</p></div><button type="button" className="metal-button-ghost" onClick={() => setDelivery(null)}>Close</button></div><h3 className="mt-6 font-semibold">Private AGENTS.md</h3><pre className="retro-inset mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 text-sm">{delivery.agentsMd}</pre></div></div>}
  </section>;
}
