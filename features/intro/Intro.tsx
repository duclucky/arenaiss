'use client';

import { useArena, useArenaDispatch } from '@/app/arena/state';
import { TierLegend } from '@/components/TierLegend';
import { oddsTable, openPack, PACK_COST } from '@/lib/game/gacha';
import { makePackSeed } from '@/lib/client/pack';
import type { Category } from '@/lib/client/api';

const CATEGORIES: { id: Category; label: string; glyph: string }[] = [
  { id: 'POKEMON', label: 'Pokémon', glyph: '⚡' },
  { id: 'ONE_PIECE', label: 'One Piece', glyph: '🏴‍☠️' },
];

export function Intro() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const rows = oddsTable(state.pool);
  const ready = state.pool.length > 0 && !state.poolLoading;
  const canOpen = ready && state.credits >= PACK_COST;

  function openFirst() {
    if (!canOpen) return;
    const reveal = openPack(state.pool, makePackSeed(state.packCount));
    dispatch({ type: 'OPEN_PACK', reveal });
  }

  return (
    <div className="anim-fade" style={{ maxWidth: 980, margin: '0 auto', padding: '34px 22px 60px' }}>
      <div style={{ textAlign: 'center', marginBottom: 30 }}>
        <div className="anim-float" style={{ fontSize: 60, marginBottom: 8 }}>🗝️</div>
        <h1 style={{ fontSize: 34, margin: '0 0 8px', letterSpacing: '-0.01em' }}>
          Vào phòng chờ <span style={{ color: 'var(--accent)' }}>Vault</span>
        </h1>
        <p style={{ color: 'var(--text-sub)', maxWidth: 620, margin: '0 auto', lineHeight: 1.6 }}>
          Mở gói theo odds tham chiếu → nhận <b>mẫu thẻ giám định thật</b> vào bộ sưu tập → lắp deck →
          đấu Top-Trumps <b>có skill</b>. Thắng để nhận credit ẢO mở tiếp. Mỗi lá dẫn tới Card Passport thật.
        </p>
      </div>

      {/* Nhãn an toàn */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 26 }}>
        <span className="chip chip-sim">💠 Mở gói MÔ PHỎNG — không tốn tiền thật</span>
        <span className="chip chip-warn">⚠ Chỉ số game HƯ CẤU — không phải định giá / lời khuyên đầu tư</span>
        <span className="chip">🔒 Read-only · không ký ví · không on-chain</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        {/* Chọn dòng thẻ */}
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-sub)' }}>DÒNG THẺ</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className="btn"
                style={{
                  flex: 1, flexDirection: 'column', display: 'flex', gap: 6, padding: '16px 10px',
                  borderColor: state.category === c.id ? 'var(--accent)' : 'var(--hairline)',
                  background: state.category === c.id ? 'var(--accent-soft)' : 'var(--raised)',
                }}
                onClick={() => dispatch({ type: 'SET_CATEGORY', category: c.id })}
              >
                <span style={{ fontSize: 26 }}>{c.glyph}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
          <p className="caveat" style={{ marginTop: 14 }}>
            Pool minh hoạ lấy từ <b>marketplace Renaiss thật</b> ({state.poolLoading ? 'đang tải…' : `${state.pool.length} thẻ`}).
          </p>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 10, padding: '15px', fontSize: 16 }}
            disabled={!canOpen}
            onClick={openFirst}
          >
            {state.poolLoading ? 'Đang mở tủ…' : state.credits < PACK_COST ? 'Không đủ credit' : `Mở gói đầu tiên · ${PACK_COST} credit`}
          </button>
          {state.poolError && <p className="caveat" style={{ color: 'var(--loss)', marginTop: 8 }}>Lỗi tải pool: {state.poolError}</p>}
        </div>

        {/* Bảng odds minh bạch */}
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-sub)' }}>ODDS THEO TIER</h3>
          <p className="caveat" style={{ marginBottom: 12 }}>
            Odds <b>ước lượng từ thành phần pool marketplace thật</b>. Gacha odds on-chain chưa công khai ở API alpha —
            xem README. Đây là tham chiếu thử nghiệm, không phải sự thật thị trường.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {rows.map((r) => (
              <div key={r.tier} data-tier={r.tier} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 40, fontWeight: 800, color: 'var(--tier)', fontSize: 13 }}>{r.tier}</span>
                <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(2, r.chance * 100)}%`, height: '100%', background: 'var(--tier)', boxShadow: '0 0 8px var(--tier)' }} />
                </div>
                <span className="tabnums" style={{ width: 46, textAlign: 'right', fontSize: 12, color: 'var(--text-sub)' }}>{(r.chance * 100).toFixed(0)}%</span>
                <span className="tabnums" style={{ width: 60, textAlign: 'right', fontSize: 10, color: 'var(--text-dim)' }}>{r.poolCount} thẻ</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--hairline)' }}>
            <TierLegend />
          </div>
        </div>
      </div>
    </div>
  );
}
