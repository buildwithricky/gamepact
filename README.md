# GamePact

Quick multiplayer games you can send to a friend. Pick a username (no email), choose a game, share a link, play — results land on profiles, ratings and leaderboards. Players can host free knockout tournaments for bragging rights. Ads are wired in and switch themselves on once the community passes 2,000 players.

## What's in the box

| Game | Status | Modes |
|---|---|---|
| Tic-Tac-Toe | Live | best of 1/3/5, ranked, bot practice |
| Chess | Live | blitz 5+0, rapid 10+5, untimed; draw offers, promotion, all draw rules (chess.js) |
| Crazy Eights | Live | 2–4 players, one round or first to 100, draw-one or draw-until-playable |
| Darts | Live | 301, 501, high score |
| Archery | Live | 2–4 players, wind, shoot-off on ties |
| Mini Golf | Live | 1–4 players, 3 or 6 holes, sand, water, slopes |
| Cup Pong | Live | balls back on double sink |
| Knockout | Live | 2–4 players, 2 or 3 lives, shrinking target |
| Word Guess | Live | 1–4 players racing the same word |
| Word Scramble | Live | 1–6 players, 5 or 8 rounds, any full anagram counts |
| Word Duel | Live | shared 9-letter rack, 3 timed rounds |
| Paintball | Marked "coming soon" | not playable yet (see Roadmap) |

Platform features:

