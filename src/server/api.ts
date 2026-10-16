import { Router } from 'express';
import { GAME_BY_ID, GAMES } from '../shared/catalog';
import { ACHIEVEMENTS } from '../shared/types';
import { adsConfig, adsStatus, invalidateUserCount } from './ads';
import { requireAdmin, requireUser, toPublic } from './auth';
import { config } from './config';
import { matches } from './matches';
import { matchmaker } from './matchmaking';
import { audit, notify } from './notify';
import { cleanText, HttpError, Limiter, newId, normalizeUsername } from './security';
import * as social from './social';
import { S } from './state';
import * as tour from './tournaments';

export const api = Router();
const createLimiter = new Limiter(30, 10 * 60_000);
const reportLimiter = new Limiter(10, 60 * 60_000);

api.get('/config', async (_req, res) => {
  res.json({ ads: await adsConfig(), passwordMinLength: config.passwordMinLength });
});

// ------------------------------------------------------------------ games & matches

api.get('/games', (_req, res) => {
  const playing: Record<string, number> = {};
  for (const m of matches.live.values()) {
    if (m.status !== 'IN_PROGRESS' || m.mode === 'practice') continue;
    playing[m.gameId] = (playing[m.gameId] ?? 0) + m.seats.filter((s) => s.userId).length;
  }
  res.json({ games: GAMES.map((g) => ({ ...g, playing: playing[g.id] ?? 0 })) });
});

api.post('/matches', async (req, res) => {
  const u = requireUser(req);
  if (!createLimiter.take(u.id)) throw new HttpError(429, 'You’re creating rooms too quickly.');
  const { gameId, mode, options, bots } = req.body ?? {};
  const meta = GAME_BY_ID[gameId];
  if (!meta || meta.status !== 'live') throw new HttpError(400, 'That game isn’t available yet.');
  if (mode !== 'private' && mode !== 'practice') throw new HttpError(400, 'Use quick play for casual and ranked matches.');
  if (mode === 'practice' && meta.practice === 'none') throw new HttpError(400, 'This game has no practice mode.');
  const botCount = mode === 'practice' && meta.practice === 'bot' ? Math.max(1, Math.min(Number(bots) || 1, meta.maxPlayers - 1)) : 0;
  try {
    const m = await matches.create({ gameId, mode, host: toPublic(u), options, withCode: mode === 'private', bots: botCount });
    res.status(201).json({ id: m.id, code: m.code });
  } catch (e: any) {
    throw new HttpError(400, e.message);
  }
});

api.get('/matches/code/:code', (req, res) => {
  const m = matches.findByCode(String(req.params.code));
  if (!m) throw new HttpError(404, 'No open room with that code. It may have started or expired.');
  res.json({ id: m.id });
});

api.get('/matches/:id', async (req, res) => {
  const id = String(req.params.id);
  const m = matches.live.get(id);
  const snap = m ? matches.snapshot(m, req.user?.id ?? null) : await matches.archived(id, req.user?.id ?? null);
  if (!snap) throw new HttpError(404, 'Match not found.');
  res.json({ match: snap, chat: m ? m.chat.slice(-30) : [] });
});

api.post('/matches/:id/invite', async (req, res) => {
  const u = requireUser(req);
  const m = matches.live.get(String(req.params.id));
  if (!m || m.status !== 'WAITING') throw new HttpError(404, 'That room isn’t open any more.');
  if (matches.seatOf(m, u.id) === null) throw new HttpError(403, 'Join the room before inviting people.');
  const friendId = String(req.body?.userId ?? '');
  const friends = await social.friendIds(u.id);
  if (!friends.includes(friendId)) throw new HttpError(403, 'You can only invite friends directly. Share the link with anyone else.');
  await notify(S.db, friendId, 'match.invite', { matchId: m.id, gameId: m.gameId, from: u.username });
  res.json({ ok: true });
});

api.get('/queue', (req, res) => {
  res.json({ waiting: matchmaker.waiting(String(req.query.game), String(req.query.mode)) });
});

// ------------------------------------------------------------------ home & profiles

