import type { AdsConfig } from '../shared/types';
import { config } from './config';
import { audit, notify } from './notify';
import { S } from './state';

let cache: { at: number; users: number } | null = null;

export async function activeUserCount(): Promise<number> {
  if (cache && Date.now() - cache.at < 60_000) return cache.users;
  const row = await S.db.one(`SELECT count(*)::int AS n FROM users WHERE status = 'active'`);
  cache = { at: Date.now(), users: Number(row?.n ?? 0) };
  return cache.users;
}

export function invalidateUserCount() { cache = null; }

/** Ads are configured (provider + client id) AND either forced on or the account threshold has been reached. */
export async function adsConfig(): Promise<AdsConfig> {
  const a = config.ads;
  const configured = a.provider !== 'none' && Boolean(a.client);
  let enabled = false;
  if (configured && a.mode === 'on') enabled = true;
  else if (configured && a.mode === 'auto') enabled = (await activeUserCount()) >= a.userThreshold;
  return {
    enabled,
    provider: enabled ? a.provider : 'none',
    client: enabled ? a.client : null,
    slots: enabled ? a.slots : { banner: null, results: null, sidebar: null },
    interstitial: enabled && a.interstitial,
    test: a.test,
  };
}

export async function adsStatus() {
  const users = await activeUserCount();
  const a = config.ads;
  const activated = await S.db.one(`SELECT value FROM settings WHERE key = 'ads_threshold_reached'`);
  return {
    users,
    threshold: a.userThreshold,
    progress: Math.min(1, users / a.userThreshold),
    provider: a.provider,
    configured: a.provider !== 'none' && Boolean(a.client),
    mode: a.mode,
    live: (await adsConfig()).enabled,
    thresholdReachedAt: activated?.value?.at ?? null,
    slots: a.slots,
    interstitial: a.interstitial,
  };
}

/** Record the moment the community crosses the threshold and tell the admins once. */
export async function checkThreshold() {
  const users = await activeUserCount();
  if (users < config.ads.userThreshold) return;
  await S.db.tx(async (q) => {
    const r = await q.one(
      `INSERT INTO settings (key, value) VALUES ('ads_threshold_reached', $1) ON CONFLICT (key) DO NOTHING RETURNING key`,
      [JSON.stringify({ at: new Date().toISOString(), users })],
    );
    if (!r) return;
    await audit(q, null, 'ads.threshold_reached', null, { users });
    const admins = await q.query(`SELECT id FROM users WHERE role = 'admin'`);
    const configured = config.ads.provider !== 'none' && Boolean(config.ads.client);
    for (const a of admins) {
      await notify(q, a.id, 'admin.ads', {
        users,
        text: configured ? `GamePact passed ${config.ads.userThreshold} players — ads are now live.` : `GamePact passed ${config.ads.userThreshold} players. Add your ad provider settings to switch ads on.`,
      });
    }
  });
}

export function adsTxt(): string | null {
  const a = config.ads;
  if (a.provider !== 'adsense' || !a.client) return null;
  const pub = a.client.replace(/^ca-/, '');
  return `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`;
}
