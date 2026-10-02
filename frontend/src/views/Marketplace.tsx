import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { formatUnits, parseUnits } from 'viem';
import { useAppContext } from '../context';
import type { AgentProfile, EvaluationCampaign, MarketplaceCertificate, MarketplaceListing, MarketplaceListingIntent } from '../adapters/interfaces';
import { displayLabel } from '../display-label';

const uuid = () => crypto.randomUUID();
const nowSeconds = () => Math.floor(Date.now() / 1000);
const usdc = (amount: string) => `${Number(formatUnits(BigInt(amount), 6)).toFixed(6)} USDC`;
const activityDate = (value?: number) => value
  ? new Date(value < 1_000_000_000_000 ? value * 1000 : value).toLocaleString()
  : 'Date unavailable';
const historyCardClass = 'marketplace-history-card retro-inset flex min-h-28 flex-col justify-between p-4 text-sm';

type PublicProfileModalState = {
  listing: MarketplaceListing;
  status: 'LOADING' | 'READY' | 'ERROR';
  profile?: AgentProfile;
  message?: string;
};

function MarketplaceModal({ titleId, onClose, children, width = 'max-w-3xl' }: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/60 p-3 sm:p-6" role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
      className={`glass-panel flex max-h-[calc(100dvh-1.5rem)] w-full ${width} flex-col overflow-hidden bg-[#f8f5ee] p-0 sm:max-h-[calc(100dvh-3rem)]`}>
      <div className="marketplace-modal-header flex shrink-0 justify-end border-b border-black/20 bg-[#f8f5ee] p-3">
        <button ref={closeRef} type="button" className="metal-button-ghost flex min-h-11 min-w-11 items-center justify-center p-2" onClick={onClose} aria-label="Close dialog">
          <X size={22} aria-hidden="true"/>
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto p-5 pt-4 sm:p-7 sm:pt-5">{children}</div>
    </div>
  </div>;
}

