import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ShoppingBag, Tag } from 'lucide-react';
import { formatUnits, parseUnits } from 'viem';
import { useAppContext } from '../context';
import type { AgentProfile, EvaluationCampaign, MarketplaceCertificate, MarketplaceListing } from '../adapters/interfaces';

const uuid = () => crypto.randomUUID();
const nowSeconds = () => Math.floor(Date.now() / 1000);
const usdc = (amount: string) => `${Number(formatUnits(BigInt(amount), 6)).toFixed(6)} USDC`;

const eligibilityExplanations: Record<string, string> = {
  CRITICAL_POLICY_FINDING: 'At least one evaluation run contains a blocking policy finding, such as a forbidden, unknown, duplicate, or unconfirmed action.',
  SCORE_SPREAD_ABOVE_THRESHOLD: 'The gap between the highest and lowest evaluation scores is greater than the allowed 20 points, so this version is not consistent enough for Marketplace certification.',
  OVERALL_SCORE_BELOW_THRESHOLD: 'The average evaluation score is below the required 80 points.',
  INCOMPLETE_COVERAGE: 'One or more required scenarios do not have two finalized evaluation runs.',
  REQUIRED_RUN_COUNT_MISMATCH: 'The selected evaluations do not contain the exact required set of runs.',
  RUN_BINDING_MISMATCH: 'At least one run belongs to a different Agent version, Test Pack, rubric, network, or GenLayer judge.',
  UNEXPECTED_SCENARIO: 'At least one run uses a scenario outside the required Marketplace Test Pack.',
  INVALID_SCORE: 'At least one evaluation score is missing or outside the accepted range.',
  INVALID_FINDING_COUNT: 'At least one evaluation contains invalid policy-finding metadata.',
  INVALID_EXECUTION_MODEL: 'At least one run is missing its model provenance.',
  INVALID_DIMENSION_SCORE: 'At least one scorecard dimension is missing or invalid.',
};

function eligibilityReasons(message: string): Array<{ code: string; explanation: string }> | null {
  const prefix = 'Agent version is not marketplace eligible:';
  if (!message.startsWith(prefix)) return null;
  return message.slice(prefix.length).split(',').map((code) => code.trim()).filter(Boolean).map((code) => ({
    code,
    explanation: code.startsWith('DIMENSION_BELOW_THRESHOLD:')
      ? `The average ${code.slice('DIMENSION_BELOW_THRESHOLD:'.length).replace(/_/g, ' ')} score is below the Marketplace minimum.`
      : eligibilityExplanations[code] ?? 'This evaluation evidence does not satisfy one of the locked Marketplace certification rules.',
  }));
}

function MarketplaceError({ message, onRefresh }: { message: string; onRefresh: () => void }) {
  const reasons = eligibilityReasons(message);
  if (!reasons) return <div role="alert" className="mt-8 border border-red-700 bg-red-50 p-4 text-sm">{message} <button type="button" className="ml-3 underline" onClick={onRefresh}>Refresh state</button></div>;
  return <section role="alert" aria-labelledby="marketplace-eligibility-error" className="mt-8 border border-red-700 bg-red-50 p-5 text-sm">
    <div className="flex items-start gap-3"><AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-red-800" size={20}/><div className="min-w-0"><h2 id="marketplace-eligibility-error" className="text-lg font-bold text-red-950">This Agent version is not eligible yet</h2><p className="mt-2 leading-relaxed text-red-950">Marketplace certification stopped because the selected evaluations failed these requirements:</p></div></div>
    <ul className="mt-4 space-y-3">{reasons.map((reason) => <li key={reason.code} className="retro-inset p-4"><p className="font-mono text-xs font-bold text-red-950">{reason.code}</p><p className="mt-2 leading-relaxed text-neutral-800">{reason.explanation}</p></li>)}</ul>
    <p className="mt-4 leading-relaxed text-red-950"><strong>How to qualify:</strong> Review the failed runs, update this Agent version, then complete two new evaluations. All required runs must have no blocking policy findings, an average score of at least 80, and a score spread of 20 points or less.</p>
    <div className="mt-4 flex flex-wrap gap-3"><Link className="metal-button-ghost" to="/evaluations">Open evaluations</Link><button type="button" className="metal-button-ghost" onClick={onRefresh}>Refresh after new evaluations</button></div>
  </section>;
}

