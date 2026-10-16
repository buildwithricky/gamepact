import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { config } from './config';
import { MIGRATIONS } from './migrations';

export interface Q {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface Db extends Q {
  /** Run fn inside a transaction. Never call the outer db from inside fn — use the q you are given. */
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'postgres' | 'pglite';
}

const wrap = (query: (sql: string, params?: unknown[]) => Promise<any[]>): Q => ({
  query,
  async one(sql, params) { return (await query(sql, params))[0] ?? null; },
});

async function postgres(url: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 10, ssl: /sslmode=require|neon|supabase|render/.test(url) ? { rejectUnauthorized: false } : undefined });
  const base = wrap(async (sql, params) => (await pool.query(sql, params as any[])).rows);
  return {
    ...base,
    kind: 'postgres',
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn(wrap(async (sql, params) => (await client.query(sql, params as any[])).rows));
        await client.query('COMMIT');
        return res;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function pglite(dir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir !== 'memory://') mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  const base = wrap(async (sql, params) => (await db.query(sql, params as any[])).rows as any[]);
  return {
    ...base,
    kind: 'pglite',
    tx: (fn) => db.transaction((t) => fn(wrap(async (sql, params) => (await t.query(sql, params as any[])).rows as any[]))),
    close: () => db.close(),
  };
}

export async function openDb(opts: { url?: string; dir?: string } = {}): Promise<Db> {
  const url = opts.url ?? config.databaseUrl;
  const db = url ? await postgres(url) : await pglite(opts.dir ?? config.dataDir);
  await migrate(db);
  return db;
}

async function migrate(db: Db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => Number(r.version)));
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    await db.tx(async (q) => {
      for (const stmt of m.sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
    });
  }
}