function PublicAgentProfile({ state, onRetry }: { state: PublicProfileModalState; onRetry: () => void }) {
  const { listing, profile } = state;
  const activity = profile?.activity;
  const stats = profile?.stats;
  const successfulEvaluations = activity?.evaluations.filter((row) => row.state === 'FINALIZED') ?? [];
  const successfulPairMatches = activity?.pairMatches.filter((row) => row.state === 'SETTLED') ?? [];
  return <>
    <div>
      <p className="page-kicker">Public verification profile</p>
      <div className="mt-2 flex flex-wrap items-center gap-3"><h2 id="marketplace-agent-profile-heading" className="text-3xl font-bold">{listing.name}</h2><span className="retro-chip px-2 py-1 text-xs">{displayLabel(listing.state)}</span></div>
      <p className="mt-3 text-sm text-neutral-700">Review verified performance and participation history before purchasing this exact Agent identity.</p>
    </div>
    {state.status === 'LOADING' && <div className="retro-inset mt-7 p-5 text-sm font-semibold" role="status">Loading public Agent evidence…</div>}
    {state.status === 'ERROR' && <div className="mt-7 border border-red-700 bg-red-50 p-5 text-sm" role="alert"><p>{state.message}</p><button type="button" className="metal-button-ghost mt-4" onClick={onRetry}>Try again</button></div>}
    {state.status === 'READY' && profile && <>
      <dl className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="retro-inset p-4"><dt className="text-xs uppercase tracking-wider text-neutral-600">Latest evaluation</dt><dd className="mt-2 text-2xl font-bold">{stats?.latestEvaluationScore === null || stats?.latestEvaluationScore === undefined ? 'N/A' : `${stats.latestEvaluationScore}/100`}</dd></div>
        <div className="retro-inset p-4"><dt className="text-xs uppercase tracking-wider text-neutral-600">Tournaments</dt><dd className="mt-2 text-2xl font-bold">{stats?.tournamentCount ?? 0}</dd></div>
        <div className="retro-inset p-4"><dt className="text-xs uppercase tracking-wider text-neutral-600">Arena matches</dt><dd className="mt-2 text-2xl font-bold">{stats?.adversarialMatchCount ?? 'N/A'}</dd></div>
      </dl>
      <section className="mt-7 border-y border-black/25 py-5" aria-labelledby="marketplace-identity-heading">
        <h3 id="marketplace-identity-heading" className="text-lg font-bold">Onchain identity</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-neutral-600">ERC-8004 identity</dt><dd className="mt-1 font-mono font-bold">{profile.erc8004Identity ? `#${profile.erc8004Identity.tokenId}` : 'Not available'}</dd></div>
          <div><dt className="text-neutral-600">Latest reputation</dt><dd className="mt-1 font-mono font-bold">{profile.erc8004Reputation?.state === 'COMPLETE' ? `${profile.erc8004Reputation.value}/100` : 'Not available'}</dd></div>
        </dl>
      </section>
      <div className="mt-7 grid items-start gap-7 lg:grid-cols-2">
        <section className="min-w-0" aria-labelledby="marketplace-evaluation-history-heading"><h3 id="marketplace-evaluation-history-heading" className="text-xl font-bold">Evaluation history</h3>
          {successfulEvaluations.length ? <ul className="mt-3 space-y-3">{successfulEvaluations.map((row) => <li key={row.campaignId} className={historyCardClass}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{displayLabel(row.state)}</span><span className="font-mono font-bold">{row.overallScore === null ? 'N/A' : `${row.overallScore}/100`}</span></div><p className="mt-2 text-neutral-700">{row.scenarioCount} scenario{row.scenarioCount === 1 ? '' : 's'} · {activityDate(row.createdAt)}</p></li>)}</ul> : <p className="mt-3 text-sm text-neutral-600">No successful evaluation history yet.</p>}
        </section>
        <section className="min-w-0" aria-labelledby="marketplace-pair-history-heading"><h3 id="marketplace-pair-history-heading" className="text-xl font-bold">Pair match history</h3>
          {successfulPairMatches.length ? <ul className="mt-3 space-y-3">{successfulPairMatches.map((row) => <li key={row.roomId} className={historyCardClass}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{displayLabel(row.state)}</span><span className="retro-chip px-2 py-1 text-xs">{displayLabel(row.role)}</span></div><p className="mt-2 text-neutral-700">{activityDate(row.createdAt)}</p></li>)}</ul> : <p className="mt-3 text-sm text-neutral-600">No successful Pair match history yet.</p>}
        </section>
      </div>
      <section className="mt-7" aria-labelledby="marketplace-tournament-history-heading"><h3 id="marketplace-tournament-history-heading" className="text-xl font-bold">Tournament history</h3>
        {activity?.tournaments.length ? <ul className="mt-3 grid gap-3 sm:grid-cols-2">{activity.tournaments.map((row) => <li key={row.id} className="retro-inset flex items-center justify-between gap-3 p-4 text-sm"><span className="font-semibold">{row.name}</span><span className="retro-chip px-2 py-1 text-xs">{displayLabel(row.status)}</span></li>)}</ul> : <p className="mt-3 text-sm text-neutral-600">No public Tournament history yet.</p>}
      </section>
      <p className="mt-7 border border-black/25 bg-white/35 p-4 text-sm text-neutral-700"><strong>Private by design:</strong> AGENTS.md is not included in this profile and is delivered only to the buyer after a completed purchase.</p>
    </>}
  </>;
}

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
  if (!reasons) return <div role="alert" className="mt-8 border border-red-700 bg-red-50 p-4 text-sm">{displayLabel(message)} <button type="button" className="ml-3 underline" onClick={onRefresh}>Refresh state</button></div>;
  return <section role="alert" aria-labelledby="marketplace-eligibility-error" className="mt-8 border border-red-700 bg-red-50 p-5 text-sm">
    <div className="flex items-start gap-3"><AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-red-800" size={20}/><div className="min-w-0"><h2 id="marketplace-eligibility-error" className="text-lg font-bold text-red-950">This Agent version is not eligible yet</h2><p className="mt-2 leading-relaxed text-red-950">Marketplace certification stopped because the selected evaluations failed these requirements:</p></div></div>
    <ul className="mt-4 space-y-3">{reasons.map((reason) => <li key={reason.code} className="retro-inset p-4"><p className="font-mono text-xs font-bold text-red-950">{displayLabel(reason.code)}</p><p className="mt-2 leading-relaxed text-neutral-800">{reason.explanation}</p></li>)}</ul>
    <p className="mt-4 leading-relaxed text-red-950"><strong>How to qualify:</strong> Review the failed runs, update this Agent version, then complete two new evaluations. All required runs must have no blocking policy findings, an average score of at least 80, and a score spread of 20 points or less.</p>
    <div className="mt-4 flex flex-wrap gap-3"><Link className="metal-button-ghost" to="/evaluations">Open evaluations</Link><button type="button" className="metal-button-ghost" onClick={onRefresh}>Refresh after new evaluations</button></div>
  </section>;
}