export function Marketplace() {
  const { account, marketplaceApi, agentApi, evaluationApi, networkConfig } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get('view') === 'sell' ? 'sell' : 'browse';
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [purchases, setPurchases] = useState<MarketplaceListing[]>([]);
  const [certificates, setCertificates] = useState<MarketplaceCertificate[]>([]);
  const [operatorCertificates, setOperatorCertificates] = useState<MarketplaceCertificate[]>([]);
  const [operatorCredit, setOperatorCredit] = useState<string | null>(null);
  const [operatorNotice, setOperatorNotice] = useState('');
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [campaigns, setCampaigns] = useState<EvaluationCampaign[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const [agentId, setAgentId] = useState('');
  const [listing, setListing] = useState({ certificateDigest: '', price: '', expiresAt: String(nowSeconds() + 7 * 86400) });
  const [delivery, setDelivery] = useState<{ listingId: string; name: string; agentsMd: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    if (!marketplaceApi) return;
    const [next, owned, bought, reviewQueue, platformCredit] = await Promise.all([
      marketplaceApi.listListings(), account ? marketplaceApi.listCertificates() : Promise.resolve([]),
      account && marketplaceApi.listPurchases ? marketplaceApi.listPurchases() : Promise.resolve([]),
      account && marketplaceApi.listOperatorCertificates ? marketplaceApi.listOperatorCertificates().catch(() => []) : Promise.resolve([]),
      account && marketplaceApi.getOperatorCredit ? marketplaceApi.getOperatorCredit().catch(() => null) : Promise.resolve(null),
    ]);
    setListings(next); setCertificates(owned); setPurchases(bought); setOperatorCertificates(reviewQueue); setOperatorCredit(platformCredit?.amount ?? null);
  }
  useEffect(() => {
    let active = true;
    if (!marketplaceApi) return;
    Promise.all([
      marketplaceApi.listListings(), account ? marketplaceApi.listCertificates() : Promise.resolve([]),
      account && marketplaceApi.listPurchases ? marketplaceApi.listPurchases() : Promise.resolve([]),
      account && agentApi ? agentApi.listOwnedAgents() : Promise.resolve([]),
      account && evaluationApi ? evaluationApi.listCampaigns() : Promise.resolve([]),
      account && marketplaceApi.listOperatorCertificates ? marketplaceApi.listOperatorCertificates().catch(() => []) : Promise.resolve([]),
      account && marketplaceApi.getOperatorCredit ? marketplaceApi.getOperatorCredit().catch(() => null) : Promise.resolve(null),
    ]).then(([next, owned, bought, profiles, records, reviewQueue, platformCredit]) => {
      if (!active) return;
      setListings(next); setCertificates(owned); setPurchases(bought);
      setAgents(profiles); setCampaigns(records); setOperatorCertificates(reviewQueue); setOperatorCredit(platformCredit?.amount ?? null);
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Eligibility failed. Check the evaluation score and try again.'); }
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
      await marketplaceApi.withdrawOperatorCredit();
      await refresh();
      setOperatorNotice('Platform withdrawal confirmed.');
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Platform fee withdrawal failed. Check the Arc receipt before retrying.'); }
    finally { setBusy(''); }
  }

  function listingAction(row: MarketplaceListing) {
    const owned = Boolean(account && row.sellerAddress.toLowerCase() === account.toLowerCase());
    if (owned && (row.state === 'ACTIVE' || row.state === 'CANCEL_SUBMITTED')) {
      const retry = row.state === 'CANCEL_SUBMITTED';
      return <button type="button" className="metal-button-ghost w-full" disabled={busy !== '' || !marketplaceApi?.cancelListing}
        onClick={() => cancel(row)} aria-label={`${retry ? 'Retry' : 'Cancel'} ${row.name} ${retry ? 'cancellation' : 'listing'}`}>
        {busy === `cancel-${row.listingId}` ? 'Cancelling on Arc…' : retry ? 'Retry cancellation' : 'Cancel listing'}
      </button>;
    }
    if (account && (row.state === 'ACTIVE' || (row.state === 'BUY_SUBMITTED' && row.buyerAddress?.toLowerCase() === account.toLowerCase()))) {
      return <button type="button" className="metal-button-solid w-full" disabled={busy !== ''}
        onClick={() => buy(row)} aria-label={row.state === 'BUY_SUBMITTED' ? `Resume ${row.name} purchase` : undefined}>
        {busy === `buy-${row.listingId}` ? 'Purchase submitting…' : row.state === 'BUY_SUBMITTED' ? 'Resume purchase' : `Buy for ${usdc(row.price)}`}
      </button>;
    }
    if (row.state === 'SOLD' && purchasedIds.has(row.listingId)) {
      return <button type="button" className="metal-button-ghost w-full" disabled={busy !== ''}
        onClick={() => openDelivery(row)} aria-label={`Open purchased Agent ${row.name}`}>
        {busy === `delivery-${row.listingId}` ? 'Loading delivery…' : 'Open purchased Agent'}
      </button>;
    }
    return <p className="text-xs text-neutral-600">{row.state === 'ACTIVE' ? 'Sign in to purchase.' : row.state === 'SOLD' ? 'Sold on Arc.' : 'Awaiting Arc confirmation. Reload to check status.'}</p>;
  }

  return <section aria-labelledby="marketplace-heading" className="mx-auto max-w-6xl">
    <p className="page-kicker">Agent Exchange · Arc Testnet</p>
    <div className="flex flex-wrap items-end justify-between gap-6"><div><h1 id="marketplace-heading" className="page-title">Marketplace</h1><p className="page-lede">Buy exact Agent versions that passed Arena ISS evaluation. Every sale settles in USDC with a fixed 1% platform fee.</p></div><span className="retro-chip px-3 py-2 text-xs">Platform fee · 1%</span></div>
    <div role="tablist" aria-label="Marketplace sections" className="mt-8 grid gap-2 sm:grid-cols-2"><button role="tab" aria-selected={activeView === 'browse'} className={activeView === 'browse' ? 'metal-button-solid' : 'metal-button-ghost'} onClick={() => setSearchParams({}, { replace: true })}><ShoppingBag size={17} aria-hidden="true" /> Agents for sale</button><button role="tab" aria-selected={activeView === 'sell'} className={activeView === 'sell' ? 'metal-button-solid' : 'metal-button-ghost'} onClick={() => setSearchParams({ view: 'sell' }, { replace: true })}><Tag size={17} aria-hidden="true" /> Sell my Agent</button></div>
    {error && <MarketplaceError message={error} onRefresh={() => refresh().catch((cause) => setError(cause instanceof Error ? cause.message : 'Refresh failed.'))}/>}
    {activeView === 'browse' && <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{listings.map((row) => <article className="glass-panel flex min-h-64 flex-col p-5" key={row.listingId}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs uppercase tracking-widest text-neutral-600">Agent listing</p><h2 className="mt-2 text-2xl font-bold">{row.name}</h2></div><span className="retro-chip px-2 py-1 text-xs">{row.state}</span></div>
      <dl className="mt-8 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-neutral-600">Price</dt><dd className="font-mono font-bold">{usdc(row.price)}</dd></div><div className="flex justify-between gap-3"><dt className="text-neutral-600">Version</dt><dd className="font-semibold">Verified Agent version</dd></div></dl>
      <div className="mt-auto pt-6">{listingAction(row)}</div>
    </article>)}</div>}
    {activeView === 'browse' && listings.length === 0 && <div className="glass-panel mt-12 p-6 text-neutral-700">No live listings yet. An Agent needs two finalized evaluations and an approved certificate before it can be listed.</div>}
    {activeView === 'sell' && (operatorCertificates.some((row) => row.state === 'ELIGIBLE') || operatorCredit !== null) && <section className="glass-panel mt-12 p-6" aria-labelledby="operator-review-heading"><p className="page-kicker">Restricted operator action</p><div className="flex flex-wrap items-start justify-between gap-5"><div><h2 id="operator-review-heading" className="mt-1 text-2xl font-bold">Operator review</h2><p className="mt-2 text-sm text-neutral-700">Approve only after checking the bound Agent version, score, coverage and expiry. Approval writes the immutable eligibility record to Arc.</p></div>{operatorCredit !== null && <div className="text-right"><p className="font-mono font-bold">{usdc(operatorCredit)} platform credit</p><button type="button" className="metal-button-ghost mt-2" disabled={busy !== '' || BigInt(operatorCredit) === 0n || !marketplaceApi?.withdrawOperatorCredit} onClick={withdrawOperatorCredit}>{busy === 'platform-withdraw' ? 'Withdrawing…' : 'Withdraw platform fee'}</button>{operatorNotice && <p role="status" className="mt-2 text-sm font-semibold">{operatorNotice}</p>}</div>}</div><ul className="mt-5 space-y-3">{operatorCertificates.filter((row) => row.state === 'ELIGIBLE').map((row) => <li key={row.certificateDigest} className="retro-inset flex flex-wrap items-center justify-between gap-4 p-4"><div><p className="text-sm font-semibold">Eligible Agent certificate</p><p className="mt-2 font-semibold">{row.overallScore}/100 · {(row.coverageBps / 100).toFixed(0)}% coverage</p><p className="mt-1 text-xs text-neutral-700">Expires {new Date(row.expiresAt * 1000).toLocaleString()}</p></div><button type="button" className="metal-button-solid" disabled={busy !== ''} onClick={() => approveCertificate(row.certificateDigest)}>{busy === `approve-${row.certificateDigest}` ? 'Approving on Arc…' : 'Approve certificate on Arc'}</button></li>)}</ul></section>}
    {activeView === 'sell' && account && <div className="mt-14 grid gap-6 lg:grid-cols-2"><form className="glass-panel p-6" onSubmit={issueEligibility}><h2 className="text-xl font-bold">Certify an evaluated version</h2><p className="mt-2 text-sm text-neutral-600">Arena ISS checks two completed evaluations for the same version. Digests and Studio Next contract details are filled from verified records.</p>
      <label className="mt-5 block text-sm font-semibold" htmlFor="marketplace-agent">Agent to certify</label><select id="marketplace-agent" className="field-control mt-2 w-full" value={agentId} onChange={(event) => setAgentId(event.target.value)} required><option value="">Select your Agent</option>{agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</select>
      {selectedAgent && <p className="mt-3 text-sm" role="status">{finalized.length} finalized evaluation{finalized.length === 1 ? '' : 's'} available for this version. {finalized.length < 2 && <Link className="underline" to="/evaluations">Run another evaluation</Link>}</p>}
      {!networkConfig?.genLayer && <p className="mt-3 text-sm text-red-900">Studio Next judge is not configured. Eligibility is unavailable.</p>}
      <button type="submit" className="metal-button-solid mt-6" disabled={busy !== '' || !selectedAgent || finalized.length < 2 || !networkConfig?.genLayer}>{busy === 'eligibility' ? 'Checking…' : 'Check eligibility'}</button>
    </form><form className="glass-panel p-6" onSubmit={createListing}><h2 className="text-xl font-bold">List an approved version</h2><p className="mt-2 text-sm text-neutral-600">Listing registers only the profile commitment on Arc. The full profile was submitted to the model provider and GenLayer validators during Agent evaluation; sale delivery gives the buyer access through Arena ISS.</p>
      <label className="mt-5 block text-sm font-semibold" htmlFor="marketplace-certificate">Approved certificate</label><select id="marketplace-certificate" className="field-control mt-2 w-full" value={listing.certificateDigest} onChange={(event) => setListing((current) => ({ ...current, certificateDigest: event.target.value }))} required><option value="">Select certificate</option>{certificates.filter((row) => row.state === 'APPROVED').map((row) => <option key={row.certificateDigest} value={row.certificateDigest}>Approved Agent · {row.overallScore}/100</option>)}</select>
      {certificates.some((row) => row.state === 'ELIGIBLE') && <p className="mt-3 text-sm text-neutral-700">Eligible certificate awaiting operator approval.</p>}
      <label className="mt-4 block text-sm font-semibold" htmlFor="marketplace-price">Price (USDC)</label><input id="marketplace-price" className="field-control mt-2 w-full" inputMode="decimal" pattern="^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,6})?$" placeholder="2.50" value={listing.price} onChange={(event) => setListing((current) => ({ ...current, price: event.target.value }))} required aria-describedby="marketplace-price-help"/><p id="marketplace-price-help" className="mt-2 text-xs text-neutral-700">Enter USDC, not base units. Settlement deducts a fixed 1% platform fee from the seller credit.</p>
      <button type="submit" className="metal-button-solid mt-6" disabled={busy !== '' || !selectedCertificate}>{busy === 'listing' ? 'Submitting…' : 'List on Arc'}</button>
    </form></div>}
    {activeView === 'sell' && !account && <p className="mt-10 text-sm text-neutral-600">Sign in to certify or list an Agent. <Link to="/agents" className="font-semibold underline">Manage Agents</Link>.</p>}
    {delivery && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDelivery(null); }}><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="marketplace-delivery-heading" className="glass-panel max-h-[85vh] w-full max-w-2xl overflow-auto bg-[#f8f5ee] p-6"><div className="flex items-start justify-between gap-4"><div><h2 id="marketplace-delivery-heading" className="text-2xl font-bold">Purchased Agent</h2><p className="mt-2 text-sm">{delivery.name}</p></div><button type="button" className="metal-button-ghost" onClick={() => setDelivery(null)}>Close</button></div><h3 className="mt-6 font-semibold">Private AGENTS.md</h3><pre className="retro-inset mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 text-sm">{delivery.agentsMd}</pre></div></div>}
  </section>;
}
