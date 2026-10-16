import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { COOKIE, userFromToken } from './auth';
import { config } from './config';
import { matches, type LiveMatch } from './matches';
import { matchmaker } from './matchmaking';
import { blockedBy, presence } from './social';
import { S } from './state';

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

export function attachRealtime(http: HttpServer) {
  const io = new Server(http, {
    path: '/socket.io',
    cors: config.publicUrl ? { origin: config.publicUrl, credentials: true } : undefined,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 64 * 1024,
    // Vite's dev server shares this port for hot reload; don't kill its upgrade requests.
    destroyUpgrade: config.env !== 'development',
    // Refuse cross-site socket connections (cross-site WebSocket hijacking).
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true);
      let host: string | null = null;
      try { host = new URL(origin).host; } catch { host = null; }
      cb(null, host === req.headers.host || origin === config.publicUrl);
    },
  });
  S.io = io;

  io.use(async (socket, next) => {
    try {
      const token = parseCookie(socket.handshake.headers.cookie, COOKIE);
      const user = await userFromToken(token);
      socket.data.user = user ? { id: user.id, username: user.username, avatar: user.avatar } : null;
      socket.data.blocked = user ? await blockedBy(user.id) : new Set();
      socket.data.watching = new Set<string>();
      next();
    } catch (e) {
      next(e as Error);
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as { id: string; username: string; avatar: any } | null;
    if (user) {
      socket.join(`user:${user.id}`);
      presence.set(user.id, (presence.get(user.id) ?? 0) + 1);
    }
    const live = (id: unknown): LiveMatch | null => (typeof id === 'string' ? matches.live.get(id) ?? null : null);
    const needUser = (ack: Ack) => { if (!user) { ack({ ok: false, error: 'Sign in to play.' }); return false; } return true; };
    const done = (ack: Ack) => (error: string | null | undefined) => ack(error ? { ok: false, error } : { ok: true });

    socket.on('match:watch', async ({ matchId } = {}, ack) => {
      const a = safeAck(ack);
      const m = live(matchId);
      if (!m) return a({ ok: false, error: 'This match isn’t running.' });
      socket.data.watching.add(m.id);
      await matches.join(m, user, socket);
      a({ ok: true, chat: m.chat.slice(-30) });
    });

    socket.on('match:unwatch', ({ matchId } = {}) => {
      const m = live(matchId);
      if (!m) return;
      socket.data.watching.delete(m.id);
      matches.unwatch(m, socket);
    });

    socket.on('match:ready', async ({ matchId, ready } = {}, ack) => {
      const a = safeAck(ack);
      const m = live(matchId);
      if (!m || !needUser(a)) return a({ ok: false, error: 'Match not found.' });
      done(a)(await matches.setReady(m, user!.id, ready !== false));
    });

    socket.on('match:start', async ({ matchId } = {}, ack) => {
      const a = safeAck(ack);
      const m = live(matchId);
      if (!m || !needUser(a)) return a({ ok: false, error: 'Match not found.' });
      done(a)(await matches.hostStart(m, user!.id));
    });

    socket.on('match:action', async ({ matchId, action, nonce } = {}, ack) => {
      const a = safeAck(ack);
      const m = live(matchId);
      if (!m || !needUser(a)) return a({ ok: false, error: 'Match not found.' });
      const res = await matches.act(m, user!.id, action, typeof nonce === 'string' ? nonce.slice(0, 64) : undefined);
      a(res.error ? { ok: false, error: res.error } : { ok: true, duplicate: res.duplicate ?? false });
    });

    for (const [event, fn] of [
      ['match:resign', (m: LiveMatch) => matches.resign(m, user!.id)],
      ['match:leave', (m: LiveMatch) => matches.leave(m, user!.id)],
      ['match:claim', (m: LiveMatch) => matches.claim(m, user!.id)],
      ['match:rematch', (m: LiveMatch) => matches.rematch(m, user!.id)],
      ['match:cancel', async (m: LiveMatch) => (m.hostId === user!.id ? (await matches.cancel(m, 'The host closed the room.'), null) : 'Only the host can close the room.')],
    ] as const) {
      socket.on(event, async ({ matchId } = {}, ack) => {
        const a = safeAck(ack);
        const m = live(matchId);
        if (!m || !needUser(a)) return a({ ok: false, error: 'Match not found.' });
        done(a)(await fn(m));
      });
    }

    socket.on('match:chat', ({ matchId, text } = {}, ack) => {
      const a = safeAck(ack);
      const m = live(matchId);
      if (!m || !needUser(a)) return a({ ok: false, error: 'Match not found.' });
      if (!socket.data.watching.has(m.id)) return a({ ok: false, error: 'Open the match first.' });
      done(a)(matches.chatMessage(m, user!, String(text ?? '')));
    });

    socket.on('match:react', ({ matchId, emoji } = {}) => {
      const m = live(matchId);
      if (!m || !user || matches.seatOf(m, user.id) === null) return;
      matches.react(m, user, String(emoji));
    });

    socket.on('mm:join', async ({ gameId, mode } = {}, ack) => {
      const a = safeAck(ack);
      if (!needUser(a)) return;
      const err = await matchmaker.enqueue(user!, String(gameId), mode === 'ranked' ? 'ranked' : 'casual');
      done(a)(err);
    });

    socket.on('mm:leave', (_p, ack) => {
      if (user) matchmaker.cancel(user.id);
      safeAck(ack)({ ok: true });
    });

    socket.on('tournament:watch', ({ id } = {}) => { if (typeof id === 'string') socket.join(`tournament:${id}`); });
    socket.on('tournament:unwatch', ({ id } = {}) => { if (typeof id === 'string') socket.leave(`tournament:${id}`); });

    socket.on('disconnect', () => {
      for (const id of socket.data.watching as Set<string>) {
        const m = matches.live.get(id);
        if (m) matches.unwatch(m, socket);
      }
      if (user) {
        const n = (presence.get(user.id) ?? 1) - 1;
        if (n <= 0) { presence.delete(user.id); matchmaker.cancel(user.id); } else presence.set(user.id, n);
      }
    });
  });
  return io;
}
