import { GAME_BY_ID } from '../shared/catalog';
import { matches, type Player } from './matches';
import { S } from './state';

interface Entry { user: Player; gameId: string; mode: 'casual' | 'ranked'; rating: number; since: number }

/** In-memory queue. Pairs two players per game/mode; ranked widens the rating window the longer you wait. */
export class Matchmaker {
  queue: Entry[] = [];
  private timer: NodeJS.Timeout | null = null;

  start() { this.timer ??= setInterval(() => this.pair().catch((e) => console.error('[mm]', e)), 1000); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async enqueue(user: Player, gameId: string, mode: 'casual' | 'ranked'): Promise<string | null> {
    const meta = GAME_BY_ID[gameId];
    if (!meta || meta.status !== 'live') return 'That game isn’t available yet.';
    if (mode === 'ranked' && !meta.ranked) return 'That game has no ranked mode.';
    this.cancel(user.id);
    const r = await S.db.one('SELECT rating FROM ratings WHERE user_id = $1 AND game_id = $2', [user.id, gameId]);
    this.queue.push({ user, gameId, mode, rating: Number(r?.rating ?? 1200), since: Date.now() });
    await this.pair();
    return null;
  }

  cancel(userId: string) {
    const before = this.queue.length;
    this.queue = this.queue.filter((e) => e.user.id !== userId);
    return before !== this.queue.length;
  }

  waiting(gameId: string, mode: string) {
    return this.queue.filter((e) => e.gameId === gameId && e.mode === mode).length;
  }

  private async blocked(a: string, b: string) {
    return Boolean(await S.db.one('SELECT 1 FROM blocks WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1)', [a, b]));
  }

  private pairing: Promise<void> | null = null;
  pair(): Promise<void> {
    // One pairing pass at a time so nobody is matched twice.
    this.pairing ??= this.pairOnce().finally(() => { this.pairing = null; });
    return this.pairing;
  }

  private async pairOnce(): Promise<void> {
    const now = Date.now();
    for (let i = 0; i < this.queue.length; i++) {
      const a = this.queue[i];
      for (let j = i + 1; j < this.queue.length; j++) {
        const b = this.queue[j];
        if (a.gameId !== b.gameId || a.mode !== b.mode || a.user.id === b.user.id) continue;
        if (a.mode === 'ranked') {
          const wait = Math.min(now - a.since, now - b.since) / 1000;
          if (Math.abs(a.rating - b.rating) > 150 + wait * 20) continue;
        }
        if (await this.blocked(a.user.id, b.user.id)) continue;
        if (!this.queue.includes(a) || !this.queue.includes(b)) return this.pairOnce(); // someone left while we checked
        this.queue = this.queue.filter((e) => e !== a && e !== b);
        const players = Math.random() < 0.5 ? [a.user, b.user] : [b.user, a.user];
        const m = await matches.create({ gameId: a.gameId, mode: a.mode, host: null, players, autoStart: true });
        for (const p of players) S.io?.to(`user:${p.id}`).emit('mm:found', { matchId: m.id });
        return this.pairOnce();
      }
    }
  }
}

export const matchmaker = new Matchmaker();
