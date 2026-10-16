import { anagramsOf, answerLists, isWord } from '../words/dictionary';
import type { Ctx, Engine } from './types';
import { clone, rankSeats, resultKind } from './types';

const ROUND_MS = 25_000;
const BREAK_MS = 3_500;

export interface WsState {
  n: number;
  rounds: number;
  round: number;
  words: string[];
  letters: string;
  phase: 'play' | 'break';
  phaseStartedAt: number;
  phaseEndsAt: number;
  scores: number[];
  results: ({ seat: number; word: string; points: number } | { seat: null; word: string; points: 0 })[];
  lastGuessAt: number[];
  out: boolean[];
  finished: boolean;
}

function scramble(word: string, ctx: Ctx): string {
  const answers = new Set(anagramsOf(word));
  for (let tries = 0; tries < 20; tries++) {
    const a = word.split('');
    for (let i = a.length - 1; i > 0; i--) {
      const j = ctx.randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    const s = a.join('');
    if (!answers.has(s)) return s;
  }
  return word.split('').reverse().join('');
}

function beginRound(s: WsState, ctx: Ctx) {
  s.phase = 'play';
  s.letters = scramble(s.words[s.round], ctx);
  s.phaseStartedAt = ctx.now;
  s.phaseEndsAt = ctx.now + ROUND_MS;
}

export const wordScramble: Engine<WsState> = {
  id: 'word-scramble',
  minPlayers: 1,
  maxPlayers: 6,
  init(n, options, ctx) {
    const rounds = options.rounds === '8' ? 8 : 5;
    const pool = [...answerLists().scramble];
    const words: string[] = [];
    while (words.length < rounds && pool.length) words.push(pool.splice(ctx.randInt(pool.length), 1)[0]);
    const s: WsState = {
      n, rounds, round: 0, words, letters: '', phase: 'play', phaseStartedAt: ctx.now, phaseEndsAt: ctx.now,
      scores: Array(n).fill(0), results: [], lastGuessAt: Array(n).fill(0), out: Array(n).fill(false), finished: false,
    };
    beginRound(s, ctx);
    return s;
  },
  start(state, ctx) { const s = clone(state); beginRound(s, ctx); return s; },
  act(state, seat, raw, ctx) {
    if (state.finished) return 'The game is over.';
    if (state.phase !== 'play') return 'Next round is about to start.';
    if (ctx.now - state.lastGuessAt[seat] < 300) return 'Slow down a little.';
    const guess = String((raw as { guess?: unknown })?.guess ?? '').toLowerCase().trim();
    const s = clone(state);
    s.lastGuessAt[seat] = ctx.now;
    const target = s.words[s.round];
    const sameLetters = guess.length === target.length && guess.split('').sort().join('') === target.split('').sort().join('');
    if (!sameLetters) return 'Use every letter exactly once.';
    if (!isWord(guess)) return 'Not a word we know — try again.';
    const remaining = Math.max(0, s.phaseEndsAt - ctx.now);
    const points = 10 + Math.round((5 * remaining) / ROUND_MS);
    s.scores[seat] += points;
    s.results.push({ seat, word: guess, points });
    s.phase = 'break';
    s.phaseStartedAt = ctx.now;
    s.phaseEndsAt = ctx.now + BREAK_MS;
    return s;
  },
  view(s) {
    return {
      round: s.round + 1, rounds: s.rounds, letters: s.letters, phase: s.phase,
      phaseEndsAt: s.phaseEndsAt, scores: s.scores, results: s.results,
      reveal: s.phase === 'break' || s.finished ? s.words[s.round] : null,
    };
  },
  outcome(s) {
    if (!s.finished) return null;
    const seats = s.scores.map((_, i) => i).filter((i) => !s.out[i]);
    const ranking = rankSeats(seats, (a, b) => s.scores[a] - s.scores[b]);
    return {
      kind: s.n === 1 ? 'ranking' : resultKind(ranking), ranking, scores: s.scores,
      summary: `${s.scores[ranking[0][0]]} points`,
      reason: `${s.results.filter((r) => r.seat === ranking[0][0]).length} of ${s.rounds} words`,
    };
  },
  deadline(s) { return s.finished ? null : { seat: null, at: s.phaseEndsAt }; },
  onDeadline(state, ctx) {
    const s = clone(state);
    if (s.phase === 'play') {
      s.results.push({ seat: null, word: s.words[s.round], points: 0 });
      s.phase = 'break';
      s.phaseStartedAt = ctx.now;
      s.phaseEndsAt = ctx.now + BREAK_MS;
      return s;
    }
    if (s.round + 1 >= s.rounds) { s.finished = true; return s; }
    s.round++;
    beginRound(s, ctx);
    return s;
  },
  drop(state, seat) {
    const s = clone(state);
    s.out[seat] = true;
    return s;
  },
};
