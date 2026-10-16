import { hash, verify } from '@node-rs/argon2';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from './config';
import { S } from './state';
import { HttpError, Limiter, newId, normalizeUsername, recoveryCode, sha256, validatePassword, validateUsername } from './security';
import type { Avatar, PublicUser } from '../shared/types';

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
export const COOKIE = 'gp_sid';

export interface SessionUser {
  id: string;
  username: string;
  role: 'user' | 'admin';
  status: string;
  avatar: Avatar;
}

declare module 'express-serve-static-core' {
  interface Request { user?: SessionUser }
}

const loginByIp = new Limiter(30, 15 * 60_000);
const loginByName = new Limiter(10, 15 * 60_000);
const registerByIp = new Limiter(config.registerPerHour, 60 * 60_000);
const recoveryByIp = new Limiter(10, 60 * 60_000);

// Used so unknown usernames take as long as known ones.
let dummyHash: string | null = null;
const getDummy = async () => (dummyHash ??= await hash('not-a-real-password-just-timing', ARGON));

export const toPublic = (u: { id: string; username: string; avatar: Avatar }): PublicUser => ({ id: u.id, username: u.username, avatar: u.avatar });

async function createSession(res: Response, userId: string) {
  const token = newId(32);
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
  await S.db.query('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), userId, expires]);
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, expires, path: '/',
  });
}

