import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { dartTarget, scoreArrow, scoreDart } from '../src/shared/arcade';
import { HOLES, simulate } from '../src/shared/golf';
import { makeCtx } from '../src/server/matches';
import { ENGINES } from '../src/server/games/registry';
import { chess } from '../src/server/games/chess';
import { canPlay, crazyEights, type C8State } from '../src/server/games/crazyEights';
import { ticTacToe } from '../src/server/games/ticTacToe';
import { markGuess, wordGuess } from '../src/server/games/wordGuess';
import { wordScramble } from '../src/server/games/wordScramble';
import { wordDuel } from '../src/server/games/wordDuel';
import type { Engine } from '../src/server/games/types';
import { anagramsOf } from '../src/server/words/dictionary';

const ctx = () => makeCtx();
function play<S>(e: Engine<S>, s: S, seat: number, a: unknown): S {
  const r = e.act(s, seat, a, ctx());
  if (typeof r === 'string') throw new Error(r);
  return r;
}

describe('tic-tac-toe', () => {
  it('rejects out-of-turn and occupied moves, detects a win', () => {
    let s = ticTacToe.init(2, { bestOf: '1' }, ctx());
    expect(ticTacToe.act(s, 1, { cell: 0 }, ctx())).toBe('It is not your turn.');
    s = play(ticTacToe, s, 0, { cell: 0 });
    expect(ticTacToe.act(s, 1, { cell: 0 }, ctx())).toBe('That square is taken.');
    s = play(ticTacToe, s, 1, { cell: 3 });
    s = play(ticTacToe, s, 0, { cell: 1 });
    s = play(ticTacToe, s, 1, { cell: 4 });
    s = play(ticTacToe, s, 0, { cell: 2 });
    const o = ticTacToe.outcome(s)!;
    expect(o.ranking).toEqual([[0], [1]]);
  });
  it('plays best of three and alternates the starter', () => {
    let s = ticTacToe.init(2, { bestOf: '3' }, ctx());
    for (const c of [0, 3, 1, 4, 2]) s = play(ticTacToe, s, s.turn, { cell: c });
    expect(s.wins).toEqual([1, 0]);
    expect(s.turn).toBe(1);
    expect(ticTacToe.outcome(s)).toBeNull();
  });
  it('times out to a forfeit', () => {
    const s = ticTacToe.onDeadline(ticTacToe.init(2, {}, ctx()), ctx());
    expect(ticTacToe.outcome(s)!.ranking).toEqual([[1], [0]]);
  });
});

