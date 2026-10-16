import type { MatchMode } from '../shared/catalog';
import type { MatchResult } from '../shared/types';
import type { Q } from './db';
import { audit, notify, type After } from './notify';
import { ACHIEVEMENTS } from '../shared/types';

export interface FinalSeat { seat: number; userId: string | null; bot: string | null }

export function seatOutcome(ranking: number[][], seat: number): 'win' | 'loss' | 'draw' {
  if (ranking.length === 1) return 'draw';
  const place = ranking.findIndex((g) => g.includes(seat));
  if (place === 0) return ranking[0].length === 1 ? 'win' : 'draw';
  return 'loss';
}

const placeOf = (ranking: number[][], seat: number) => {
  let p = 1;
  for (const g of ranking) { if (g.includes(seat)) return p; p += g.length; }
  return p;
};

/** Elo across all human seats, using pairwise results. Exported for tests. */
export function eloDeltas(
  seats: { seat: number; rating: number; ratedGames: number; k?: number }[],
  ranking: number[][],
): Record<number, number> {
  const out: Record<number, number> = {};
  const n = seats.length;
  for (const a of seats) {
    let sum = 0;
    for (const b of seats) {
      if (a === b) continue;
      const pa = placeOf(ranking, a.seat), pb = placeOf(ranking, b.seat);
      const score = pa < pb ? 1 : pa === pb ? 0.5 : 0;
      const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
      sum += score - expected;
    }
    const k = a.k ?? (a.ratedGames < 20 ? 40 : 24);
    out[a.seat] = Math.round((k * sum) / Math.max(1, n - 1));
  }
  return out;
}

/**
 * Persist a finished match exactly once. Returns null if it was already finalized.
 * Runs inside the caller's transaction.
 */
export async function finalizeMatch(
  q: Q,
  m: { id: string; gameId: string; mode: MatchMode; seats: FinalSeat[] },
  result: MatchResult,
  after: After,
): Promise<MatchResult | null> {
  const claimed = await q.one(
    `UPDATE matches SET status = 'COMPLETED', completed_at = now(), result = $2, state = NULL
      WHERE id = $1 AND status = 'IN_PROGRESS' RETURNING id`,
    [m.id, JSON.stringify(result)],
  );
  if (!claimed) return null;

  const humans = m.seats.filter((s) => s.userId);
  const counted = m.mode !== 'practice';
  const ratingChanges: Record<number, { before: number; after: number }> = {};

  // Current ratings for everyone involved.
  const current: Record<string, { rating: number; rated_games: number }> = {};
  for (const h of humans) {
    await q.query(`INSERT INTO ratings (user_id, game_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [h.userId, m.gameId]);
    const r = await q.one('SELECT rating, rated_games FROM ratings WHERE user_id = $1 AND game_id = $2 FOR UPDATE', [h.userId, m.gameId]);
    current[h.userId!] = { rating: Number(r.rating), rated_games: Number(r.rated_games) };
  }

  let deltas: Record<number, number> = {};
  const rated = m.mode === 'ranked' && humans.length >= 2 && humans.length === m.seats.length;
  if (rated) {
    // Anti-farming: repeated ranked games between the same two accounts stop moving ratings.
    let k: number | undefined;
    if (humans.length === 2) {
      const recent = await q.one(
        `SELECT count(*)::int AS n FROM matches mt
           JOIN match_participants a ON a.match_id = mt.id AND a.user_id = $1
           JOIN match_participants b ON b.match_id = mt.id AND b.user_id = $2
          WHERE mt.mode = 'ranked' AND mt.status = 'COMPLETED' AND mt.game_id = $3
            AND mt.completed_at > now() - interval '24 hours' AND mt.id <> $4`,
        [humans[0].userId, humans[1].userId, m.gameId, m.id],
      );
      if (Number(recent?.n) >= 4) {
        k = 0;
        await audit(q, null, 'rating.farm_guard', m.id, { users: humans.map((h) => h.userId) });
      }
    }
    deltas = eloDeltas(
      humans.map((h) => ({ seat: h.seat, rating: current[h.userId!].rating, ratedGames: current[h.userId!].rated_games, k })),
      result.ranking,
    );
  }

  for (const h of humans) {
    const outcome = seatOutcome(result.ranking, h.seat);
    const before = current[h.userId!].rating;
    const afterRating = before + (deltas[h.seat] ?? 0);
    await q.query(
      `UPDATE match_participants SET final_score = $3, outcome = $4, placement = $5, rating_before = $6, rating_after = $7
        WHERE match_id = $1 AND seat = $2`,
      [m.id, h.seat, result.scores[h.seat] ?? null, outcome, placeOf(result.ranking, h.seat), rated ? before : null, rated ? afterRating : null],
    );
    if (!counted) continue;
    await q.query(
      `UPDATE ratings SET
          games = games + 1,
          wins = wins + $3, losses = losses + $4, draws = draws + $5,
          streak = CASE WHEN $3 = 1 THEN streak + 1 ELSE 0 END,
          rating = $6, peak = GREATEST(peak, $6), rated_games = rated_games + $7, updated_at = now()
        WHERE user_id = $1 AND game_id = $2`,
      [h.userId, m.gameId, outcome === 'win' ? 1 : 0, outcome === 'loss' ? 1 : 0, outcome === 'draw' ? 1 : 0, afterRating, rated ? 1 : 0],
    );
    if (rated) {
      await q.query(
        'INSERT INTO rating_changes (match_id, user_id, game_id, before, after) VALUES ($1, $2, $3, $4, $5)',
        [m.id, h.userId, m.gameId, before, afterRating],
      );
      ratingChanges[h.seat] = { before, after: afterRating };
    }
    await grantFromMatch(q, h.userId!, (result as any).tags?.[h.seat] ?? [], after);
  }
  return { ...result, ratingChanges: rated ? ratingChanges : undefined };
}

async function grantFromMatch(q: Q, userId: string, tags: string[], after: After) {
  const stats = await q.one(
    `SELECT COALESCE(sum(games), 0)::int AS games, COALESCE(sum(wins), 0)::int AS wins, COALESCE(max(streak), 0)::int AS streak
       FROM ratings WHERE user_id = $1`,
    [userId],
  );
  const keys = [...tags];
  if (stats.wins >= 1) keys.push('first_win');
  if (stats.games >= 10) keys.push('ten_matches');
  if (stats.streak >= 5) keys.push('streak_5');
  for (const k of keys) await grant(q, userId, k, after);
}

export async function grant(q: Q, userId: string, key: string, after: After) {
  if (!ACHIEVEMENTS[key]) return;
  const row = await q.one('INSERT INTO achievements (user_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING key', [userId, key]);
  if (row) await notify(q, userId, 'achievement', { key, name: ACHIEVEMENTS[key].name }, after);
}
