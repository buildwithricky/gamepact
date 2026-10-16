import { PONG, pongLanding, pongRack } from '../../shared/arcade';
import { round2 } from './aim';
import type { Ctx, Engine } from './types';
import { clone } from './types';

const THROW_MS = 20_000;
const MAX_TURNS = 30;

export interface PongState {
  racks: [number[], number[]];
  turn: number;
  throwsLeft: number;
  hitsThisTurn: number;
  turns: [number, number];
  throwStartedAt: number;
  throwId: number;
  last: { seat: number; land: { x: number; y: number }; cup: number | null; rim: boolean; ballsBack: boolean } | null;
  strikes: [number, number];
  forfeit: number | null;
  finished: boolean;
}

function nextTurn(s: PongState, ctx: Ctx) {
  s.turns[s.turn]++;
  if (s.turns[0] >= MAX_TURNS && s.turns[1] >= MAX_TURNS) { s.finished = true; return; }
  s.turn = 1 - s.turn;
  s.throwsLeft = 2;
  s.hitsThisTurn = 0;
  s.throwStartedAt = ctx.now;
}

function throwBall(s: PongState, seat: number, angle: number, power: number, ctx: Ctx) {
  const target = pongLanding(angle, power);
  const land = { x: target.x + ctx.gauss() * PONG.noise, y: target.y + ctx.gauss() * PONG.noise };
  const rack = s.racks[1 - seat];
  const cups = pongRack().filter((c) => rack.includes(c.id));
  let hit: number | null = null;
  let rim = false;
  for (const c of cups) {
    const d = Math.hypot(land.x - c.x, land.y - c.y);
    if (d < PONG.cupRadius - PONG.ballRadius * 0.4) { hit = c.id; break; }
    if (d < PONG.cupRadius + 0.8) { rim = true; if (ctx.rand() < 0.45) { hit = c.id; break; } }
  }
  if (hit !== null) {
    s.racks[1 - seat] = rack.filter((id) => id !== hit);
    s.hitsThisTurn++;
  }
  s.throwsLeft--;
  s.throwId++;
  let ballsBack = false;
  if (s.racks[1 - seat].length === 0) s.finished = true;
  else if (s.throwsLeft === 0) {
    if (s.hitsThisTurn === 2) { ballsBack = true; s.throwsLeft = 2; s.hitsThisTurn = 0; }
    else nextTurn(s, ctx);
  }
  s.last = { seat, land: { x: round2(land.x), y: round2(land.y) }, cup: hit, rim: rim && hit === null, ballsBack };
  s.throwStartedAt = ctx.now;
}

export const cupPong: Engine<PongState> = {
  id: 'cup-pong',
  minPlayers: 2,
  maxPlayers: 2,
  init(_n, _o, ctx) {
    const ids = pongRack().map((c) => c.id);
    return {
      racks: [[...ids], [...ids]], turn: 0, throwsLeft: 2, hitsThisTurn: 0, turns: [0, 0], throwStartedAt: ctx.now,
      throwId: 0, last: null, strikes: [0, 0], forfeit: null, finished: false,
    };
  },
  start(s, ctx) { return { ...s, throwStartedAt: ctx.now }; },
  act(state, seat, raw, ctx) {
    if (state.finished || state.forfeit !== null) return 'The match is over.';
    if (seat !== state.turn) return 'Wait for your turn.';
    const a = raw as { angle?: unknown; power?: unknown };
    const angle = Number(a?.angle), power = Number(a?.power);
    if (!Number.isFinite(angle) || !Number.isFinite(power)) return 'Invalid throw.';
    const s = clone(state);
    s.strikes[seat] = 0;
    throwBall(s, seat, angle, power, ctx);
    return s;
  },
  view(s) {
    return { racks: s.racks, turn: s.turn, throwsLeft: s.throwsLeft, throwId: s.throwId, last: s.last, turns: s.turns };
  },
  outcome(s) {
    const left = [s.racks[0].length, s.racks[1].length];
    if (s.forfeit !== null) {
      const w = 1 - s.forfeit;
      return { kind: 'win', ranking: [[w], [s.forfeit]], scores: left, summary: 'Opponent stopped throwing', reason: 'Opponent timed out' };
    }
    if (!s.finished) return null;
    const summary = `${left[0]} – ${left[1]} cups left`;
    if (left[0] === left[1]) return { kind: 'draw', ranking: [[0, 1]], scores: left, summary, reason: 'Turn limit reached' };
    const w = left[0] > left[1] ? 0 : 1; // more of your own cups standing = you win
    return { kind: 'win', ranking: [[w], [1 - w]], scores: left, summary, reason: left[1 - w] === 0 ? 'Cleared the rack' : 'More cups standing' };
  },
  deadline(s) { return s.finished || s.forfeit !== null ? null : { seat: s.turn, at: s.throwStartedAt + THROW_MS }; },
  onDeadline(state, ctx) {
    const s = clone(state);
    const seat = s.turn;
    s.strikes[seat]++;
    if (s.strikes[seat] >= 3) { s.forfeit = seat; return s; }
    throwBall(s, seat, 0, -5, ctx);
    return s;
  },
  bot(s, seat, ctx) {
    if (s.finished || s.turn !== seat) return null;
    const cups = pongRack().filter((c) => s.racks[1 - seat].includes(c.id));
    const c = cups[ctx.randInt(cups.length)];
    const d = Math.hypot(c.x, c.y);
    return {
      angle: Math.atan2(c.x, c.y) + ctx.gauss() * 0.012,
      power: (d - PONG.minDistance) / (PONG.maxDistance - PONG.minDistance) + ctx.gauss() * 0.02,
    };
  },
};