api.get('/me/home', async (req, res) => {
  const u = requireUser(req);
  const [stats, recent, invites, tournaments, friends, activity] = await Promise.all([
    S.db.one(`SELECT COALESCE(sum(games),0)::int AS games, COALESCE(sum(wins),0)::int AS wins, COALESCE(sum(losses),0)::int AS losses,
                     COALESCE(sum(draws),0)::int AS draws FROM ratings WHERE user_id = $1`, [u.id]),
    S.db.query(`SELECT m.game_id, max(m.completed_at) AS last FROM match_participants p JOIN matches m ON m.id = p.match_id
                 WHERE p.user_id = $1 AND m.status = 'COMPLETED' GROUP BY m.game_id ORDER BY last DESC LIMIT 4`, [u.id]),
    S.db.query(`SELECT id, payload, created_at FROM notifications WHERE user_id = $1 AND type = 'match.invite' AND read_at IS NULL
                 AND created_at > now() - interval '1 hour' ORDER BY created_at DESC LIMIT 5`, [u.id]),
    S.db.query(`SELECT t.id, t.title, t.game_id, t.status, t.starts_at, p.status AS my_status
                  FROM tournament_participants p JOIN tournaments t ON t.id = p.tournament_id
                 WHERE p.user_id = $1 AND t.status IN ('REGISTRATION_OPEN','CHECK_IN','IN_PROGRESS') AND p.status <> 'withdrawn'
                 ORDER BY t.starts_at LIMIT 6`, [u.id]),
    social.listFriends(u.id),
    S.db.query(`SELECT m.id, m.game_id, m.completed_at, p.outcome, m.mode FROM match_participants p JOIN matches m ON m.id = p.match_id
                 WHERE p.user_id = $1 AND m.status = 'COMPLETED' AND m.mode <> 'practice' ORDER BY m.completed_at DESC LIMIT 6`, [u.id]),
  ]);
  const myLive = [...matches.live.values()]
    .filter((m) => (m.status === 'IN_PROGRESS' || m.status === 'WAITING') && matches.seatOf(m, u.id) !== null)
    .map((m) => ({ id: m.id, gameId: m.gameId, status: m.status, mode: m.mode, tournament: m.tournament?.title ?? null }));
  res.json({
    stats, recentGames: recent.map((r) => r.game_id), invites, tournaments,
    friendsOnline: friends.friends.filter((f) => f.online).slice(0, 8), friendRequests: friends.incoming.length,
    activity, live: myLive,
  });
});

api.patch('/me', async (req, res) => {
  const u = requireUser(req);
  const { avatar, favoriteGames } = req.body ?? {};
  if (avatar) {
    const color = Number(avatar.color), glyph = Number(avatar.glyph);
    if (!(color >= 0 && color < 8 && glyph >= 0 && glyph < 8)) throw new HttpError(400, 'Invalid avatar.');
    await S.db.query('UPDATE users SET avatar = $2 WHERE id = $1', [u.id, JSON.stringify({ color, glyph })]);
  }
  if (Array.isArray(favoriteGames)) {
    const favs = favoriteGames.filter((g: string) => GAME_BY_ID[g]).slice(0, 5);
    await S.db.query('UPDATE users SET favorite_games = $2 WHERE id = $1', [u.id, favs]);
  }
  res.json({ ok: true });
});

api.get('/players/:username', async (req, res) => {
  const p = await S.db.one(
    `SELECT id, username, avatar, created_at, favorite_games, status FROM users WHERE username_norm = $1`, [normalizeUsername(String(req.params.username))]);
  if (!p || p.status !== 'active') throw new HttpError(404, 'Player not found.');
  const [games, achievements, recent, tournaments] = await Promise.all([
    S.db.query(`SELECT game_id, rating, peak, rated_games, games, wins, losses, draws FROM ratings WHERE user_id = $1 AND games > 0 ORDER BY games DESC`, [p.id]),
    S.db.query(`SELECT key, earned_at FROM achievements WHERE user_id = $1 ORDER BY earned_at DESC`, [p.id]),
    recentMatches(p.id, null),
    S.db.query(`SELECT t.id, t.title, t.game_id, t.status, tp.final_placement, t.completed_at FROM tournament_participants tp
                  JOIN tournaments t ON t.id = tp.tournament_id
                 WHERE tp.user_id = $1 AND t.status IN ('IN_PROGRESS', 'COMPLETED') AND tp.status <> 'withdrawn'
                 ORDER BY COALESCE(t.completed_at, t.started_at) DESC LIMIT 10`, [p.id]),
  ]);
  const totals = games.reduce((a, g) => ({ games: a.games + g.games, wins: a.wins + g.wins, losses: a.losses + g.losses, draws: a.draws + g.draws }),
    { games: 0, wins: 0, losses: 0, draws: 0 });
  let relation: string | null = null;
  if (req.user && req.user.id !== p.id) {
    const [a, b] = req.user.id < p.id ? [req.user.id, p.id] : [p.id, req.user.id];
    const f = await S.db.one('SELECT status, requester FROM friendships WHERE user_a = $1 AND user_b = $2', [a, b]);
    const blocked = await S.db.one('SELECT 1 FROM blocks WHERE blocker = $1 AND blocked = $2', [req.user.id, p.id]);
    relation = blocked ? 'blocked' : f?.status === 'accepted' ? 'friends' : f ? (f.requester === req.user.id ? 'requested' : 'incoming') : 'none';
  }
  res.json({
    player: { id: p.id, username: p.username, avatar: p.avatar, joinedAt: p.created_at, favoriteGames: p.favorite_games, online: social.isOnline(p.id) },
    totals, games,
    achievements: achievements.map((a) => ({ ...a, ...ACHIEVEMENTS[a.key] })),
    recent, tournaments, relation,
  });
});