export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const row = await S.db.one(
    `SELECT u.id, u.username, u.role, u.status, u.avatar, s.last_used_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!row || row.status !== 'active') return null;
  if (Date.now() - new Date(row.last_used_at).getTime() > 5 * 60_000) {
    S.db.query('UPDATE sessions SET last_used_at = now() WHERE id_hash = $1', [sha256(token)]).catch(() => {});
    S.db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [row.id]).catch(() => {});
  }
  return { id: row.id, username: row.username, role: row.role, status: row.status, avatar: row.avatar };
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try { req.user = (await userFromToken(req.cookies?.[COOKIE])) ?? undefined; next(); } catch (e) { next(e); }
}

export function requireUser(req: Request) {
  if (!req.user) throw new HttpError(401, 'Sign in to do that.');
  return req.user;
}

export function requireAdmin(req: Request) {
  const u = requireUser(req);
  if (u.role !== 'admin') throw new HttpError(403, 'Admins only.');
  return u;
}

const ip = (req: Request) => req.ip ?? 'unknown';

export const authRouter = Router();

authRouter.get('/username-available', async (req, res) => {
  const name = String(req.query.u ?? '');
  const problem = validateUsername(name);
  if (problem) return res.json({ available: false, reason: problem });
  const taken = await S.db.one('SELECT 1 FROM users WHERE username_norm = $1', [normalizeUsername(name)]);
  res.json({ available: !taken, reason: taken ? 'That username is taken.' : null });
});

authRouter.post('/register', async (req, res) => {
  if (!registerByIp.take(ip(req))) throw new HttpError(429, 'Too many new accounts from this network. Try again later.');
  const { username, password, website } = req.body ?? {};
  if (website) throw new HttpError(400, 'Could not create the account.'); // honeypot field bots fill in
  const uErr = validateUsername(username);
  if (uErr) throw new HttpError(400, uErr);
  const pErr = validatePassword(password, username, config.passwordMinLength);
  if (pErr) throw new HttpError(400, pErr);
  const norm = normalizeUsername(username);
  const code = recoveryCode();
  const [pwHash, recHash] = await Promise.all([hash(password, ARGON), hash(code, ARGON)]);
  const id = newId(9);
  const role = config.adminUsernames.includes(norm) ? 'admin' : 'user';
  const avatar = { color: Math.floor(Math.random() * 8), glyph: Math.floor(Math.random() * 8) };
  try {
    await S.db.query(
      'INSERT INTO users (id, username, username_norm, password_hash, recovery_hash, role, avatar) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, username.trim(), norm, pwHash, recHash, role, JSON.stringify(avatar)],
    );
  } catch (e: any) {
    if (String(e?.code) === '23505' || /unique|duplicate/i.test(String(e?.message))) throw new HttpError(409, 'That username is taken.');
    throw e;
  }
  await createSession(res, id);
  res.status(201).json({ user: { id, username: username.trim(), avatar, role }, recoveryCode: code });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  const norm = normalizeUsername(String(username ?? ''));
  if (!loginByIp.take(ip(req)) || !loginByName.take(norm)) throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
  const row = await S.db.one('SELECT id, username, password_hash, status, role, avatar FROM users WHERE username_norm = $1', [norm]);
  const ok = row ? await verify(row.password_hash, String(password ?? '')) : (await verify(await getDummy(), String(password ?? '')), false);
  if (!row || !ok) throw new HttpError(401, 'Username or password is wrong.');
  if (row.status !== 'active') throw new HttpError(403, 'This account is suspended.');
  loginByName.reset(norm);
  await createSession(res, row.id);
  res.json({ user: { id: row.id, username: row.username, avatar: row.avatar, role: row.role } });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (token) await S.db.query('DELETE FROM sessions WHERE id_hash = $1', [sha256(token)]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.post('/logout-everywhere', async (req, res) => {
  const u = requireUser(req);
  await S.db.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/session', (req, res) => {
  res.json({ user: req.user ? { id: req.user.id, username: req.user.username, avatar: req.user.avatar, role: req.user.role } : null });
});

authRouter.post('/recovery/redeem', async (req, res) => {
  if (!recoveryByIp.take(ip(req))) throw new HttpError(429, 'Too many recovery attempts. Try again in an hour.');
  const { username, code, newPassword } = req.body ?? {};
  const norm = normalizeUsername(String(username ?? ''));
  const row = await S.db.one('SELECT id, username, recovery_hash, status, role, avatar FROM users WHERE username_norm = $1', [norm]);
  const cleaned = String(code ?? '').trim().toUpperCase();
  const ok = row?.recovery_hash ? await verify(row.recovery_hash, cleaned) : false;
  if (!row || !ok) throw new HttpError(401, 'That username and recovery code don’t match.');
  const pErr = validatePassword(newPassword, row.username, config.passwordMinLength);
  if (pErr) throw new HttpError(400, pErr);
  const next = recoveryCode();
  const [pwHash, recHash] = await Promise.all([hash(newPassword, ARGON), hash(next, ARGON)]);
  await S.db.tx(async (q) => {
    await q.query('UPDATE users SET password_hash = $1, recovery_hash = $2 WHERE id = $3', [pwHash, recHash, row.id]);
    await q.query('DELETE FROM sessions WHERE user_id = $1', [row.id]);
    await q.query(`INSERT INTO audit_log (actor_id, action, target) VALUES ($1, 'recovery.redeem', $1)`, [row.id]);
  });
  await createSession(res, row.id);
  res.json({ user: { id: row.id, username: row.username, avatar: row.avatar, role: row.role }, recoveryCode: next });
});

authRouter.post('/password', async (req, res) => {
  const u = requireUser(req);
  const { currentPassword, newPassword } = req.body ?? {};
  const row = await S.db.one('SELECT password_hash FROM users WHERE id = $1', [u.id]);
  if (!row || !(await verify(row.password_hash, String(currentPassword ?? '')))) throw new HttpError(401, 'Your current password is wrong.');
  const pErr = validatePassword(newPassword, u.username, config.passwordMinLength);
  if (pErr) throw new HttpError(400, pErr);
  await S.db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hash(newPassword, ARGON), u.id]);
  await S.db.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
  await createSession(res, u.id);
  res.json({ ok: true });
});

authRouter.post('/recovery/regenerate', async (req, res) => {
  const u = requireUser(req);
  const row = await S.db.one('SELECT password_hash FROM users WHERE id = $1', [u.id]);
  if (!row || !(await verify(row.password_hash, String(req.body?.password ?? '')))) throw new HttpError(401, 'Your password is wrong.');
  const code = recoveryCode();
  await S.db.query('UPDATE users SET recovery_hash = $1 WHERE id = $2', [await hash(code, ARGON), u.id]);
  res.json({ recoveryCode: code });
});
