import { fitsRack, isWord, wordsFromRack } from '../words/dictionary';
import type { Ctx, Engine } from './types';
import { clone, rankSeats, resultKind } from './types';

const ROUND_MS = 90_000;
const BREAK_MS = 8_000;
const ROUNDS = 3;
const VOWELS = 'aaaaeeeeeiiiioooouu';
const CONSONANTS = 'bbccddddffgghhjkllllmmnnnnnnppqrrrrrrssssssttttttvwwxyz';

export const LETTER_VALUE: Record<string, number> = Object.fromEntries(
  [
    ['aeioulnrst', 1], ['dghcmp', 2], ['bfkwyv', 3], ['jx', 5], ['qz', 6],
  ].flatMap(([letters, v]) => (letters as string).split('').map((l) => [l, v as number])),
);
const LENGTH_BONUS = [0, 0, 0, 0, 0, 2, 4, 6, 9, 12];

export function scoreWord(w: string) {
  return w.split('').reduce((a, c) => a + (LETTER_VALUE[c] ?? 1), 0) + LENGTH_BONUS[w.length];
}

export interface WdState {
  n: number;
  round: number;
  racks: string[][];
  best: string[][];
  possible: number[];
  phase: 'play' | 'break';
  phaseEndsAt: number;
  found: string[][][];
  scores: number[];
  out: boolean[];
  finished: boolean;
}

function makeRack(ctx: Ctx): { rack: string[]; all: string[] } {
  for (;;) {
    const vowels = 3 + ctx.randInt(2);
    const rack: string[] = [];
    for (let i = 0; i < vowels; i++) rack.push(VOWELS[ctx.randInt(VOWELS.length)]);
    while (rack.length < 9) rack.push(CONSONANTS[ctx.randInt(CONSONANTS.length)]);
    if (rack.includes('q') && !rack.includes('u')) continue;
    const all = wordsFromRack(rack);
    if (all.length >= 25 && all.some((w) => w.length >= 6)) {
      for (let i = rack.length - 1; i > 0; i--) {
        const j = ctx.randInt(i + 1);
        [rack[i], rack[j]] = [rack[j], rack[i]];
      }
      return { rack, all };
    }
  }
}

export const wordDuel: Engine<WdState> = {
  id: 'word-duel',
  minPlayers: 1,
  maxPlayers: 2,
  init(n, _o, ctx) {
    const racks: string[][] = [];
    const best: string[][] = [];
    const possible: number[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      const { rack, all } = makeRack(ctx);
      racks.push(rack);
      possible.push(all.length);
      best.push([...all].sort((a, b) => scoreWord(b) - scoreWord(a)).slice(0, 6));
    }
    return {
      n, round: 0, racks, best, possible, phase: 'play', phaseEndsAt: ctx.now + ROUND_MS,
      found: racks.map(() => Array.from({ length: n }, () => [])), scores: Array(n).fill(0),
      out: Array(n).fill(false), finished: false,
    };
  },
  start(s, ctx) { return { ...s, phase: 'play', phaseEndsAt: ctx.now + ROUND_MS }; },
  act(state, seat, raw) {
    if (state.finished) return 'The duel is over.';
    if (state.phase !== 'play') return 'The next round is about to start.';
    const word = String((raw as { word?: unknown })?.word ?? '').toLowerCase().trim();
    if (!/^[a-z]{3,9}$/.test(word)) return 'Words need at least three letters.';
    const counts = new Map<string, number>();
    for (const l of state.racks[state.round]) counts.set(l, (counts.get(l) ?? 0) + 1);
    if (!fitsRack(word, counts)) return 'Use only the letters in the rack.';
    if (state.found[state.round][seat].includes(word)) return 'You already found that one.';
    if (!isWord(word)) return 'Not in the dictionary.';
    const s = clone(state);
    s.found[s.round][seat].push(word);
    s.scores[seat] += scoreWord(word);
    return s;
  },
  view(s, seat) {
    const showAll = s.phase === 'break' || s.finished;
    const roundScore = (r: number, i: number) => s.found[r][i].reduce((a, w) => a + scoreWord(w), 0);
    return {
      round: s.round + 1, rounds: ROUNDS, rack: s.racks[s.round], phase: s.phase, phaseEndsAt: s.phaseEndsAt,
      mine: seat !== null ? s.found[s.round][seat] : [],
      myScore: seat !== null ? s.scores[seat] : null,
      counts: s.found[s.round].map((w) => w.length),
      // Running totals are hidden mid-round so players can't see who is ahead until it ends.
      scores: s.scores.map((sc, i) => (showAll || i === seat ? sc : s.scores[i] - roundScore(s.round, i))),
      reveal: showAll ? { found: s.found[s.round], best: s.best[s.round], possible: s.possible[s.round] } : null,
      values: LETTER_VALUE,
    };
  },
  outcome(s) {
    if (!s.finished) return null;
    const seats = s.scores.map((_, i) => i).filter((i) => !s.out[i]);
    const ranking = rankSeats(seats, (a, b) => s.scores[a] - s.scores[b]);
    return {
      kind: s.n === 1 ? 'ranking' : resultKind(ranking), ranking, scores: s.scores,
      summary: s.scores.join(' – '),
      reason: `${s.found.reduce((a, r) => a + r[ranking[0][0]].length, 0)} words found`,
    };
  },
  deadline(s) { return s.finished ? null : { seat: null, at: s.phaseEndsAt }; },
  onDeadline(state, ctx) {
    const s = clone(state);
    if (s.phase === 'play') { s.phase = 'break'; s.phaseEndsAt = ctx.now + BREAK_MS; return s; }
    if (s.round + 1 >= ROUNDS) { s.finished = true; return s; }
    s.round++;
    s.phase = 'play';
    s.phaseEndsAt = ctx.now + ROUND_MS;
    return s;
  },
  drop(state, seat) {
    const s = clone(state);
    s.out[seat] = true;
    return s;
  },
};
