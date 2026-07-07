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
// Render markdown tối giản (đoạn + **đậm** + _nghiêng_).
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
      // 1) Card detail (on-chain + custody + ảnh)
      const d = await fetchCardDetail(tokenId);
      if (!alive) return;
      setDetail(d);

      // 2) Reference giá từ Index (resolve tên → href → detail)
      const q = card.pokemonName || card.name;
      const results = await searchIndex(q);
      let indexCard: IndexCard | null = null;
      if (results.length > 0 && results[0].href) {
        indexCard = await fetchIndexCardByHref(results[0].href);
      }
      if (!alive) return;
      setIdx(indexCard);
      setLoading(false);

      // 3) AI narration (server-side, có fallback)
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

        {/* Header — tông SẠCH hơn game */}
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
            <div className="chip" style={{ marginTop: 6, fontSize: 10 }}>Card Passport · dữ liệu THẬT</div>
          </div>
          <button className="btn btn-ghost" style={{ padding: '4px 10px', alignSelf: 'flex-start' }} onClick={() => dispatch({ type: 'CLOSE_PASSPORT' })}>✕</button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Reference price (Index) */}
          <section>
            <SectionLabel>GIÁ THAM CHIẾU · RENAISS OS INDEX</SectionLabel>
            {loading ? <Skeleton /> : idx ? (
              <div className="panel" style={{ padding: 14, background: '#202734' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span className="tabnums" style={{ fontSize: 26, fontWeight: 900 }}>{cents(idx.priceUsdCents)}</span>
                  {idx.confidence && (
                    <span className="chip" style={{ borderColor: idx.confidence === 'high' ? 'var(--win)' : idx.confidence === 'low' ? 'var(--loss)' : 'var(--hairline-strong)' }}>
                      tin cậy: {idx.confidence}
                    </span>
                  )}
                </div>
                {idx.deltas && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12 }}>
                    <Delta label="7n" v={idx.deltas.d7} /><Delta label="30n" v={idx.deltas.d30} /><Delta label="365n" v={idx.deltas.d365} />
                  </div>
                )}
                <div className="caveat" style={{ marginTop: 10 }}>
                  {idx.observationCount ?? '—'} quan sát{idx.sourceCount ? ` · ${idx.sourceCount} nguồn` : ''}
                  {idx.lastSaleAt ? ` · bán gần nhất ${idx.lastSaleAt.slice(0, 10)}` : ''}.
                  Nguồn: <b>Renaiss OS Index</b>, tính đến {asOf.slice(0, 10)}.
                  {idx.observationCount != null && idx.observationCount < 10 ? ' Dữ liệu mỏng — tham chiếu thử nghiệm.' : ''}
                </div>
              </div>
            ) : (
              <p className="caveat">Chưa khớp được lá này với Renaiss OS Index (hoặc không có dữ liệu giá).</p>
            )}
          </section>

          {/* Custody */}
          <section>
            <SectionLabel>LƯU KÝ</SectionLabel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="chip">🏛 {collectible?.vaultLocation ?? card.vaultLocation ?? 'không rõ'}</span>
              <span className="chip">🌍 {collectible?.vaultRegionCountryCode ?? 'không rõ quốc gia'}</span>
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
              <p className="caveat">Không có dữ liệu hoạt động on-chain.</p>
            )}
          </section>

          {/* AI narration */}
          <section>
            <SectionLabel>
              PASSPORT AI {narr && <span className="chip" style={{ marginLeft: 8, fontSize: 9 }}>{narr.mode === 'ai' ? '🤖 LLM' : '📄 tóm tắt dữ liệu'}</span>}
            </SectionLabel>
            <div className="panel" style={{ padding: 14, background: '#202734' }}>
              {narrLoading ? <Skeleton lines={4} /> : narr ? (
                <>
                  <Narr text={narr.text} />
                  {narr.note && <p className="caveat" style={{ marginTop: 6, fontStyle: 'italic' }}>{narr.note}</p>}
                </>
              ) : <p className="caveat">Không tạo được diễn giải.</p>}
            </div>
          </section>

          {/* Chỉ số game (hư cấu) */}
          <section>
            <SectionLabel>CHỈ SỐ GAME (HƯ CẤU)</SectionLabel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <Stat k="ATK" v={card.atk} /><Stat k="DEF" v={card.def} /><Stat k="AURA" v={card.aura} />
              <Stat k="POWER" v={card.power} accent /><Stat k="TIER" v={card.tier} />
            </div>
            <p className="caveat">{STAT_FORMULA_NOTES.power} Chỉ số HƯ CẤU cho gameplay — KHÔNG phản ánh định giá tài sản / lời khuyên đầu tư.</p>
          </section>

          {/* Sở hữu THẬT — phễu hệ sinh thái */}
          <section>
            {!showReal ? (
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={loadReal}>✨ Làm sao sở hữu lá THẬT?</button>
            ) : (
              <div className="panel" style={{ padding: 14 }}>
                <SectionLabel>GÓI THẬT CỦA RENAISS</SectionLabel>
                <p className="caveat" style={{ marginBottom: 10 }}>
                  Đây là gói THẬT trên Renaiss (tốn USDT thật, cần ví) — TÁCH biệt hoàn toàn với gói mô phỏng trong game.
                  Mỗi gói có cơ hội trúng thẻ giám định như thế này.
                </p>
                {packs.length === 0 ? <Skeleton /> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {packs.filter((p) => p.stage === 'active').slice(0, 4).map((p) => (
                      <div key={p.slug} className="panel" style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, background: '#202734' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                          <div className="caveat">{p.packType ?? ''}{p.priceInUsdt ? ` · ${p.priceInUsdt} USDT` : ''}{p.expectedValueInUsd ? ` · EV ~$${p.expectedValueInUsd}` : ''}</div>
                        </div>
                      </div>
                    ))}
                    <a className="btn" style={{ textAlign: 'center', textDecoration: 'none' }} href="https://renaiss.xyz" target="_blank" rel="noreferrer">
                      Mở marketplace Renaiss ↗
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
