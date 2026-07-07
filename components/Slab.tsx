'use client';

import { memo, useEffect, useState } from 'react';
import type { GameCard } from '@/lib/game/stats';
import { ELEMENT_GLYPH, imageUrlFromSerial } from '@/lib/game/stats';
import type { StatKey } from '@/lib/game/battle';

// SLAB — mỗi quân bài là một "slab giám định số": thanh tier phát sáng, nhãn
// grade, ảnh thẻ THẬT ở giữa, chỉ số game phủ như HUD. (docs/art-direction.md)

interface SlabProps {
  card: GameCard;
  onClick?: (card: GameCard) => void;
  selected?: boolean;
  defeated?: boolean;
  highlightStat?: StatKey | null;
  interactive?: boolean;
  reveal?: boolean; // animation trồi lên (pack open)
  revealDelayMs?: number;
}

function shortName(name: string): string {
  return name.length > 46 ? name.slice(0, 44) + '…' : name;
}

function SlabBase({ card, onClick, selected, defeated, highlightStat, interactive = true, reveal, revealDelayMs = 0 }: SlabProps) {
  // Ảnh dựng từ serial; nếu 404 → thử lần lượt các biến thể (silver/golden) → noart.
  const [variant, setVariant] = useState(0);
  useEffect(() => { setVariant(0); }, [card.imageUrl, card.serial]);
  const imgSrc = variant === 0 ? card.imageUrl : imageUrlFromSerial(card.serial, variant);
  function onImgError() { setVariant((v) => v + 1); }

  const stats: { key: StatKey; label: string; value: number }[] = [
    { key: 'atk', label: 'ATK', value: card.atk },
    { key: 'def', label: 'DEF', value: card.def },
    { key: 'aura', label: 'AURA', value: card.aura },
  ];
  return (
    <div
      className={`slab${interactive ? ' interactive' : ''}${selected ? ' selected' : ''}${defeated ? ' defeated' : ''}${reveal ? ' anim-rise' : ''}`}
      data-tier={card.tier}
      style={reveal ? { animationDelay: `${revealDelayMs}ms` } : undefined}
      onClick={onClick ? () => onClick(card) : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(card); } } : undefined}
      title={card.name}
    >
      <div className="slab-tierbar" />
      <div className="slab-label">
        <div>
          <div className="slab-name">{shortName(card.name)}</div>
          <div className="slab-cert mono">
            {card.gradingCompany ?? 'RAW'} · {card.year ?? '—'} · #{card.tokenId.slice(0, 6)}
          </div>
        </div>
        <div className="slab-grade">
          {card.gradeNum ?? '—'}
          <small>{card.tier}</small>
        </div>
      </div>

      <div className="slab-art">
        <span className="slab-element" title={card.element}>{ELEMENT_GLYPH[card.element]}</span>
        {imgSrc ? (
          // ảnh thẻ THẬT từ Renaiss (lazy-load). Dùng <img> để tránh cấu hình domain.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgSrc} alt={card.name} loading="lazy" onError={onImgError} />
        ) : (
          <div className="noart">{card.pokemonName || card.name.split(' ').slice(-2).join(' ')}</div>
        )}
        <span className="specular" />
      </div>

      <div className="slab-stats">
        {stats.map((s) => (
          <div key={s.key} className={`slab-stat${highlightStat === s.key ? ' hot' : ''}`}>
            <div className="k">{s.label}</div>
            <div className="v tabnums">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="slab-power">
        <span className="lbl">POWER</span>
        <span className="val tabnums">{card.power}</span>
      </div>
    </div>
  );
}

export const Slab = memo(SlabBase);