describe('chess', () => {
  it('rejects illegal moves and finds fool’s mate', () => {
    let s = chess.init(2, { tc: 'untimed' }, ctx());
    expect(chess.act(s, 0, { type: 'move', from: 'e2', to: 'e5' }, ctx())).toBe('That move is not legal.');
    expect(chess.act(s, 1, { type: 'move', from: 'e7', to: 'e5' }, ctx())).toBe('It is not your turn.');
    s = play(chess, s, 0, { type: 'move', from: 'f2', to: 'f3' });
    s = play(chess, s, 1, { type: 'move', from: 'e7', to: 'e5' });
    s = play(chess, s, 0, { type: 'move', from: 'g2', to: 'g4' });
    s = play(chess, s, 1, { type: 'move', from: 'd8', to: 'h4' });
    const o = chess.outcome(s)!;
    expect(o.ranking).toEqual([[1], [0]]);
    expect(o.tags?.[1]).toContain('checkmate');
  });
  it('detects stalemate', () => {
    let s = chess.init(2, { tc: 'untimed' }, ctx());
    // Known shortest stalemate (Sam Loyd, 10 moves).
    const moves = ['e3', 'a5', 'Qh5', 'Ra6', 'Qxa5', 'h5', 'h4', 'Rah6', 'Qxc7', 'f6', 'Qxd7+', 'Kf7', 'Qxb7', 'Qd3', 'Qxb8', 'Qh7', 'Qxc8', 'Kg6', 'Qe6'];
    s = { ...s, moves: moves.slice(0, -1) };
    const g = new Chess();
    for (const m of moves.slice(0, -1)) g.move(m);
    const mv = g.move('Qe6');
    s = play(chess, s, 0, { type: 'move', from: mv.from, to: mv.to });
    expect(chess.outcome(s)!.kind).toBe('draw');
  });
  it('handles promotion and draw offers', () => {
    let s = chess.init(2, { tc: 'rapid' }, ctx());
    s = play(chess, s, 0, { type: 'offerDraw' });
    expect(chess.act(s, 0, { type: 'acceptDraw' }, ctx())).toMatch(/no draw offer/);
    s = play(chess, s, 1, { type: 'acceptDraw' });
    expect(chess.outcome(s)!.kind).toBe('draw');
  });
  it('flags on time', () => {
    const s = chess.init(2, { tc: 'blitz' }, ctx());
    const d = chess.deadline(s)!;
    expect(d.seat).toBe(0);
    expect(chess.outcome(chess.onDeadline(s, ctx()))!.ranking).toEqual([[1], [0]]);
  });
  it('only sends legal moves to the player on turn', () => {
    const s = chess.init(2, {}, ctx());
    expect((chess.view(s, 0, Date.now()) as any).legal.length).toBe(20);
    expect((chess.view(s, 1, Date.now()) as any).legal.length).toBe(0);
  });
});

describe('crazy eights', () => {
  it('deals privately and enforces matching', () => {
    const s = crazyEights.init(2, {}, ctx());
    expect(s.hands[0]).toHaveLength(7);
    const v1 = crazyEights.view(s, 1, 0) as any;
    expect(v1.hand).toEqual(s.hands[1]);
    expect(JSON.stringify(v1)).not.toContain(JSON.stringify(s.hands[0]));
    expect((crazyEights.view(s, null, 0) as any).hand).toBeNull();
    const bad = s.hands[0].find((c) => !canPlay(s, c));
    if (bad) expect(crazyEights.act(s, 0, { type: 'play', card: bad }, ctx())).toMatch(/doesn’t match/);
    expect(crazyEights.act(s, 0, { type: 'play', card: 'ZZ' }, ctx())).toMatch(/don’t have/);
  });
  it('requires a suit for eights and finishes a round', () => {
    const s: C8State = { ...crazyEights.init(2, {}, ctx()), hands: [['8S'], ['2H', 'KD']], discard: ['5C'], suit: 'C', turn: 0 };
    expect(crazyEights.act(s, 0, { type: 'play', card: '8S' }, ctx())).toMatch(/Choose a suit/);
    const done = play(crazyEights, s, 0, { type: 'play', card: '8S', suit: 'H' });
    const o = crazyEights.outcome(done)!;
    expect(o.ranking[0]).toEqual([0]);
    expect(done.totals[0]).toBe(12);
  });
  it('bots always produce legal actions', () => {
    let s = crazyEights.init(3, {}, ctx());
    for (let i = 0; i < 300 && !crazyEights.outcome(s); i++) {
      const a = crazyEights.bot!(s, s.turn, ctx());
      s = play(crazyEights, s, s.turn, a);
    }
    expect(crazyEights.outcome(s)).not.toBeNull();
  });
});

