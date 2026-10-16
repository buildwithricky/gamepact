import { useMemo, useRef, useState } from 'react';
import { ARCHERY, breathe, DARTS, KNOCKOUT, PONG, pongRack } from '../../shared/arcade';
import { BALL_R, COURSE_H, COURSE_W, CUP_R, HOLES } from '../../shared/golf';
import { CHALK, COLORS, easeOut, INK, SEAT_COLORS, seatName, TurnLine, useAim, useCanvas, useTween, type BoardProps } from './common';

function drawSight(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color = CHALK) {
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke();
  ctx.restore();
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, scale = 1) {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function AimHint({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <p className="tiny faint center">Press and hold to aim, drag to adjust, let go when the ring is smallest. Keyboard: arrows to aim, hold Space.</p>;
}

// ------------------------------------------------------------------ Darts

interface DartsView {
  mode: '301' | '501' | 'high'; scores: [number, number]; turn: number;
  current: { x: number; y: number; label: string; score: number }[];
  history: { darts: { label: string; score: number }[]; total: number; bust: boolean }[][];
  maxTurns: number; throwId: number; dartsLeft: number;
  last: { seat: number; aim: { x: number; y: number }; dart: { x: number; y: number; label: string; score: number }; bust: boolean } | null;
}

export function DartsBoard({ snap, view, act, myTurn }: BoardProps<DartsView>) {
  const R = DARTS.frame + 10;
  const tween = useTween(view.throwId, 320);
  const [pending, setPending] = useState(false);
  const geo = useRef({ w: 1, s: 1 });
  const aim = useAim({
    enabled: myTurn && !pending,
    start: { x: 0, y: -103 },
    toWorld: (px, py) => ({ x: (px - geo.current.w / 2) / geo.current.s, y: (py - geo.current.w / 2) / geo.current.s }),
    onRelease: async (a) => { setPending(true); await act(a); setPending(false); },
  });
  // Darts shown: this turn's darts; if the turn just ended, keep showing the last dart briefly.
  const shown = view.current.length ? view.current : view.last ? [view.last.dart] : [];

  const { ref } = useCanvas((ctx, w, _h, t) => {
    const s = w / (2 * R);
    geo.current = { w, s };
    const c = w / 2;
    ctx.save();
    ctx.translate(c, c);
    // surround
    ctx.fillStyle = '#1B1E4B';
    ctx.beginPath(); ctx.arc(0, 0, DARTS.frame * s, 0, Math.PI * 2); ctx.fill();
    // sectors
    const rings: [number, number, 'single' | 'double' | 'treble'][] = [
      [DARTS.doubleInner, DARTS.doubleOuter, 'double'], [DARTS.trebleOuter, DARTS.doubleInner, 'single'],
      [DARTS.trebleInner, DARTS.trebleOuter, 'treble'], [DARTS.bullOuter, DARTS.trebleInner, 'single'],
    ];
    for (let i = 0; i < 20; i++) {
      const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180, a1 = ((i * 18 + 9 - 90) * Math.PI) / 180;
      for (const [r0, r1, kind] of rings) {
        ctx.fillStyle = kind === 'single' ? (i % 2 ? CHALK : INK) : i % 2 ? COLORS.mint : COLORS.arcade;
        ctx.beginPath(); ctx.arc(0, 0, r1 * s, a0, a1); ctx.arc(0, 0, r0 * s, a1, a0, true); ctx.closePath(); ctx.fill();
      }
    }
    ctx.strokeStyle = '#8b8fbf'; ctx.lineWidth = 1;
    for (const r of [DARTS.doubleOuter, DARTS.doubleInner, DARTS.trebleOuter, DARTS.trebleInner]) { ctx.beginPath(); ctx.arc(0, 0, r * s, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = COLORS.mint; ctx.beginPath(); ctx.arc(0, 0, DARTS.bullOuter * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS.arcade; ctx.beginPath(); ctx.arc(0, 0, DARTS.bullInner * s, 0, Math.PI * 2); ctx.fill();
    // numbers
    ctx.fillStyle = CHALK; ctx.font = `${Math.max(11, 17 * s * 1.6)}px 'Lilita One', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    DARTS.sectors.forEach((n, i) => {
      const a = ((i * 18 - 90) * Math.PI) / 180;
      ctx.fillText(String(n), Math.cos(a) * 195 * s, Math.sin(a) * 195 * s);
    });
    // darts
    const p = easeOut(tween.progress(t));
    shown.forEach((d, i) => {
      const isLast = i === shown.length - 1 && view.last && d === (view.current.length ? view.current[view.current.length - 1] : view.last.dart);
      const k = isLast ? p : 1;
      const x = d.x * s, y = d.y * s + (1 - k) * 260 * s;
      const z = Math.max(1, w / 380);
      ctx.save();
      ctx.strokeStyle = INK; ctx.lineWidth = 3 * z;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 10 * z, y + 26 * z); ctx.stroke();
      ctx.fillStyle = SEAT_COLORS[view.last?.seat ?? 0]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 8 * z, y + 20 * z); ctx.lineTo(x + 20 * z, y + 26 * z); ctx.lineTo(x + 12 * z, y + 36 * z); ctx.closePath(); ctx.fill(); ctx.stroke();
      drawPin(ctx, x, y, SEAT_COLORS[view.last?.seat ?? 0], 0.9);
      ctx.restore();
    });
    if (aim.aim) {
      const hold = aim.holdStart !== null ? performance.now() - aim.holdStart : 0;
      drawSight(ctx, aim.aim.x * s, aim.aim.y * s, breathe(hold, DARTS.spread.period, DARTS.spread.min, DARTS.spread.max) * 1.2 * s, COLORS.word);
    }
    ctx.restore();
  }, 1, true);

  const lastTurn = (seat: number) => view.history[seat][view.history[seat].length - 1];
  return (
    <div className="board-wrap">
      <div className="board-hud">
        {[0, 1].map((seat) => (
          <div key={seat} className="stack" style={{ gap: 0, textAlign: seat ? 'right' : 'left' }}>
            <span className="tiny muted">{seatName(snap, seat)}</span>
            <span className="big-score num" style={{ color: SEAT_COLORS[seat] }}>{view.scores[seat]}</span>
            <span className="tiny faint">{lastTurn(seat) ? (lastTurn(seat).bust ? 'Bust' : `Last: ${lastTurn(seat).total}`) : `${view.mode === 'high' ? 'High score' : view.mode}`}</span>
          </div>
        ))}
      </div>
      <canvas ref={ref} className="board-canvas" style={{ cursor: myTurn ? 'crosshair' : 'default', background: 'transparent', border: 0, boxShadow: 'none' }} {...aim.handlers} aria-label="Dartboard" />
      <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 10 }}>
        {[0, 1, 2].map((i) => <span key={i} className="chip num" style={view.current[i] ? { background: 'var(--chalk)', color: 'var(--ink)' } : undefined}>{view.current[i]?.label ?? '–'}</span>)}
      </div>
      <TurnLine snap={snap} seat={view.turn}>
        {view.last?.bust && view.current.length === 0 ? `${seatName(snap, view.last.seat)} bust!` : myTurn ? `Your throw — ${view.dartsLeft} dart${view.dartsLeft === 1 ? '' : 's'} left` : undefined}
      </TurnLine>
      <AimHint enabled={myTurn} />
    </div>
  );
}

// ------------------------------------------------------------------ Archery

interface ArcheryView {
  ends: number; end: number; turn: number | null; scores: number[]; arrows: { x: number; y: number; score: number; end: number }[][];
  wind: { x: number; y: number }; throwId: number; last: { seat: number; arrow: { x: number; y: number; score: number } } | null;
  shootoff: { seats: number[]; round: number } | null; out: boolean[]; arrowsLeftInEnd: number;
}

const RING_COLORS = ['#FFD23F', '#FFD23F', '#FF5D73', '#FF5D73', '#4CB8FF', '#4CB8FF', '#1B1E4B', '#1B1E4B', CHALK, CHALK];

export function ArcheryBoard({ snap, view, act, myTurn }: BoardProps<ArcheryView>) {
  const tween = useTween(view.throwId, 380);
  const [pending, setPending] = useState(false);
  const geo = useRef({ w: 1, s: 1 });
  const aim = useAim({
    enabled: myTurn && !pending, start: { x: 0, y: 0 },
    toWorld: (px, py) => ({ x: (px - geo.current.w / 2) / geo.current.s, y: (py - geo.current.w / 2) / geo.current.s }),
    onRelease: async (a) => { setPending(true); await act(a); setPending(false); },
  });
  const windSpeed = Math.hypot(view.wind.x, view.wind.y);
  const { ref } = useCanvas((ctx, w, _h, t) => {
    const s = w / (2 * ARCHERY.field);
    geo.current = { w, s };
    ctx.save();
    ctx.fillStyle = '#20245a'; ctx.fillRect(0, 0, w, w);
    ctx.translate(w / 2, w / 2);
    for (let i = 9; i >= 0; i--) {
      ctx.fillStyle = RING_COLORS[i];
      ctx.beginPath(); ctx.arc(0, 0, (i + 1) * ARCHERY.ring * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = i >= 6 && i <= 7 ? '#5a5f9c' : INK; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, ARCHERY.radius * s, 0, Math.PI * 2); ctx.stroke();
    // arrows
    const p = easeOut(tween.progress(t));
    view.arrows.forEach((list, seat) => list.forEach((a, i) => {
      const isLast = view.last?.seat === seat && i === list.length - 1;
      if (isLast && p < 1) {
        const k = p;
        ctx.globalAlpha = k;
        drawPin(ctx, a.x * s, a.y * s + (1 - k) * 40, SEAT_COLORS[seat], 1 + (1 - k));
        ctx.globalAlpha = 1;
      } else drawPin(ctx, a.x * s, a.y * s, SEAT_COLORS[seat], 0.9);
    }));
    // wind arrow
    if (windSpeed > 0.05) {
      const ang = Math.atan2(view.wind.y, view.wind.x);
      ctx.save();
      ctx.translate(-ARCHERY.field * s + 34, -ARCHERY.field * s + 34);
      ctx.rotate(ang);
      ctx.strokeStyle = CHALK; ctx.lineWidth = 4; ctx.lineCap = 'round';
      const L = 8 + windSpeed * 6;
      ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.moveTo(L - 7, -6); ctx.lineTo(L, 0); ctx.lineTo(L - 7, 6); ctx.stroke();
      ctx.restore();
    }
    if (aim.aim) {
      const hold = aim.holdStart !== null ? performance.now() - aim.holdStart : 0;
      drawSight(ctx, aim.aim.x * s, aim.aim.y * s, breathe(hold, ARCHERY.spread.period, ARCHERY.spread.min, ARCHERY.spread.max) * 1.2 * s, COLORS.mint);
    }
    ctx.restore();
  }, 1, true);

  return (
    <div className="board-wrap">
      <div className="board-hud">
        {view.scores.map((sc, seat) => (
          <div key={seat} className="stack" style={{ gap: 0, opacity: view.out[seat] ? 0.4 : 1 }}>
            <span className="tiny muted">{seatName(snap, seat)}</span>
            <span className="big-score num" style={{ color: SEAT_COLORS[seat] }}>{sc}</span>
          </div>
        ))}
      </div>
      <canvas ref={ref} className="board-canvas" style={{ cursor: myTurn ? 'crosshair' : 'default' }} {...aim.handlers} aria-label="Archery target" />
      <div className="row between" style={{ marginTop: 10 }}>
        <span className="chip">{view.shootoff ? `Shoot-off ${view.shootoff.round}` : `End ${view.end} of ${view.ends}`}</span>
        <span className="chip">Wind {windSpeed.toFixed(1)} m/s</span>
        {view.last && <span className="chip num">{seatName(snap, view.last.seat)}: {view.last.arrow.score || 'Miss'}</span>}
      </div>
      <TurnLine snap={snap} seat={view.turn}>{myTurn ? 'Your shot — aim off to beat the wind' : undefined}</TurnLine>
      <AimHint enabled={myTurn} />
    </div>
  );
}

// ------------------------------------------------------------------ Knockout

interface KoView {
  lives: number[]; round: number; target: { x: number; y: number; r: number }; turn: number | null;
  roundShots: Record<string, boolean>; period: number; throwId: number;
  last: { seat: number; shot: { x: number; y: number }; hit: boolean } | null;
  lastRound: { round: number; hits: number[]; misses: number[]; replay: boolean } | null; out: boolean[];
}

export function KnockoutBoard({ snap, view, act, myTurn }: BoardProps<KoView>) {
  const tween = useTween(view.throwId, 900);
  const [pending, setPending] = useState(false);
  const geo = useRef({ w: 1, s: 1 });
  const aim = useAim({
    enabled: myTurn && !pending, start: { x: view.target.x, y: view.target.y },
    toWorld: (px, py) => ({ x: (px - geo.current.w / 2) / geo.current.s, y: (py - geo.current.w / 2) / geo.current.s }),
    onRelease: async (a) => { setPending(true); await act(a); setPending(false); },
  });
  const { ref } = useCanvas((ctx, w, _h, t) => {
    const s = w / (2 * (KNOCKOUT.field + 6));
    geo.current = { w, s };
    ctx.save();
    ctx.fillStyle = '#1d2058'; ctx.fillRect(0, 0, w, w);
    ctx.translate(w / 2, w / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (let r = 20; r <= 100; r += 20) { ctx.beginPath(); ctx.arc(0, 0, r * s, 0, Math.PI * 2); ctx.stroke(); }
    const { x, y, r } = view.target;
    ctx.fillStyle = COLORS.arcade; ctx.strokeStyle = INK; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = CHALK; ctx.beginPath(); ctx.arc(x * s, y * s, r * 0.55 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS.arcade; ctx.beginPath(); ctx.arc(x * s, y * s, r * 0.22 * s, 0, Math.PI * 2); ctx.fill();
    if (view.last) {
      const p = tween.progress(t);
      if (p < 1) {
        const color = view.last.hit ? COLORS.mint : COLORS.word;
        ctx.globalAlpha = 1 - p * 0.6;
        drawPin(ctx, view.last.shot.x * s, view.last.shot.y * s, color, 1.2);
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(view.last.shot.x * s, view.last.shot.y * s, 8 + p * 30, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (aim.aim) {
      const hold = aim.holdStart !== null ? performance.now() - aim.holdStart : 0;
      drawSight(ctx, aim.aim.x * s, aim.aim.y * s, breathe(hold, view.period, KNOCKOUT.spread.min, KNOCKOUT.spread.max) * 1.2 * s, COLORS.word);
    }
    ctx.restore();
  }, 1, true);
  const lr = view.lastRound;
  return (
    <div className="board-wrap">
      <div className="board-hud">
        {view.lives.map((l, seat) => (
          <div key={seat} className="stack" style={{ gap: 2, opacity: l === 0 || view.out[seat] ? 0.35 : 1 }}>
            <span className="tiny muted">{seatName(snap, seat)}{seat in view.roundShots ? (view.roundShots[seat] ? ' ✓' : ' ✗') : ''}</span>
            <span style={{ color: SEAT_COLORS[seat], fontSize: '1.3rem', letterSpacing: 2 }} aria-label={`${l} lives`}>{'●'.repeat(l)}<span className="faint">{'○'.repeat(Math.max(0, 3 - l))}</span></span>
          </div>
        ))}
      </div>
      <canvas ref={ref} className="board-canvas" style={{ cursor: myTurn ? 'crosshair' : 'default' }} {...aim.handlers} aria-label="Knockout target" />
      <div className="row between" style={{ marginTop: 10 }}>
        <span className="chip">Round {view.round}</span>
        {lr && <span className="chip">{lr.replay ? 'Everyone missed — replay' : lr.misses.length ? `${lr.misses.map((m) => seatName(snap, m)).join(', ')} lost a life` : 'Everyone hit'}</span>}
      </div>
      <TurnLine snap={snap} seat={view.turn}>{myTurn ? 'Your shot — hit the target or lose a life' : undefined}</TurnLine>
      <AimHint enabled={myTurn} />
    </div>
  );
}

// ------------------------------------------------------------------ Cup pong

interface PongView {
  racks: [number[], number[]]; turn: number; throwsLeft: number; throwId: number; turns: [number, number];
  last: { seat: number; land: { x: number; y: number }; cup: number | null; rim: boolean; ballsBack: boolean } | null;
}

export function CupPongBoard({ snap, view, act, myTurn }: BoardProps<PongView>) {
  const tween = useTween(view.throwId, 750);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [pending, setPending] = useState(false);
  const rack = useMemo(() => pongRack(), []);
  const shooter = view.last && tween.running(performance.now()) ? view.last.seat : view.turn;
  const defending = 1 - shooter;
  const ASPECT = 1.05;
  const sizeRef = useRef({ w: 1, h: 1 });

  const shot = (d: NonNullable<typeof drag>) => {
    const { w, h } = sizeRef.current;
    const angle = Math.max(-1, Math.min(1, (d.x - d.x0) / (0.45 * w))) * PONG.maxAngle;
    const power = Math.max(0, Math.min(1, (d.y0 - d.y) / (0.55 * h)));
    return { angle, power };
  };

  const { ref } = useCanvas((ctx, w, h, t) => {
    sizeRef.current = { w, h };
    // Camera looks down the far half of the table; the throwing end is squeezed into the bottom strip.
    const farY = h * 0.08, base = h * 0.8, cx = w / 2, px = (0.42 * w) / PONG.tableHalfWidth, near = 100, far = PONG.tableLength + 6;
    const k = (y: number) => 1 / (1 + Math.max(0, y - near) / 380);
    const proj = (x: number, y: number) => {
      const sy = y >= near ? base - ((y - near) / (far - near)) * (base - farY) : base + ((near - y) / near) * (h * 0.97 - base);
      const scale = y >= near ? k(y) : 1 + ((near - y) / near) * 0.25;
      return { x: cx + x * px * scale, y: sy };
    };
    // table
    const corners = [proj(-PONG.tableHalfWidth, 0), proj(PONG.tableHalfWidth, 0), proj(PONG.tableHalfWidth, PONG.tableLength), proj(-PONG.tableHalfWidth, PONG.tableLength)];
    ctx.fillStyle = '#2b3077'; ctx.strokeStyle = INK; ctx.lineWidth = 4;
    ctx.beginPath(); corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y))); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
    const m0 = proj(0, 0), m1 = proj(0, PONG.tableLength);
    ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y); ctx.stroke();
    // cups, far ones first
    const anim = view.last && tween.running(t);
    const standing = new Set(view.racks[defending]);
    if (anim && view.last!.cup !== null) standing.add(view.last!.cup);
    [...rack].sort((a, b) => b.y - a.y).forEach((c) => {
      if (!standing.has(c.id)) return;
      const p = proj(c.x, c.y), r = PONG.cupRadius * px * k(c.y) * 0.95;
      ctx.fillStyle = COLORS.arcade; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(p.x, p.y + r * 0.9, r * 0.82, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillRect(p.x - r * 0.82, p.y, r * 1.64, r * 0.9);
      ctx.beginPath(); ctx.moveTo(p.x - r * 0.82, p.y); ctx.lineTo(p.x - r * 0.82, p.y + r * 0.9); ctx.moveTo(p.x + r * 0.82, p.y); ctx.lineTo(p.x + r * 0.82, p.y + r * 0.9); ctx.stroke();
      ctx.fillStyle = CHALK; ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d9c35a'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 1, r * 0.72, r * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    });
    // ball
    const ballAt = (x: number, y: number, z: number) => {
      const p = proj(x, y), r = PONG.ballRadius * px * k(y) * 1.3;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = CHALK; ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y - z, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    };
    if (anim) {
      const p = tween.progress(t);
      const L = view.last!.land;
      ballAt(L.x * p, L.y * p, Math.sin(Math.PI * p) * h * 0.22);
    } else if (myTurn) {
      ballAt(0, 12, 0);
    }
    if (drag) {
      const s = shot(drag);
      const o = proj(0, 12);
      ctx.save();
      ctx.strokeStyle = COLORS.word; ctx.lineWidth = 4; ctx.setLineDash([8, 8]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + Math.sin(s.angle) * h * 0.4, o.y - Math.cos(s.angle) * h * 0.4); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(w - 26, h * 0.3, 12, h * 0.5);
      ctx.fillStyle = s.power > 0.85 ? COLORS.arcade : COLORS.word; ctx.fillRect(w - 26, h * 0.8 - h * 0.5 * s.power, 12, h * 0.5 * s.power);
    }
  }, ASPECT, true);

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!myTurn || pending) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const r = e.currentTarget.getBoundingClientRect();
      setDrag({ x0: e.clientX - r.left, y0: e.clientY - r.top, x: e.clientX - r.left, y: e.clientY - r.top });
    },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drag) return;
      const r = e.currentTarget.getBoundingClientRect();
      setDrag({ ...drag, x: e.clientX - r.left, y: e.clientY - r.top });
    },
    onPointerUp: async () => {
      if (!drag) return;
      const s = shot(drag);
      setDrag(null);
      if (s.power < 0.05) return;
      setPending(true);
      await act(s);
      setPending(false);
    },
    onPointerCancel: () => setDrag(null),
  };

  const left = (seat: number) => view.racks[seat].length;
  const msg = view.last && !tween.running(performance.now())
    ? view.last.cup !== null ? `${seatName(snap, view.last.seat)} sank one!${view.last.ballsBack ? ' Balls back!' : ''}` : view.last.rim ? 'Off the rim!' : null
    : null;
  return (
    <div className="board-wrap">
      <div className="board-hud">
        {[0, 1].map((seat) => (
          <div key={seat} className="stack" style={{ gap: 0, textAlign: seat ? 'right' : 'left' }}>
            <span className="tiny muted">{seatName(snap, seat)}</span>
            <span className="big-score num" style={{ color: SEAT_COLORS[seat] }}>{left(seat)}</span>
            <span className="tiny faint">cups left</span>
          </div>
        ))}
      </div>
      <canvas ref={ref} className="board-canvas" style={{ touchAction: 'none' }} {...handlers} aria-label={`Cup rack, ${left(defending)} cups`} />
      <TurnLine snap={snap} seat={view.turn}>{msg ?? (myTurn ? `Your throw — ${view.throwsLeft} ball${view.throwsLeft === 1 ? '' : 's'} left` : undefined)}</TurnLine>
      {myTurn && <p className="tiny faint center">Press anywhere and swipe up: sideways sets direction, length sets distance.</p>}
      {myTurn && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <KeyboardThrow onThrow={async (s) => { setPending(true); await act(s); setPending(false); }} />
        </div>
      )}
    </div>
  );
}

/** Accessible alternative to swiping. */
function KeyboardThrow({ onThrow }: { onThrow(s: { angle: number; power: number }): void }) {
  const [open, setOpen] = useState(false);
  const [angle, setAngle] = useState(0);
  const [power, setPower] = useState(0.6);
  if (!open) return <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Use sliders instead</button>;
  return (
    <div className="panel stack" style={{ width: '100%' }}>
      <label className="field"><span className="label">Direction</span><input type="range" min={-1} max={1} step={0.01} value={angle} onChange={(e) => setAngle(Number(e.target.value))} /></label>
      <label className="field"><span className="label">Distance</span><input type="range" min={0} max={1} step={0.01} value={power} onChange={(e) => setPower(Number(e.target.value))} /></label>
      <button className="btn btn-primary" onClick={() => onThrow({ angle: angle * PONG.maxAngle, power })}>Throw</button>
    </div>
  );
}

// ------------------------------------------------------------------ Mini golf

interface GolfView {
  hole: number; holeCount: number; balls: { x: number; y: number }[]; strokes: number[][]; holed: boolean[]; turn: number;
  throwId: number; last: { seat: number; hole: number; path: [number, number][]; sunk: boolean; water: boolean } | null; out: boolean[]; par: number[];
}

export function MiniGolfBoard({ snap, view, act, myTurn }: BoardProps<GolfView>) {
  const dur = Math.max(400, (view.last?.path.length ?? 0) * (1000 / 60));
  const tween = useTween(view.throwId, dur);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState(false);
  const scaleRef = useRef(1);
  const animHole = view.last && tween.running(performance.now()) ? view.last.hole : view.hole;
  const h = HOLES[animHole];
  const turnBall = view.balls[view.turn];

  const shotFrom = (d: { x: number; y: number }) => {
    const dx = turnBall.x - d.x, dy = turnBall.y - d.y;
    return { angle: Math.atan2(dy, dx), power: Math.min(1, Math.hypot(dx, dy) / 170) };
  };

  const { ref } = useCanvas((ctx, w, _h, t) => {
    const s = w / COURSE_W;
    scaleRef.current = s;
    ctx.save();
    ctx.scale(s, s);
    ctx.fillStyle = '#14163A'; ctx.fillRect(0, 0, COURSE_W, COURSE_H);
    // green
    ctx.beginPath(); h.outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.fillStyle = '#1e9c86'; ctx.fill();
    ctx.save(); ctx.clip();
    for (let y = 0; y < COURSE_H; y += 40) { ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, y, COURSE_W, 20); }
    for (const z of h.sand) { ctx.fillStyle = '#f2d27a'; ctx.beginPath(); ctx.roundRect(z.x, z.y, z.w, z.h, 14); ctx.fill(); }
    for (const z of h.water) { ctx.fillStyle = COLORS.sky; ctx.beginPath(); ctx.roundRect(z.x, z.y, z.w, z.h, 10); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; for (let x = z.x + 12; x < z.x + z.w - 10; x += 26) { ctx.beginPath(); ctx.moveTo(x, z.y + z.h / 2); ctx.quadraticCurveTo(x + 6, z.y + z.h / 2 - 6, x + 12, z.y + z.h / 2); ctx.stroke(); } }
    for (const z of h.slopes) {
      ctx.fillStyle = 'rgba(10,11,36,0.18)'; ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
      const a = Math.atan2(z.ay, z.ax);
      for (let yy = z.y + 30; yy < z.y + z.h; yy += 50) for (let xx = z.x + 30; xx < z.x + z.w; xx += 50) {
        ctx.save(); ctx.translate(xx, yy); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(0, 0); ctx.lineTo(-8, 6); ctx.stroke(); ctx.restore();
      }
    }
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 8; ctx.lineJoin = 'round';
    ctx.beginPath(); h.outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    for (const b of h.blocks) { ctx.fillStyle = '#313781'; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 4); ctx.fill(); ctx.lineWidth = 3; ctx.stroke(); }
    // cup + flag
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(h.cup.x, h.cup.y, CUP_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = CHALK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(h.cup.x, h.cup.y); ctx.lineTo(h.cup.x, h.cup.y - 46); ctx.stroke();
    ctx.fillStyle = COLORS.word; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(h.cup.x, h.cup.y - 46); ctx.lineTo(h.cup.x + 26, h.cup.y - 38); ctx.lineTo(h.cup.x, h.cup.y - 30); ctx.closePath(); ctx.fill(); ctx.stroke();
    // balls
    const anim = view.last && tween.running(t) ? view.last : null;
    view.balls.forEach((b, seat) => {
      if (view.out[seat]) return;
      if (animHole !== view.hole && !(anim && anim.seat === seat)) return;
      let pos = b;
      if (anim && anim.seat === seat) {
        const idx = Math.min(anim.path.length - 1, Math.floor(tween.progress(t) * (anim.path.length - 1)));
        pos = { x: anim.path[idx][0], y: anim.path[idx][1] };
      } else if (view.holed[seat] && animHole === view.hole) return;
      ctx.fillStyle = SEAT_COLORS[seat]; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, BALL_R + 1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    if (drag && myTurn) {
      const sh = shotFrom(drag);
      ctx.save();
      ctx.strokeStyle = sh.power > 0.85 ? COLORS.arcade : CHALK; ctx.lineWidth = 4; ctx.setLineDash([6, 8]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(turnBall.x, turnBall.y);
      ctx.lineTo(turnBall.x + Math.cos(sh.angle) * (30 + sh.power * 150), turnBall.y + Math.sin(sh.angle) * (30 + sh.power * 150)); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }, COURSE_H / COURSE_W, true);

  const toWorld = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scaleRef.current, y: (e.clientY - r.top) / scaleRef.current };
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => { if (!myTurn || pending) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(toWorld(e)); },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => { if (drag) setDrag(toWorld(e)); },
    onPointerUp: async () => {
      if (!drag) return;
      const sh = shotFrom(drag);
      setDrag(null);
      if (sh.power < 0.04) return;
      setPending(true);
      await act(sh);
      setPending(false);
    },
    onPointerCancel: () => setDrag(null),
  };
  const total = (seat: number) => view.strokes[seat].reduce((a, b) => a + b, 0);
  const parTotal = view.par.slice(0, view.hole + 1).reduce((a, b) => a + b, 0);

  return (
    <div className="board-wrap tall">
      <div className="board-hud">
        <span className="chip">Hole {view.hole + 1} of {view.holeCount} · par {HOLES[view.hole].par}</span>
        <span className="small muted">{HOLES[view.hole].name}</span>
      </div>
      <canvas ref={ref} className="board-canvas" {...handlers} aria-label={`Mini golf hole ${view.hole + 1}`} />
      <TurnLine snap={snap} seat={view.turn}>
        {view.last && !tween.running(performance.now()) && view.last.water ? `${seatName(snap, view.last.seat)} found the water — penalty stroke` : view.last?.sunk && !tween.running(performance.now()) ? `${seatName(snap, view.last.seat)} holed it!` : myTurn ? 'Drag back from anywhere and let go' : undefined}
      </TurnLine>
      <div className="panel" style={{ padding: 12, overflowX: 'auto' }}>
        <table className="table num small">
          <thead><tr><th>Hole</th>{view.par.map((_, i) => <th key={i}>{i + 1}</th>)}<th>Total</th></tr></thead>
          <tbody>
            <tr><td className="faint">Par</td>{view.par.map((p, i) => <td key={i} className="faint">{p}</td>)}<td className="faint">{view.par.reduce((a, b) => a + b, 0)}</td></tr>
            {view.strokes.map((st, seat) => (
              <tr key={seat} className={seat === snap.you ? 'me' : ''}>
                <td style={{ color: SEAT_COLORS[seat], fontWeight: 800 }}>{seatName(snap, seat)}</td>
                {view.par.map((_, i) => <td key={i}>{st[i] ?? ''}</td>)}
                <td><b>{total(seat)}</b> <span className="faint">({total(seat) - parTotal >= 0 ? '+' : ''}{total(seat) - parTotal})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {myTurn && <GolfSliders onShot={async (s) => { setPending(true); await act(s); setPending(false); }} />}
    </div>
  );
}

function GolfSliders({ onShot }: { onShot(s: { angle: number; power: number }): void }) {
  const [open, setOpen] = useState(false);
  const [angle, setAngle] = useState(-90);
  const [power, setPower] = useState(0.5);
  if (!open) return <div className="center" style={{ marginTop: 8 }}><button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Use sliders instead</button></div>;
  return (
    <div className="panel stack" style={{ marginTop: 8 }}>
      <label className="field"><span className="label">Direction ({angle}°)</span><input type="range" min={-180} max={180} value={angle} onChange={(e) => setAngle(Number(e.target.value))} /></label>
      <label className="field"><span className="label">Power ({Math.round(power * 100)}%)</span><input type="range" min={0.05} max={1} step={0.01} value={power} onChange={(e) => setPower(Number(e.target.value))} /></label>
      <button className="btn btn-primary" onClick={() => onShot({ angle: (angle * Math.PI) / 180, power })}>Putt</button>
    </div>
  );
}
