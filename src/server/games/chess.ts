import { Chess } from 'chess.js';
import type { Engine } from './types';
import { clone } from './types';

const TC: Record<string, { initial: number; inc: number } | null> = {
  blitz: { initial: 5 * 60_000, inc: 0 },
  rapid: { initial: 10 * 60_000, inc: 5_000 },
  untimed: null,
};

export interface ChessState {
  moves: string[];
  lastMove: { from: string; to: string } | null;
  tc: { initial: number; inc: number } | null;
  clocks: [number, number];
  turnStartedAt: number;
  drawOffer: number | null;
  end: { kind: 'checkmate' | 'stalemate' | 'draw' | 'agreed' | 'flag'; winner: number | null; detail: string } | null;
}

// Replaying the whole game on every call is slow for long games, so keep recent positions.
// Entries are keyed by the full move list; a cached instance is only mutated by take(), which re-keys it.
const cache = new Map<string, Chess>();
function rebuild(moves: string[]): Chess {
  const key = moves.join(' ');
  const hit = cache.get(key);
  if (hit) return hit;
  const g = new Chess();
  for (const m of moves) g.move(m);
  cache.set(key, g);
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return g;
}
function take(moves: string[]): Chess {
  const g = rebuild(moves);
  cache.delete(moves.join(' '));
  return g;
}

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const chess: Engine<ChessState> = {
  id: 'chess',
  minPlayers: 2,
  maxPlayers: 2,
  init(_n, options, ctx) {
    const tc = options.tc in TC ? TC[options.tc] : TC.rapid;
    return {
      moves: [], lastMove: null, tc, clocks: [tc?.initial ?? 0, tc?.initial ?? 0],
      turnStartedAt: ctx.now, drawOffer: null, end: null,
    };
  },
  start(s, ctx) { return { ...s, turnStartedAt: ctx.now }; },
  act(state, seat, raw, ctx) {
    if (state.end) return 'The game is over.';
    const a = (raw ?? {}) as { type?: string; from?: string; to?: string; promotion?: string };
    const turn = state.moves.length % 2;
    const s = clone(state);

    if (a.type === 'offerDraw') {
      if (s.drawOffer !== null) return 'A draw offer is already open.';
      s.drawOffer = seat;
      return s;
    }
    if (a.type === 'acceptDraw' || a.type === 'declineDraw') {
      if (s.drawOffer === null || s.drawOffer === seat) return 'There is no draw offer to answer.';
      if (a.type === 'acceptDraw') s.end = { kind: 'agreed', winner: null, detail: 'Draw agreed' };
      s.drawOffer = null;
      return s;
    }
    if (a.type !== 'move') return 'Unknown action.';
    if (seat !== turn) return 'It is not your turn.';
    if (typeof a.from !== 'string' || typeof a.to !== 'string') return 'Choose a piece and a square.';
    const promotion = ['q', 'r', 'b', 'n'].includes(String(a.promotion)) ? String(a.promotion) : undefined;

    if (s.tc) {
      const used = ctx.now - s.turnStartedAt;
      if (used >= s.clocks[seat]) {
        s.clocks[seat] = 0;
        s.end = { kind: 'flag', winner: 1 - seat, detail: 'Lost on time' };
        return s;
      }
      s.clocks[seat] = s.clocks[seat] - used + s.tc.inc;
    }

    const matching = rebuild(state.moves).moves({ verbose: true }).filter((m) => m.from === a.from && m.to === a.to);
    if (!matching.length) return 'That move is not legal.';
    const game = take(state.moves);
    const mv = game.move({ from: a.from, to: a.to, promotion: matching.some((m) => m.promotion) ? promotion ?? 'q' : undefined });
    cache.set([...state.moves, mv.san].join(' '), game);
    s.moves.push(mv.san);
    s.lastMove = { from: mv.from, to: mv.to };
    s.turnStartedAt = ctx.now;
    if (s.drawOffer === 1 - seat) s.drawOffer = null; // moving declines an opponent's offer
    if (s.drawOffer === seat) s.drawOffer = null;

    if (game.isCheckmate()) s.end = { kind: 'checkmate', winner: seat, detail: 'Checkmate' };
    else if (game.isStalemate()) s.end = { kind: 'stalemate', winner: null, detail: 'Stalemate' };
    else if (game.isInsufficientMaterial()) s.end = { kind: 'draw', winner: null, detail: 'Insufficient material' };
    else if (game.isThreefoldRepetition()) s.end = { kind: 'draw', winner: null, detail: 'Threefold repetition' };
    else if (game.isDraw()) s.end = { kind: 'draw', winner: null, detail: 'Fifty-move rule' };
    else if (s.moves.length >= 500) s.end = { kind: 'draw', winner: null, detail: 'Move limit reached' };
    return s;
  },
  view(s, seat, now) {
    const game = rebuild(s.moves);
    const turn = game.turn() === 'w' ? 0 : 1;
    const clocks: [number, number] = [...s.clocks];
    if (s.tc && !s.end) clocks[turn] = Math.max(0, clocks[turn] - (now - s.turnStartedAt));
    const legal = seat === turn && !s.end
      ? game.moves({ verbose: true }).map((m) => ({ from: m.from, to: m.to, promo: Boolean(m.promotion) }))
      : [];
    return {
      fen: game.fen(), moves: s.moves, lastMove: s.lastMove, turn, inCheck: game.inCheck(),
      clocks, timed: Boolean(s.tc), drawOffer: s.drawOffer, legal, end: s.end,
    };
  },
  outcome(s) {
    if (!s.end) return null;
    const summary = s.end.detail;
    const scores = s.end.winner === null ? [0.5, 0.5] : s.end.winner === 0 ? [1, 0] : [0, 1];
    if (s.end.winner === null) return { kind: 'draw', ranking: [[0, 1]], scores, summary, reason: summary };
    const w = s.end.winner;
    return {
      kind: 'win', ranking: [[w], [1 - w]], scores, summary, reason: summary,
      tags: s.end.kind === 'checkmate' ? { [w]: ['checkmate'] } : undefined,
    };
  },
  deadline(s) {
    if (!s.tc || s.end) return null;
    const turn = s.moves.length % 2;
    return { seat: turn, at: s.turnStartedAt + s.clocks[turn] };
  },
  onDeadline(s) {
    const turn = s.moves.length % 2;
    const clocks: [number, number] = [...s.clocks];
    clocks[turn] = 0;
    return { ...s, clocks, end: { kind: 'flag', winner: 1 - turn, detail: 'Lost on time' } };
  },
  bot(s, seat, ctx) {
    if (s.end) return null;
    if (s.drawOffer !== null && s.drawOffer !== seat) return { type: 'declineDraw' };
    const game = rebuild(s.moves);
    if ((game.turn() === 'w' ? 0 : 1) !== seat) return null;
    const moves = game.moves({ verbose: true });
    let best = -Infinity;
    let picks: typeof moves = [];
    for (const m of moves) {
      let v = ctx.rand() * 1.5;
      if (m.captured) v += VALUES[m.captured] * 2 - VALUES[m.piece] * 0.5;
      if (m.promotion) v += 8;
      game.move(m);
      if (game.isCheckmate()) v += 1000;
      else if (game.inCheck()) v += 0.6;
      // Avoid leaving the moved piece where it can simply be taken.
      const replies = game.moves({ verbose: true });
      const hanging = replies.some((r) => r.to === m.to && r.captured);
      if (hanging) v -= VALUES[m.promotion ?? m.piece] * 1.6;
      game.undo();
      if (v > best) { best = v; picks = [m]; } else if (v === best) picks.push(m);
    }
    const m = picks[ctx.randInt(picks.length)];
    return { type: 'move', from: m.from, to: m.to, promotion: m.promotion };
  },
};
