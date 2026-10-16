import type { Ctx, Engine } from './types';
import { clone, rankSeats, resultKind } from './types';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];
const TURN_MS = 30_000;
const MAX_STRIKES = 3;

export const rankOf = (c: string) => c.slice(0, -1);
export const suitOf = (c: string) => c.slice(-1);
export function cardPoints(c: string) {
  const r = rankOf(c);
  if (r === '8') return 50;
  if (r === 'A') return 1;
  if (['J', 'Q', 'K', '10'].includes(r)) return 10;
  return Number(r);
}

export interface C8State {
  n: number;
  hands: string[][];
  draw: string[];
  discard: string[];
  suit: string;
  turn: number;
  drawnCard: string | null;
  out: boolean[];
  strikes: number[];
  totals: number[];
  target: number;
  drawUntil: boolean;
  round: number;
  roundWinner: number | null;
  lastRound: { winner: number; points: number } | null;
  log: { seat: number; text: string }[];
  turnStartedAt: number;
  finished: boolean;
}

function shuffle(a: string[], ctx: Ctx) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = ctx.randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deal(s: C8State, ctx: Ctx) {
  const deck = shuffle(RANKS.flatMap((r) => SUITS.map((x) => r + x)), ctx);
  const size = s.n === 2 ? 7 : 5;
  s.hands = Array.from({ length: s.n }, (_, i) => (s.out[i] ? [] : deck.splice(0, size)));
  let top = deck.shift()!;
  while (rankOf(top) === '8') { deck.push(top); top = deck.shift()!; }
  s.discard = [top];
  s.suit = suitOf(top);
  s.draw = deck;
  s.drawnCard = null;
  s.roundWinner = null;
}

function nextActive(s: C8State, from: number) {
  for (let k = 1; k <= s.n; k++) {
    const i = (from + k) % s.n;
    if (!s.out[i]) return i;
  }
  return from;
}

export function canPlay(s: { discard: string[]; suit: string }, card: string) {
  const top = s.discard[s.discard.length - 1];
  return rankOf(card) === '8' || suitOf(card) === s.suit || rankOf(card) === rankOf(top);
}

function drawOne(s: C8State, ctx: Ctx): string | null {
  if (s.draw.length === 0) {
    const top = s.discard.pop()!;
    s.draw = shuffle(s.discard, ctx);
    s.discard = [top];
  }
  return s.draw.shift() ?? null;
}

function pushLog(s: C8State, seat: number, text: string) {
  s.log.push({ seat, text });
  if (s.log.length > 8) s.log.shift();
}

function endTurn(s: C8State, ctx: Ctx) {
  s.drawnCard = null;
  s.turn = nextActive(s, s.turn);
  s.turnStartedAt = ctx.now;
}

function finishRound(s: C8State, winner: number, ctx: Ctx) {
  const points = s.hands.reduce((sum, h, i) => (i === winner ? sum : sum + h.reduce((a, c) => a + cardPoints(c), 0)), 0);
  s.totals[winner] += points;
  s.lastRound = { winner, points };
  s.roundWinner = winner;
  if (s.target === 0 || s.totals[winner] >= s.target) { s.finished = true; return; }
  s.round++;
  deal(s, ctx);
  s.turn = nextActive(s, winner - 1 < 0 ? s.n - 1 : winner - 1);
  s.turnStartedAt = ctx.now;
}

