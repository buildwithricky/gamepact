import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/server/db';
import { createServer } from '../src/server/index';
import { matches } from '../src/server/matches';
import { S } from '../src/server/state';
import { tournamentTick } from '../src/server/tournaments';
import type { MatchSnapshot } from '../src/shared/types';

let base = '';
let server: Awaited<ReturnType<typeof createServer>>;
const sockets: Socket[] = [];

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const db = await openDb({ dir: 'memory://' });
  server = await createServer({ db, quiet: true });
  server.start();
  await new Promise<void>((r) => server.http.listen(0, r));
  base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

interface Client { cookie: string; id: string; username: string; socket: Socket; states: MatchSnapshot[] }

async function call(path: string, body?: unknown, cookie = '', method?: string) {
  const res = await fetch(base + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-requested-with': 'gamepact', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

async function signup(username: string): Promise<Client> {
  const r = await call('/api/auth/register', { username, password: 'correct horse battery' });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  expect(r.json.recoveryCode).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  const cookie = r.setCookie!.split(';')[0];
  const socket = connect(base, { extraHeaders: { cookie }, transports: ['websocket'] });
  sockets.push(socket);
  await new Promise<void>((res) => socket.on('connect', () => res()));
  const c: Client = { cookie, id: r.json.user.id, username, socket, states: [] };
  socket.on('match:state', (s: MatchSnapshot) => c.states.push(s));
  return c;
}

const emit = (c: Client, ev: string, payload: unknown) =>
  new Promise<any>((res) => c.socket.emit(ev, payload, (r: any) => res(r)));

async function until<T>(fn: () => T | undefined | null | false, ms = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const last = (c: Client, id: string) => [...c.states].reverse().find((s) => s.id === id);

describe('accounts', () => {
  it('registers once per normalized username and logs in', async () => {
    await signup('Amaka');
    const dup = await call('/api/auth/register', { username: 'amaka', password: 'correct horse battery' });
    expect(dup.status).toBe(409);
    const bad = await call('/api/auth/login', { username: 'AMAKA', password: 'wrong password!!' });
    expect(bad.status).toBe(401);
    const ok = await call('/api/auth/login', { username: 'AMAKA', password: 'correct horse battery' });
    expect(ok.status).toBe(200);
    const row = await S.db.one(`SELECT password_hash FROM users WHERE username_norm = 'amaka'`);
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
  });
  it('rejects weak passwords, reserved names and cross-site posts', async () => {
    expect((await call('/api/auth/register', { username: 'tooshort', password: 'abc' })).status).toBe(400);
    expect((await call('/api/auth/register', { username: 'admin', password: 'correct horse battery' })).status).toBe(400);
    const res = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(403);
  });
  it('recovers an account with the recovery code', async () => {
    const r = await call('/api/auth/register', { username: 'forgetful', password: 'correct horse battery' });
    const code = r.json.recoveryCode;
    const wrong = await call('/api/auth/recovery/redeem', { username: 'forgetful', code: 'AAAAA-AAAAA-AAAAA-AAAAA', newPassword: 'a brand new passphrase' });
    expect(wrong.status).toBe(401);
    const ok = await call('/api/auth/recovery/redeem', { username: 'forgetful', code, newPassword: 'a brand new passphrase' });
    expect(ok.status).toBe(200);
    expect(ok.json.recoveryCode).not.toBe(code);
    expect((await call('/api/auth/login', { username: 'forgetful', password: 'a brand new passphrase' })).status).toBe(200);
  });
});

describe('private match', () => {
  it('two players play tic-tac-toe over sockets and the result persists', async () => {
    const a = await signup('ada_x'), b = await signup('bayo_o');
    const created = await call('/api/matches', { gameId: 'tic-tac-toe', mode: 'private', options: { bestOf: '1' } }, a.cookie);
    expect(created.status).toBe(201);
    const id = created.json.id;
    expect(id.length).toBeGreaterThanOrEqual(20);
    expect((await call(`/api/matches/code/${created.json.code}`, undefined, b.cookie)).json.id).toBe(id);

    expect((await emit(a, 'match:watch', { matchId: id })).ok).toBe(true);
    expect((await emit(b, 'match:watch', { matchId: id })).ok).toBe(true);
    await until(() => last(a, id)?.seats.length === 2);
    await emit(a, 'match:ready', { matchId: id });
    await emit(b, 'match:ready', { matchId: id });
    await until(() => last(b, id)?.status === 'IN_PROGRESS');

    expect((await emit(b, 'match:action', { matchId: id, action: { cell: 0 } })).error).toMatch(/not your turn/);
    const n1 = 'nonce-1';
    expect((await emit(a, 'match:action', { matchId: id, action: { cell: 0 }, nonce: n1 })).ok).toBe(true);
    expect((await emit(a, 'match:action', { matchId: id, action: { cell: 0 }, nonce: n1 })).duplicate).toBe(true);
    for (const [c, cell] of [[b, 3], [a, 1], [b, 4], [a, 2]] as const) {
      const r = await emit(c, 'match:action', { matchId: id, action: { cell } });
      expect(r.ok, r.error).toBe(true);
    }
    const done = await until(() => { const s = last(b, id); return s?.status === 'COMPLETED' && s.result?.ratingChanges === undefined ? s : null; });
    expect(done.result!.ranking).toEqual([[0], [1]]);
    const row = await S.db.one('SELECT status, result FROM matches WHERE id = $1', [id]);
    expect(row.status).toBe('COMPLETED');
    const parts = await S.db.query('SELECT user_id, outcome FROM match_participants WHERE match_id = $1 ORDER BY seat', [id]);
    expect(parts.map((p) => p.outcome)).toEqual(['win', 'loss']);
    const stats = await S.db.one(`SELECT wins FROM ratings WHERE user_id = $1 AND game_id = 'tic-tac-toe'`, [a.id]);
    expect(stats.wins).toBe(1);
    // Extra actions after the end are rejected and don't change stats.
    expect((await emit(b, 'match:action', { matchId: id, action: { cell: 8 } })).ok).toBe(false);

    // Rematch creates a fresh match with seats swapped.
    await emit(a, 'match:rematch', { matchId: id });
    await emit(b, 'match:rematch', { matchId: id });
    const re = await until(() => last(a, id)?.rematch.nextId);
    const live = matches.live.get(re)!;
    expect(live.seats[0].userId).toBe(b.id);
    expect(live.status).toBe('IN_PROGRESS');
  });

  it('hides crazy eights hands from the opponent and spectators', async () => {
    const a = await signup('cardsharp'), b = await signup('cardshark'), spy = await signup('watcher1');
    const id = (await call('/api/matches', { gameId: 'crazy-eights', mode: 'private' }, a.cookie)).json.id;
    await emit(a, 'match:watch', { matchId: id });
    await emit(b, 'match:watch', { matchId: id });
    await emit(b, 'match:ready', { matchId: id });
    expect((await emit(a, 'match:start', { matchId: id })).ok).toBe(true);
    await emit(spy, 'match:watch', { matchId: id });
    const sb = await until(() => { const s = last(b, id); return s?.status === 'IN_PROGRESS' ? s : null; });
    const ss = await until(() => { const s = last(spy, id); return s?.status === 'IN_PROGRESS' ? s : null; });
    const live = matches.live.get(id)!;
    const handA = live.state.hands[0] as string[];
    expect((sb.view as any).hand).toEqual(live.state.hands[1]);
    for (const card of handA) expect(JSON.stringify((sb.view as any).hand)).not.toContain(`"${card}"`);
    expect((ss.view as any).hand).toBeNull();
    expect(ss.you).toBeNull();
    expect((await emit(spy, 'match:action', { matchId: id, action: { type: 'draw' } })).error).toMatch(/Spectators/);
    await emit(a, 'match:resign', { matchId: id });
    const done = await until(() => { const s = last(b, id); return s?.status === 'COMPLETED' ? s : null; });
    expect(done.result!.ranking[0]).toEqual([1]);
  });
});

describe('ranked matchmaking', () => {
  it('pairs two players, updates Elo once, and keeps games separate', async () => {
    const a = await signup('rank_one'), b = await signup('rank_two');
    const found: string[] = [];
    a.socket.on('mm:found', (m: any) => found.push(m.matchId));
    expect((await emit(a, 'mm:join', { gameId: 'tic-tac-toe', mode: 'ranked' })).ok).toBe(true);
    await emit(b, 'mm:join', { gameId: 'tic-tac-toe', mode: 'ranked' });
    const id = await until(() => found[0]);
    await emit(a, 'match:watch', { matchId: id });
    await emit(b, 'match:watch', { matchId: id });
    const m = matches.live.get(id)!;
    const resigner = m.seats[1].userId === a.id ? a : b;
    await emit(resigner, 'match:resign', { matchId: id });
    const s = await until(() => { const x = last(a, id); return x?.status === 'COMPLETED' && x.result?.ratingChanges ? x : null; });
    const changes = Object.values(s.result!.ratingChanges!);
    expect(changes.map((c) => c.after - c.before).sort((x, y) => x - y)).toEqual([-20, 20]);
    const rc = await S.db.query('SELECT * FROM rating_changes WHERE match_id = $1', [id]);
    expect(rc).toHaveLength(2);
    const chessRow = await S.db.one(`SELECT 1 FROM ratings WHERE user_id = $1 AND game_id = 'chess'`, [a.id]);
    expect(chessRow).toBeNull();
    const lb = await call('/api/leaderboards?game=tic-tac-toe');
    expect(lb.json.rows[0].rating).toBe(1220);
  });
});

describe('tournaments', () => {
  it('runs a 3-player single-elimination bracket with a bye to a champion', async () => {
    const host = await signup('host_t'), p2 = await signup('player_2'), p3 = await signup('player_3');
    const t = await call('/api/tournaments', {
      title: 'Friday X and O', gameId: 'tic-tac-toe', capacity: 4, startsAt: new Date(Date.now() + 3600_000).toISOString(),
      options: { bestOf: '1' }, bragging: 'Lagos X&O king',
    }, host.cookie);
    expect(t.status, JSON.stringify(t.json)).toBe(201);
    const tid = t.json.id;
    expect((await call(`/api/tournaments/${tid}/register`, {}, p2.cookie)).status).toBe(200);
    expect((await call(`/api/tournaments/${tid}/register`, {}, p2.cookie)).status).toBe(409);
    expect((await call(`/api/tournaments/${tid}/register`, {}, p3.cookie)).status).toBe(200);
    expect((await call(`/api/tournaments/${tid}/start`, {}, p2.cookie)).status).toBe(403);
    expect((await call(`/api/tournaments/${tid}/start`, {}, host.cookie)).status).toBe(200);

    const detail = async () => (await call(`/api/tournaments/${tid}`, undefined, host.cookie)).json;
    let d = await detail();
    expect(d.tournament.status).toBe('IN_PROGRESS');
    expect(d.bracket.filter((x: any) => x.status === 'bye')).toHaveLength(1);

    const clients = [host, p2, p3];
    const playOut = async (tm: any) => {
      const a = clients.find((c) => c.id === tm.a_user)!, b = clients.find((c) => c.id === tm.b_user)!;
      await emit(a, 'match:watch', { matchId: tm.match_id });
      await emit(b, 'match:watch', { matchId: tm.match_id });
      await emit(a, 'match:ready', { matchId: tm.match_id });
      await emit(b, 'match:ready', { matchId: tm.match_id });
      await until(() => matches.live.get(tm.match_id)?.status === 'IN_PROGRESS');
      // seat 0 (higher seed) wins with the top row
      const m = matches.live.get(tm.match_id)!;
      const s0 = clients.find((c) => c.id === m.seats[0].userId)!, s1 = clients.find((c) => c.id === m.seats[1].userId)!;
      for (const [c, cell] of [[s0, 0], [s1, 3], [s0, 1], [s1, 4], [s0, 2]] as const) await emit(c, 'match:action', { matchId: tm.match_id, action: { cell } });
      await until(() => matches.live.get(tm.match_id)?.status === 'COMPLETED');
      return m.seats[0].userId;
    };

    d = await detail();
    const r1 = d.bracket.find((x: any) => x.round === 1 && x.status === 'live');
    expect(r1).toBeTruthy();
    await playOut(r1);
    let final: any = null;
    for (let i = 0; i < 100 && !final; i++) {
      d = await detail();
      final = d.bracket.find((x: any) => x.round === 2 && x.status === 'live');
      if (!final) await new Promise((r) => setTimeout(r, 50));
    }
    expect(final).toBeTruthy();
    const champion = await playOut(final);
    for (let i = 0; i < 100; i++) { d = await detail(); if (d.tournament.status === 'COMPLETED') break; await new Promise((r) => setTimeout(r, 50)); }
    expect(d.tournament.status).toBe('COMPLETED');
    expect(d.tournament.champion_id).toBe(champion);
    const placements = d.participants.map((p: any) => p.final_placement).sort();
    expect(placements).toEqual([1, 2, 3]);
    const ach = await S.db.query('SELECT key FROM achievements WHERE user_id = $1', [champion]);
    expect(ach.map((a) => a.key)).toEqual(expect.arrayContaining(['champion', 'finalist', 'first_win']));
    const champs = await call('/api/leaderboards/champions');
    expect(champs.json.rows[0].titles).toBe(1);
  }, 30_000);

  it('enforces capacity and auto-starts from the scheduler', async () => {
    const h = await signup('cap_host');
    const t = await call('/api/tournaments', {
      title: 'Tiny cup', gameId: 'word-guess', capacity: 4, startsAt: new Date(Date.now() + 1000).toISOString(),
    }, h.cookie);
    const tid = t.json.id;
    const others = [await signup('cap_1'), await signup('cap_2'), await signup('cap_3'), await signup('cap_4')];
    const results = [];
    for (const o of others) results.push((await call(`/api/tournaments/${tid}/register`, {}, o.cookie)).status);
    expect(results).toEqual([200, 200, 200, 409]);
    await new Promise((r) => setTimeout(r, 1100));
    await tournamentTick();
    const d = (await call(`/api/tournaments/${tid}`, undefined, h.cookie)).json;
    expect(d.tournament.status).toBe('IN_PROGRESS');
    expect(d.bracket.filter((x: any) => x.round === 1 && x.status === 'live')).toHaveLength(2);
  }, 20_000);
});

describe('ads gate', () => {
  it('keeps ads off below the threshold and when unconfigured', async () => {
    const r = await call('/api/config');
    expect(r.json.ads.enabled).toBe(false);
    expect((await fetch(base + '/ads.txt')).status).toBe(404);
  });
  it('switches ads on once the player threshold is reached', async () => {
    const { config } = await import('../src/server/config');
    const { invalidateUserCount, checkThreshold } = await import('../src/server/ads');
    Object.assign(config.ads, { provider: 'adsense', client: 'ca-pub-1234567890', slots: { banner: '111', results: '222', sidebar: null }, userThreshold: 1_000_000 });
    invalidateUserCount();
    expect((await call('/api/config')).json.ads.enabled).toBe(false);
    const users = (await S.db.one(`SELECT count(*)::int AS n FROM users WHERE status = 'active'`)).n;
    config.ads.userThreshold = users;
    invalidateUserCount();
    const on = (await call('/api/config')).json.ads;
    expect(on).toMatchObject({ enabled: true, provider: 'adsense', client: 'ca-pub-1234567890', slots: { banner: '111', results: '222' } });
    expect(await (await fetch(base + '/ads.txt')).text()).toBe('google.com, pub-1234567890, DIRECT, f08c47fec0942fa0\n');
    await checkThreshold();
    await checkThreshold();
    const rows = await S.db.query(`SELECT * FROM audit_log WHERE action = 'ads.threshold_reached'`);
    expect(rows).toHaveLength(1);
    Object.assign(config.ads, { provider: 'none', client: null, userThreshold: 2000 });
    invalidateUserCount();
  });
});
