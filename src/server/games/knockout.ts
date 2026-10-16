import { breathe, KNOCKOUT } from '../../shared/arcade';
import { botHold, readAim, round2, scatter } from './aim';
import type { Ctx, Engine } from './types';
import { clone, rankSeats, resultKind } from './types';

const SHOT_MS = 20_000;
const MAX_ROUNDS = 30;

export interface KoState {
  n: number;
  lives: number[];
  round: number;
  target: { x: number; y: number; r: number };
  queue: number[];
  roundShots: Record<number, boolean>;
  eliminatedAt: number[];
  shotStartedAt: number;
  throwId: number;
  last: { seat: number; aim: { x: number; y: number }; shot: { x: number; y: number }; hit: boolean } | null;
  lastRound: { round: number; hits: number[]; misses: number[]; replay: boolean } | null;
  strikes: number[];
  out: boolean[];
  finished: boolean;
}

const alive = (s: KoState) => s.lives.map((_, i) => i).filter((i) => s.lives[i] > 0 && !s.out[i]);

function newTarget(round: number, ctx: Ctx) {
  const a = ctx.rand() * Math.PI * 2;
  const d = ctx.rand() * 55;
  return { x: round2(Math.cos(a) * d), y: round2(Math.sin(a) * d), r: KNOCKOUT.targetRadius(round) };
}

function closeRound(s: KoState, ctx: Ctx) {
  const shooters = Object.keys(s.roundShots).map(Number).filter((i) => !s.out[i]);
  const hits = shooters.filter((i) => s.roundShots[i]);
  const misses = shooters.filter((i) => !s.roundShots[i]);
  const replay = hits.length === 0;
  if (!replay) for (const m of misses) { s.lives[m]--; if (s.lives[m] === 0) s.eliminatedAt[m] = s.round; }
  s.lastRound = { round: s.round, hits, misses, replay };
  if (alive(s).length <= 1 || s.round >= MAX_ROUNDS) { s.finished = true; return; }
  s.round++;
  s.target = newTarget(s.round, ctx);
  s.queue = alive(s);
  s.roundShots = {};
}

function shoot(s: KoState, seat: number, aim: { x: number; y: number; hold: number }, ctx: Ctx) {
  const spread = breathe(aim.hold, KNOCKOUT.period(s.round), KNOCKOUT.spread.min, KNOCKOUT.spread.max);
  const p = scatter(ctx, aim.x, aim.y, spread);
  const hit = Math.hypot(p.x - s.target.x, p.y - s.target.y) <= s.target.r;
  s.roundShots[seat] = hit;
  s.throwId++;
  s.last = { seat, aim: { x: round2(aim.x), y: round2(aim.y) }, shot: { x: round2(p.x), y: round2(p.y) }, hit };
  s.queue.shift();
  if (s.queue.length === 0) closeRound(s, ctx);
  s.shotStartedAt = ctx.now;
}

export const knockout: Engine<KoState> = {
  id: 'knockout',
  minPlayers: 2,
  maxPlayers: 4,
  init(n, options, ctx) {
    const lives = options.lives === '2' ? 2 : 3;
    return {
      n, lives: Array(n).fill(lives), round: 1, target: newTarget(1, ctx), queue: Array.from({ length: n }, (_, i) => i),
      roundShots: {}, eliminatedAt: Array(n).fill(0), shotStartedAt: ctx.now, throwId: 0, last: null, lastRound: null,
      strikes: Array(n).fill(0), out: Array(n).fill(false), finished: false,
    };
  },
  start(s, ctx) { return { ...s, shotStartedAt: ctx.now }; },
  act(state, seat, raw, ctx) {
    if (state.finished) return 'The match is over.';
    if (state.queue[0] !== seat) return 'Wait for your turn.';
    const aim = readAim(raw, KNOCKOUT.field);
    if (!aim) return 'Invalid shot.';
    const s = clone(state);
    s.strikes[seat] = 0;
    shoot(s, seat, aim, ctx);
    return s;
  },
  view(s) {
    return {
      lives: s.lives, round: s.round, target: s.target, turn: s.queue[0] ?? null, roundShots: s.roundShots,
      period: KNOCKOUT.period(s.round), throwId: s.throwId, last: s.last, lastRound: s.lastRound, out: s.out,
    };
  },
  outcome(s) {
    if (!s.finished) return null;
    const seats = s.lives.map((_, i) => i).filter((i) => !s.out[i]);
    const ranking = rankSeats(seats, (a, b) => (s.lives[a] !== s.lives[b] ? s.lives[a] - s.lives[b] : s.eliminatedAt[a] - s.eliminatedAt[b]));
    return {
      kind: resultKind(ranking), ranking, scores: s.lives,
      summary: `Survived ${s.round} rounds`, reason: ranking[0].length > 1 ? 'Round limit reached' : 'Last one standing',
    };
  },
  deadline(s) { return s.finished ? null : { seat: s.queue[0], at: s.shotStartedAt + SHOT_MS }; },
  onDeadline(state, ctx) {
    const s = clone(state);
    const seat = s.queue[0];
    s.strikes[seat]++;
    if (s.strikes[seat] >= 3) return knockout.drop!(s, seat, ctx);
    shoot(s, seat, { x: 0, y: 1000, hold: 0 }, ctx);
    return s;
  },
  drop(state, seat, ctx) {
    const s = clone(state);
    s.out[seat] = true;
    s.queue = s.queue.filter((x) => x !== seat);
    delete s.roundShots[seat];
    if (alive(s).length <= 1) { s.finished = true; return s; }
    if (s.queue.length === 0) closeRound(s, ctx);
    s.shotStartedAt = ctx.now;
    return s;
  },
  bot(s, seat, ctx) {
    if (s.finished || s.queue[0] !== seat) return null;
    return {
      x: s.target.x + ctx.gauss() * 2, y: s.target.y + ctx.gauss() * 2,
      hold: botHold(ctx, KNOCKOUT.period(s.round), 0.7),
    };
  },
};