export const crazyEights: Engine<C8State> = {
  id: 'crazy-eights',
  minPlayers: 2,
  maxPlayers: 4,
  init(n, options, ctx) {
    const s: C8State = {
      n, hands: [], draw: [], discard: [], suit: 'S', turn: 0, drawnCard: null,
      out: Array(n).fill(false), strikes: Array(n).fill(0), totals: Array(n).fill(0),
      target: options.target === '100' ? 100 : 0, drawUntil: options.draw === 'until',
      round: 1, roundWinner: null, lastRound: null, log: [], turnStartedAt: ctx.now, finished: false,
    };
    deal(s, ctx);
    return s;
  },
  start(s, ctx) { return { ...s, turnStartedAt: ctx.now }; },
  act(state, seat, raw, ctx) {
    if (state.finished) return 'The match is over.';
    if (seat !== state.turn) return 'It is not your turn.';
    const a = (raw ?? {}) as { type?: string; card?: string; suit?: string };
    const s = clone(state);
    s.strikes[seat] = 0;
    const hand = s.hands[seat];

    if (a.type === 'play') {
      const card = String(a.card);
      const idx = hand.indexOf(card);
      if (idx < 0) return 'You don’t have that card.';
      if (s.drawnCard && card !== s.drawnCard) return 'After drawing you can only play the card you drew.';
      if (!canPlay(s, card)) return 'That card doesn’t match the suit or rank.';
      if (rankOf(card) === '8' && !SUITS.includes(String(a.suit))) return 'Choose a suit for your eight.';
      hand.splice(idx, 1);
      s.discard.push(card);
      s.suit = rankOf(card) === '8' ? String(a.suit) : suitOf(card);
      pushLog(s, seat, rankOf(card) === '8' ? `played ${card} and called ${s.suit}` : `played ${card}`);
      if (hand.length === 0) { finishRound(s, seat, ctx); return s; }
      endTurn(s, ctx);
      return s;
    }
    if (a.type === 'draw') {
      if (s.drawnCard) return 'You have already drawn this turn.';
      let card = drawOne(s, ctx);
      if (!card) { pushLog(s, seat, 'couldn’t draw and passed'); endTurn(s, ctx); return s; }
      hand.push(card);
      let count = 1;
      if (s.drawUntil) {
        while (!canPlay(s, card!)) {
          const next = drawOne(s, ctx);
          if (!next) break;
          card = next;
          hand.push(card);
          count++;
        }
      }
      pushLog(s, seat, count === 1 ? 'drew a card' : `drew ${count} cards`);
      if (canPlay(s, card!)) s.drawnCard = card;
      else endTurn(s, ctx);
      return s;
    }
    if (a.type === 'pass') {
      if (!s.drawnCard) return 'Draw a card before passing.';
      pushLog(s, seat, 'passed');
      endTurn(s, ctx);
      return s;
    }
    return 'Unknown action.';
  },
  view(s, seat) {
    return {
      hand: seat !== null ? s.hands[seat] : null,
      counts: s.hands.map((h) => h.length),
      top: s.discard[s.discard.length - 1],
      suit: s.suit,
      drawCount: s.draw.length,
      turn: s.turn,
      drawnCard: seat === s.turn ? s.drawnCard : null,
      hasDrawn: s.drawnCard !== null,
      out: s.out,
      totals: s.totals,
      target: s.target,
      round: s.round,
      lastRound: s.lastRound,
      log: s.log,
      // Once the match is over every hand is shown so the scoring can be checked.
      reveal: s.finished ? s.hands : null,
    };
  },
  outcome(s) {
    if (!s.finished) return null;
    const active = s.hands.map((_, i) => i).filter((i) => !s.out[i]);
    const remaining = s.hands.map((h) => h.reduce((a, c) => a + cardPoints(c), 0));
    const ranking = rankSeats(active, (a, b) => {
      if (s.target === 0) {
        if (a === s.roundWinner) return 1;
        if (b === s.roundWinner) return -1;
        return remaining[b] - remaining[a];
      }
      return s.totals[a] - s.totals[b];
    });
    const w = s.lastRound?.winner ?? ranking[0][0];
    return {
      kind: resultKind(ranking), ranking, scores: s.totals,
      summary: s.target === 0 ? `Went out and scored ${s.lastRound?.points ?? 0}` : `${s.totals[w]} points`,
      reason: 'Emptied their hand',
    };
  },
  deadline(s) { return s.finished ? null : { seat: s.turn, at: s.turnStartedAt + TURN_MS }; },
  onDeadline(state, ctx) {
    const s = clone(state);
    const seat = s.turn;
    s.strikes[seat]++;
    if (s.strikes[seat] >= MAX_STRIKES) return crazyEights.drop!(s, seat, ctx);
    if (!s.drawnCard) {
      const card = drawOne(s, ctx);
      if (card) s.hands[seat].push(card);
    }
    pushLog(s, seat, 'ran out of time');
    endTurn(s, ctx);
    return s;
  },
  drop(state, seat, ctx) {
    const s = clone(state);
    s.out[seat] = true;
    s.draw.push(...s.hands[seat]);
    s.hands[seat] = [];
    pushLog(s, seat, 'left the table');
    if (s.out.filter((o) => !o).length <= 1) { s.finished = true; s.roundWinner = s.out.indexOf(false); return s; }
    if (s.turn === seat) endTurn(s, ctx);
    return s;
  },
  bot(s, seat) {
    if (s.finished || s.turn !== seat) return null;
    const hand = s.hands[seat];
    const counts: Record<string, number> = { S: 0, H: 0, D: 0, C: 0 };
    for (const c of hand) if (rankOf(c) !== '8') counts[suitOf(c)]++;
    const favourite = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const options = (s.drawnCard ? [s.drawnCard] : hand).filter((c) => canPlay(s, c));
    const normal = options.filter((c) => rankOf(c) !== '8').sort((a, b) => cardPoints(b) - cardPoints(a));
    if (normal.length) return { type: 'play', card: normal[0] };
    if (options.length) return { type: 'play', card: options[0], suit: favourite };
    return s.drawnCard ? { type: 'pass' } : { type: 'draw' };
  },
};
