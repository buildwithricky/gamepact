import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MatchSnapshot } from '../../shared/types';

export interface BoardProps<V = any> {
  snap: MatchSnapshot;
  view: V;
  act(action: unknown): Promise<{ ok: boolean; error?: string }>;
  now: number;
  myTurn: boolean;
}

export const seatName = (snap: MatchSnapshot, seat: number | null | undefined) =>
  seat === null || seat === undefined ? '' : snap.you === seat ? 'You' : snap.seats[seat]?.user?.username ?? snap.seats[seat]?.bot ?? 'Player';

export function TurnLine({ snap, seat, children }: { snap: MatchSnapshot; seat: number | null | undefined; children?: ReactNode }) {
  if (snap.status !== 'IN_PROGRESS') return <div className="toast-line" />;
  const mine = seat === snap.you;
  return (
    <div className="toast-line" aria-live="polite" style={{ color: mine ? 'var(--word)' : 'var(--muted)' }}>
      {children ?? (mine ? 'Your turn' : `${seatName(snap, seat)}’s turn`)}
    </div>
  );
}

/** Canvas sized to its container with device-pixel-ratio scaling. `draw` receives a context in CSS pixels. */
export function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void, aspect: number, animate: boolean) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setSize({ w, h: w * aspect });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  const paint = useCallback((t: number) => {
    const el = ref.current;
    if (!el || !size.w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (el.width !== Math.round(size.w * dpr)) { el.width = Math.round(size.w * dpr); el.height = Math.round(size.h * dpr); }
    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    drawRef.current(ctx, size.w, size.h, t);
  }, [size]);

  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => { paint(t); if (animate) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paint, animate]);

  return { ref, size, repaint: () => paint(performance.now()) };
}

/** Animate a 0→1 progress whenever `key` changes. */
export function useTween(key: unknown, ms: number) {
  const [start, setStart] = useState<number | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setStart(performance.now());
  }, [key]);
  const progress = (t: number) => (start === null ? 1 : Math.min(1, (t - start) / ms));
  return { progress, running: (t: number) => start !== null && t - start < ms };
}

export const easeOut = (p: number) => 1 - (1 - p) ** 3;

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export const INK = '#0A0B24';
export const CHALK = '#FFFDF6';
export const COLORS = { arcade: '#FF5D73', board: '#8B7BFF', word: '#FFD23F', mint: '#2DE1C2', sky: '#4CB8FF', alert: '#FF8A3D' };
export const SEAT_COLORS = ['#FFD23F', '#4CB8FF', '#FF5D73', '#2DE1C2', '#8B7BFF', '#FF8A3D'];

/**
 * Aim-and-release control used by darts, archery and knockout.
 * Press to place the sight (drag to adjust); the sight "breathes"; release to shoot.
 * Keyboard: arrows move the sight, hold Space and release to shoot.
 */
export function useAim(opts: {
  enabled: boolean;
  toWorld(px: number, py: number): { x: number; y: number };
  onRelease(aim: { x: number; y: number; hold: number }): void;
  start: { x: number; y: number };
  touchOffsetPx?: number;
}) {
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null);
  const [holdStart, setHoldStart] = useState<number | null>(null);
  const kbAim = useRef(opts.start);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!opts.enabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const off = e.pointerType === 'touch' ? opts.touchOffsetPx ?? 70 : 0;
    setAim(opts.toWorld(e.clientX - r.left, e.clientY - r.top - off));
    setHoldStart(performance.now());
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (holdStart === null) return;
    const r = e.currentTarget.getBoundingClientRect();
    const off = e.pointerType === 'touch' ? opts.touchOffsetPx ?? 70 : 0;
    setAim(opts.toWorld(e.clientX - r.left, e.clientY - r.top - off));
  };
  const up = () => {
    if (holdStart === null || !aim) return;
    const hold = performance.now() - holdStart;
    setHoldStart(null);
    optsRef.current.onRelease({ x: aim.x, y: aim.y, hold });
    setAim(null);
  };
  const cancel = () => { setHoldStart(null); setAim(null); };

  useEffect(() => {
    if (!opts.enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const step = e.shiftKey ? 1 : 4;
      const k = kbAim.current;
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        kbAim.current = {
          x: k.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0),
          y: k.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0),
        };
        setAim(kbAim.current);
      } else if (e.key === ' ' && e.type === 'keydown' && !e.repeat) {
        e.preventDefault();
        setAim(kbAim.current);
        setHoldStart(performance.now());
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      e.preventDefault();
      setHoldStart((hs) => {
        if (hs !== null) optsRef.current.onRelease({ ...kbAim.current, hold: performance.now() - hs });
        return null;
      });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }, [opts.enabled]);

  return {
    aim, holdStart,
    handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: cancel },
  };
}