describe('word games', () => {
  it('marks repeated letters correctly', () => {
    expect(markGuess('allee', 'apple')).toBe('gy..g');
    expect(markGuess('speed', 'abide')).toBe('..y.y');
    expect(markGuess('crane', 'crane')).toBe('ggggg');
  });
  it('hides the answer until the end', () => {
    let s = wordGuess.init(2, {}, ctx());
    expect(JSON.stringify(wordGuess.view(s, 0, 0))).not.toContain(`"${s.answer}"`);
    expect(wordGuess.act(s, 0, { guess: 'zzzzz' }, ctx())).toMatch(/dictionary/);
    s = play(wordGuess, s, 0, { guess: s.answer });
    s = wordGuess.onDeadline(s, ctx());
    expect((wordGuess.view(s, 1, 0) as any).answer).toBe(s.answer);
    expect(wordGuess.outcome(s)!.ranking[0]).toEqual([0]);
  });
  it('scramble accepts the answer and anagrams, rejects others', () => {
    let s = wordScramble.init(2, { rounds: '5' }, ctx());
    const word = s.words[0];
    expect(wordScramble.act(s, 1, { guess: 'xyz' }, ctx())).toMatch(/every letter/);
    s = play(wordScramble, s, 1, { guess: anagramsOf(word)[0] });
    expect(s.scores[1]).toBeGreaterThanOrEqual(10);
    expect(s.phase).toBe('break');
  });
  it('word duel validates racks and duplicates', () => {
    let s = wordDuel.init(2, {}, ctx());
    const rack = s.racks[0];
    const word = s.best[0][s.best[0].length - 1];
    s = play(wordDuel, s, 0, { word });
    expect(wordDuel.act(s, 0, { word }, ctx())).toMatch(/already/);
    expect(wordDuel.act(s, 1, { word: 'q'.repeat(3) }, ctx())).toBeTypeOf('string');
    expect(rack).toHaveLength(9);
    // Opponent can't see round score mid-round.
    expect((wordDuel.view(s, 1, 0) as any).scores[0]).toBe(0);
  });
});

describe('arcade geometry', () => {
  it('scores darts regions', () => {
    expect(scoreDart(0, 0).score).toBe(50);
    expect(scoreDart(0, -11).score).toBe(25);
    const t20 = dartTarget('T20');
    expect(scoreDart(t20.x, t20.y).label).toBe('T20');
    const d16 = dartTarget('D16');
    expect(scoreDart(d16.x, d16.y).label).toBe('D16');
    expect(scoreDart(0, -200).score).toBe(0);
    expect(scoreArrow(0, 0)).toBe(10);
    expect(scoreArrow(59, 0)).toBe(1);
    expect(scoreArrow(61, 0)).toBe(0);
  });
  it('every golf hole can be finished within the stroke cap by a careful player', () => {
    for (const h of HOLES) {
      let ball = { ...h.tee };
      let strokes = 0;
      let sunk = false;
      while (!sunk && strokes < 8) {
        let best = { score: Infinity, end: ball, sunk: false };
        for (let i = 0; i < 300; i++) {
          const r = simulate(h, ball, Math.random() * Math.PI * 2, 0.08 + Math.random() * 0.92);
          const score = r.sunk ? -1 : r.water ? 1e9 : Math.hypot(r.end.x - h.cup.x, r.end.y - h.cup.y);
          if (score < best.score) best = { score, end: r.end, sunk: r.sunk };
        }
        ball = best.end;
        sunk = best.sunk;
        strokes++;
      }
      expect(sunk, h.name).toBe(true);
    }
  });
});

describe('every engine can finish a game with bots', () => {
  for (const [id, e] of Object.entries(ENGINES)) {
    if (!e!.bot) continue;
    it(id, () => {
      const n = e!.minPlayers === 1 ? 2 : e!.minPlayers;
      let s = e!.init(n, {}, ctx());
      let guard = 0;
      while (!e!.outcome(s) && guard++ < 3000) {
        let moved = false;
        for (let seat = 0; seat < n; seat++) {
          const a = e!.bot!(s, seat, ctx());
          if (a) { s = play(e!, s, seat, a); moved = true; break; }
        }
        if (!moved) s = e!.onDeadline(s, ctx());
      }
      const o = e!.outcome(s)!;
      expect(o).not.toBeNull();
      expect(o.ranking.flat().sort()).toEqual(Array.from({ length: n }, (_, i) => i));
    }, 120_000);
  }
});
