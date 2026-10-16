import { ARCHERY, breathe, scoreArrow } from '../../shared/arcade';
import { botHold, readAim, round2, scatter } from './aim';
import type { Ctx, Engine } from './types';
import { clone, rankSeats, resultKind } from './types';

const SHOT_MS = 20_000;
const ARROWS_PER_END = 2;

interface Arrow { x: number; y: number; score: number; end: number }

export interface ArcheryState {
  n: number;
  ends: number;
  end: number;
  queue: number[];
  scores: number[];
  arrows: Arrow[][];
  wind: { x: number; y: number };
  shotStartedAt: number;
  throwId: number;
  last: { seat: number; aim: { x: number; y: number }; arrow: Arrow; wind: { x: number; y: number } } | null;
  out: boolean[];
  strikes: number[];
  shootoff: { seats: number[]; dist: Record<number, number>; round: number } | null;
  finished: boolean;
}

function newWind(ctx: Ctx) {
  const a = ctx.rand() * Math.PI * 2;
  const v = ctx.rand() * 3.5;
  return { x: round2(Math.cos(a) * v), y: round2(Math.sin(a) * v) };
}

const active = (s: ArcheryState) => s.scores.map((_, i) => i).filter((i) => !s.out[i]);

function buildQueue(s: ArcheryState) {
  const q: number[] = [];
  for (let k = 0; k < ARROWS_PER_END; k++) q.push(...active(s));
  return q;
}

function advance(s: ArcheryState, ctx: Ctx) {
  s.wind = newWind(ctx);
  s.shotStartedAt = ctx.now;
  if (s.queue.length > 0) return;
  if (s.shootoff) {
    const d = s.shootoff.dist;
    const best = Math.min(...s.shootoff.seats.map((x) => d[x]));
    const still = s.shootoff.seats.filter((x) => d[x] === best);
    if (still.length === 1) { s.finished = true; return; }
    s.shootoff = { seats: still, dist: {}, round: s.shootoff.round + 1 };
    s.queue = [...still];
    return;
  }
  if (s.end < s.ends) { s.end++; s.queue = buildQueue(s); return; }
  const alive = active(s);
  const top = Math.max(...alive.map((i) => s.scores[i]));
  const tied = alive.filter((i) => s.scores[i] === top);
  if (tied.length > 1) { s.shootoff = { seats: tied, dist: {}, round: 1 }; s.queue = [...tied]; return; }
  s.finished = true;
}

function shoot(s: ArcheryState, seat: number, aim: { x: number; y: number; hold: number }, ctx: Ctx) {
  const spread = breathe(aim.hold, ARCHERY.spread.period, ARCHERY.spread.min, ARCHERY.spread.max);
  const p = scatter(ctx, aim.x + s.wind.x * ARCHERY.driftPerWind, aim.y + s.wind.y * ARCHERY.driftPerWind, spread);
  const arrow: Arrow = { x: round2(p.x), y: round2(p.y), score: scoreArrow(p.x, p.y), end: s.shootoff ? 0 : s.end };
  s.arrows[seat].push(arrow);
  s.throwId++;
  s.last = { seat, aim: { x: round2(aim.x), y: round2(aim.y) }, arrow, wind: s.wind };
  if (s.shootoff) s.shootoff.dist[seat] = Math.hypot(p.x, p.y);
  else s.scores[seat] += arrow.score;
  s.queue.shift();
  advance(s, ctx);
}

export const archery: Engine<ArcheryState> = {
  id: 'archery',
  minPlayers: 2,
  maxPlayers: 4,
  init(n, options, ctx) {
    const s: ArcheryState = {
      n, ends: options.ends === '3' ? 3 : 5, end: 1, queue: [], scores: Array(n).fill(0),
      arrows: Array.from({ length: n }, () => []), wind: newWind(ctx), shotStartedAt: ctx.now, throwId: 0,
      last: null, out: Array(n).fill(false), strikes: Array(n).fill(0), shootoff: null, finished: false,
    };
    s.queue = buildQueue(s);
    return s;
  },
  start(s, ctx) { return { ...s, shotStartedAt: ctx.now }; },
  act(state, seat, raw, ctx) {
    if (state.finished) return 'The match is over.';
    if (state.queue[0] !== seat) return 'Wait for your turn.';
    const aim = readAim(raw, ARCHERY.field);
    if (!aim) return 'Invalid shot.';
    const s = clone(state);
    s.strikes[seat] = 0;
    shoot(s, seat, aim, ctx);
    return s;
  },
  view(s) {
    return {
      ends: s.ends, end: s.end, turn: s.queue[0] ?? null, scores: s.scores, arrows: s.arrows, wind: s.wind,
      throwId: s.throwId, last: s.last, shootoff: s.shootoff ? { seats: s.shootoff.seats, round: s.shootoff.round } : null,
      out: s.out, arrowsLeftInEnd: s.queue.length,
    };
  },
  outcome(s) {
    if (!s.finished) return null;
    const alive = active(s);
    const ranking = rankSeats(alive, (a, b) => {
      if (s.scores[a] !== s.scores[b]) return s.scores[a] - s.scores[b];
      const da = s.shootoff?.dist[a], db = s.shootoff?.dist[b];
      if (da === undefined || db === undefined) return 0;
      return Math.sign(db - da);
    });
    const w = ranking[0][0];
    return {
      kind: resultKind(ranking), ranking, scores: s.scores,
      summary: `${s.scores[w]} points`, reason: s.shootoff ? 'Won the shoot-off' : alive.length === 1 ? 'Last archer standing' : 'Highest score',
    };
  },
  deadline(s) { return s.finished ? null : { seat: s.queue[0], at: s.shotStartedAt + SHOT_MS }; },
  onDeadline(state, ctx) {
    const s = clone(state);
    const seat = s.queue[0];
    s.strikes[seat]++;
    if (s.strikes[seat] >= 3) return archery.drop!(s, seat, ctx);
    shoot(s, seat, { x: 0, y: 1000, hold: 0 }, ctx);
    return s;
  },
  drop(state, seat, ctx) {
    const s = clone(state);
    s.out[seat] = true;
    const wasTurn = s.queue[0] === seat;
    s.queue = s.queue.filter((x) => x !== seat);
    if (s.shootoff) s.shootoff.seats = s.shootoff.seats.filter((x) => x !== seat);
    if (active(s).length <= 1) { s.finished = true; return s; }
    if (wasTurn || s.queue.length === 0) advance(s, ctx);
    return s;
  },
  bot(s, seat, ctx) {
    if (s.finished || s.queue[0] !== seat) return null;
    const k = ARCHERY.driftPerWind;
    return {
      x: -s.wind.x * k + ctx.gauss() * 3, y: -s.wind.y * k + ctx.gauss() * 3,
      hold: botHold(ctx, ARCHERY.spread.period, 0.75),
    };
  },
};
