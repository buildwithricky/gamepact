import { answerLists, isWord } from '../words/dictionary';
import type { Engine } from './types';
import { clone, rankSeats, resultKind } from './types';

const LIMIT_MS = 180_000;
const TRIES = 6;

export interface WgState {
  n: number;
  answer: string;
  guesses: string[][];
  marks: string[][];
  solvedAt: (number | null)[];
  startedAt: number;
  endsAt: number;
  finished: boolean;
  out: boolean[];
}

/** 'g' = right spot, 'y' = in word elsewhere, '.' = absent. Handles repeated letters. */
export function markGuess(guess: string, answer: string): string {
  const res = Array(5).fill('.');
  const pool: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) res[i] = 'g';
    else pool[answer[i]] = (pool[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] === 'g') continue;
    if ((pool[guess[i]] ?? 0) > 0) { res[i] = 'y'; pool[guess[i]]--; }
  }
  return res.join('');
}

const done = (s: WgState, seat: number) => s.out[seat] || s.solvedAt[seat] !== null || s.guesses[seat].length >= TRIES;

export const wordGuess: Engine<WgState> = {
  id: 'word-guess',
  minPlayers: 1,
  maxPlayers: 4,
  init(n, _o, ctx) {
    const list = answerLists().five;
    return {
      n, answer: list[ctx.randInt(list.length)],
      guesses: Array.from({ length: n }, () => []), marks: Array.from({ length: n }, () => []),
      solvedAt: Array(n).fill(null), startedAt: ctx.now, endsAt: ctx.now + LIMIT_MS, finished: false, out: Array(n).fill(false),
    };
  },
  start(s, ctx) { return { ...s, startedAt: ctx.now, endsAt: ctx.now + LIMIT_MS }; },
  act(state, seat, raw, ctx) {
    if (state.finished) return 'The round is over.';
    if (done(state, seat)) return 'You are out of guesses.';
    const guess = String((raw as { guess?: unknown })?.guess ?? '').toLowerCase().trim();
    if (!/^[a-z]{5}$/.test(guess)) return 'Guesses must be five letters.';
    if (!isWord(guess)) return 'That word isn’t in the dictionary.';
    if (state.guesses[seat].includes(guess)) return 'You already tried that word.';
    const s = clone(state);
    const m = markGuess(guess, s.answer);
    s.guesses[seat].push(guess);
    s.marks[seat].push(m);
    if (m === 'ggggg') s.solvedAt[seat] = ctx.now - s.startedAt;
    if (s.guesses.every((_, i) => done(s, i))) s.finished = true;
    return s;
  },
  view(s, seat) {
    return {
      mine: seat !== null ? { guesses: s.guesses[seat], marks: s.marks[seat] } : null,
      others: s.marks.map((m, i) => ({ seat: i, marks: m, solved: s.solvedAt[i] !== null, timeMs: s.solvedAt[i], done: done(s, i) })),
      tries: TRIES,
      endsAt: s.endsAt,
      answer: s.finished ? s.answer : null,
    };
  },
  outcome(s) {
    if (!s.finished) return null;
    const seats = s.guesses.map((_, i) => i).filter((i) => !s.out[i]);
    const ranking = rankSeats(seats, (a, b) => {
      const sa = s.solvedAt[a] !== null, sb = s.solvedAt[b] !== null;
      if (sa !== sb) return sa ? 1 : -1;
      if (!sa) return 0;
      if (s.guesses[a].length !== s.guesses[b].length) return s.guesses[b].length - s.guesses[a].length;
      return Math.sign(s.solvedAt[b]! - s.solvedAt[a]!);
    });
    const scores = s.guesses.map((g, i) => (s.solvedAt[i] !== null ? TRIES + 1 - g.length : 0));
    const top = ranking[0][0];
    return {
      kind: s.n === 1 ? 'ranking' : resultKind(ranking), ranking, scores,
      summary: `The word was ${s.answer.toUpperCase()}`,
      reason: s.solvedAt[top] !== null ? `Solved in ${s.guesses[top].length}` : 'Nobody solved it',
    };
  },
  deadline(s) { return s.finished ? null : { seat: null, at: s.endsAt }; },
  onDeadline(s) { return { ...s, finished: true }; },
  drop(state, seat) {
    const s = clone(state);
    s.out[seat] = true;
    if (s.guesses.every((_, i) => done(s, i))) s.finished = true;
    return s;
  },
};
