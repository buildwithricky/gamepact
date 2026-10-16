import { GAME_BY_ID, sanitizeOptions } from '../shared/catalog';
import type { Q } from './db';
import { matches } from './matches';
import { audit, notify, type After } from './notify';
import { grant } from './results';
import { cleanText, HttpError, newId, shortCode } from './security';
import { S } from './state';
import type { SessionUser } from './auth';

export const CAPACITIES = [4, 8, 16, 32, 64];
const OPEN = ['REGISTRATION_OPEN', 'CHECK_IN'];

/** Bracket order for a power-of-two field: seed 1 meets the last seed, and 1 and 2 can only meet in the final. */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

export const placementForLoss = (round: number, rounds: number) => 2 ** (rounds - round) + 1;

const runAfter = (after: After) => after.forEach((f) => f());

// ------------------------------------------------------------------ create & manage

export async function createTournament(user: SessionUser, body: any) {
  const meta = GAME_BY_ID[String(body?.gameId)];
  if (!meta || meta.status !== 'live') throw new HttpError(400, 'Pick a game that’s available.');
  const title = cleanText(String(body?.title ?? '')).slice(0, 60);
  if (title.length < 3) throw new HttpError(400, 'Give the tournament a name of at least 3 characters.');
  const capacity = Number(body?.capacity);
  if (!CAPACITIES.includes(capacity)) throw new HttpError(400, 'Choose 4, 8, 16, 32 or 64 players.');
  const startsAt = new Date(body?.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new HttpError(400, 'Pick a start time.');
  if (startsAt.getTime() < Date.now() - 60_000) throw new HttpError(400, 'The start time is in the past.');
  if (startsAt.getTime() > Date.now() + 30 * 86_400_000) throw new HttpError(400, 'Tournaments can start up to 30 days ahead.');
  const checkin = [0, 10, 15, 30].includes(Number(body?.checkinMinutes)) ? Number(body.checkinMinutes) : 0;
  const deadline = [5, 10, 15, 30].includes(Number(body?.matchDeadlineMinutes)) ? Number(body.matchDeadlineMinutes) : 10;
  const visibility = body?.visibility === 'private' ? 'private' : 'public';
  const id = newId(10);
  const after: After = [];
  await S.db.tx(async (q) => {
    const active = await q.one(`SELECT count(*)::int AS n FROM tournaments WHERE host_id = $1 AND status IN ('DRAFT','REGISTRATION_OPEN','CHECK_IN','IN_PROGRESS')`, [user.id]);
    if (Number(active.n) >= 5) throw new HttpError(429, 'You can host up to five open tournaments at once.');
    await q.query(
      `INSERT INTO tournaments (id, host_id, game_id, title, description, bragging, visibility, invite_code, status, capacity, options,
                                checkin_minutes, match_deadline_minutes, starts_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, user.id, meta.id, title, cleanText(String(body?.description ?? '')).slice(0, 500), cleanText(String(body?.bragging ?? '')).slice(0, 60),
        visibility, visibility === 'private' ? shortCode(8) : null, body?.publish === false ? 'DRAFT' : 'REGISTRATION_OPEN',
        capacity, JSON.stringify(sanitizeOptions(meta, body?.options)), checkin, deadline, startsAt],
    );
    if (body?.hostPlays !== false) await q.query('INSERT INTO tournament_participants (tournament_id, user_id) VALUES ($1, $2)', [id, user.id]);
    await audit(q, user.id, 'tournament.create', id);
  });
  runAfter(after);
  return id;
}

async function lockTournament(q: Q, id: string) {
  const t = await q.one('SELECT * FROM tournaments WHERE id = $1 FOR UPDATE', [id]);
  if (!t) throw new HttpError(404, 'Tournament not found.');
  return t;
}

export async function publish(user: SessionUser, id: string) {
  await S.db.tx(async (q) => {
    const t = await lockTournament(q, id);
    if (t.host_id !== user.id) throw new HttpError(403, 'Only the host can publish.');
    if (t.status !== 'DRAFT') throw new HttpError(409, 'Already published.');
    await q.query(`UPDATE tournaments SET status = 'REGISTRATION_OPEN' WHERE id = $1`, [id]);
  });
}

export async function register(user: SessionUser, id: string, code?: string) {
  const after: After = [];
  await S.db.tx(async (q) => {
    const t = await lockTournament(q, id);
    if (!OPEN.includes(t.status)) throw new HttpError(409, 'Registration is closed.');
    if (t.visibility === 'private' && t.host_id !== user.id && code !== t.invite_code) throw new HttpError(403, 'You need the invite link to join this tournament.');
    const count = await q.one(`SELECT count(*)::int AS n FROM tournament_participants WHERE tournament_id = $1 AND status <> 'withdrawn'`, [id]);
    if (Number(count.n) >= t.capacity) throw new HttpError(409, 'The tournament is full.');
    const existing = await q.one('SELECT status FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2', [id, user.id]);
    if (existing && existing.status !== 'withdrawn') throw new HttpError(409, 'You’re already registered.');
    const status = t.status === 'CHECK_IN' ? 'checked_in' : 'registered';
    if (existing) await q.query('UPDATE tournament_participants SET status = $3, registered_at = now() WHERE tournament_id = $1 AND user_id = $2', [id, user.id, status]);
    else await q.query('INSERT INTO tournament_participants (tournament_id, user_id, status) VALUES ($1, $2, $3)', [id, user.id, status]);
    if (t.host_id !== user.id) await notify(q, t.host_id, 'tournament.registered', { tournamentId: id, title: t.title, username: user.username }, after);
  });
  runAfter(after);
}

export async function checkIn(user: SessionUser, id: string) {
  await S.db.tx(async (q) => {
    const t = await lockTournament(q, id);
    if (t.status !== 'CHECK_IN') throw new HttpError(409, 'Check-in isn’t open.');
    const r = await q.one(`UPDATE tournament_participants SET status = 'checked_in' WHERE tournament_id = $1 AND user_id = $2 AND status = 'registered' RETURNING user_id`, [id, user.id]);
    if (!r) throw new HttpError(409, 'You’re not registered, or you’ve already checked in.');
  });
}

export async function withdraw(user: SessionUser, id: string) {
  const after: After = [];
  let liveMatchId: string | null = null;
  let walkover: { tmId: string; winner: string } | null = null;
  await S.db.tx(async (q) => {
    const t = await lockTournament(q, id);
    const p = await q.one('SELECT status FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2', [id, user.id]);
    if (!p || ['withdrawn', 'eliminated', 'champion'].includes(p.status)) throw new HttpError(409, 'You’re not in this tournament.');
    if (OPEN.includes(t.status) || t.status === 'DRAFT') {
      await q.query('DELETE FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2', [id, user.id]);
      return;
    }
    if (t.status !== 'IN_PROGRESS') throw new HttpError(409, 'This tournament is over.');
    await q.query(`UPDATE tournament_participants SET status = 'withdrawn' WHERE tournament_id = $1 AND user_id = $2`, [id, user.id]);
    const tm = await q.one(
      `SELECT * FROM tournament_matches WHERE tournament_id = $1 AND winner_id IS NULL AND (a_user = $2 OR b_user = $2) ORDER BY round LIMIT 1`, [id, user.id]);
    if (tm?.match_id && matches.live.get(tm.match_id)?.status === 'IN_PROGRESS') liveMatchId = tm.match_id;
    else if (tm && tm.a_user && tm.b_user) walkover = { tmId: tm.id, winner: tm.a_user === user.id ? tm.b_user : tm.a_user };
  });
  runAfter(after);
  if (liveMatchId) {
    const m = matches.live.get(liveMatchId)!;
    const seat = matches.seatOf(m, user.id);
    if (seat !== null) await matches.forfeit(m, seat, 'Withdrew');
  } else if (walkover) {
    const w = walkover as { tmId: string; winner: string };
    const m = [...matches.live.values()].find((x) => x.tournament?.tmId === w.tmId && x.status === 'WAITING');
    if (m) await matches.cancel(m, 'Opponent withdrew.');
    await walkoverMatch(w.tmId, w.winner, 'Opponent withdrew');
  }
  spawnReady(id).catch((e) => console.error('[tournament spawn]', e));
}

export async function cancelTournament(user: SessionUser, id: string) {
  const after: After = [];
  await S.db.tx(async (q) => {
    const t = await lockTournament(q, id);
    if (t.host_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Only the host can cancel.');
    if (!['DRAFT', ...OPEN].includes(t.status) && user.role !== 'admin') throw new HttpError(409, 'Tournaments can’t be cancelled once they’ve started.');
    if (['COMPLETED', 'CANCELLED'].includes(t.status)) throw new HttpError(409, 'This tournament is already finished.');
    await q.query(`UPDATE tournaments SET status = 'CANCELLED' WHERE id = $1`, [id]);
    const ps = await q.query(`SELECT user_id FROM tournament_participants WHERE tournament_id = $1 AND status <> 'withdrawn'`, [id]);
    for (const p of ps) if (p.user_id !== user.id) await notify(q, p.user_id, 'tournament.cancelled', { tournamentId: id, title: t.title }, after);
    await audit(q, user.id, 'tournament.cancel', id);
  });
  runAfter(after);
  for (const m of matches.live.values()) if (m.tournament?.id === id && m.status === 'WAITING') await matches.cancel(m, 'The tournament was cancelled.');
}

export async function post(user: SessionUser, id: string, body: string) {
  const t = await S.db.one('SELECT host_id, title FROM tournaments WHERE id = $1', [id]);
  if (!t) throw new HttpError(404, 'Tournament not found.');
  if (t.host_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Only the host can post announcements.');
  const text = cleanText(body).slice(0, 280);
  if (!text) throw new HttpError(400, 'Write something first.');
  const after: After = [];
  await S.db.tx(async (q) => {
    await q.query('INSERT INTO tournament_posts (id, tournament_id, user_id, body) VALUES ($1, $2, $3, $4)', [newId(8), id, user.id, text]);
    const ps = await q.query(`SELECT user_id FROM tournament_participants WHERE tournament_id = $1 AND status NOT IN ('withdrawn')`, [id]);
    for (const p of ps) if (p.user_id !== user.id) await notify(q, p.user_id, 'tournament.post', { tournamentId: id, title: t.title, text }, after);
  });
  runAfter(after);
}

// ------------------------------------------------------------------ running the bracket

export async function startTournament(id: string, by?: SessionUser) {
  const after: After = [];
  await S.db.tx(async (q) => {
    const t = await lockTournament(q, id);
    if (by && t.host_id !== by.id && by.role !== 'admin') throw new HttpError(403, 'Only the host can start the tournament.');
    if (!OPEN.includes(t.status)) { if (by) throw new HttpError(409, 'This tournament can’t be started now.'); return; }
    const eligibleStatus = t.checkin_minutes > 0 && t.status === 'CHECK_IN' ? ['checked_in'] : ['registered', 'checked_in'];
    const players = await q.query(
      `SELECT p.user_id, COALESCE(r.rating, 1200) AS rating, p.registered_at
         FROM tournament_participants p
         LEFT JOIN ratings r ON r.user_id = p.user_id AND r.game_id = $2
        WHERE p.tournament_id = $1 AND p.status = ANY($3)
        ORDER BY COALESCE(r.rating, 1200) DESC, p.registered_at ASC`,
      [id, t.game_id, eligibleStatus],
    );
    if (players.length < 2) {
      await q.query(`UPDATE tournaments SET status = 'CANCELLED' WHERE id = $1`, [id]);
      const all = await q.query(`SELECT user_id FROM tournament_participants WHERE tournament_id = $1`, [id]);
      for (const p of all) await notify(q, p.user_id, 'tournament.cancelled', { tournamentId: id, title: t.title, reason: 'Not enough players checked in.' }, after);
      return;
    }
    // Players who registered but didn't check in drop out.
    await q.query(`UPDATE tournament_participants SET status = 'withdrawn' WHERE tournament_id = $1 AND NOT (status = ANY($2))`, [id, eligibleStatus]);
    let size = 2;
    while (size < players.length) size *= 2;
    const rounds = Math.log2(size);
    for (let i = 0; i < players.length; i++) {
      await q.query(`UPDATE tournament_participants SET seed = $3, status = 'active' WHERE tournament_id = $1 AND user_id = $2`, [id, players[i].user_id, i + 1]);
    }
    for (let r = 1; r <= rounds; r++) {
      for (let s = 0; s < size / 2 ** r; s++) {
        await q.query('INSERT INTO tournament_matches (id, tournament_id, round, slot) VALUES ($1, $2, $3, $4)', [newId(10), id, r, s]);
      }
    }
    const order = seedOrder(size);
    for (let s = 0; s < size / 2; s++) {
      const sa = order[2 * s], sb = order[2 * s + 1];
      const a = players[sa - 1]?.user_id ?? null, b = players[sb - 1]?.user_id ?? null;
      await q.query(`UPDATE tournament_matches SET a_user = $3, b_user = $4, a_seed = $5, b_seed = $6 WHERE tournament_id = $1 AND round = 1 AND slot = $2`,
        [id, s, a, b, a ? sa : null, b ? sb : null]);
    }
    await q.query(`UPDATE tournaments SET status = 'IN_PROGRESS', started_at = now() WHERE id = $1`, [id]);
    // Byes: top seeds without an opponent advance straight away.
    const firsts = await q.query('SELECT * FROM tournament_matches WHERE tournament_id = $1 AND round = 1 ORDER BY slot', [id]);
    for (const tm of firsts) {
      if (tm.a_user && !tm.b_user) await setWinner(q, tm, tm.a_user, 'Bye', after, true);
      else if (tm.b_user && !tm.a_user) await setWinner(q, tm, tm.b_user, 'Bye', after, true);
    }
    await markReady(q, id, after);
    for (const p of players) await notify(q, p.user_id, 'tournament.started', { tournamentId: id, title: t.title }, after);
  });
  runAfter(after);
  await spawnReady(id);
}

async function markReady(q: Q, tournamentId: string, after: After) {
  const t = await q.one('SELECT title FROM tournaments WHERE id = $1', [tournamentId]);
  const rows = await q.query(
    `SELECT * FROM tournament_matches WHERE tournament_id = $1 AND status = 'pending' AND a_user IS NOT NULL AND b_user IS NOT NULL`, [tournamentId]);
  for (const tm of rows) {
    const ps = await q.query('SELECT user_id, status FROM tournament_participants WHERE tournament_id = $1 AND user_id = ANY($2)', [tournamentId, [tm.a_user, tm.b_user]]);
    const gone = (u: string) => ps.find((p) => p.user_id === u)?.status === 'withdrawn';
    if (gone(tm.a_user) || gone(tm.b_user)) {
      const winner = gone(tm.a_user) ? tm.b_user : tm.a_user;
      await setWinner(q, tm, winner, 'Opponent withdrew', after);
      await markReady(q, tournamentId, after);
      return;
    }
    await q.query(`UPDATE tournament_matches SET status = 'ready', ready_at = now() WHERE id = $1`, [tm.id]);
    for (const [me, them] of [[tm.a_user, tm.b_user], [tm.b_user, tm.a_user]]) {
      const opp = await q.one('SELECT username FROM users WHERE id = $1', [them]);
      await notify(q, me, 'tournament.match_ready', { tournamentId, title: t.title, round: tm.round, opponent: opp?.username }, after);
    }
  }
}

/** Record a bracket result exactly once and move the winner on. */
async function setWinner(q: Q, tm: any, winnerId: string, note: string, after: After, isBye = false) {
  const done = await q.one(
    `UPDATE tournament_matches SET winner_id = $2, status = $3, result_note = $4 WHERE id = $1 AND winner_id IS NULL RETURNING *`,
    [tm.id, winnerId, isBye ? 'bye' : 'done', note]);
  if (!done) return;
  const t = await q.one('SELECT * FROM tournaments WHERE id = $1', [tm.tournament_id]);
  const total = await q.one('SELECT max(round)::int AS r FROM tournament_matches WHERE tournament_id = $1', [tm.tournament_id]);
  const rounds = Number(total.r);
  const loser = done.a_user === winnerId ? done.b_user : done.a_user;
  if (loser) {
    await q.query(`UPDATE tournament_participants SET status = CASE WHEN status = 'withdrawn' THEN 'withdrawn' ELSE 'eliminated' END, final_placement = $3
                    WHERE tournament_id = $1 AND user_id = $2`, [tm.tournament_id, loser, placementForLoss(done.round, rounds)]);
  }
  if (done.round === rounds) {
    await q.query(`UPDATE tournament_participants SET status = 'champion', final_placement = 1 WHERE tournament_id = $1 AND user_id = $2`, [tm.tournament_id, winnerId]);
    await q.query(`UPDATE tournaments SET status = 'COMPLETED', completed_at = now(), champion_id = $2 WHERE id = $1`, [tm.tournament_id, winnerId]);
    await grant(q, winnerId, 'champion', after);
    await grant(q, winnerId, 'finalist', after);
    if (loser) await grant(q, loser, 'finalist', after);
    await grant(q, t.host_id, 'host', after);
    const champ = await q.one('SELECT username FROM users WHERE id = $1', [winnerId]);
    const ps = await q.query('SELECT user_id FROM tournament_participants WHERE tournament_id = $1', [tm.tournament_id]);
    for (const p of ps) await notify(q, p.user_id, 'tournament.completed', { tournamentId: tm.tournament_id, title: t.title, champion: champ?.username, bragging: t.bragging }, after);
    return;
  }
  const side = done.slot % 2 === 0 ? 'a' : 'b';
  const seed = done.a_user === winnerId ? done.a_seed : done.b_seed;
  await q.query(
    `UPDATE tournament_matches SET ${side}_user = $4, ${side}_seed = $5 WHERE tournament_id = $1 AND round = $2 AND slot = $3`,
    [tm.tournament_id, done.round + 1, Math.floor(done.slot / 2), winnerId, seed]);
}

/** Hook for the match manager: called inside the match-finalizing transaction. */
export async function onMatchResult(q: Q, tmId: string, winnerId: string | null, note: string, after: After) {
  const tm = await q.one('SELECT * FROM tournament_matches WHERE id = $1 FOR UPDATE', [tmId]);
  if (!tm || tm.winner_id) return;
  if (!winnerId) {
    if (tm.replays < 2) {
      await q.query(`UPDATE tournament_matches SET status = 'ready', match_id = NULL, replays = replays + 1, ready_at = now(), result_note = 'Drawn — replaying' WHERE id = $1`, [tmId]);
      return;
    }
    winnerId = (tm.a_seed ?? 999) < (tm.b_seed ?? 999) ? tm.a_user : tm.b_user;
    note = 'Drawn three times — higher seed advances';
  }
  await setWinner(q, tm, winnerId!, note, after);
  await markReady(q, tm.tournament_id, after);
}

export async function walkoverMatch(tmId: string, winnerId: string | null, note: string) {
  const after: After = [];
  await S.db.tx(async (q) => {
    const tm = await q.one('SELECT * FROM tournament_matches WHERE id = $1 FOR UPDATE', [tmId]);
    if (!tm || tm.winner_id) return;
    const w = winnerId ?? ((tm.a_seed ?? 999) < (tm.b_seed ?? 999) ? tm.a_user : tm.b_user);
    await setWinner(q, tm, w, note, after);
    await markReady(q, tm.tournament_id, after);
  });
  runAfter(after);
}

const spawning = new Map<string, Promise<void>>();
/** Create live matches for every bracket pairing that's ready to play. */
export function spawnReady(tournamentId: string): Promise<void> {
  const prev = spawning.get(tournamentId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const t = await S.db.one('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
    if (!t || t.status !== 'IN_PROGRESS') return;
    const rows = await S.db.query(`SELECT * FROM tournament_matches WHERE tournament_id = $1 AND status = 'ready' AND match_id IS NULL`, [tournamentId]);
    for (const tm of rows) {
      const users = await S.db.query('SELECT id, username, avatar FROM users WHERE id = ANY($1)', [[tm.a_user, tm.b_user]]);
      const a = users.find((u) => u.id === tm.a_user), b = users.find((u) => u.id === tm.b_user);
      if (!a || !b) continue;
      const deadline = new Date(tm.ready_at ?? Date.now()).getTime() + t.match_deadline_minutes * 60_000;
      const m = await matches.create({
        gameId: t.game_id, mode: 'tournament', host: null, options: t.options, players: [a, b],
        tournament: { id: t.id, title: t.title, round: tm.round, tmId: tm.id, deadline },
      });
      await S.db.query(`UPDATE tournament_matches SET match_id = $2, status = 'live' WHERE id = $1 AND match_id IS NULL`, [tm.id, m.id]);
    }
    S.io?.to(`tournament:${tournamentId}`).emit('tournament:update', { id: tournamentId });
  }).catch((e) => console.error('[tournament spawn]', tournamentId, e));
  spawning.set(tournamentId, next);
  return next;
}

// ------------------------------------------------------------------ scheduler

export async function tournamentTick(now = new Date()) {
  const due = await S.db.query(
    `SELECT id, status, checkin_minutes, starts_at, title FROM tournaments
      WHERE (status = 'REGISTRATION_OPEN' AND (starts_at <= $1 OR (checkin_minutes > 0 AND starts_at - make_interval(mins => checkin_minutes) <= $1)))
         OR (status = 'CHECK_IN' AND starts_at <= $1)`,
    [now],
  );
  for (const t of due) {
    if (t.status === 'REGISTRATION_OPEN' && t.checkin_minutes > 0 && new Date(t.starts_at) > now) {
      const after: After = [];
      await S.db.tx(async (q) => {
        const r = await q.one(`UPDATE tournaments SET status = 'CHECK_IN' WHERE id = $1 AND status = 'REGISTRATION_OPEN' RETURNING id`, [t.id]);
        if (!r) return;
        const ps = await q.query(`SELECT user_id FROM tournament_participants WHERE tournament_id = $1 AND status = 'registered'`, [t.id]);
        for (const p of ps) await notify(q, p.user_id, 'tournament.checkin', { tournamentId: t.id, title: t.title }, after);
      });
      runAfter(after);
    } else {
      await startTournament(t.id).catch((e) => console.error('[tournament start]', t.id, e));
    }
  }
}

export async function restoreTournaments() {
  // Lobbies are not kept across restarts, so reopen any bracket match whose lobby closed.
  await S.db.query(
    `UPDATE tournament_matches tm SET status = 'ready', match_id = NULL, ready_at = now()
       FROM matches m WHERE m.id = tm.match_id AND tm.status = 'live' AND tm.winner_id IS NULL AND m.status = 'CANCELLED'`);
  const live = await S.db.query(`SELECT id FROM tournaments WHERE status = 'IN_PROGRESS'`);
  for (const t of live) await spawnReady(t.id);
}

export function wireTournamentHooks() {
  matches.hooks.tournamentResult = onMatchResult;
  matches.hooks.tournamentWalkover = walkoverMatch;
  matches.hooks.afterTournamentChange = (id) => { spawnReady(id).catch(() => {}); };
}

// ------------------------------------------------------------------ reads

export async function listTournaments(filter: { tab?: string; gameId?: string; userId?: string | null }) {
  const params: unknown[] = [filter.userId ?? ''];
  const mine = `(t.host_id = $1 OR EXISTS (SELECT 1 FROM tournament_participants x WHERE x.tournament_id = t.id AND x.user_id = $1))`;
  const where = [`(t.visibility = 'public' OR ${mine})`];
  const tab = filter.tab ?? 'open';
  if (tab === 'open') where.push(`t.status IN ('REGISTRATION_OPEN', 'CHECK_IN')`);
  else if (tab === 'live') where.push(`t.status = 'IN_PROGRESS'`);
  else if (tab === 'done') where.push(`t.status = 'COMPLETED'`);
  else if (tab === 'mine') where.push(mine);
  if (tab !== 'mine') where.push(`t.status <> 'DRAFT'`);
  if (filter.gameId && GAME_BY_ID[filter.gameId]) { params.push(filter.gameId); where.push(`t.game_id = $${params.length}`); }
  return S.db.query(
    `SELECT t.id, t.title, t.game_id, t.status, t.capacity, t.starts_at, t.bragging, t.visibility, t.checkin_minutes,
            u.username AS host, c.username AS champion,
            (SELECT count(*)::int FROM tournament_participants p WHERE p.tournament_id = t.id AND p.status <> 'withdrawn') AS players,
            (SELECT count(*)::int FROM tournaments h WHERE h.host_id = t.host_id AND h.status = 'COMPLETED') AS host_completed
       FROM tournaments t JOIN users u ON u.id = t.host_id LEFT JOIN users c ON c.id = t.champion_id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'CHECK_IN' THEN 1 WHEN 'REGISTRATION_OPEN' THEN 2 WHEN 'DRAFT' THEN 3 ELSE 4 END,
               t.starts_at ASC
      LIMIT 60`,
    params,
  );
}

export async function tournamentDetail(id: string, user: SessionUser | undefined, code?: string) {
  const t = await S.db.one(
    `SELECT t.*, u.username AS host, u.avatar AS host_avatar, c.username AS champion,
            (SELECT count(*)::int FROM tournaments h WHERE h.host_id = t.host_id AND h.status = 'COMPLETED') AS host_completed
       FROM tournaments t JOIN users u ON u.id = t.host_id LEFT JOIN users c ON c.id = t.champion_id WHERE t.id = $1`, [id]);
  if (!t) throw new HttpError(404, 'Tournament not found.');
  const participants = await S.db.query(
    `SELECT p.user_id, p.status, p.seed, p.final_placement, u.username, u.avatar
       FROM tournament_participants p JOIN users u ON u.id = p.user_id
      WHERE p.tournament_id = $1 ORDER BY p.seed NULLS LAST, p.registered_at`, [id]);
  const isHost = user?.id === t.host_id;
  const me = participants.find((p) => p.user_id === user?.id) ?? null;
  if (t.visibility === 'private' && !isHost && !me && code !== t.invite_code && user?.role !== 'admin') {
    throw new HttpError(403, 'This tournament is private. Ask the host for the invite link.');
  }
  const bracket = await S.db.query(
    `SELECT tm.id, tm.round, tm.slot, tm.a_user, tm.b_user, tm.a_seed, tm.b_seed, tm.winner_id, tm.match_id, tm.status, tm.result_note, tm.ready_at, tm.replays
       FROM tournament_matches tm WHERE tm.tournament_id = $1 ORDER BY tm.round, tm.slot`, [id]);
  const posts = await S.db.query(
    `SELECT p.id, p.body, p.created_at, u.username FROM tournament_posts p JOIN users u ON u.id = p.user_id
      WHERE p.tournament_id = $1 ORDER BY p.created_at DESC LIMIT 20`, [id]);
  const { invite_code, ...rest } = t;
  return {
    tournament: { ...rest, invite_code: isHost ? invite_code : undefined },
    participants: participants.map((p) => ({ ...p, user: { id: p.user_id, username: p.username, avatar: p.avatar } })),
    bracket, posts, me, isHost,
  };
}
