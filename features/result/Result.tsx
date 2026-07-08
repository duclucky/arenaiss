'use client';

import { useArena, useArenaDispatch, deckCards } from '@/app/arena/state';
import { BATTLE_STAKE, WIN_REWARD } from '@/lib/game/gacha';

export function Result() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const battle = state.battle;
  const won = battle?.status === 'player_win';
  const reward = state.battleReward ?? 0;
  const deck = deckCards(state);

  return (
    <div className="anim-fade" style={{ maxWidth: 640, margin: '0 auto', padding: '50px 22px', textAlign: 'center' }}>
      <div className={won ? 'anim-win' : 'anim-loss'} style={{ fontSize: 42, fontWeight: 900 }}>
        {won ? 'WIN' : 'LOSS'}
      </div>
      <h1 style={{ fontSize: 34, margin: '10px 0 4px', color: won ? 'var(--win)' : 'var(--text)' }}>
        {won ? 'Victory!' : 'Defeat'}
      </h1>
      <p style={{ color: 'var(--text-sub)' }}>
        {won ? 'Your lineup won the stake battle.' : 'Your 100-credit stake was lost. Adjust the lineup and try again.'}
      </p>

      <div className="panel" style={{ padding: 24, margin: '26px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-dim)' }}>BATTLE PAYOUT</div>
        <div className="tabnums" style={{ fontSize: 40, fontWeight: 900, color: won ? 'var(--accent)' : 'var(--text-dim)' }}>
          {won ? `+${reward}` : '+0'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
          Stake paid before battle: <b className="tabnums">{BATTLE_STAKE}</b>.
          Winner payout: <b className="tabnums">{WIN_REWARD}</b>.
          New balance: <b className="tabnums">{state.credits}</b>.
        </div>
        <p className="caveat" style={{ marginTop: 8 }}>Credits are an in-game unit only: not real money and not redeemable.</p>
      </div>

      {battle && (
        <div className="panel" style={{ padding: '14px 18px', marginBottom: 22, textAlign: 'left' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)', marginBottom: 6 }}>DECIDING MOMENT</div>
          <p style={{ fontSize: 13, color: 'var(--text-sub)', margin: 0 }}>
            {battle.rounds[battle.rounds.length - 1]?.reason ?? 'The battle is deterministic from lineup order and stat choices.'}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => dispatch({ type: 'GOTO', screen: 'intro' })}>Gacha</button>
        <button className="btn" onClick={() => dispatch({ type: 'GOTO', screen: 'deck' })} disabled={deck.length !== 5}>Rematch</button>
        <button className="btn btn-ghost" onClick={() => dispatch({ type: 'GOTO', screen: 'roster' })}>Roster</button>
      </div>
    </div>
  );
}