async function recentMatches(userId: string, before: string | null) {
  return S.db.query(
    `SELECT m.id, m.game_id, m.mode, m.completed_at, p.outcome, p.final_score, p.rating_before, p.rating_after,
            (SELECT json_agg(json_build_object('username', COALESCE(u2.username, p2.bot_name), 'bot', p2.bot_name IS NOT NULL) ORDER BY p2.seat)
               FROM match_participants p2 LEFT JOIN users u2 ON u2.id = p2.user_id WHERE p2.match_id = m.id AND p2.seat <> p.seat) AS opponents
       FROM match_participants p JOIN matches m ON m.id = p.match_id
      WHERE p.user_id = $1 AND m.status = 'COMPLETED' AND ($2::timestamptz IS NULL OR m.completed_at < $2)
      ORDER BY m.completed_at DESC LIMIT 20`, [userId, before]);
}

api.get('/players/:username/matches', async (req, res) => {
  const p = await S.db.one('SELECT id FROM users WHERE username_norm = $1', [normalizeUsername(String(req.params.username))]);
  if (!p) throw new HttpError(404, 'Player not found.');
  res.json({ matches: await recentMatches(p.id, req.query.before ? String(req.query.before) : null) });
});

// ------------------------------------------------------------------ friends & blocks

api.get('/friends', async (req, res) => res.json(await social.listFriends(requireUser(req).id)));
api.post('/friends/request', async (req, res) => res.json(await social.requestFriend(requireUser(req), String(req.body?.username ?? ''))));
api.post('/friends/accept', async (req, res) => res.json(await social.acceptFriend(requireUser(req), String(req.body?.userId ?? ''))));
api.delete('/friends/:userId', async (req, res) => { await social.removeFriend(requireUser(req), String(req.params.userId)); res.json({ ok: true }); });
api.post('/blocks', async (req, res) => { await social.block(requireUser(req), String(req.body?.userId ?? '')); res.json({ ok: true }); });
api.delete('/blocks/:userId', async (req, res) => { await social.unblock(requireUser(req), String(req.params.userId)); res.json({ ok: true }); });
api.get('/blocks', async (req, res) => {
  const u = requireUser(req);
  res.json({ blocked: await S.db.query('SELECT u.id, u.username, u.avatar FROM blocks b JOIN users u ON u.id = b.blocked WHERE b.blocker = $1', [u.id]) });
});

// ------------------------------------------------------------------ notifications

api.get('/notifications', async (req, res) => {
  const u = requireUser(req);
  const items = await S.db.query(
    `SELECT id, type, payload, created_at AS "createdAt", read_at AS "readAt" FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 40`, [u.id]);
  res.json({ items, unread: items.filter((i) => !i.readAt).length });
});

