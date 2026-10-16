import { breathe, DARTS, dartTarget, scoreDart } from '../../shared/arcade';
import { botHold, readAim, round2, scatter } from './aim';
import type { Ctx, Engine } from './types';
import { clone } from './types';

const DART_MS = 20_000;

interface Dart { x: number; y: number; label: string; score: number }
interface Turn { darts: Dart[]; total: number; bust: boolean }

export interface DartsState {
  mode: '301' | '501' | 'high';
  scores: [number, number];
  turn: number;
  current: Dart[];
  turnStart: number;
  history: [Turn[], Turn[]];
  maxTurns: number;
  dartStartedAt: number;
  throwId: number;
  last: { seat: number; aim: { x: number; y: number }; dart: Dart; bust: boolean } | null;
  strikes: [number, number];
  forfeit: number | null;
  finished: boolean;
}

function endTurn(s: DartsState, bust: boolean, ctx: Ctx) {
  const total = s.current.reduce((a, d) => a + d.score, 0);
  s.history[s.turn].push({ darts: s.current, total: bust ? 0 : total, bust });
  s.current = [];
  const bothDone = s.history[0].length >= s.maxTurns && s.history[1].length >= s.maxTurns;
  if (bothDone) { s.finished = true; return; }
  s.turn = 1 - s.turn;
  s.turnStart = s.scores[s.turn];
}

function throwDart(s: DartsState, seat: number, aim: { x: number; y: number; hold: number }, ctx: Ctx) {
  const spread = breathe(aim.hold, DARTS.spread.period, DARTS.spread.min, DARTS.spread.max);
  const land = scatter(ctx, aim.x, aim.y, spread);
  const hit = scoreDart(land.x, land.y);
  const dart: Dart = { x: round2(land.x), y: round2(land.y), label: hit.label, score: hit.score };
  s.current.push(dart);
  s.throwId++;
  let bust = false;
  if (s.mode === 'high') {
    s.scores[seat] += hit.score;
  } else {
    const left = s.scores[seat] - hit.score;
    if (left < 0) bust = true;
    else s.scores[seat] = left;
    if (left === 0) { s.history[seat].push({ darts: s.current, total: s.turnStart, bust: false }); s.current = []; s.finished = true; }
  }
  s.last = { seat, aim: { x: round2(aim.x), y: round2(aim.y) }, dart, bust };
  if (s.finished) return;
  if (bust) { s.scores[seat] = s.turnStart; endTurn(s, true, ctx); }
  else if (s.current.length >= 3) endTurn(s, false, ctx);
  s.dartStartedAt = ctx.now;
}

export const darts: Engine<DartsState> = {
  id: 'darts',
  minPlayers: 2,
  maxPlayers: 2,
  init(_n, options, ctx) {
    const mode = (['301', '501', 'high'].includes(options.mode) ? options.mode : '301') as DartsState['mode'];
    const start = mode === 'high' ? 0 : Number(mode);
    return {
      mode, scores: [start, start], turn: 0, current: [], turnStart: start, history: [[], []],
      maxTurns: mode === 'high' ? 5 : mode === '301' ? 15 : 20, dartStartedAt: ctx.now, throwId: 0, last: null,
      strikes: [0, 0], forfeit: null, finished: false,
    };
  },
  start(s, ctx) { return { ...s, dartStartedAt: ctx.now }; },
  act(state, seat, raw, ctx) {
    if (state.finished || state.forfeit !== null) return 'The match is over.';
    if (seat !== state.turn) return 'Wait for your turn.';
    const aim = readAim(raw, DARTS.frame);
    if (!aim) return 'Invalid throw.';
    const s = clone(state);
    s.strikes[seat] = 0;
    throwDart(s, seat, aim, ctx);
    return s;
  },
  view(s) {
    return {
      mode: s.mode, scores: s.scores, turn: s.turn, current: s.current, history: s.history,
      maxTurns: s.maxTurns, throwId: s.throwId, last: s.last, dartsLeft: 3 - s.current.length,
    };
  },
  outcome(s) {
    if (s.forfeit !== null) {
      const w = 1 - s.forfeit;
      return { kind: 'win', ranking: [[w], [s.forfeit]], scores: s.scores, summary: 'Missed three throws in a row', reason: 'Opponent timed out' };
    }
    if (!s.finished) return null;
    const [a, b] = s.scores;
    const summary = s.mode === 'high' ? `${a} – ${b}` : `${a} – ${b} left`;
    if (a === b) return { kind: 'draw', ranking: [[0, 1]], scores: s.scores, summary, reason: 'Level' };
    const w = s.mode === 'high' ? (a > b ? 0 : 1) : a < b ? 0 : 1;
    const reason = s.mode === 'high' ? 'Highest score' : s.scores[w] === 0 ? 'Checked out' : 'Closest to zero';
    return { kind: 'win', ranking: [[w], [1 - w]], scores: s.scores, summary, reason };
  },
  deadline(s) { return s.finished || s.forfeit !== null ? null : { seat: s.turn, at: s.dartStartedAt + DART_MS }; },
  onDeadline(state, ctx) {
    const s = clone(state);
    const seat = s.turn;
    s.strikes[seat]++;
    if (s.strikes[seat] >= 3) { s.forfeit = seat; return s; }
    throwDart(s, seat, { x: 0, y: 400, hold: 0 }, ctx);
    return s;
  },
  bot(s, seat, ctx) {
    if (s.finished || s.turn !== seat) return null;
    const rem = s.scores[seat];
    let target = 'T20';
    if (s.mode !== 'high') {
      if (rem === 50) target = 'Bull';
      else if (rem <= 20) target = String(rem);
      else if (rem <= 40 && rem % 2 === 0) target = `D${rem / 2}`;
      else if (rem <= 60) target = rem - 20 <= 20 ? String(rem - 20) : '20';
    }
    const t = dartTarget(target);
    return { x: t.x + ctx.gauss() * 4, y: t.y + ctx.gauss() * 4, hold: botHold(ctx, DARTS.spread.period, 0.7) };
  },
};
