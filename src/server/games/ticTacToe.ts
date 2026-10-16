import type { Engine } from './types';
import { clone } from './types';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const TURN_MS = 30_000;

export interface TttState {
  board: (number | null)[];
  turn: number;
  starter: number;
  bestOf: number;
  round: number;
  wins: [number, number];
  draws: number;
  lastRound: { winner: number | null; line: number[] | null; board: (number | null)[] } | null;
  turnStartedAt: number;
  finished: boolean;
  timedOut: number | null;
}

export function winLine(board: (number | null)[]): number[] | null {
  for (const l of LINES) {
    const [a, b, c] = l;
    if (board[a] !== null && board[a] === board[b] && board[a] === board[c]) return l;
  }
  return null;
}

function needed(s: TttState) { return Math.floor(s.bestOf / 2) + 1; }

function minimax(board: (number | null)[], me: number, turn: number, depth: number): number {
  const line = winLine(board);
  if (line) return board[line[0]] === me ? 10 - depth : depth - 10;
  if (board.every((c) => c !== null)) return 0;
  const scores: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null) continue;
    board[i] = turn;
    scores.push(minimax(board, me, 1 - turn, depth + 1));
    board[i] = null;
  }
  return turn === me ? Math.max(...scores) : Math.min(...scores);
}

export const ticTacToe: Engine<TttState> = {
  id: 'tic-tac-toe',
  minPlayers: 2,
  maxPlayers: 2,
  init(_n, options, ctx) {
    const bestOf = [1, 3, 5].includes(Number(options.bestOf)) ? Number(options.bestOf) : 3;
    return {
      board: Array(9).fill(null), turn: 0, starter: 0, bestOf, round: 1, wins: [0, 0], draws: 0,
      lastRound: null, turnStartedAt: ctx.now, finished: false, timedOut: null,
    };
  },
  start(s, ctx) { return { ...s, turnStartedAt: ctx.now }; },
  act(state, seat, action, ctx) {
    if (state.finished) return 'The match is over.';
    if (seat !== state.turn) return 'It is not your turn.';
    const cell = (action as { cell?: unknown })?.cell;
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 8) return 'Pick a square on the board.';
    if (state.board[cell] !== null) return 'That square is taken.';
    const s = clone(state);
    s.board[cell] = seat;
    const line = winLine(s.board);
    const full = s.board.every((c) => c !== null);
    if (line || full) {
      const winner = line ? seat : null;
      if (winner !== null) s.wins[winner]++;
      else s.draws++;
      s.lastRound = { winner, line, board: s.board };
      const done = s.wins[0] >= needed(s) || s.wins[1] >= needed(s) || s.round >= s.bestOf;
      if (done) { s.finished = true; return s; }
      s.round++;
      s.starter = 1 - s.starter;
      s.turn = s.starter;
      s.board = Array(9).fill(null);
    } else {
      s.turn = 1 - seat;
    }
    s.turnStartedAt = ctx.now;
    return s;
  },
  view(s) {
    return { board: s.board, turn: s.turn, round: s.round, bestOf: s.bestOf, wins: s.wins, draws: s.draws, lastRound: s.lastRound, winLine: winLine(s.board) };
  },
  outcome(s) {
    if (s.timedOut !== null) {
      const w = 1 - s.timedOut;
      return { kind: 'win', ranking: [[w], [s.timedOut]], scores: s.wins, summary: `${s.wins[0]}–${s.wins[1]}`, reason: 'Ran out of time' };
    }
    if (!s.finished) return null;
    const [a, b] = s.wins;
    const summary = `${a}–${b}${s.draws ? ` (${s.draws} drawn)` : ''}`;
    if (a === b) return { kind: 'draw', ranking: [[0, 1]], scores: s.wins, summary, reason: 'Level on rounds' };
    const w = a > b ? 0 : 1;
    return { kind: 'win', ranking: [[w], [1 - w]], scores: s.wins, summary, reason: s.bestOf === 1 ? 'Three in a row' : `Won ${Math.max(a, b)} rounds` };
  },
  deadline(s) {
    return s.finished || s.timedOut !== null ? null : { seat: s.turn, at: s.turnStartedAt + TURN_MS };
  },
  onDeadline(s) { return { ...s, timedOut: s.turn }; },
  bot(s, seat, ctx) {
    if (s.turn !== seat || s.finished) return null;
    const empty = s.board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
    if (ctx.rand() < 0.25) return { cell: empty[ctx.randInt(empty.length)] };
    let best = -Infinity;
    let picks: number[] = [];
    for (const i of empty) {
      const b = [...s.board];
      b[i] = seat;
      const v = minimax(b, seat, 1 - seat, 1);
      if (v > best) { best = v; picks = [i]; } else if (v === best) picks.push(i);
    }
    return { cell: picks[ctx.randInt(picks.length)] };
  },
};