api.post('/notifications/read', async (req, res) => {
  const u = requireUser(req);
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (ids.length) await S.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL', [u.id, ids]);
  else await S.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [u.id]);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ leaderboards

api.get('/leaderboards', async (req, res) => {
  const gameId = req.query.game && GAME_BY_ID[String(req.query.game)] ? String(req.query.game) : null;
  const period = ['week', 'month'].includes(String(req.query.period)) ? String(req.query.period) : 'all';
  const friendsOnly = req.query.friends === '1' && req.user;
  const page = Math.max(0, Number(req.query.page) || 0);
  const limit = 50;
  const ids = friendsOnly ? [...(await social.friendIds(req.user!.id)), req.user!.id] : null;
  let rows: any[];
  let metric: 'rating' | 'wins';
  if (period === 'all' && gameId) {
    metric = 'rating';
    rows = await S.db.query(
      `SELECT u.id, u.username, u.avatar, r.rating, r.peak, r.wins, r.losses, r.draws, r.games
         FROM ratings r JOIN users u ON u.id = r.user_id
        WHERE r.game_id = $1 AND r.rated_games > 0 AND u.status = 'active' AND ($2::text[] IS NULL OR u.id = ANY($2))
        ORDER BY r.rating DESC, r.wins DESC, u.username_norm ASC LIMIT $3 OFFSET $4`,
      [gameId, ids, limit, page * limit]);
  } else if (period === 'all') {
    metric = 'wins';
    rows = await S.db.query(
      `SELECT u.id, u.username, u.avatar, sum(r.wins)::int AS wins, sum(r.losses)::int AS losses, sum(r.draws)::int AS draws, sum(r.games)::int AS games
         FROM ratings r JOIN users u ON u.id = r.user_id
        WHERE u.status = 'active' AND ($1::text[] IS NULL OR u.id = ANY($1))
        GROUP BY u.id HAVING sum(r.games) > 0
        ORDER BY wins DESC, games ASC, u.username_norm ASC LIMIT $2 OFFSET $3`,
      [ids, limit, page * limit]);
  } else {
    metric = 'wins';
    const since = period === 'week' ? `date_trunc('week', now())` : `date_trunc('month', now())`;
    rows = await S.db.query(
      `SELECT u.id, u.username, u.avatar,
              count(*) FILTER (WHERE p.outcome = 'win')::int AS wins, count(*) FILTER (WHERE p.outcome = 'loss')::int AS losses,
              count(*) FILTER (WHERE p.outcome = 'draw')::int AS draws, count(*)::int AS games
         FROM match_participants p JOIN matches m ON m.id = p.match_id JOIN users u ON u.id = p.user_id
        WHERE m.status = 'COMPLETED' AND m.mode <> 'practice' AND m.completed_at >= ${since}
          AND ($1::text IS NULL OR m.game_id = $1) AND u.status = 'active' AND ($2::text[] IS NULL OR u.id = ANY($2))
        GROUP BY u.id
        ORDER BY wins DESC, games ASC, u.username_norm ASC LIMIT $3 OFFSET $4`,
      [gameId, ids, limit, page * limit]);
  }
  res.json({
    metric, period, gameId,
    rows: rows.map((r, i) => ({ rank: page * limit + i + 1, user: { id: r.id, username: r.username, avatar: r.avatar }, ...r, id: undefined, username: undefined, avatar: undefined })),
    hasMore: rows.length === limit,
  });
});

api.get('/leaderboards/champions', async (_req, res) => {
  const rows = await S.db.query(
    `SELECT u.id, u.username, u.avatar, count(*)::int AS titles, max(t.completed_at) AS last_title
       FROM tournaments t JOIN users u ON u.id = t.champion_id
      WHERE t.status = 'COMPLETED' AND u.status = 'active'
      GROUP BY u.id ORDER BY titles DESC, last_title DESC, u.username_norm ASC LIMIT 50`);
  res.json({ rows: rows.map((r, i) => ({ rank: i + 1, user: { id: r.id, username: r.username, avatar: r.avatar }, titles: r.titles })) });
});

// ------------------------------------------------------------------ tournaments

api.get('/tournaments', async (req, res) => {
  res.json({ tournaments: await tour.listTournaments({ tab: String(req.query.tab ?? 'open'), gameId: req.query.game ? String(req.query.game) : undefined, userId: req.user?.id ?? null }) });
});
api.post('/tournaments', async (req, res) => {
  const u = requireUser(req);
  if (!createLimiter.take(`t:${u.id}`)) throw new HttpError(429, 'Slow down a little.');
  res.status(201).json({ id: await tour.createTournament(u, req.body) });
});
api.get('/tournaments/:id', async (req, res) => {
  res.json(await tour.tournamentDetail(String(req.params.id), req.user, req.query.code ? String(req.query.code) : undefined));
});
api.post('/tournaments/:id/publish', async (req, res) => { await tour.publish(requireUser(req), String(req.params.id)); res.json({ ok: true }); });
api.post('/tournaments/:id/register', async (req, res) => {
  await tour.register(requireUser(req), String(req.params.id), req.body?.code ? String(req.body.code) : undefined);
  res.json({ ok: true });
});
api.post('/tournaments/:id/check-in', async (req, res) => { await tour.checkIn(requireUser(req), String(req.params.id)); res.json({ ok: true }); });
api.post('/tournaments/:id/withdraw', async (req, res) => { await tour.withdraw(requireUser(req), String(req.params.id)); res.json({ ok: true }); });
api.post('/tournaments/:id/start', async (req, res) => { await tour.startTournament(String(req.params.id), requireUser(req)); res.json({ ok: true }); });
api.post('/tournaments/:id/cancel', async (req, res) => { await tour.cancelTournament(requireUser(req), String(req.params.id)); res.json({ ok: true }); });
api.post('/tournaments/:id/posts', async (req, res) => { await tour.post(requireUser(req), String(req.params.id), String(req.body?.body ?? '')); res.json({ ok: true }); });

// ------------------------------------------------------------------ reports & moderation

api.post('/reports', async (req, res) => {
  const u = requireUser(req);
  if (!reportLimiter.take(u.id)) throw new HttpError(429, 'You’ve sent a lot of reports. Try again later.');
  const type = String(req.body?.targetType);
  if (!['user', 'tournament', 'match'].includes(type)) throw new HttpError(400, 'Unknown report type.');
  const reason = cleanText(String(req.body?.reason ?? '')).slice(0, 500);
  if (reason.length < 3) throw new HttpError(400, 'Tell us what happened.');
  await S.db.query('INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES ($1,$2,$3,$4,$5)',
    [newId(10), u.id, type, String(req.body?.targetId ?? '').slice(0, 64), reason]);
  res.status(201).json({ ok: true });
});

api.get('/admin/overview', async (req, res) => {
  requireAdmin(req);
  const [counts, today] = await Promise.all([
    S.db.one(`SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_users,
                     (SELECT count(*)::int FROM users WHERE last_seen_at > now() - interval '1 day') AS dau,
                     (SELECT count(*)::int FROM reports WHERE status = 'open') AS open_reports,
                     (SELECT count(*)::int FROM tournaments WHERE status IN ('REGISTRATION_OPEN','CHECK_IN','IN_PROGRESS')) AS active_tournaments`),
    S.db.query(`SELECT game_id, count(*)::int AS n FROM matches WHERE status = 'COMPLETED' AND completed_at > now() - interval '1 day' GROUP BY game_id ORDER BY n DESC`),
  ]);
  res.json({
    counts, matchesToday: today, ads: await adsStatus(),
    live: { matches: [...matches.live.values()].filter((m) => m.status === 'IN_PROGRESS').length, online: social.presence.size, queue: matchmaker.queue.length },
  });
});

api.get('/admin/reports', async (req, res) => {
  requireAdmin(req);
  res.json({
    reports: await S.db.query(
      `SELECT r.*, u.username AS reporter, tu.username AS target_username FROM reports r JOIN users u ON u.id = r.reporter_id
         LEFT JOIN users tu ON r.target_type = 'user' AND tu.id = r.target_id
        ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 100`),
  });
});

api.post('/admin/reports/:id/resolve', async (req, res) => {
  const a = requireAdmin(req);
  await S.db.query(`UPDATE reports SET status = 'resolved', resolved_by = $2, resolved_at = now() WHERE id = $1`, [String(req.params.id), a.id]);
  await audit(S.db, a.id, 'report.resolve', String(req.params.id));
  res.json({ ok: true });
});

api.get('/admin/users', async (req, res) => {
  requireAdmin(req);
  const q = normalizeUsername(String(req.query.q ?? ''));
  res.json({
    users: await S.db.query(
      `SELECT id, username, status, role, created_at, last_seen_at FROM users WHERE username_norm LIKE $1 ORDER BY username_norm LIMIT 50`, [`%${q.replace(/[%_]/g, '')}%`]),
  });
});

api.post('/admin/users/:id/status', async (req, res) => {
  const a = requireAdmin(req);
  const status = req.body?.status === 'suspended' ? 'suspended' : 'active';
  const id = String(req.params.id);
  if (id === a.id) throw new HttpError(400, 'You can’t suspend yourself.');
  await S.db.tx(async (q) => {
    await q.query('UPDATE users SET status = $2 WHERE id = $1', [id, status]);
    if (status === 'suspended') await q.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(q, a.id, `user.${status}`, id);
  });
  invalidateUserCount();
  res.json({ ok: true });
});
