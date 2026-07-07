'use client';

import { useArena, useArenaDispatch, deckCards } from '@/app/arena/state';
import { openPack, PACK_COST } from '@/lib/game/gacha';
import { makePackSeed } from '@/lib/client/pack';

export function Result() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const battle = state.battle;
  const won = battle?.status === 'player_win';
  const reward = state.battleReward ?? 0;
  const deck = deckCards(state);

  function rematch() {
    dispatch({ type: 'GOTO', screen: 'deck' });
  }
  function openAnother() {
    if (state.pool.length === 0 || state.credits < PACK_COST) return;
    dispatch({ type: 'OPEN_PACK', reveal: openPack(state.pool, makePackSeed(state.packCount)) });
  }

  return (
    <div className="anim-fade" style={{ maxWidth: 640, margin: '0 auto', padding: '50px 22px', textAlign: 'center' }}>
      <div className={won ? 'anim-win' : 'anim-loss'} style={{ fontSize: 72 }}>{won ? '🏆' : '🛡️'}</div>
      <h1 style={{ fontSize: 34, margin: '10px 0 4px', color: won ? 'var(--win)' : 'var(--text)' }}>
        {won ? 'Chiến thắng!' : 'Thất bại'}
      </h1>
      <p style={{ color: 'var(--text-sub)' }}>
        {won ? 'Deck của bạn áp đảo — lựa chọn thuộc tính & khắc chế đã lên tiếng.' : 'Sát nút! Thử đổi thứ tự deck hoặc khai thác type-advantage.'}
      </p>

      <div className="panel" style={{ padding: 24, margin: '26px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-dim)' }}>PHẦN THƯỞNG</div>
        <div className="tabnums" style={{ fontSize: 40, fontWeight: 900, color: 'var(--accent)' }}>+{reward}</div>
        <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>credit ẢO · số dư mới: <b className="tabnums">{state.credits}</b></div>
        <p className="caveat" style={{ marginTop: 8 }}>Credit là ĐƠN VỊ TRONG GAME — không phải tiền thật, không quy đổi.</p>
      </div>

      {battle && (
        <div className="panel" style={{ padding: '14px 18px', marginBottom: 22, textAlign: 'left' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)', marginBottom: 6 }}>KHOẢNH KHẮC QUYẾT ĐỊNH</div>
          <p style={{ fontSize: 13, color: 'var(--text-sub)', margin: 0 }}>
            {battle.rounds[battle.rounds.length - 1]?.reason ?? 'Trận đấu deterministic — tái lập được từ deck + lựa chọn.'}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={openAnother} disabled={state.pool.length === 0 || state.credits < PACK_COST}>
          Mở gói · {PACK_COST}
        </button>
        <button className="btn" onClick={rematch} disabled={deck.length !== 5}>Đấu lại</button>
        <button className="btn btn-ghost" onClick={() => dispatch({ type: 'GOTO', screen: 'roster' })}>Bộ sưu tập</button>
      </div>
    </div>
  );
}
