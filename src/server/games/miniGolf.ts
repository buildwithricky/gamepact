import { HOLES, MAX_STROKES, simulate } from '../../shared/golf';
import type { Ctx, Engine } from './types';
import { clone, rankSeats, resultKind } from './types';

const SHOT_MS = 30_000;

export interface GolfState {
  n: number;
  holeCount: number;
  hole: number;
  balls: { x: number; y: number }[];
  strokes: number[][];
  holed: boolean[];
  turn: number;
  shotStartedAt: number;
  throwId: number;
  last: { seat: number; hole: number; path: [number, number][]; sunk: boolean; water: boolean } | null;
  out: boolean[];
  strikes: number[];
  finished: boolean;
}

const tee = (h: number) => ({ ...HOLES[h].tee });
const total = (s: GolfState, seat: number) => s.strokes[seat].reduce((a, b) => a + b, 0);

function nextPlayer(s: GolfState, from: number): number | null {
  for (let k = 1; k <= s.n; k++) {
    const i = (from + k) % s.n;
    if (!s.out[i] && !s.holed[i]) return i;
  }
  return null;
}

function afterShot(s: GolfState, ctx: Ctx) {
  const next = nextPlayer(s, s.turn);
  if (next !== null) { s.turn = next; s.shotStartedAt = ctx.now; return; }
  if (s.hole + 1 >= s.holeCount) { s.finished = true; return; }
  s.hole++;
  for (let i = 0; i < s.n; i++) { s.balls[i] = tee(s.hole); s.holed[i] = s.out[i]; s.strokes[i].push(0); }
  s.turn = nextPlayer(s, -1 + s.n) ?? 0;
  s.shotStartedAt = ctx.now;
}

function stroke(s: GolfState, seat: number, angle: number, power: number, ctx: Ctx) {
  const h = HOLES[s.hole];
  const res = simulate(h, s.balls[seat], angle, power);
  s.strokes[seat][s.hole] += res.water ? 2 : 1;
  s.balls[seat] = res.end;
  s.throwId++;
  s.last = { seat, hole: s.hole, path: res.path, sunk: res.sunk, water: res.water };
  if (res.sunk) s.holed[seat] = true;
  if (!res.sunk && s.strokes[seat][s.hole] >= MAX_STROKES) { s.strokes[seat][s.hole] = MAX_STROKES; s.holed[seat] = true; }
  afterShot(s, ctx);
}

export const miniGolf: Engine<GolfState> = {
  id: 'mini-golf',
  minPlayers: 1,
  maxPlayers: 4,
  init(n, options, ctx) {
    const holeCount = options.holes === '6' ? 6 : 3;
    return {
      n, holeCount, hole: 0, balls: Array.from({ length: n }, () => tee(0)), strokes: Array.from({ length: n }, () => [0]),
      holed: Array(n).fill(false), turn: 0, shotStartedAt: ctx.now, throwId: 0, last: null,
      out: Array(n).fill(false), strikes: Array(n).fill(0), finished: false,
    };
  },
  start(s, ctx) { return { ...s, shotStartedAt: ctx.now }; },
  act(state, seat, raw, ctx) {
    if (state.finished) return 'The round is over.';
    if (seat !== state.turn) return 'Wait for your turn.';
    const a = raw as { angle?: unknown; power?: unknown };
    const angle = Number(a?.angle), power = Number(a?.power);
    if (!Number.isFinite(angle) || !Number.isFinite(power) || power <= 0) return 'Invalid shot.';
    const s = clone(state);
    s.strikes[seat] = 0;
    stroke(s, seat, angle, Math.min(1, power), ctx);
    return s;
  },
  view(s) {
    return {
      hole: s.hole, holeCount: s.holeCount, balls: s.balls, strokes: s.strokes, holed: s.holed, turn: s.turn,
      throwId: s.throwId, last: s.last, out: s.out, par: HOLES.slice(0, s.holeCount).map((h) => h.par),
    };
  },
  outcome(s) {
    if (!s.finished) return null;
    const live = s.strokes.map((_, i) => i).filter((i) => !s.out[i]);
    const seats = live.length ? live : s.strokes.map((_, i) => i);
    const ranking = rankSeats(seats, (a, b) => total(s, b) - total(s, a));
    const par = HOLES.slice(0, s.holeCount).reduce((a, h) => a + h.par, 0);
    const tags: Record<number, string[]> = {};
    for (const i of seats) if (total(s, i) < par) tags[i] = ['under_par'];
    const best = total(s, ranking[0][0]);
    const rel = best - par;
    return {
      kind: s.n === 1 ? 'ranking' : resultKind(ranking), ranking, scores: s.strokes.map((_, i) => total(s, i)),
      summary: `${best} strokes (${rel === 0 ? 'level par' : rel > 0 ? `+${rel}` : rel})`, reason: 'Fewest strokes', tags,
    };
  },
  deadline(s) { return s.finished ? null : { seat: s.turn, at: s.shotStartedAt + SHOT_MS }; },
  onDeadline(state, ctx) {
    const s = clone(state);
    const seat = s.turn;
    s.strikes[seat]++;
    if (s.strikes[seat] >= 3) return miniGolf.drop!(s, seat, ctx);
    s.strokes[seat][s.hole]++;
    if (s.strokes[seat][s.hole] >= MAX_STROKES) { s.strokes[seat][s.hole] = MAX_STROKES; s.holed[seat] = true; }
    afterShot(s, ctx);
    return s;
  },
  drop(state, seat, ctx) {
    const s = clone(state);
    s.out[seat] = true;
    s.holed[seat] = true;
    if (s.out.every((o) => o) || (s.n > 1 && s.out.filter((o) => !o).length <= 1)) { s.finished = true; return s; }
    if (s.turn === seat) afterShot(s, ctx);
    return s;
  },
  bot(s, seat, ctx) {
    if (s.finished || s.turn !== seat) return null;
    const h = HOLES[s.hole];
    const ball = s.balls[seat];
    const direct = Math.atan2(h.cup.y - ball.y, h.cup.x - ball.x);
    let best = { angle: direct, power: 0.5, score: Infinity };
    for (let i = 0; i < 90; i++) {
      const angle = direct + (ctx.rand() - 0.5) * (i < 40 ? 0.6 : 3.2);
      const power = 0.12 + ctx.rand() * 0.88;
      const r = simulate(h, ball, angle, power);
      const score = r.sunk ? -1 : r.water ? 1e6 : Math.hypot(r.end.x - h.cup.x, r.end.y - h.cup.y);
      if (score < best.score) best = { angle, power, score };
    }
    return { angle: best.angle + ctx.gauss() * 0.02, power: best.power * (1 + ctx.gauss() * 0.04) };
  },
};
