import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORY_LABEL, type GameMeta } from '../../shared/catalog';
import { AVATAR_COLORS, AVATAR_GLYPHS, type Avatar as AvatarT } from '../../shared/types';
import { useApp } from '../lib/app';
import { GameArt, Icons } from './art';

export function Avatar({ user, size = 40 }: { user: { username: string; avatar?: AvatarT } | null; size?: number }) {
  const a = user?.avatar ?? { color: 1, glyph: 4 };
  const c = AVATAR_COLORS[a.color % 8];
  return (
    <span className="avatar" style={{ ['--c' as string]: c, ['--size' as string]: `${size}px` }} aria-hidden="true">
      {(user?.username ?? '?').slice(0, 1).toUpperCase()}
      {size >= 32 && <span className="glyph">{AVATAR_GLYPHS[a.glyph % 8]}</span>}
    </span>
  );
}

export function UserLink({ user, size = 32, extra }: { user: { username: string; avatar?: AvatarT }; size?: number; extra?: ReactNode }) {
  return (
    <Link to={`/u/${user.username}`} className="row" style={{ textDecoration: 'none', gap: 10 }}>
      <Avatar user={user} size={size} />
      <span className="list-title">{user.username}</span>
      {extra}
    </Link>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog stack" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="row between">
          <h3>{title}</h3>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">{Icons.close}</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong style={{ color: 'var(--chalk)', fontSize: '1.05rem' }}>{title}</strong>
      {children && <div className="small">{children}</div>}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: NoInfer<T>; label: string }[]; onChange(v: NoInfer<T>): void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function GameToken({ game, playing }: { game: GameMeta; playing?: number }) {
  const soon = game.status !== 'live';
  return (
    <Link to={`/games/${game.id}`} className="game-token" data-cat={game.category} data-soon={soon}>
      <div className="art"><GameArt id={game.id} /></div>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <span className="name">{game.name}</span>
        {soon ? <span className="chip chip-warn">Soon</span> : playing ? <span className="chip chip-live">{playing} playing</span> : null}
      </div>
      <p className="small muted">{game.blurb}</p>
      <div className="meta">
        <span className={`chip chip-${game.category}`}>{CATEGORY_LABEL[game.category]}</span>
        <span className="chip">{game.minPlayers === game.maxPlayers ? `${game.maxPlayers} players` : `${Math.max(2, game.minPlayers)}–${game.maxPlayers} players`}</span>
        <span className="chip">{game.duration}</span>
      </div>
    </Link>
  );
}

export function MiniToken({ game }: { game: GameMeta }) {
  return (
    <Link to={`/games/${game.id}`} className="mini-token" data-cat={game.category}>
      <span className="disc"><GameArt id={game.id} /></span>
      {game.name}
    </Link>
  );
}

export function useNow(intervalMs = 250, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, active]);
  return now;
}

export function Confetti() {
  const colors = ['#FFD23F', '#FF5D73', '#8B7BFF', '#2DE1C2', '#4CB8FF'];
  const [pieces] = useState(() => Array.from({ length: 60 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.6, dur: 1.8 + Math.random() * 1.6, color: colors[i % colors.length], rot: Math.random() * 360,
  })));
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i key={i} style={{ left: `${p.left}%`, background: p.color, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ ads

declare global {
  interface Window { adsbygoogle?: unknown[]; adBreak?: (o: Record<string, unknown>) => void; adConfig?: (o: Record<string, unknown>) => void }
}

let adScript: Promise<void> | null = null;
function loadAdScript(client: string, test: boolean, interstitial: boolean) {
  adScript ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    s.crossOrigin = 'anonymous';
    if (test) s.setAttribute('data-adbreak-test', 'on');
    s.onload = () => {
      if (interstitial) {
        window.adBreak = window.adConfig = function (o: Record<string, unknown>) { (window.adsbygoogle = window.adsbygoogle || []).push(o); };
        window.adConfig({ preloadAdBreaks: 'on', sound: 'off' });
      }
      resolve();
    };
    s.onerror = () => reject(new Error('ad script blocked'));
    document.head.appendChild(s);
  });
  return adScript;
}

/**
 * A display ad placement. Renders nothing until the server says ads are live
 * (provider configured and the player threshold reached). Never used inside gameplay.
 */
export function AdSlot({ placement }: { placement: 'banner' | 'results' | 'sidebar' }) {
  const { config } = useApp();
  const ref = useRef<HTMLModElement>(null);
  const ads = config?.ads;
  const slot = ads?.enabled ? ads.slots[placement] : null;
  useEffect(() => {
    if (!ads?.enabled || !ads.client || !slot) return;
    let cancelled = false;
    loadAdScript(ads.client, ads.test, ads.interstitial)
      .then(() => { if (!cancelled && ref.current && !ref.current.dataset.adsbygoogleStatus) (window.adsbygoogle = window.adsbygoogle || []).push({}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ads, slot]);
  if (!ads?.enabled || !ads.client || !slot) return null;
  return (
    <div>
      <div className="ad-label">Advertisement</div>
      <ins
        ref={ref}
        className="adsbygoogle ad-slot"
        style={{ display: 'block' }}
        data-ad-client={ads.client}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
        {...(ads.test ? { 'data-adtest': 'on' } : {})}
      />
    </div>
  );
}

/** Between-match interstitial via Google's H5 Games Ads, when enabled. Resolves when it's safe to continue. */
export function showBreak(config: ReturnType<typeof useApp>['config'], name: string): Promise<void> {
  const ads = config?.ads;
  if (!ads?.enabled || !ads.interstitial || !ads.client) return Promise.resolve();
  return loadAdScript(ads.client, ads.test, true).then(() => new Promise<void>((resolve) => {
    const done = setTimeout(resolve, 15_000);
    window.adBreak?.({ type: 'next', name, adBreakDone: () => { clearTimeout(done); resolve(); } });
  })).catch(() => {});
}
