import { randomInt } from 'node:crypto';
import type { Socket } from 'socket.io';
import { GAME_BY_ID, sanitizeOptions, type GameId, type MatchMode } from '../shared/catalog';
import type { Avatar, ChatMessage, MatchResult, MatchSnapshot, MatchStatus, SeatInfo } from '../shared/types';
import { engineFor } from './games/registry';
import type { Ctx, Engine, Outcome } from './games/types';
import type { After } from './notify';
import { finalizeMatch } from './results';
import { cleanText, Limiter, newId, shortCode } from './security';
import { S } from './state';

export const DISCONNECT_GRACE_MS = 90_000;
const LOBBY_TTL_MS = 60 * 60_000;
const KEEP_FINISHED_MS = 15 * 60_000;
/** A started match nobody has touched or watched for this long is abandoned (e.g. untimed games left open). */
const IDLE_MS = 30 * 60_000;
const BOT_NAMES = ['Pip', 'Dot', 'Bolt', 'Nova', 'Juno'];
export const REACTIONS = ['👏', '🔥', '😂', '😮', '😤', 'GG'];

export function makeCtx(now = Date.now()): Ctx {
  const rand = () => randomInt(0, 2 ** 32) / 2 ** 32;
  return {
    now,
    rand,
    randInt: (n: number) => (n <= 1 ? 0 : randomInt(n)),
    gauss: () => {
      const u = Math.max(rand(), 1e-12), v = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

interface Seat {
  seat: number;
  userId: string | null;
  username: string;
  avatar: Avatar;
  bot: string | null;
  ready: boolean;
  rating: number | null;
}

export interface Player { id: string; username: string; avatar: Avatar }

export interface LiveMatch {
  id: string;
  gameId: GameId;
  mode: MatchMode;
  status: MatchStatus;
  code: string | null;
  hostId: string | null;
  options: Record<string, string>;
  engine: Engine;
  state: any;
  seats: Seat[];
  maxSeats: number;
  minSeats: number;
  createdAt: number;
  expiresAt: number | null;
  result: MatchResult | null;
  dropped: number[];
  seq: number;
  nonces: Set<string>;
  rematch: { requested: Set<number>; nextId: string | null };
  tournament: { id: string; title: string; round: number; tmId: string; deadline: number } | null;
  disconnectedAt: Map<number, number>;
  chat: ChatMessage[];
  chain: Promise<void>;
  botTimer: NodeJS.Timeout | null;
  finishing: boolean;
  doneAt: number | null;
  lastActivity: number;
}

type Hooks = {
  /** Called inside the finalize transaction for tournament matches. Returns tournament id to refresh. */
  tournamentResult?: (q: import('./db').Q, tmId: string, winnerUserId: string | null, note: string, after: After) => Promise<void>;
  tournamentWalkover?: (tmId: string, winnerUserId: string | null, note: string) => Promise<void>;
  afterTournamentChange?: (tournamentId: string) => void;
};

const chatLimiter = new Limiter(6, 10_000);

export class MatchManager {
  live = new Map<string, LiveMatch>();
  watchers = new Map<string, Set<Socket>>();
  hooks: Hooks = {};
  private ticker: NodeJS.Timeout | null = null;

  private ticking = false;
  startTicker() {
    this.ticker ??= setInterval(() => {
      if (this.ticking) return;
      this.ticking = true;
      this.tick().catch((e) => console.error('[match tick]', e)).finally(() => { this.ticking = false; });
    }, 400);
  }
  stopTicker() { if (this.ticker) clearInterval(this.ticker); this.ticker = null; }

  // ------------------------------------------------------------------ creation

  async create(opts: {
    gameId: string;
    mode: MatchMode;
    host: Player | null;
    options?: unknown;
    players?: Player[];
    bots?: number;
    withCode?: boolean;
    tournament?: LiveMatch['tournament'];
    rematchOf?: string;
    autoStart?: boolean;
  }): Promise<LiveMatch> {
    const meta = GAME_BY_ID[opts.gameId];
    const engine = engineFor(opts.gameId);
    if (!meta || !engine || meta.status !== 'live') throw new Error('That game isn’t available yet.');
    const options = sanitizeOptions(meta, opts.options);
    const id = newId(16);
    let code: string | null = null;
    if (opts.withCode) {
      for (let i = 0; i < 5 && !code; i++) {
        const c = shortCode(6);
        if (![...this.live.values()].some((m) => m.code === c && m.status === 'WAITING')) code = c;
      }
    }
    const solo = opts.mode === 'practice' && meta.practice === 'solo' && !opts.bots;
    const maxSeats = opts.mode === 'practice'
      ? (solo ? 1 : Math.min(engine.maxPlayers, 1 + Math.max(1, Math.min(opts.bots ?? 1, 3))))
      : engine.maxPlayers;
    const m: LiveMatch = {
      id, gameId: meta.id, mode: opts.mode, status: 'WAITING', code, hostId: opts.host?.id ?? null, options, engine,
      state: null, seats: [], maxSeats,
      minSeats: opts.mode === 'practice' ? maxSeats : Math.max(2, meta.minPlayers),
      createdAt: Date.now(), expiresAt: opts.tournament ? null : Date.now() + LOBBY_TTL_MS, result: null, dropped: [], seq: 0,
      nonces: new Set(), rematch: { requested: new Set(), nextId: null }, tournament: opts.tournament ?? null,
      disconnectedAt: new Map(), chat: [], chain: Promise.resolve(), botTimer: null, finishing: false, doneAt: null,
      lastActivity: Date.now(),
    };
    const players = opts.players ?? (opts.host ? [opts.host] : []);
    for (const p of players) await this.addSeat(m, p);
    if (opts.mode === 'practice') {
      for (let i = m.seats.length; i < maxSeats; i++) {
        m.seats.push({ seat: i, userId: null, username: BOT_NAMES[i % BOT_NAMES.length], avatar: { color: (i * 3) % 8, glyph: 4 }, bot: 'bot', ready: true, rating: null });
      }
    }
    this.live.set(id, m);
    await S.db.query(
      `INSERT INTO matches (id, game_id, mode, status, code, host_id, options, rematch_of, tournament_match_id, expires_at)
       VALUES ($1,$2,$3,'WAITING',$4,$5,$6,$7,$8,$9)`,
      [id, m.gameId, m.mode, code, m.hostId, JSON.stringify(options), opts.rematchOf ?? null, m.tournament?.tmId ?? null,
        m.expiresAt ? new Date(m.expiresAt) : null],
    );
    this.event(m, 'created', null, { mode: m.mode, options });
    if (opts.autoStart || opts.mode === 'practice') {
      for (const s of m.seats) s.ready = true;
      await this.start(m);
    }
    return m;
  }

  private async addSeat(m: LiveMatch, p: Player) {
    const r = await S.db.one('SELECT rating, rated_games FROM ratings WHERE user_id = $1 AND game_id = $2', [p.id, m.gameId]);
    m.seats.push({
      seat: m.seats.length, userId: p.id, username: p.username, avatar: p.avatar, bot: null, ready: false,
      rating: r && Number(r.rated_games) > 0 ? Number(r.rating) : null,
    });
  }

  findByCode(code: string): LiveMatch | undefined {
    const c = code.trim().toUpperCase();
    return [...this.live.values()].find((m) => m.code === c && m.status === 'WAITING');
  }

  seatOf(m: LiveMatch, userId: string | undefined | null) {
    if (!userId) return null;
    const s = m.seats.find((x) => x.userId === userId);
    return s ? s.seat : null;
  }

  // ------------------------------------------------------------------ lobby

  async join(m: LiveMatch, user: Player | null, socket: Socket): Promise<string | null> {
    let set = this.watchers.get(m.id);
    if (!set) { set = new Set(); this.watchers.set(m.id, set); }
    set.add(socket);
    if (user) {
      const seat = this.seatOf(m, user.id);
      if (seat !== null) {
        m.disconnectedAt.delete(seat);
      } else if (m.status === 'WAITING' && m.mode === 'private' && m.seats.length < m.maxSeats) {
        const blocked = m.hostId && (await S.db.one(
          'SELECT 1 FROM blocks WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1)', [m.hostId, user.id],
        ));
        if (!blocked) {
          await this.addSeat(m, user);
          this.event(m, 'join', m.seats.length - 1, { userId: user.id });
        }
      }
    }
    this.broadcast(m);
    return null;
  }

  unwatch(m: LiveMatch, socket: Socket) {
    const set = this.watchers.get(m.id);
    if (!set) return;
    set.delete(socket);
    const uid = socket.data.user?.id as string | undefined;
    const seat = this.seatOf(m, uid);
    if (seat !== null && ![...set].some((s) => s.data.user?.id === uid)) {
      m.disconnectedAt.set(seat, Date.now());
      this.broadcast(m);
    }
  }

  async setReady(m: LiveMatch, userId: string, ready: boolean): Promise<string | null> {
    if (m.status !== 'WAITING') return 'The match has already started.';
    const seat = this.seatOf(m, userId);
    if (seat === null) return 'You’re watching this match.';
    m.seats[seat].ready = ready;
    this.broadcast(m);
    const full = m.seats.length === m.maxSeats;
    if (full && m.seats.every((s) => s.ready)) await this.start(m);
    return null;
  }

  async hostStart(m: LiveMatch, userId: string): Promise<string | null> {
    if (m.status !== 'WAITING') return 'The match has already started.';
    if (m.hostId !== userId) return 'Only the host can start the match.';
    if (m.seats.length < m.minSeats) return `Waiting for at least ${m.minSeats} players.`;
    const notReady = m.seats.filter((s) => s.userId !== userId && !s.ready);
    if (notReady.length) return `Waiting for ${notReady.map((s) => s.username).join(', ')} to get ready.`;
    m.seats.forEach((s) => (s.ready = true));
    await this.start(m);
    return null;
  }

  async leave(m: LiveMatch, userId: string): Promise<string | null> {
    if (m.status !== 'WAITING') return 'The match has started — resign instead.';
    if (m.tournament) return 'Tournament seats can’t be given up here. Withdraw from the tournament instead.';
    if (m.hostId === userId) { await this.cancel(m, 'The host closed the room.'); return null; }
    const seat = this.seatOf(m, userId);
    if (seat === null) return null;
    m.seats.splice(seat, 1);
    m.seats.forEach((s, i) => (s.seat = i));
    m.disconnectedAt.clear();
    this.event(m, 'leave', seat, { userId });
    this.broadcast(m);
    return null;
  }

  async cancel(m: LiveMatch, reason: string) {
    if (m.status !== 'WAITING' && m.status !== 'READY') return;
    m.status = 'CANCELLED';
    m.result = { kind: 'draw', ranking: [], scores: [], summary: reason, reason };
    m.doneAt = Date.now();
    await S.db.query(`UPDATE matches SET status = 'CANCELLED', result = $2 WHERE id = $1`, [m.id, JSON.stringify(m.result)]);
    this.broadcast(m);
  }

  // ------------------------------------------------------------------ play

  async start(m: LiveMatch) {
    if (m.status !== 'WAITING') return;
    const ctx = makeCtx();
    let state = m.engine.init(m.seats.length, m.options, ctx);
    if (m.engine.start) state = m.engine.start(state, ctx);
    m.state = state;
    m.status = 'IN_PROGRESS';
    m.code = null;
    m.expiresAt = null;
    await S.db.tx(async (q) => {
      await q.query(`UPDATE matches SET status = 'IN_PROGRESS', started_at = now(), code = NULL, expires_at = NULL, state = $2 WHERE id = $1`,
        [m.id, JSON.stringify(state)]);
      for (const s of m.seats) {
        await q.query('INSERT INTO match_participants (match_id, seat, user_id, bot_name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [m.id, s.seat, s.userId, s.bot ? s.username : null]);
      }
    });
    this.event(m, 'start', null, { seats: m.seats.map((s) => s.userId ?? `bot:${s.username}`) });
    this.broadcast(m);
    this.scheduleBots(m);
  }

  async act(m: LiveMatch, userId: string, action: unknown, nonce?: string): Promise<{ error?: string; duplicate?: boolean }> {
    if (m.status !== 'IN_PROGRESS' || m.finishing) return { error: 'This match isn’t in play.' };
    const seat = this.seatOf(m, userId);
    if (seat === null) return { error: 'Spectators can’t make moves.' };
    if (m.dropped.includes(seat)) return { error: 'You’re out of this match.' };
    if (nonce) {
      if (m.nonces.has(nonce)) return { duplicate: true };
      m.nonces.add(nonce);
      if (m.nonces.size > 500) m.nonces = new Set([...m.nonces].slice(-250));
    }
    return this.apply(m, seat, action);
  }

  private async apply(m: LiveMatch, seat: number, action: unknown): Promise<{ error?: string }> {
    const res = m.engine.act(m.state, seat, action, makeCtx());
    if (typeof res === 'string') {
      this.event(m, 'rejected', seat, { reason: res });
      return { error: res };
    }
    m.state = res;
    m.lastActivity = Date.now();
    this.event(m, 'action', seat, action);
    await this.afterChange(m);
    return {};
  }

  private async afterChange(m: LiveMatch) {
    const outcome = m.engine.outcome(m.state);
    if (outcome) { await this.complete(m, outcome); return; }
    const active = m.seats.filter((s) => !m.dropped.includes(s.seat));
    if (m.seats.length > 1 && active.length === 1) {
      await this.complete(m, { kind: 'win', ranking: [[active[0].seat]], scores: [], summary: 'Last player left', reason: 'Everyone else left' });
      return;
    }
    this.saveState(m);
    this.broadcast(m);
    this.scheduleBots(m);
  }

  async resign(m: LiveMatch, userId: string): Promise<string | null> {
    if (m.status === 'WAITING') return this.leave(m, userId);
    if (m.status !== 'IN_PROGRESS') return 'This match is over.';
    const seat = this.seatOf(m, userId);
    if (seat === null) return 'You’re not playing in this match.';
    await this.forfeit(m, seat, 'Resigned');
    return null;
  }

  async claim(m: LiveMatch, userId: string): Promise<string | null> {
    if (m.status !== 'IN_PROGRESS') return 'This match is over.';
    const seat = this.seatOf(m, userId);
    if (seat === null) return 'You’re not playing in this match.';
    const now = Date.now();
    const gone = [...m.disconnectedAt.entries()].filter(([s, t]) => s !== seat && !m.dropped.includes(s) && now - t >= DISCONNECT_GRACE_MS);
    if (!gone.length) return 'Your opponent can still reconnect. Give them a moment.';
    for (const [s] of gone) {
      if (m.status !== 'IN_PROGRESS') break;
      await this.forfeit(m, s, 'Left the match');
    }
    return null;
  }

  async forfeit(m: LiveMatch, seat: number, reason: string) {
    if (m.dropped.includes(seat) || m.status !== 'IN_PROGRESS') return;
    this.event(m, 'forfeit', seat, { reason });
    if (m.seats.length === 1) {
      m.status = 'ABANDONED';
      m.doneAt = Date.now();
      m.result = { kind: 'ranking', ranking: [[0]], scores: [], summary: reason, reason };
      await S.db.query(`UPDATE matches SET status = 'ABANDONED', completed_at = now(), result = $2, state = NULL WHERE id = $1`, [m.id, JSON.stringify(m.result)]);
      this.broadcast(m);
      return;
    }
    m.dropped.push(seat);
    const active = m.seats.filter((s) => !m.dropped.includes(s.seat)).map((s) => s.seat);
    if (active.length === 1 || !m.engine.drop) {
      await this.complete(m, {
        kind: active.length === 1 && m.seats.length === 2 ? 'win' : 'ranking', ranking: [active], scores: [],
        summary: `${m.seats[seat].username} ${reason.toLowerCase()}`, reason: `${m.seats[seat].username} ${reason.toLowerCase()}`,
      });
      return;
    }
    m.state = m.engine.drop(m.state, seat, makeCtx());
    await this.afterChange(m);
  }

  private normalize(m: LiveMatch, outcome: Outcome): MatchResult {
    const dropped = new Set(m.dropped);
    const ranking = outcome.ranking.map((g) => g.filter((s) => !dropped.has(s))).filter((g) => g.length);
    const seen = new Set(ranking.flat());
    const missing = m.seats.map((s) => s.seat).filter((s) => !seen.has(s) && !dropped.has(s));
    if (missing.length) ranking.push(missing);
    for (const s of [...m.dropped].reverse()) ranking.push([s]);
    const kind = ranking.length === 1 && m.seats.length > 1 ? 'draw' : outcome.kind;
    const { tags, ...rest } = outcome;
    return { ...rest, kind, ranking, ...(tags ? { tags } : {}) } as MatchResult;
  }

  private async complete(m: LiveMatch, outcome: Outcome) {
    if (m.finishing) return;
    m.finishing = true;
    if (m.botTimer) { clearTimeout(m.botTimer); m.botTimer = null; }
    const result = this.normalize(m, outcome);
    m.result = result;
    this.event(m, 'complete', null, { ranking: result.ranking, reason: result.reason });
    await m.chain; // make sure every event is written before the result
    const after: After = [];
    let tournamentId: string | null = null;
    const final = await S.db.tx(async (q) => {
      const r = await finalizeMatch(q, { id: m.id, gameId: m.gameId, mode: m.mode, seats: m.seats.map((s) => ({ seat: s.seat, userId: s.userId, bot: s.bot })) }, result, after);
      if (r && m.tournament && this.hooks.tournamentResult) {
        const w = r.ranking.length > 1 && r.ranking[0].length === 1 ? m.seats[r.ranking[0][0]].userId : null;
        await this.hooks.tournamentResult(q, m.tournament.tmId, w, r.reason, after);
        tournamentId = m.tournament.id;
      }
      return r;
    });
    after.forEach((f) => f());
    if (final) {
      const { tags: _t, ...clean } = final as MatchResult & { tags?: unknown };
      m.result = clean;
    }
    m.status = 'COMPLETED';
    m.state = m.state; // keep final board for viewers
    m.doneAt = Date.now();
    this.broadcast(m);
    if (tournamentId) this.hooks.afterTournamentChange?.(tournamentId);
  }

  // ------------------------------------------------------------------ extras

  async rematch(m: LiveMatch, userId: string): Promise<string | null> {
    if (m.status !== 'COMPLETED') return 'Rematches open once the match ends.';
    if (m.tournament) return 'Tournament matches can’t be rematched.';
    if (m.rematch.nextId) return null;
    const seat = this.seatOf(m, userId);
    if (seat === null) return 'Only players can ask for a rematch.';
    m.rematch.requested.add(seat);
    const humans = m.seats.filter((s) => s.userId);
    if (humans.every((s) => m.rematch.requested.has(s.seat))) {
      // Rotate seats so the first move alternates.
      const players = [...humans.slice(1), humans[0]].map((s) => ({ id: s.userId!, username: s.username, avatar: s.avatar }));
      const next = await this.create({
        gameId: m.gameId, mode: m.mode === 'practice' ? 'practice' : 'private', host: players[0], options: m.options,
        players, bots: m.seats.length - humans.length, rematchOf: m.id, autoStart: true,
      });
      m.rematch.nextId = next.id;
    }
    this.broadcast(m);
    return null;
  }

  chatMessage(m: LiveMatch, user: Player, text: string): string | null {
    if (!chatLimiter.take(user.id)) return 'You’re sending messages too quickly.';
    const clean = cleanText(text);
    if (!clean) return null;
    const msg: ChatMessage = { id: newId(8), userId: user.id, username: user.username, text: clean, at: Date.now() };
    m.chat.push(msg);
    if (m.chat.length > 60) m.chat.shift();
    for (const s of this.watchers.get(m.id) ?? []) {
      if ((s.data.blocked as Set<string> | undefined)?.has(user.id)) continue;
      s.emit('match:chat', { matchId: m.id, message: msg });
    }
    return null;
  }

  react(m: LiveMatch, user: Player, emoji: string) {
    if (!REACTIONS.includes(emoji) || !chatLimiter.take(`r:${user.id}`)) return;
    for (const s of this.watchers.get(m.id) ?? []) s.emit('match:react', { matchId: m.id, userId: user.id, emoji });
  }

  // ------------------------------------------------------------------ bots & timers

  private scheduleBots(m: LiveMatch) {
    if (m.botTimer || m.status !== 'IN_PROGRESS' || !m.engine.bot) return;
    const bots = m.seats.filter((s) => s.bot && !m.dropped.includes(s.seat));
    if (!bots.length) return;
    const meta = GAME_BY_ID[m.gameId];
    const delay = meta.category === 'arcade' ? 2600 : m.gameId === 'chess' ? 1100 : 900;
    m.botTimer = setTimeout(async () => {
      m.botTimer = null;
      if (m.status !== 'IN_PROGRESS') return;
      for (const b of bots) {
        const action = m.engine.bot!(m.state, b.seat, makeCtx());
        if (action) { await this.apply(m, b.seat, action); return; }
      }
    }, delay + randomInt(400));
  }

  async tick(now = Date.now()) {
    for (const m of [...this.live.values()]) {
      if (m.status === 'IN_PROGRESS' && !m.finishing) {
        const humansHere = [...(this.watchers.get(m.id) ?? [])].some((s) => this.seatOf(m, s.data.user?.id) !== null);
        if (humansHere) m.lastActivity = Math.max(m.lastActivity, now - IDLE_MS / 2);
        else if (now - m.lastActivity > IDLE_MS) { await this.abandon(m, 'Nobody played for 30 minutes'); continue; }
        const d = m.engine.deadline(m.state);
        if (d && now >= d.at) {
          m.state = m.engine.onDeadline(m.state, makeCtx(now));
          this.event(m, 'timeout', d.seat, null);
          await this.afterChange(m);
        }
      } else if (m.status === 'WAITING') {
        if (m.tournament && now >= m.tournament.deadline) await this.tournamentDeadline(m);
        else if (m.expiresAt && now >= m.expiresAt) await this.cancel(m, 'The invitation expired.');
      } else if (m.doneAt && now - m.doneAt > KEEP_FINISHED_MS && !this.watchers.get(m.id)?.size) {
        this.live.delete(m.id);
        this.watchers.delete(m.id);
      }
    }
  }

  private async abandon(m: LiveMatch, reason: string) {
    if (m.botTimer) { clearTimeout(m.botTimer); m.botTimer = null; }
    m.status = 'ABANDONED';
    m.doneAt = Date.now();
    m.result = { kind: 'draw', ranking: [], scores: [], summary: reason, reason };
    await S.db.query(`UPDATE matches SET status = 'ABANDONED', completed_at = now(), result = $2, state = NULL WHERE id = $1`, [m.id, JSON.stringify(m.result)]);
    this.broadcast(m);
    if (m.tournament) {
      await this.hooks.tournamentWalkover?.(m.tournament.tmId, null, `${reason} — higher seed advances`);
      this.hooks.afterTournamentChange?.(m.tournament.id);
    }
  }

  private async tournamentDeadline(m: LiveMatch) {
    const present = m.seats.filter((s) => s.ready || (this.watchers.get(m.id) && [...this.watchers.get(m.id)!].some((x) => x.data.user?.id === s.userId)));
    if (present.length === m.seats.length) { m.seats.forEach((s) => (s.ready = true)); await this.start(m); return; }
    const winner = present.length === 1 ? present[0].userId : null;
    m.status = 'ABANDONED';
    m.doneAt = Date.now();
    const note = winner ? 'Opponent didn’t show up' : 'Neither player showed up — higher seed advances';
    m.result = { kind: 'win', ranking: [], scores: [], summary: note, reason: note };
    await S.db.query(`UPDATE matches SET status = 'ABANDONED', result = $2 WHERE id = $1`, [m.id, JSON.stringify(m.result)]);
    this.broadcast(m);
    await this.hooks.tournamentWalkover?.(m.tournament!.tmId, winner, note);
    this.hooks.afterTournamentChange?.(m.tournament!.id);
  }

  // ------------------------------------------------------------------ persistence & broadcast

  private event(m: LiveMatch, type: string, seat: number | null, payload: unknown) {
    const seq = ++m.seq;
    m.chain = m.chain
      .then(() => S.db.query('INSERT INTO match_events (match_id, seq, type, seat, payload) VALUES ($1,$2,$3,$4,$5)',
        [m.id, seq, type, seat, payload === null || payload === undefined ? null : JSON.stringify(payload)]))
      .then(() => undefined)
      .catch((e) => console.error('[match event]', m.id, e.message));
  }

  private saveState(m: LiveMatch) {
    const snapshot = JSON.stringify(m.state);
    m.chain = m.chain
      .then(() => S.db.query('UPDATE matches SET state = $2 WHERE id = $1 AND status = $3', [m.id, snapshot, 'IN_PROGRESS']))
      .then(() => undefined)
      .catch((e) => console.error('[match state]', m.id, e.message));
  }

  snapshot(m: LiveMatch, userId: string | null, now = Date.now()): MatchSnapshot {
    const you = this.seatOf(m, userId);
    const sockets = [...(this.watchers.get(m.id) ?? [])];
    const online = (uid: string | null) => !!uid && sockets.some((s) => s.data.user?.id === uid);
    const seats: SeatInfo[] = m.seats.map((s) => ({
      seat: s.seat,
      user: s.userId ? { id: s.userId, username: s.username, avatar: s.avatar } : null,
      bot: s.bot ? s.username : null,
      connected: s.bot ? true : online(s.userId),
      ready: s.ready,
      rating: s.rating,
      out: m.dropped.includes(s.seat),
    }));
    let claimableAt: number | null = null;
    if (you !== null && m.status === 'IN_PROGRESS') {
      for (const [s, t] of m.disconnectedAt) {
        if (s !== you && !m.dropped.includes(s) && !online(m.seats[s]?.userId ?? null)) claimableAt = Math.min(claimableAt ?? Infinity, t + DISCONNECT_GRACE_MS);
      }
    }
    return {
      id: m.id, gameId: m.gameId, mode: m.mode, status: m.status, code: m.code, hostId: m.hostId, options: m.options,
      seats, maxSeats: m.maxSeats, you,
      spectators: sockets.filter((s) => this.seatOf(m, s.data.user?.id) === null).length,
      deadline: m.status === 'IN_PROGRESS' && m.state ? m.engine.deadline(m.state) : null,
      serverNow: now,
      view: m.state ? m.engine.view(m.state, you, now) : null,
      result: m.result,
      rematch: { requested: [...m.rematch.requested], nextId: m.rematch.nextId },
      tournament: m.tournament ? { id: m.tournament.id, title: m.tournament.title, round: m.tournament.round } : null,
      expiresAt: m.expiresAt,
      claimableAt,
    };
  }

  broadcast(m: LiveMatch) {
    const now = Date.now();
    for (const s of this.watchers.get(m.id) ?? []) s.emit('match:state', this.snapshot(m, s.data.user?.id ?? null, now));
  }

  /** Read-only snapshot of a match that is no longer in memory. */
  async archived(id: string, userId: string | null): Promise<MatchSnapshot | null> {
    const row = await S.db.one('SELECT * FROM matches WHERE id = $1', [id]);
    if (!row) return null;
    const parts = await S.db.query(
      `SELECT p.seat, p.user_id, p.bot_name, u.username, u.avatar, p.rating_before
         FROM match_participants p LEFT JOIN users u ON u.id = p.user_id WHERE p.match_id = $1 ORDER BY p.seat`, [id]);
    const you = parts.find((p) => p.user_id && p.user_id === userId)?.seat ?? null;
    return {
      id, gameId: row.game_id, mode: row.mode, status: row.status, code: null, hostId: row.host_id, options: row.options,
      seats: parts.map((p) => ({
        seat: p.seat, user: p.user_id ? { id: p.user_id, username: p.username, avatar: p.avatar } : null, bot: p.bot_name,
        connected: false, ready: true, rating: p.rating_before, out: false,
      })),
      maxSeats: parts.length, you, spectators: 0, deadline: null, serverNow: Date.now(), view: null, result: row.result,
      rematch: { requested: [], nextId: null }, tournament: null, expiresAt: null, claimableAt: null,
    };
  }

  /** After a restart: reload lobbies and games in progress so nobody loses a match to a deploy. */
  async restore() {
    const rows = await S.db.query(`SELECT * FROM matches WHERE status IN ('WAITING', 'IN_PROGRESS')`);
    for (const row of rows) {
      const engine = engineFor(row.game_id);
      if (!engine) continue;
      const parts = await S.db.query(
        `SELECT p.seat, p.user_id, p.bot_name, u.username, u.avatar FROM match_participants p
           LEFT JOIN users u ON u.id = p.user_id WHERE p.match_id = $1 ORDER BY p.seat`, [row.id]);
      if (row.status === 'WAITING' || !row.state || parts.length === 0) {
        // Lobbies are cheap to recreate; tell players their room closed.
        await S.db.query(`UPDATE matches SET status = 'CANCELLED', result = $2 WHERE id = $1`,
          [row.id, JSON.stringify({ kind: 'draw', ranking: [], scores: [], summary: 'Server restarted', reason: 'Server restarted' })]);
        continue;
      }
      const ctx = makeCtx();
      const state = engine.start ? engine.start(row.state, ctx) : row.state;
      const tm = row.tournament_match_id
        ? await S.db.one(`SELECT tm.round, t.id, t.title FROM tournament_matches tm JOIN tournaments t ON t.id = tm.tournament_id WHERE tm.id = $1`, [row.tournament_match_id])
        : null;
      const m: LiveMatch = {
        id: row.id, gameId: row.game_id, mode: row.mode, status: 'IN_PROGRESS', code: null, hostId: row.host_id, options: row.options,
        engine, state, maxSeats: parts.length, minSeats: parts.length,
        seats: parts.map((p) => ({
          seat: p.seat, userId: p.user_id, username: p.username ?? p.bot_name ?? 'Player', avatar: p.avatar ?? { color: 0, glyph: 4 },
          bot: p.bot_name ? 'bot' : null, ready: true, rating: null,
        })),
        createdAt: Date.now(), expiresAt: null, result: null, dropped: [], seq: 0, nonces: new Set(),
        rematch: { requested: new Set(), nextId: null },
        tournament: tm ? { id: tm.id, title: tm.title, round: tm.round, tmId: row.tournament_match_id, deadline: Infinity } : null,
        disconnectedAt: new Map(parts.filter((p) => p.user_id).map((p) => [p.seat, Date.now()])),
        chat: [], chain: Promise.resolve(), botTimer: null, finishing: false, doneAt: null, lastActivity: Date.now(),
      };
      const last = await S.db.one('SELECT max(seq)::int AS seq FROM match_events WHERE match_id = $1', [row.id]);
      m.seq = Number(last?.seq ?? 0);
      this.live.set(m.id, m);
      this.scheduleBots(m);
    }
  }
}

export const matches = new MatchManager();
