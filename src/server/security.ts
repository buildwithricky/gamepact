import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const newId = (bytes = 12) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function shortCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export function recoveryCode() {
  return Array.from({ length: 4 }, () => shortCode(5)).join('-');
}

const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'gamepact', 'support', 'help', 'mod', 'moderator', 'staff', 'official',
  'team', 'security', 'null', 'undefined', 'bot', 'anonymous', 'guest', 'owner', 'api', 'www', 'me', 'settings',
]);

// Deliberately short: catches the obvious cases without flagging ordinary names.
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'whore', 'slut', 'rape', 'nazi', 'hitler', 'retard', 'bitch', 'dick', 'pussy', 'cock'];

export function normalizeUsername(u: string) {
  return u.trim().toLowerCase();
}

export function validateUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'Choose a username.';
  const u = raw.trim();
  if (u.length < 3 || u.length > 20) return 'Usernames are 3–20 characters.';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(u)) return 'Use letters, numbers, dots, dashes or underscores, starting with a letter or number.';
  if (/[_.-]{2,}/.test(u)) return 'Separators can’t sit next to each other.';
  const n = normalizeUsername(u);
  const squashed = n.replace(/[_.-]/g, '');
  if (RESERVED.has(n) || RESERVED.has(squashed) || /^(admin|mod|gamepact|official)/.test(squashed)) return 'That username is reserved.';
  if (BLOCKED.some((w) => squashed.includes(w))) return 'Pick a different username.';
  return null;
}

const COMMON = new Set([
  'password1234', '123456789012', 'qwertyuiopas', 'passwordpassword', 'iloveyou1234', '111111111111', 'aaaaaaaaaaaa',
  'letmein12345', 'welcome12345', 'football1234', 'abc123456789', 'qwerty123456', 'password123!', 'changeme1234',
]);

export function validatePassword(raw: unknown, username: string, min: number): string | null {
  if (typeof raw !== 'string') return 'Choose a password.';
  if (raw.length < min) return `Passwords need at least ${min} characters. A short phrase works well.`;
  if (raw.length > 200) return 'That password is too long.';
  const low = raw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(raw)) return 'That password is too easy to guess.';
  if (username && low.includes(normalizeUsername(username))) return 'Don’t include your username in your password.';
  return null;
}

export function cleanText(text: string) {
  let out = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 280);
  for (const w of BLOCKED) out = out.replace(new RegExp(w, 'gi'), (m) => '*'.repeat(m.length));
  return out;
}

/** In-memory sliding-window limiter. Fine for a single instance; move to Redis when scaling out. */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  take(key: string, now = Date.now()) {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 50_000) this.hits.clear();
    return true;
  }
  reset(key: string) { this.hits.delete(key); }
}

/** CSRF defence: state-changing requests must come from our own origin and carry JSON. */
export function sameOrigin(publicUrl: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    const host = req.get('host');
    let originHost: string | null = null;
    try { originHost = origin ? new URL(origin).host : null; } catch { originHost = null; }
    const ok = !origin || origin === publicUrl || (host !== undefined && originHost === host);
    if (!ok) return res.status(403).json({ error: 'Cross-site request blocked.' });
    if (req.get('x-requested-with') !== 'gamepact') return res.status(403).json({ error: 'Missing request header.' });
    next();
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
