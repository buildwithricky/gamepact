import { existsSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { adsTxt, checkThreshold, invalidateUserCount } from './ads';
import { api } from './api';
import { attachUser, authRouter } from './auth';
import { config } from './config';
import { openDb, type Db } from './db';
import { matches } from './matches';
import { matchmaker } from './matchmaking';
import { attachRealtime } from './realtime';
import { HttpError, sameOrigin } from './security';
import { S } from './state';
import { restoreTournaments, tournamentTick, wireTournamentHooks } from './tournaments';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function createServer(opts: { db?: Db; dev?: boolean; quiet?: boolean } = {}) {
  S.db = opts.db ?? (await openDb());
  wireTournamentHooks();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const adsOn = config.ads.provider === 'adsense';
  const google = adsOn
    ? ['https://pagead2.googlesyndication.com', 'https://*.googlesyndication.com', 'https://*.doubleclick.net', 'https://*.google.com',
        'https://*.gstatic.com', 'https://fundingchoicesmessages.google.com', 'https://*.adtrafficquality.google']
    : [];
  app.use(helmet({
    contentSecurityPolicy: opts.dev ? false : {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...google, ...(adsOn ? ["'unsafe-inline'"] : [])],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', ...google],
        connectSrc: ["'self'", ...google],
        frameSrc: [...google],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', sameOrigin(config.publicUrl), attachUser);
  app.use('/api/auth', authRouter);
  app.use('/api', api);
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/ads.txt', (_req, res) => {
    const txt = adsTxt();
    if (!txt) return res.status(404).type('text/plain').send('');
    res.type('text/plain').send(txt);
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

  const http = createHttp(app);
  attachRealtime(http);

  if (opts.dev) {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({ server: { middlewareMode: true, hmr: { server: http } }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = [path.resolve(here, '../client'), path.resolve(process.cwd(), 'dist/client')].find((p) => existsSync(p));
    if (dist) {
      app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
      app.use(express.static(dist, { index: false, maxAge: '1h' }));
      app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    }
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if ((err as any)?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
    console.error('[http]', err);
    res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
  });

  await matches.restore();
  await restoreTournaments();

  const timers: NodeJS.Timeout[] = [];
  const start = () => {
    matches.startTicker();
    matchmaker.start();
    timers.push(setInterval(() => tournamentTick().catch((e) => console.error('[tournaments]', e)), 5_000));
    timers.push(setInterval(() => { invalidateUserCount(); checkThreshold().catch((e) => console.error('[ads]', e)); }, 5 * 60_000));
    checkThreshold().catch(() => {});
  };

  return {
    app, http, start,
    async close() {
      timers.forEach(clearInterval);
      matches.stopTicker();
      matchmaker.stop();
      S.io?.close();
      await new Promise<void>((r) => http.close(() => r()));
      await S.db.close();
    },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const dev = config.env === 'development';
  const server = await createServer({ dev });
  server.start();
  server.http.listen(config.port, () => {
    console.log(`GamePact running on http://localhost:${config.port} (${S.db.kind}${dev ? ', dev' : ''})`);
  });
  const shutdown = async () => { await server.close().catch(() => {}); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
