import { useId } from 'react';
import { PATHS } from './Icon';

// Code-drawn card artwork: a glowing type emblem over a type-specific scene.
// Each card name gets its own variation of the scene, and rarer cards get
// light rays, sparkles and more gems.

const GEMS = { Common: 1, Rare: 2, Epic: 3, Legendary: 4 };

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seq(seed) {
  let s = seed || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9;
    s ^= s >>> 13;
    return ((s >>> 0) % 1000) / 1000;
  };
}

function Scene({ type, r }) {
  if (type === 'Fire') {
    return (
      <g className="ca-scene">
        {Array.from({ length: 7 }, (_, i) => {
          const x = 8 + i * 24 + r() * 8;
          const h = 26 + r() * 40;
          return <path key={i} d={`M${x - 10} 100 C${x - 8} ${100 - h * 0.6} ${x + 4} ${100 - h * 0.7} ${x} ${100 - h} C${x + 10} ${100 - h * 0.55} ${x + 12} ${100 - h * 0.3} ${x + 10} 100Z`} />;
        })}
      </g>
    );
  }
  if (type === 'Water') {
    return (
      <g className="ca-scene ca-lines">
        {Array.from({ length: 5 }, (_, i) => {
          const y = 30 + i * 16 + r() * 6;
          const a = 4 + r() * 6;
          return <path key={i} d={`M-5 ${y} Q 15 ${y - a} 35 ${y} T 75 ${y} T 115 ${y} T 155 ${y} T 195 ${y}`} />;
        })}
        {Array.from({ length: 6 }, (_, i) => <circle key={`b${i}`} cx={10 + r() * 140} cy={15 + r() * 60} r={1.2 + r() * 2.2} className="ca-bubble" />)}
      </g>
    );
  }
  if (type === 'Earth') {
    const ridge = (base, amp) => {
      let d = `M-5 100 L-5 ${base}`;
      for (let x = 0; x <= 170; x += 17) d += ` L${x} ${base - r() * amp}`;
      return `${d} L170 100Z`;
    };
    return (
      <g className="ca-scene">
        <path className="far" d={ridge(62, 34)} />
        <path d={ridge(84, 22)} />
        {Array.from({ length: 4 }, (_, i) => {
          const x = 15 + r() * 130;
          return <polygon key={i} className="ca-rock" points={`${x},92 ${x + 6},${84 - r() * 6} ${x + 13},92`} />;
        })}
      </g>
    );
  }
  return (
    <g className="ca-scene ca-lines">
      {Array.from({ length: 4 }, (_, i) => {
        const y = 22 + i * 19 + r() * 6;
        const x = 10 + r() * 50;
        return <path key={i} d={`M${x - 30} ${y} C${x + 20} ${y - 10} ${x + 60} ${y + 8} ${x + 90} ${y - 2} q 14 -6 8 -14 q -6 -6 -12 2`} />;
      })}
    </g>
  );
}

export default function CardArt({ card }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const r = seq(hash(`${card.name}:${card.type}`));
  const rarityIndex = GEMS[card.rarity] || 1;
  const sparkles = Array.from({ length: rarityIndex * 2 - 1 }, () => ({ x: 12 + r() * 136, y: 8 + r() * 58, s: 1.5 + r() * 2.5 }));
  const tilt = (r() - 0.5) * 14;

  return (
    <svg className="card-art" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id={`bg${uid}`} cx="50%" cy="45%" r="75%">
          <stop offset="0%" className="ca-bg-in" />
          <stop offset="100%" className="ca-bg-out" />
        </radialGradient>
        <filter id={`glow${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width="160" height="100" fill={`url(#bg${uid})`} />
      {rarityIndex >= 3 && (
        <g className="ca-rays">
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} transform={`rotate(${i * 30 + tilt} 80 48)`} d="M80 48 L76 -20 L84 -20Z" />
          ))}
        </g>
      )}
      <Scene type={card.type} r={r} />
      <circle cx="80" cy="47" r="27" className="ca-halo" />
      <g filter={`url(#glow${uid})`} transform={`translate(80 47) rotate(${tilt / 2}) scale(2.1) translate(-12 -12)`} className="ca-emblem">
        {PATHS[card.type]}
      </g>
      {sparkles.map((p, i) => (
        <path key={i} className="ca-sparkle"
          d={`M${p.x} ${p.y - p.s * 2} L${p.x + p.s * 0.5} ${p.y - p.s * 0.5} L${p.x + p.s * 2} ${p.y} L${p.x + p.s * 0.5} ${p.y + p.s * 0.5} L${p.x} ${p.y + p.s * 2} L${p.x - p.s * 0.5} ${p.y + p.s * 0.5} L${p.x - p.s * 2} ${p.y} L${p.x - p.s * 0.5} ${p.y - p.s * 0.5}Z`} />
      ))}
      <g className="ca-gems">
        {Array.from({ length: rarityIndex }, (_, i) => {
          const x = 80 + (i - (rarityIndex - 1) / 2) * 11;
          return <path key={i} d={`M${x} 86 L${x + 4} 91 L${x} 96 L${x - 4} 91Z`} />;
        })}
      </g>
    </svg>
  );
}