- **Accounts without email**: username + password (Argon2id), one-time recovery code shown at signup (copy/download), password change, regenerate recovery code, sign out everywhere.
- **Play modes**: private rooms (unguessable link + 6-letter code, 1-hour expiry, invite friends directly), quick play casual/ranked matchmaking (rating window widens while you wait), practice vs bots or solo.
- **Server-authoritative engine**: every move is validated on the server; hidden information (cards, the secret word, rack scores) never leaves it; duplicate/replayed actions are ignored (nonces); out-of-turn moves rejected; turn timers and clocks enforced by server time; event log per match; in-progress games survive a server restart.
- **Reconnects & no-shows**: state restores on reconnect; if an opponent is gone for 90 s you can claim the win; idle abandoned matches close after 30 min.
- **Ratings & leaderboards**: per-game Elo (ranked only, idempotent, farming guard after 4 ranked games/24 h between the same pair); global, per-game, weekly, season (month), friends, and tournament champions boards.
- **Tournaments**: single elimination for 4–64, seeded by rating, byes to top seeds, optional check-in, show-up deadline with automatic walkovers, draws replayed (then higher seed advances), withdrawals, host announcements, private invite-link tournaments, drafts, champion trophies. No entry fees or cash — the "prize" is a free-text bragging line.
- **Social**: friends (requests by exact username), online presence, block (also blocks matchmaking, invites and chat), match chat with rate limits + basic filter, quick reactions, reports.
- **Achievements**: first win, 10 matches, 5-win streak, checkmate, under par, finalist, champion, organiser.
- **Admin** (`/admin`): accounts, DAU, live matches, ad threshold progress, reports, suspend/reinstate users.
- **PWA** basics (manifest + icons), mobile-first layouts, keyboard and slider alternatives for gesture controls, reduced-motion support.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000 — API, sockets and Vite hot reload on one port
```

No database setup needed for local work: when `DATABASE_URL` is empty the server uses an embedded Postgres (PGlite) stored in `./data/pglite`.

Make yourself an admin: put `ADMIN_USERNAMES=yourname` in `.env` (copy `.env.example`) **before** registering that username.

```bash
npm test             # engine unit tests + full two-player socket/tournament/ads integration tests
npm run typecheck
npm run build && npm start   # production build on PORT (default 3000)
```

## Deploy

It's one Node process (HTTP + WebSockets) plus Postgres.

- **Render**: push the repo and create a Blueprint from `render.yaml` (web service + Postgres). Set `ADMIN_USERNAMES` and `PUBLIC_URL`.
- **Railway / Fly / any Docker host**: `docker build -t gamepact .` and run with `DATABASE_URL` set. Without `DATABASE_URL` it falls back to PGlite in `/data` — mount a volume, and treat that as a hobby setup only.
- Needs sticky sessions only if you run more than one instance — see *Scaling* below. Run **one instance** for now.

Migrations run automatically on boot (`src/server/migrations.ts`).

## Ads: how the 2,000-player switch works

Ads are fully wired but invisible until **both** are true:

1. a provider is configured (`ADS_PROVIDER=adsense` + `ADS_CLIENT_ID`), and
2. active accounts ≥ `ADS_USER_THRESHOLD` (default 2000) — or you force them with `ADS_MODE=on`.

The server re-checks every few minutes. The moment the threshold is crossed it records the date, writes an audit entry and notifies every admin in-app. `/admin` shows a progress bar the whole time.

Placements (all respect the gate, none appear during gameplay):

| Slot env var | Where |
|---|---|
| `ADS_SLOT_BANNER` | Home page, below your dashboard |
| `ADS_SLOT_RESULTS` | Under the result screen after a match |
| `ADS_SLOT_SIDEBAR` | Tournaments list and leaderboards |
| `ADS_H5_INTERSTITIAL=true` | Between matches — shown when a player taps Rematch/Play again (Google's H5 Games Ads / Ad Placement API) |

To go live:

1. Get AdSense approved for your domain and create three responsive display ad units; copy their slot IDs into the env vars above.
2. `/ads.txt` is generated automatically from `ADS_CLIENT_ID`.
3. Turn on Google's consent message (AdSense → Privacy & messaging) for UK/EEA visitors before ads go live — you're in London and many players will be in the UK.
4. Optional: apply for H5 Games Ads, then set `ADS_H5_INTERSTITIAL=true`. Use `ADS_TEST_MODE=true` while testing.
5. The Content-Security-Policy opens up to Google's ad domains automatically when `ADS_PROVIDER=adsense`.

To use a different network later, add it next to the AdSense loader in `src/client/components/ui.tsx` (`AdSlot`, `showBreak`) and extend `ADS_PROVIDER` in `src/server/config.ts`.

## How it's built

- **Client**: React + TypeScript (Vite), React Router, plain CSS design system in `src/client/styles.css` (felt-dark surfaces, one accent per game family, tactile "token" controls with hard shadows; Lilita One + Figtree, self-hosted). Boards are DOM for board/card/word games and Canvas for arcade games.
- **Server**: Express 5 + Socket.IO in one process (`src/server`), Postgres via `pg` (PGlite fallback), hand-written SQL migrations.
- **Shared**: `src/shared` holds the game catalog, protocol types, darts/archery/pong geometry and the mini golf courses + physics used by both sides.

Adding a game:

1. Add its metadata to `src/shared/catalog.ts`.
2. Write an engine implementing `Engine` in `src/server/games/` (`init`, `act`, `view`, `outcome`, `deadline`, `onDeadline`, optional `drop`, `bot`) and register it in `registry.ts`.
3. Add a board component in `src/client/games/` and register it in `index.tsx`.
4. Add a bot-plays-itself test — `tests/engines.test.ts` already runs every engine with a bot to completion.

Matchmaking, rooms, timers, reconnects, ratings, stats, achievements, tournaments and leaderboards come for free.

## Deviations from the spec, on purpose

- **Vite + Express instead of Next.js, raw SQL instead of Prisma**: one long-lived process is the simplest home for WebSockets, and Prisma's engine downloads were not needed for this schema. Swapping later is contained to `src/server/db.ts`.
- **Password minimum is 12** as specified (`PASSWORD_MIN_LENGTH`), with a show/hide toggle and passphrase hint to keep signup quick.
- **Real-money features are not built at all** — tournaments are free and the prize is text. The bracket code has no notion of fees, so nothing needs to be "disabled".

## Known limits and next steps

- **Scaling**: live matches, the matchmaking queue, presence and rate limits live in memory, so run a single instance. To scale out, add the Socket.IO Redis adapter and move the queue/limits to Redis, pinning each match to one node.
- **Arcade fairness**: arcade games send *intent* (aim point, hold time, swipe) and the server applies its own randomness and scoring, so nobody can submit a score — but a scripted client could aim more precisely than a thumb. Add plausibility flags (e.g. perfect-release streaks) before running ranked arcade seasons with real stakes.
- **Paintball** is listed as coming soon. Next: double elimination / Swiss formats, spectator chat toggle, passkeys and optional email for recovery, push notifications.
- The dictionary is the MIT-licensed `an-array-of-english-words` list (~275k words). Puzzle answers come from hand-picked everyday words in `src/server/words/lists.ts`.