export function Marketplace() {
  const { account, marketplaceApi, agentApi, evaluationApi, networkConfig } = useAppContext();
  const [searchParams] = useSearchParams();
  const activeView = searchParams.get('view') === 'sell' ? 'sell' : 'browse';
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [ownedListings, setOwnedListings] = useState<MarketplaceListing[]>([]);
  const [purchases, setPurchases] = useState<MarketplaceListing[]>([]);
  const [listingIntents, setListingIntents] = useState<MarketplaceListingIntent[]>([]);
  const [certificates, setCertificates] = useState<MarketplaceCertificate[]>([]);
  const [operatorCertificates, setOperatorCertificates] = useState<MarketplaceCertificate[]>([]);
  const [operatorCredit, setOperatorCredit] = useState<string | null>(null);
  const [operatorNotice, setOperatorNotice] = useState('');
  const [eligibilityNotice, setEligibilityNotice] = useState('');
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [campaigns, setCampaigns] = useState<EvaluationCampaign[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const [agentId, setAgentId] = useState('');
  const [listing, setListing] = useState({ certificateDigest: '', price: '', expiresAt: String(nowSeconds() + 7 * 86400) });
  const [delivery, setDelivery] = useState<{ listingId: string; name: string; agentsMd: string } | null>(null);
  const [purchaseConfirm, setPurchaseConfirm] = useState<MarketplaceListing | null>(null);
  const [publicProfileModal, setPublicProfileModal] = useState<PublicProfileModalState | null>(null);
  const publicProfileRequest = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    if (!marketplaceApi) return;
    const [next, owned, sellerRows, bought, intents, reviewQueue, platformCredit] = await Promise.all([
      marketplaceApi.listListings(), account ? marketplaceApi.listCertificates() : Promise.resolve([]),
      account && marketplaceApi.listOwnedListings ? marketplaceApi.listOwnedListings() : Promise.resolve([]),
      account && marketplaceApi.listPurchases ? marketplaceApi.listPurchases() : Promise.resolve([]),
      account && marketplaceApi.listListingIntents ? marketplaceApi.listListingIntents() : Promise.resolve([]),
      account && marketplaceApi.listOperatorCertificates ? marketplaceApi.listOperatorCertificates().catch(() => []) : Promise.resolve([]),
      account && marketplaceApi.getOperatorCredit ? marketplaceApi.getOperatorCredit().catch(() => null) : Promise.resolve(null),
    ]);
    setListings(next); setOwnedListings(sellerRows); setCertificates(owned); setPurchases(bought); setListingIntents(intents); setOperatorCertificates(reviewQueue); setOperatorCredit(platformCredit?.amount ?? null);
  }
  useEffect(() => {
    let active = true;
    if (!marketplaceApi) return;
    Promise.all([
      marketplaceApi.listListings(), account ? marketplaceApi.listCertificates() : Promise.resolve([]),
      account && marketplaceApi.listOwnedListings ? marketplaceApi.listOwnedListings() : Promise.resolve([]),
      account && marketplaceApi.listPurchases ? marketplaceApi.listPurchases() : Promise.resolve([]),
      account && marketplaceApi.listListingIntents ? marketplaceApi.listListingIntents() : Promise.resolve([]),
      account && agentApi ? agentApi.listOwnedAgents() : Promise.resolve([]),
      account && evaluationApi ? evaluationApi.listCampaigns() : Promise.resolve([]),
      account && marketplaceApi.listOperatorCertificates ? marketplaceApi.listOperatorCertificates().catch(() => []) : Promise.resolve([]),
      account && marketplaceApi.getOperatorCredit ? marketplaceApi.getOperatorCredit().catch(() => null) : Promise.resolve(null),
    ]).then(([next, owned, sellerRows, bought, intents, profiles, records, reviewQueue, platformCredit]) => {
      if (!active) return;
      setListings(next); setOwnedListings(sellerRows); setCertificates(owned); setPurchases(bought); setListingIntents(intents);
      setAgents(profiles); setCampaigns(records); setOperatorCertificates(reviewQueue); setOperatorCredit(platformCredit?.amount ?? null);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load Marketplace.'); });
    return () => { active = false; };
  }, [marketplaceApi, account, agentApi, evaluationApi]);

  const selectedAgent = agents.find((row) => row.agentId === agentId);
  const finalized = useMemo(() => campaigns.filter((row) => row.state === 'FINALIZED' && row.agentVersionId === selectedAgent?.agentsVersion), [campaigns, selectedAgent?.agentsVersion]);
  const availableCertificates = certificates.filter((row) => row.state === 'APPROVED' && !listingIntents.some((intent) => intent.certificateDigest === row.certificateDigest));
  const selectedCertificate = availableCertificates.find((row) => row.certificateDigest === listing.certificateDigest);
  const activeListings = listings.filter((row) => row.state === 'ACTIVE');
  const privatePurchases = purchases.filter((row) => row.state === 'BUY_SUBMITTED' || row.state === 'SOLD');
  const sellerRecords = ownedListings;

  async function issueEligibility(event: React.FormEvent) {
    event.preventDefault();
    if (!marketplaceApi || !selectedAgent || finalized.length < 2 || !networkConfig?.genLayer) return;
    setBusy('eligibility'); setError(''); setEligibilityNotice('');
    try {
      const certificate = await marketplaceApi.createEligibility({ agentId: selectedAgent.agentId, agentsVersion: selectedAgent.agentsVersion, campaignIds: finalized.slice(0, 2).map((row) => row.campaignId), issuedAt: nowSeconds(), expiresAt: nowSeconds() + 30 * 86400, network: 'studio-next', chainId: networkConfig.genLayer.chainId, judgeAddress: networkConfig.genLayer.evaluationJudgeAddress });
      setCertificates((current) => [...current.filter((row) => row.certificateDigest !== certificate.certificateDigest), certificate]);
      if (certificate.state === 'APPROVED') {
        setListing((current) => ({ ...current, certificateDigest: certificate.certificateDigest }));
        setEligibilityNotice('Eligibility approved on Arc. Enter a price to list this Agent.');
      }
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
      await marketplaceApi.createListing({ listingId: String(Date.now()), certificateDigest: selectedCertificate.certificateDigest, agentId: selectedCertificate.agentId, agentsVersion: selectedCertificate.agentVersionId, agentsCommitment: selectedCertificate.agentsCommitment, price: price.toString(), expiresAt: Number(listing.expiresAt), nftApprovalIdempotencyKey: uuid(), listingIdempotencyKey: uuid() });
      await refresh();
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'conflicting marketplace listing intent') {
        try { await refresh(); setError(''); }
        catch { setError('A previous listing attempt exists, but its recovery state could not be loaded.'); }
      } else setError(cause instanceof Error ? cause.message : 'Listing failed. Check the price and certificate.');
    }
    finally { setBusy(''); }
  }

  async function resumeListing(intent: MarketplaceListingIntent) {
    if (!marketplaceApi) return;
    setBusy(`intent-${intent.certificateDigest}`); setError('');
    try {
      await marketplaceApi.createListing({ listingId: String(Date.now()), certificateDigest: intent.certificateDigest,
        agentId: intent.agentId, agentsVersion: intent.agentVersionId, agentsCommitment: intent.agentsCommitment,
        price: intent.price, expiresAt: intent.expiresAt, nftApprovalIdempotencyKey: uuid(), listingIdempotencyKey: uuid() });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not resume the previous listing attempt.'); }
    finally { setBusy(''); }
  }

  async function buy(row: MarketplaceListing) {
    if (!marketplaceApi) return;
    setBusy(`buy-${row.listingId}`); setError('');
    try { await marketplaceApi.buy(row.listingId, uuid(), uuid()); await refresh(); setPurchaseConfirm(null); }
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

  async function openPublicProfile(row: MarketplaceListing) {
    const requestId = ++publicProfileRequest.current;
    setPublicProfileModal({ listing: row, status: 'LOADING' });
    if (!marketplaceApi?.getListingProfile && !agentApi?.listPublicAgents) {
      setPublicProfileModal({ listing: row, status: 'ERROR', message: 'Public Agent evidence is not available on this server.' });
      return;
    }
    try {
      const profile = marketplaceApi?.getListingProfile
        ? await marketplaceApi.getListingProfile(row.listingId)
        : (await agentApi!.listPublicAgents!()).find((candidate) => candidate.agentId === row.agentId);
      if (publicProfileRequest.current !== requestId) return;
      if (!profile) throw new Error('This Agent public profile could not be found.');
      setPublicProfileModal({ listing: row, status: 'READY', profile });
    } catch (cause) {
      if (publicProfileRequest.current !== requestId) return;
      setPublicProfileModal({ listing: row, status: 'ERROR', message: cause instanceof Error ? cause.message : 'Could not load public Agent evidence.' });
    }
  }

  function closePublicProfile() {
    publicProfileRequest.current += 1;
    setPublicProfileModal(null);
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

  function listingAction(row: MarketplaceListing, privateRecord = false) {
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
        onClick={() => setPurchaseConfirm(row)} aria-label={row.state === 'BUY_SUBMITTED' ? `Resume ${row.name} purchase` : undefined}>
        {busy === `buy-${row.listingId}` ? 'Purchase submitting…' : row.state === 'BUY_SUBMITTED' ? 'Resume purchase' : `Buy for ${usdc(row.price)}`}
      </button>;
    }
    if (privateRecord && row.state === 'SOLD') {
      return <button type="button" className="metal-button-ghost w-full" disabled={busy !== ''}
        onClick={() => openDelivery(row)} aria-label={`Open purchased Agent ${row.name}`}>
        {busy === `delivery-${row.listingId}` ? 'Loading delivery…' : 'Open purchased Agent'}
      </button>;
    }
    if (!account && row.state === 'ACTIVE') {
      return <button type="button" className="metal-button-solid w-full" disabled>Sign in to buy</button>;
    }
    return <p className="text-xs text-neutral-600">{row.state === 'ACTIVE' ? 'Sign in to purchase.' : row.state === 'SOLD' ? 'Sold on Arc.' : 'Awaiting Arc confirmation. Reload to check status.'}</p>;
  }

  function listingCard(row: MarketplaceListing, privateRecord = false) {
    return <article className="glass-panel flex min-h-64 flex-col p-5" key={`${privateRecord ? 'private' : 'public'}-${row.listingId}`}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs uppercase tracking-widest text-neutral-600">{privateRecord ? 'Private account record' : 'Agent listing'}</p><h2 className="mt-2 text-2xl font-bold">{row.name}</h2></div><span className="retro-chip shrink-0 px-2 py-1 text-xs">{displayLabel(row.state)}</span></div>
      {!privateRecord && <div role="group" aria-label={`${row.name} listing actions`} className="mt-5 grid grid-cols-2 gap-2"><button type="button" className="metal-button-ghost w-full" onClick={() => openPublicProfile(row)}>View details</button>{listingAction(row)}</div>}
      <dl className={`${privateRecord ? 'mt-8' : 'mt-5'} space-y-3 text-sm`}><div className="flex justify-between gap-3"><dt className="text-neutral-600">Price</dt><dd className="font-mono font-bold">{usdc(row.price)}</dd></div><div className="flex justify-between gap-3"><dt className="text-neutral-600">Identity</dt><dd className="font-mono font-bold">ERC-8004 #{row.erc8004TokenId}</dd></div><div className="flex justify-between gap-3"><dt className="text-neutral-600">Version</dt><dd className="font-semibold">Verified Agent version</dd></div><div className="flex justify-between gap-3"><dt className="text-neutral-600">Listing expires</dt><dd className="text-right font-semibold">{activityDate(row.expiresAt)}</dd></div></dl>
      {privateRecord && <div className="mt-auto pt-6">{listingAction(row, true)}</div>}
    </article>;
  }

  return <section aria-labelledby="marketplace-heading" className="mx-auto max-w-6xl">
    <p className="page-kicker">Agent Exchange · Arc Testnet</p>
    <div className="flex flex-wrap items-end justify-between gap-6"><div><h1 id="marketplace-heading" className="page-title">Marketplace</h1><p className="page-lede">Buy exact Agent versions that passed Arena ISS evaluation. Every sale settles in USDC with a fixed 1% platform fee.</p></div><span className="retro-chip px-3 py-2 text-xs">Platform fee · 1%</span></div>
    {error && <MarketplaceError message={error} onRefresh={() => refresh().catch((cause) => setError(cause instanceof Error ? cause.message : 'Refresh failed.'))}/>}
    {activeView === 'browse' && <section className="mt-12" role="region" aria-label="Agents for sale">
      {activeListings.length > 0 ? <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{activeListings.map((row) => listingCard(row))}</div>
        : <div className="glass-panel p-6 text-neutral-700">No live listings yet. An Agent needs two finalized evaluations and an approved certificate before it can be listed.</div>}
    </section>}
    {activeView === 'browse' && account && privatePurchases.length > 0 && <section className="mt-14" role="region" aria-label="My purchased Agents"><p className="page-kicker">Private account records</p><h2 className="mt-1 text-2xl font-bold">My purchased Agents</h2><p className="mt-2 text-sm text-neutral-700">Completed purchases and purchases still awaiting Arc confirmation are visible only to this account.</p><div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{privatePurchases.map((row) => listingCard(row, true))}</div></section>}
    {activeView === 'sell' && account && sellerRecords.length > 0 && <section className="glass-panel mt-12 p-6" role="region" aria-label="My listing records"><p className="page-kicker">Private seller records</p><h2 className="mt-1 text-2xl font-bold">My listing records</h2><p className="mt-2 text-sm text-neutral-700">These records show every listing submitted by this account. Only ACTIVE listings appear in public search; pending, expired, cancelled, and sold records remain private here.</p><div className="mt-5 grid gap-5 md:grid-cols-2">{sellerRecords.map((row) => listingCard(row, true))}</div></section>}
    {activeView === 'sell' && account && listingIntents.length > 0 && <section className="glass-panel mt-12 p-6" role="region" aria-label="Listing recovery"><p className="page-kicker">Safe transaction recovery</p><h2 className="mt-1 text-2xl font-bold">Resume a previous listing attempt</h2><p className="mt-2 text-sm text-neutral-700">Arena ISS found an unfinished listing. Resume its original price, expiry and server-held transaction identity instead of creating a conflicting Arc transaction.</p><ul className="mt-5 space-y-3">{listingIntents.map((intent) => { const agentName = agents.find((agent) => agent.agentId === intent.agentId)?.name ?? 'Agent'; const expired = intent.state === 'PREPARED' && intent.expiresAt <= nowSeconds(); return <li key={intent.certificateDigest} className="retro-inset flex flex-wrap items-center justify-between gap-4 p-4"><div><p className="font-bold">{agentName}</p><p className="mt-1 font-mono text-sm">{usdc(intent.price)}</p><p className="mt-1 text-xs text-neutral-700">Expires {activityDate(intent.expiresAt)} · {displayLabel(intent.state)}</p>{expired && <p className="mt-2 text-xs text-red-900">This prepared attempt has expired and cannot submit a new Arc listing.</p>}</div><button type="button" className="metal-button-solid" disabled={busy !== '' || expired} onClick={() => resumeListing(intent)}>{busy === `intent-${intent.certificateDigest}` ? 'Resuming on Arc…' : 'Resume listing attempt'}</button></li>; })}</ul></section>}
    {activeView === 'sell' && (operatorCertificates.some((row) => row.state === 'ELIGIBLE') || operatorCredit !== null) && <section className="glass-panel mt-12 p-6" aria-labelledby="operator-review-heading"><p className="page-kicker">Restricted operator action</p><div className="flex flex-wrap items-start justify-between gap-5"><div><h2 id="operator-review-heading" className="mt-1 text-2xl font-bold">Operator review</h2><p className="mt-2 text-sm text-neutral-700">Approve only after checking the bound Agent version, score, coverage and expiry. Approval writes the immutable eligibility record to Arc.</p></div>{operatorCredit !== null && <div className="text-right"><p className="font-mono font-bold">{usdc(operatorCredit)} platform credit</p><button type="button" className="metal-button-ghost mt-2" disabled={busy !== '' || BigInt(operatorCredit) === 0n || !marketplaceApi?.withdrawOperatorCredit} onClick={withdrawOperatorCredit}>{busy === 'platform-withdraw' ? 'Withdrawing…' : 'Withdraw platform fee'}</button>{operatorNotice && <p role="status" className="mt-2 text-sm font-semibold">{operatorNotice}</p>}</div>}</div><ul className="mt-5 space-y-3">{operatorCertificates.filter((row) => row.state === 'ELIGIBLE').map((row) => <li key={row.certificateDigest} className="retro-inset flex flex-wrap items-center justify-between gap-4 p-4"><div><p className="text-sm font-semibold">Eligible Agent certificate</p><p className="mt-2 font-semibold">{row.overallScore}/100 · {(row.coverageBps / 100).toFixed(0)}% coverage</p><p className="mt-1 text-xs text-neutral-700">Expires {new Date(row.expiresAt * 1000).toLocaleString()}</p></div><button type="button" className="metal-button-solid" disabled={busy !== ''} onClick={() => approveCertificate(row.certificateDigest)}>{busy === `approve-${row.certificateDigest}` ? 'Approving on Arc…' : 'Approve certificate on Arc'}</button></li>)}</ul></section>}
    {activeView === 'sell' && account && <div className="mt-14 grid gap-6 lg:grid-cols-2"><form className="glass-panel p-6" onSubmit={issueEligibility}><h2 className="text-xl font-bold">Certify an evaluated version</h2><p className="mt-2 text-sm text-neutral-600">Arena ISS checks two completed evaluations for the same version. Digests and Studio Next contract details are filled from verified records.</p>
      <label className="mt-5 block text-sm font-semibold" htmlFor="marketplace-agent">Agent to certify</label><select id="marketplace-agent" className="field-control mt-2 w-full" value={agentId} onChange={(event) => setAgentId(event.target.value)} required><option value="">Select your Agent</option>{agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</select>
      {selectedAgent && <p className="mt-3 text-sm" role="status">{finalized.length} finalized evaluation{finalized.length === 1 ? '' : 's'} available for this version. {finalized.length < 2 && <Link className="underline" to="/evaluations">Run another evaluation</Link>}</p>}
      {!networkConfig?.genLayer && <p className="mt-3 text-sm text-red-900">Studio Next judge is not configured. Eligibility is unavailable.</p>}
      <button type="submit" className="metal-button-solid mt-6" disabled={busy !== '' || !selectedAgent || finalized.length < 2 || !networkConfig?.genLayer}>{busy === 'eligibility' ? 'Checking…' : 'Check eligibility'}</button>
      {eligibilityNotice && <p className="mt-3 text-sm font-semibold" role="status">{eligibilityNotice}</p>}
    </form><form className="glass-panel p-6" onSubmit={createListing}><h2 className="text-xl font-bold">List an approved version</h2><p className="mt-2 text-sm text-neutral-600">Listing binds the approved version to its ERC-8004 identity NFT. Arena ISS grants the Marketplace transfer permission automatically; a completed sale transfers the complete identity to the buyer while the private profile remains delivered through Arena ISS.</p>
      <label className="mt-5 block text-sm font-semibold" htmlFor="marketplace-certificate">Approved certificate</label><select id="marketplace-certificate" className="field-control mt-2 w-full" value={listing.certificateDigest} onChange={(event) => setListing((current) => ({ ...current, certificateDigest: event.target.value }))} required><option value="">Select certificate</option>{availableCertificates.map((row) => <option key={row.certificateDigest} value={row.certificateDigest}>Approved Agent · {row.overallScore}/100</option>)}</select>
      {certificates.some((row) => row.state === 'ELIGIBLE') && <p className="mt-3 text-sm text-neutral-700">Eligible certificate awaiting operator approval.</p>}
      <label className="mt-4 block text-sm font-semibold" htmlFor="marketplace-price">Price (USDC)</label><input id="marketplace-price" className="field-control mt-2 w-full" inputMode="decimal" pattern="^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,6})?$" placeholder="2.50" value={listing.price} onChange={(event) => setListing((current) => ({ ...current, price: event.target.value }))} required aria-describedby="marketplace-price-help"/><p id="marketplace-price-help" className="mt-2 text-xs text-neutral-700">Enter USDC, not base units. Settlement deducts a fixed 1% platform fee from the seller credit.</p>
      <button type="submit" className="metal-button-solid mt-6" disabled={busy !== '' || !selectedCertificate}>{busy === 'listing' ? 'Approving ERC-8004 identity and listing…' : 'List on Arc'}</button>
    </form></div>}
    {activeView === 'sell' && !account && <p className="mt-10 text-sm text-neutral-600">Sign in to certify or list an Agent. <Link to="/agents" className="font-semibold underline">Manage Agents</Link>.</p>}
    {publicProfileModal && <MarketplaceModal titleId="marketplace-agent-profile-heading" onClose={closePublicProfile}>
      <PublicAgentProfile state={publicProfileModal} onRetry={() => openPublicProfile(publicProfileModal.listing)}/>
    </MarketplaceModal>}
    {purchaseConfirm && <MarketplaceModal titleId="marketplace-purchase-review-heading" onClose={() => setPurchaseConfirm(null)} width="max-w-xl">
      <p className="page-kicker">Arc Testnet purchase</p>
      <h2 id="marketplace-purchase-review-heading" className="mt-2 text-3xl font-bold">Review purchase</h2>
      <p className="mt-3 text-sm text-neutral-700">Confirm the exact onchain identity and total before Arena ISS submits the USDC approval and purchase transactions.</p>
      <dl className="retro-inset mt-6 space-y-4 p-5 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-neutral-600">Agent</dt><dd className="text-right font-bold">{purchaseConfirm.name}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-neutral-600">Identity</dt><dd className="font-mono font-bold">ERC-8004 #{purchaseConfirm.erc8004TokenId}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-neutral-600">Network</dt><dd className="font-bold">Arc Testnet</dd></div>
        <div className="flex justify-between gap-4 border-t border-black/20 pt-4"><dt className="font-bold">Total</dt><dd className="font-mono text-lg font-bold">{usdc(purchaseConfirm.price)}</dd></div>
      </dl>
      <p className="mt-5 text-sm leading-relaxed text-neutral-700">A successful sale transfers the complete ERC-8004 identity to your managed wallet. The exact private AGENTS.md version becomes available only after canonical Arc ownership readback.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" className="metal-button-ghost w-full" disabled={busy !== ''} onClick={() => setPurchaseConfirm(null)}>Cancel</button><button type="button" className="metal-button-solid w-full" disabled={busy !== ''} onClick={() => buy(purchaseConfirm)}>{busy === `buy-${purchaseConfirm.listingId}` ? 'Purchasing on Arc…' : 'Confirm purchase'}</button></div>
    </MarketplaceModal>}
    {delivery && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDelivery(null); }}><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="marketplace-delivery-heading" className="glass-panel max-h-[85vh] w-full max-w-2xl overflow-auto bg-[#f8f5ee] p-6"><div className="flex items-start justify-between gap-4"><div><h2 id="marketplace-delivery-heading" className="text-2xl font-bold">Purchased Agent</h2><p className="mt-2 text-sm">{delivery.name}</p></div><button type="button" className="metal-button-ghost" onClick={() => setDelivery(null)}>Close</button></div><h3 className="mt-6 font-semibold">Private AGENTS.md</h3><pre className="retro-inset mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 text-sm">{delivery.agentsMd}</pre></div></div>}
  </section>;
}
