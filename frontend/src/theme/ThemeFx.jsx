import { useTheme } from './ThemeContext';

// Background decoration for each theme: drifting particles and a few large
// ornaments. Purely visual, sits behind the content and ignores the mouse.

const PARTICLES = { forge: 26, forest: 22, frost: 48, infernal: 30 };

// Deterministic pseudo-random numbers so particles keep their places between renders.
function rand(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function Gear({ className, teeth = 12 }) {
  const points = [];
  for (let i = 0; i < teeth * 2; i++) {
    const a = (Math.PI * i) / teeth;
    const r = i % 2 === 0 ? 50 : 42;
    points.push(`${60 + r * Math.cos(a)},${60 + r * Math.sin(a)}`);
  }
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <polygon points={points.join(' ')} />
      <circle cx="60" cy="60" r="28" className="gear-hole" />
      <circle cx="60" cy="60" r="10" />
    </svg>
  );
}

function Vine({ className }) {
  return (
    <svg className={className} viewBox="0 0 220 220" aria-hidden="true">
      <path className="vine-stem" d="M0 10 C60 20 70 70 120 80 S190 120 210 210" />
      <path className="vine-stem" d="M10 0 C20 60 60 80 70 140" />
      {[[40, 22, -20], [95, 72, 30], [150, 108, -35], [190, 160, 40], [22, 60, 60], [55, 110, -50]].map(([x, y, r]) => (
        <path key={`${x}-${y}`} className="vine-leaf" transform={`translate(${x} ${y}) rotate(${r})`}
          d="M0 0 C8 -12 22 -12 28 0 C22 10 8 10 0 0Z" />
      ))}
    </svg>
  );
}

function Icicles({ className }) {
  const drops = [];
  for (let i = 0; i < 40; i++) {
    const x = i * 25 + rand(i, 3) * 10;
    const h = 14 + rand(i, 4) * 46;
    drops.push(`M${x} 0 L${x + 6} ${h} L${x + 12} 0Z`);
  }
  return (
    <svg className={className} viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
      <path d={drops.join(' ')} />
    </svg>
  );
}

function Mountains({ className }) {
  return (
    <svg className={className} viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
      <path className="far" d="M0 200 L0 120 L90 70 L170 110 L260 40 L360 120 L450 80 L540 130 L640 50 L740 120 L830 90 L920 130 L1000 100 L1000 200Z" />
      <path className="near" d="M0 200 L0 160 L120 120 L220 160 L330 110 L430 170 L560 120 L680 170 L800 130 L900 170 L1000 140 L1000 200Z" />
    </svg>
  );
}

export default function ThemeFx() {
  const { theme } = useTheme();
  const count = PARTICLES[theme] || 0;
  if (!count) return null;

  const particles = Array.from({ length: count }, (_, i) => ({
    left: `${(rand(i, 1) * 100).toFixed(2)}%`,
    top: `${(rand(i, 7) * 100).toFixed(2)}%`,
    size: `${(theme === 'frost' ? 2 + rand(i, 2) * 4 : 2 + rand(i, 2) * 3).toFixed(1)}px`,
    delay: `${(-rand(i, 5) * 14).toFixed(2)}s`,
    duration: `${(8 + rand(i, 6) * 10).toFixed(2)}s`,
    drift: `${((rand(i, 8) - 0.5) * 120).toFixed(0)}px`,
  }));

  return (
    <div className={`theme-fx fx-${theme}`} aria-hidden="true">
      {theme === 'forge' && (
        <>
          <Gear className="fx-gear gear-a" teeth={14} />
          <Gear className="fx-gear gear-b" teeth={10} />
          <Gear className="fx-gear gear-c" teeth={16} />
          <div className="fx-furnace" />
        </>
      )}
      {theme === 'forest' && (
        <>
          <Vine className="fx-vine vine-a" />
          <Vine className="fx-vine vine-b" />
          <div className="fx-canopy" />
        </>
      )}
      {theme === 'frost' && (
        <>
          <Icicles className="fx-icicles" />
          <Mountains className="fx-mountains" />
        </>
      )}
      {theme === 'infernal' && <div className="fx-hellfire" />}
      {particles.map((p, i) => (
        <span key={i} className="fx-p"
          style={{ left: p.left, top: p.top, width: p.size, height: p.size, animationDelay: p.delay,
            animationDuration: p.duration, '--drift': p.drift }} />
      ))}
    </div>
  );
}
