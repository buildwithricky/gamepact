// Load .env if present (Node 20.12+). Real environment variables win.
try { (process as any).loadEnvFile?.(); } catch { /* no .env file */ }

const env = process.env;

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const config = {
  env: env.NODE_ENV ?? 'development',
  isProd: env.NODE_ENV === 'production',
  port: num(env.PORT, 3000),
  /** Public origin, e.g. https://gamepact.app. Used for invite links and origin checks. */
  publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  /** Postgres connection string. When empty, an embedded Postgres (PGlite) stores data in DATA_DIR. */
  databaseUrl: env.DATABASE_URL ?? '',
  dataDir: env.DATA_DIR ?? './data/pglite',
  trustProxy: num(env.TRUST_PROXY, 1),
  passwordMinLength: num(env.PASSWORD_MIN_LENGTH, 12),
  /** New accounts per IP per hour. Mobile carriers share IPs widely, so keep this generous. */
  registerPerHour: num(env.REGISTER_PER_HOUR, 30),
  sessionDays: num(env.SESSION_DAYS, 30),
  adminUsernames: list(env.ADMIN_USERNAMES),

  ads: {
    provider: (env.ADS_PROVIDER === 'adsense' ? 'adsense' : 'none') as 'adsense' | 'none',
    client: env.ADS_CLIENT_ID || null,
    slots: {
      banner: env.ADS_SLOT_BANNER || null,
      results: env.ADS_SLOT_RESULTS || null,
      sidebar: env.ADS_SLOT_SIDEBAR || null,
    },
    /** Ads switch on automatically once this many active accounts exist. */
    userThreshold: num(env.ADS_USER_THRESHOLD, 2000),
    /** auto = follow the threshold, on = always (useful for testing), off = never. */
    mode: (['on', 'off'].includes(env.ADS_MODE ?? '') ? env.ADS_MODE : 'auto') as 'auto' | 'on' | 'off',
    /** Use Google's H5 Games Ads (Ad Placement API) for between-match interstitials. Needs separate approval. */
    interstitial: env.ADS_H5_INTERSTITIAL === 'true',
    test: env.ADS_TEST_MODE === 'true',
  },
};

export type Config = typeof config;
