import { S } from './state';
import { HttpError, normalizeUsername } from './security';
import { notify } from './notify';
import type { SessionUser } from './auth';

/** userId -> number of open sockets. */
export const presence = new Map<string, number>();
export const isOnline = (id: string) => (presence.get(id) ?? 0) > 0;

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export async function friendIds(userId: string): Promise<string[]> {
  const rows = await S.db.query(
    `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS id FROM friendships
      WHERE (user_a = $1 OR user_b = $1) AND status = 'accepted'`, [userId]);
  return rows.map((r) => r.id);
}

export async function isBlockedEitherWay(a: string, b: string) {
  return Boolean(await S.db.one('SELECT 1 FROM blocks WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1)', [a, b]));
}

export async function listFriends(userId: string) {
  const rows = await S.db.query(
    `SELECT f.status, f.requester, u.id, u.username, u.avatar, u.last_seen_at
       FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
      WHERE (f.user_a = $1 OR f.user_b = $1) AND u.status = 'active'
      ORDER BY u.username_norm`, [userId]);
  const out = rows.map((r) => ({
    user: { id: r.id, username: r.username, avatar: r.avatar },
    status: r.status as 'pending' | 'accepted',
    incoming: r.status === 'pending' && r.requester !== userId,
    online: isOnline(r.id),
    lastSeenAt: r.last_seen_at,
  }));
  return {
    friends: out.filter((f) => f.status === 'accepted').sort((a, b) => Number(b.online) - Number(a.online)),
    incoming: out.filter((f) => f.incoming),
    outgoing: out.filter((f) => f.status === 'pending' && !f.incoming),
  };
}

export async function requestFriend(me: SessionUser, username: string) {
  const target = await S.db.one(`SELECT id, username FROM users WHERE username_norm = $1 AND status = 'active'`, [normalizeUsername(username)]);
  if (!target) throw new HttpError(404, `No player called “${username}”. Usernames must match exactly.`);
  if (target.id === me.id) throw new HttpError(400, 'You can’t add yourself.');
  if (await isBlockedEitherWay(me.id, target.id)) throw new HttpError(403, 'You can’t add this player.');
  const [a, b] = pair(me.id, target.id);
  const existing = await S.db.one('SELECT status, requester FROM friendships WHERE user_a = $1 AND user_b = $2', [a, b]);
  if (existing?.status === 'accepted') throw new HttpError(409, 'You’re already friends.');
  if (existing && existing.requester !== me.id) return acceptFriend(me, target.id);
  if (existing) throw new HttpError(409, 'Request already sent.');
  await S.db.query('INSERT INTO friendships (user_a, user_b, requester) VALUES ($1, $2, $3)', [a, b, me.id]);
  await notify(S.db, target.id, 'friend.request', { from: me.username, userId: me.id });
  return { status: 'pending' as const };
}

export async function acceptFriend(me: SessionUser, otherId: string) {
  const [a, b] = pair(me.id, otherId);
  const r = await S.db.one(
    `UPDATE friendships SET status = 'accepted' WHERE user_a = $1 AND user_b = $2 AND status = 'pending' AND requester <> $3 RETURNING requester`,
    [a, b, me.id]);
  if (!r) throw new HttpError(404, 'That request is no longer open.');
  await notify(S.db, otherId, 'friend.accepted', { from: me.username, userId: me.id });
  return { status: 'accepted' as const };
}

export async function removeFriend(me: SessionUser, otherId: string) {
  const [a, b] = pair(me.id, otherId);
  await S.db.query('DELETE FROM friendships WHERE user_a = $1 AND user_b = $2', [a, b]);
}

export async function block(me: SessionUser, otherId: string) {
  if (otherId === me.id) throw new HttpError(400, 'You can’t block yourself.');
  await S.db.query('INSERT INTO blocks (blocker, blocked) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me.id, otherId]);
  await removeFriend(me, otherId);
}

export async function unblock(me: SessionUser, otherId: string) {
  await S.db.query('DELETE FROM blocks WHERE blocker = $1 AND blocked = $2', [me.id, otherId]);
}

export async function blockedBy(userId: string): Promise<Set<string>> {
  const rows = await S.db.query('SELECT blocked FROM blocks WHERE blocker = $1', [userId]);
  return new Set(rows.map((r) => r.blocked));
}
