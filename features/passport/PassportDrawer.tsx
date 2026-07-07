'use client';

import { useEffect, useMemo, useState } from 'react';
import { useArena, useArenaDispatch, cardByToken } from '@/app/arena/state';
import {
  fetchCardDetail, searchIndex, fetchIndexCardByHref, fetchPacks, narratePassport,
  type NarrationResult,
} from '@/lib/client/api';
import type { CardDetail, IndexCard, CardPack, Activity } from '@/lib/renaiss/schemas';
import { STAT_FORMULA_NOTES, ELEMENT_GLYPH, type GameCard } from '@/lib/game/stats';

function fmtDate(ts: string | number | null | undefined): string {
  if (ts == null) return '—';
  const n = Number(ts);
  if (!Number.isFinite(n)) return String(ts);
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString().slice(0, 10);
}
function cents(c: number | null | undefined): string {
  return c == null ? '—' : '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function moneyFromCents(input: string | number | null | undefined): string {
  if (input == null || input === '') return '—';
  const n = Number(input);
  if (!Number.isFinite(n)) return String(input);
  return '$' + (n / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function usdtFromBaseUnits(input: string | number | null | undefined): string {
  if (input == null || input === '') return '—';
  try {
    const raw = BigInt(String(input));
    const scale = BigInt('1000000000000000000');
    const whole = raw / scale;
    const frac = raw % scale;
    const centsPart = Number((frac * BigInt(100)) / scale);
    return `$${Number(whole).toLocaleString('en-US')}${centsPart ? `.${String(centsPart).padStart(2, '0')}` : ''}`;
  } catch {
    const n = Number(input);
    return Number.isFinite(n) ? `$${n.toLocaleString('en-US')}` : String(input);
  }
}
function packUrl(slug: string): string {
  return `https://www.renaiss.xyz/gacha/${encodeURIComponent(slug)}`;
}
// Minimal markdown renderer for narration paragraphs, bold, and emphasis.
function Narr({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((p, i) => {
        const html = p
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/_(.+?)_/g, '<em style="color:var(--text-dim)">$1</em>');
        return <p key={i} style={{ margin: '0 0 10px', lineHeight: 1.6, fontSize: 13.5 }} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </>
  );
}

export function PassportDrawer() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const tokenId = state.passportToken;
  const card = useMemo(() => cardByToken(state, tokenId), [state, tokenId]);

  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [idx, setIdx] = useState<IndexCard | null>(null);
  const [narr, setNarr] = useState<NarrationResult | null>(null);
  const [packs, setPacks] = useState<CardPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [narrLoading, setNarrLoading] = useState(false);
  const [showReal, setShowReal] = useState(false);
  const asOf = useMemo(() => new Date().toISOString(), [tokenId]);

  useEffect(() => {
    if (!tokenId || !card) return;
    let alive = true;
    setDetail(null); setIdx(null); setNarr(null); setShowReal(false);
    setLoading(true); setNarrLoading(true);

    (async () => {
      // 1) Card detail: on-chain activity, custody, and image.
      const d = await fetchCardDetail(tokenId);
      if (!alive) return;
      setDetail(d);

      // 2) Reference price from Index: resolve name -> href -> detail.
      const q = card.pokemonName || card.name;
      const results = await searchIndex(q);
      let indexCard: IndexCard | null = null;
      if (results.length > 0 && results[0].href) {
        indexCard = await fetchIndexCardByHref(results[0].href);
      }
      if (!alive) return;
      setIdx(indexCard);
      setLoading(false);

      // 3) AI narration: server-side, with deterministic fallback.
      const collectible = d?.collectible;
      const activities: Activity[] = d?.activities?.activities ?? [];
      const input = {
        card: {
          name: card.name, setName: card.setName, grade: card.grade,
          gradingCompany: card.gradingCompany, year: card.year, tokenId: card.tokenId,
        },
        custody: {
          vaultLocation: collectible?.vaultLocation ?? card.vaultLocation ?? null,
          countryCode: collectible?.vaultRegionCountryCode ?? null,
        },
        onchain: {
          activities: activities.slice(0, 8).map((a) => ({
            type: a.type, timestamp: a.timestamp != null ? String(a.timestamp) : null,
            txHash: a.txHash ?? null, amount: a.amount ?? null,
          })),
          lastSale: null,
        },
        reference: indexCard
          ? {
              source: 'Renaiss OS Index',
              priceUsd: indexCard.priceUsdCents != null ? indexCard.priceUsdCents / 100 : null,
              confidence: indexCard.confidence ?? null,
              observationCount: indexCard.observationCount ?? null,
              lastSaleAt: indexCard.lastSaleAt ?? null,
              deltas: indexCard.deltas ?? null,
              sourceBreakdown: (indexCard.sourceBreakdown ?? []).map((s) => ({
                bucket: s.bucket ?? null, medianUsd: s.medianUsdCents != null ? s.medianUsdCents / 100 : null,
              })),
            }
          : null,
        asOf,
      };
      const n = await narratePassport(input);
      if (!alive) return;
      setNarr(n);
      setNarrLoading(false);
    })();

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId]);

  async function loadReal() {
    setShowReal(true);
    if (packs.length === 0) setPacks(await fetchPacks());
  }

  if (!tokenId || !card) return null;
  const collectible = detail?.collectible;
  const img = collectible?.frontImageUrl || card.imageUrl;
  const activities: Activity[] = detail?.activities?.activities ?? [];
  const deltas = idx?.deltas ?? null;
  const hasDeltas = !!deltas && [deltas.d7, deltas.d30, deltas.d365].some((v) => v != null);

  return (
    <>
      <div
        onClick={() => dispatch({ type: 'CLOSE_PASSPORT' })}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40, animation: 'fadeIn 0.2s ease' }}
      />
      <aside
        role="dialog"
        aria-label="Card Passport"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)', zIndex: 41,
          background: '#1b212c', borderLeft: '1px solid var(--hairline-strong)',
          overflowY: 'auto', boxShadow: '-30px 0 60px -20px rgba(0,0,0,0.8)',
          animation: 'slideIn 0.28s cubic-bezier(0.2,0.8,0.2,1)',
        }}
      >
        <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>

        {/* Cleaner, data-oriented header. */}
        <div style={{ display: 'flex', gap: 14, padding: 18, borderBottom: '1px solid var(--hairline)', position: 'sticky', top: 0, background: '#1b212c', zIndex: 2 }}>
          <div data-tier={card.tier} style={{ width: 66, flex: 'none', aspectRatio: '2.5/3.5', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(from var(--tier) r g b / 0.5)', background: '#0d1016' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img ? <img src={img} alt={card.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{card.name}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
              {card.gradingCompany ?? 'RAW'} {card.grade ?? ''} · {ELEMENT_GLYPH[card.element]} {card.element} · #{card.tokenId.slice(0, 10)}…
            </div>
            <div className="chip" style={{ marginTop: 6, fontSize: 10 }}>Card Passport · real reference data</div>
          </div>
          <button className="btn btn-ghost" style={{ padding: '4px 10px', alignSelf: 'flex-start' }} onClick={() => dispatch({ type: 'CLOSE_PASSPORT' })}>✕</button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Reference price (Index) */}
          <section>
            <SectionLabel>REFERENCE PRICE · RENAISS OS INDEX</SectionLabel>
            {loading ? <Skeleton /> : idx ? (
              <div className="panel" style={{ padding: 14, background: '#202734' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span className="tabnums" style={{ fontSize: 26, fontWeight: 900 }}>{cents(idx.priceUsdCents)}</span>
                  {idx.confidence && (
                    <span className="chip" style={{ borderColor: idx.confidence === 'high' ? 'var(--win)' : idx.confidence === 'low' ? 'var(--loss)' : 'var(--hairline-strong)' }}>
                      confidence: {idx.confidence}
                    </span>
                  )}
                </div>
                {hasDeltas ? (
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12 }}>
                    <Delta label="7d" v={deltas!.d7} /><Delta label="30d" v={deltas!.d30} /><Delta label="365d" v={deltas!.d365} />
                  </div>
                ) : (
                  <div className="caveat" style={{ marginTop: 8 }}>
                    Recent trend unavailable: Renaiss OS Index did not return 7d/30d/365d deltas for this card.
                  </div>
                )}
                <div className="caveat" style={{ marginTop: 10 }}>
                  {idx.observationCount ?? '—'} observations{idx.sourceCount ? ` · ${idx.sourceCount} sources` : ''}
                  {idx.lastSaleAt ? ` · last sale ${idx.lastSaleAt.slice(0, 10)}` : ''}.
                  Source: <b>Renaiss OS Index</b>, as of {asOf.slice(0, 10)}.
                  {idx.observationCount != null && idx.observationCount < 10 ? ' Thin data — treat as experimental reference.' : ''}
                </div>
              </div>
            ) : (
              <p className="caveat">This card could not be matched to Renaiss OS Index, or no reference price is available.</p>
            )}
          </section>

          {/* Custody */}
          <section>
            <SectionLabel>CUSTODY</SectionLabel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="chip">🏛 {collectible?.vaultLocation ?? card.vaultLocation ?? 'unknown vault'}</span>
              <span className="chip">🌍 {collectible?.vaultRegionCountryCode ?? 'unknown country'}</span>
            </div>
          </section>

          {/* Provenance on-chain */}
          <section>
            <SectionLabel>PROVENANCE ON-CHAIN</SectionLabel>
            {loading ? <Skeleton /> : activities.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activities.slice(0, 6).map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
                    <span className="chip" style={{ minWidth: 62, justifyContent: 'center', textTransform: 'uppercase', fontSize: 10 }}>{a.type}</span>
                    <span style={{ color: 'var(--text-sub)' }}>{fmtDate(a.timestamp)}</span>
                    {a.txHash && <a className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--tier-a)' }} href={`https://bscscan.com/tx/${a.txHash}`} target="_blank" rel="noreferrer">{a.txHash.slice(0, 10)}…</a>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="caveat">No on-chain activity data is available.</p>
            )}
          </section>

          {/* AI narration */}
          <section>
            <SectionLabel>
              PASSPORT AI {narr && <span className="chip" style={{ marginLeft: 8, fontSize: 9 }}>{narr.mode === 'ai' ? '🤖 LLM' : '📄 data summary'}</span>}
            </SectionLabel>
            <div className="panel" style={{ padding: 14, background: '#202734' }}>
              {narrLoading ? <Skeleton lines={4} /> : narr ? (
                <>
                  <Narr text={narr.text} />
                  {narr.note && <p className="caveat" style={{ marginTop: 6, fontStyle: 'italic' }}>{narr.note}</p>}
                </>
              ) : <p className="caveat">Narration could not be generated.</p>}
            </div>
          </section>

          {/* Fictional game stats */}
          <section>
            <SectionLabel>FICTIONAL GAME STATS</SectionLabel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <Stat k="ATK" v={card.atk} /><Stat k="DEF" v={card.def} /><Stat k="AURA" v={card.aura} />
              <Stat k="POWER" v={card.power} accent /><Stat k="TIER" v={card.tier} />
            </div>
            <p className="caveat">{STAT_FORMULA_NOTES.power} Fictional gameplay stats only — not asset valuation or investment advice.</p>
          </section>

          {/* Real ownership funnel */}
          <section>
            {!showReal ? (
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={loadReal}>How to own it for real</button>
            ) : (
              <div className="panel" style={{ padding: 14 }}>
                <SectionLabel>REAL RENAISS PACKS</SectionLabel>
                <p className="caveat" style={{ marginBottom: 10 }}>
                  Source: <b>Renaiss /v0/packs</b> via this app&apos;s read-only <b>/api/packs</b> proxy. These are real Renaiss packs
                  that use real USDT and a wallet, separate from the simulated game packs. Renaiss pack pages currently state each pack contains 1 card.
                </p>
                {packs.length === 0 ? <Skeleton /> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {packs.filter((p) => p.stage === 'active').slice(0, 4).map((p) => (
                      <a
                        key={p.slug}
                        className="panel"
                        href={packUrl(p.slug)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, background: '#202734', textDecoration: 'none' }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                          <div className="caveat">
                            {p.packType ?? ''}
                            {p.priceInUsdt ? ` · ${usdtFromBaseUnits(p.priceInUsdt)}/pack` : ''}
                            {p.expectedValueInUsd ? ` · EV ${moneyFromCents(p.expectedValueInUsd)}` : ''}
                            {p.featuredCardFmvInUsd ? ` · top ${moneyFromCents(p.featuredCardFmvInUsd)}` : ''}
                          </div>
                        </div>
                        <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 800 }}>Open ↗</span>
                      </a>
                    ))}
                    <a className="btn" style={{ textAlign: 'center', textDecoration: 'none' }} href="https://www.renaiss.xyz/gacha" target="_blank" rel="noreferrer">
                      View all Renaiss packs ↗
                    </a>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-dim)', marginBottom: 8, display: 'flex', alignItems: 'center' }}>{children}</div>;
}
function Skeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ height: 12, borderRadius: 6, background: 'linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.09), rgba(255,255,255,0.04))', width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}
function Delta({ label, v }: { label: string; v: number | null | undefined }) {
  const color = v == null ? 'var(--text-dim)' : v >= 0 ? 'var(--win)' : 'var(--loss)';
  return <span style={{ color }}>{label}: {v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}</span>;
}
function Stat({ k, v, accent }: { k: string; v: number | string; accent?: boolean }) {
  return (
    <span className="chip" style={{ fontWeight: 700, color: accent ? 'var(--accent)' : 'var(--text)' }}>
      <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{k}</span> <span className="tabnums">{v}</span>
    </span>
  );
}
