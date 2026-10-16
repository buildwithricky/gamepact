import type { GameId } from '../../shared/catalog';
import type { MatchResult } from '../../shared/types';

export interface Ctx {
  now: number;
  /** Uniform [0,1) from a cryptographically secure source. */
  rand(): number;
  randInt(n: number): number;
  /** Standard normal sample. */
  gauss(): number;
}

export type Outcome = Omit<MatchResult, 'ratingChanges'> & {
  /** Seat -> achievement tags earned in this match (e.g. 'checkmate'). */
  tags?: Record<number, string[]>;
};

export interface Engine<S = any> {
  id: GameId;
  minPlayers: number;
  maxPlayers: number;
  init(players: number, options: Record<string, string>, ctx: Ctx): S;
  /** Apply a player's intent. Return the new state, or an error message. Must not mutate input. */
  act(state: S, seat: number, action: unknown, ctx: Ctx): S | string;
  /** What a seat (or a spectator, seat = null) is allowed to see. */
  view(state: S, seat: number | null, now: number): unknown;
  outcome(state: S): Outcome | null;
  /** The next server-enforced deadline, if any. seat = null means a phase timer for everyone. */
  deadline(state: S): { seat: number | null; at: number } | null;
  onDeadline(state: S, ctx: Ctx): S;
  /** Remove a seat that resigned or was forfeited in a multi-player game. */
  drop?(state: S, seat: number, ctx: Ctx): S;
  /** Pick an action for a bot seat, or null to wait. */
  bot?(state: S, seat: number, ctx: Ctx): unknown | null;
  /** Called when the match actually starts (all seats filled), so timers start fresh. */
  start?(state: S, ctx: Ctx): S;
}

export const clone = <T>(v: T): T => structuredClone(v);

/** Build a 2+-player ranking where `better(a,b) > 0` means a beats b. */
export function rankSeats(seats: number[], cmp: (a: number, b: number) => number): number[][] {
  const sorted = [...seats].sort((a, b) => -cmp(a, b));
  const groups: number[][] = [];
  for (const s of sorted) {
    const last = groups[groups.length - 1];
    if (last && cmp(last[0], s) === 0) last.push(s);
    else groups.push([s]);
  }
  return groups;
}

export function resultKind(ranking: number[][]): 'win' | 'draw' | 'ranking' {
  if (ranking.length === 1) return 'draw';
  return ranking.flat().length === 2 ? 'win' : 'ranking';
}
