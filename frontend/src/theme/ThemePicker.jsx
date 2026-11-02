import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { useTheme } from './ThemeContext';

export default function ThemePicker({ className = '' }) {
  const { theme, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = themes.find((t) => t.id === theme) || themes[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`theme-picker ${className}`} ref={ref}>
      <button type="button" className="ghost theme-button" aria-haspopup="true" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <Icon name="palette" size={16} />
        Theme: {current.name}
      </button>
      {open && (
        <div className="theme-menu" role="radiogroup" aria-label="Choose a theme">
          {themes.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={t.id === theme}
              className={t.id === theme ? 'theme-option active' : 'theme-option'}
              onClick={() => { setTheme(t.id); setOpen(false); }}>
              <span className="theme-swatch" aria-hidden="true"
                style={{ background: `linear-gradient(135deg, ${t.colors[0]} 0 34%, ${t.colors[1]} 34% 67%, ${t.colors[2]} 67%)` }} />
              <span>{t.name}</span>
              {t.id === theme && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
