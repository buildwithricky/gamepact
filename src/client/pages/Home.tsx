import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GAME_BY_ID, GAMES } from '../../shared/catalog';
import { AdSlot, Avatar, Dialog, Empty, MiniToken } from '../components/ui';
import { GameArt } from '../components/art';
import { useApp, useFetch } from '../lib/app';
import { pct, timeAgo, when } from '../lib/format';

interface HomeData {
  stats: { games: number; wins: number; losses: number; draws: number };
  recentGames: string[];
  invites: { id: string; payload: { matchId: string; gameId: string; from: string }; created_at: string }[];
  tournaments: { id: string; title: string; game_id: string; status: string; starts_at: string; my_status: string }[];
  friendsOnline: { user: { id: string; username: string; avatar: any } }[];
  friendRequests: number;
  activity: { id: string; game_id: string; completed_at: string; outcome: string; mode: string }[];
  live: { id: string; gameId: string; status: string; mode: string; tournament: string | null }[];
}

export function PlayNowDialog({ onClose }: { onClose(): void }) {
  const navigate = useNavigate();
  return (
    <Dialog title="What are we playing?" onClose={onClose}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {GAMES.filter((g) => g.status === 'live').map((g) => (
          <button key={g.id} className="btn btn-ghost" style={{ justifyContent: 'flex-start', borderRadius: 16, padding: '8px 12px', minHeight: 56 }} onClick={() => navigate(`/games/${g.id}`)}>
            <span style={{ width: 34, height: 28, display: 'grid', placeItems: 'center', borderRadius: 8, background: `var(--${g.category})`, flex: 'none' }}><GameArt id={g.id} /></span>
            <span className="small" style={{ textAlign: 'left' }}>{g.name}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export default function Home() {
  const { me } = useApp();
  const { data } = useFetch<HomeData>('/me/home');
  const [picking, setPicking] = useState(false);
  const recent = (data?.recentGames ?? []).map((id) => GAME_BY_ID[id]).filter(Boolean);
  const shelf = [...recent, ...GAMES.filter((g) => g.status === 'live' && !recent.includes(g))];

  return (
    <div className="page stack-lg">
      <section className="row-wrap between" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 4 }}>
          <p className="muted">Hey {me!.username},</p>
          <h1 style={{ fontSize: 'clamp(2rem, 6vw, 3.2rem)' }}>who are we beating today?</h1>
        </div>
        <div className="row-wrap">
          <button className="btn btn-primary btn-lg" onClick={() => setPicking(true)}>Play now</button>
          <Link className="btn btn-lg" to="/join">Enter a code</Link>
        </div>
      </section>

      {data?.live && data.live.length > 0 && (
        <section className="stack">
          {data.live.map((m) => (
            <Link key={m.id} to={`/m/${m.id}`} className="card card-tight row" style={{ textDecoration: 'none', borderColor: 'var(--mint)' }}>
              <span className="chip chip-live">{m.status === 'WAITING' ? 'Lobby open' : 'In progress'}</span>
              <span className="grow list-title">{GAME_BY_ID[m.gameId]?.name}{m.tournament ? ` · ${m.tournament}` : ''}</span>
              <span className="btn btn-sm btn-mint">{m.status === 'WAITING' ? 'Open lobby' : 'Resume'}</span>
            </Link>
          ))}
        </section>
      )}

      {data?.invites && data.invites.length > 0 && (
        <section className="stack">
          <h3>Challenges for you</h3>
          {data.invites.map((i) => (
            <Link key={i.id} to={`/m/${i.payload.matchId}`} className="card card-tight row" style={{ textDecoration: 'none' }}>
              <span className="grow"><strong>{i.payload.from}</strong> wants a game of <strong>{GAME_BY_ID[i.payload.gameId]?.name}</strong> <span className="faint small">{timeAgo(i.created_at)}</span></span>
              <span className="btn btn-sm btn-primary">Accept</span>
            </Link>
          ))}
        </section>
      )}

      <section className="stack">
        <div className="section-head"><h2>Your shelf</h2><Link to="/games">All games</Link></div>
        <div className="mini-shelf">{shelf.map((g) => <MiniToken key={g.id} game={g} />)}</div>
      </section>

      <div className="grid-2">
        <section className="stack">
          <div className="section-head"><h3>Your record</h3><Link to="/me">Profile</Link></div>
          <div className="stat-strip">
            <div className="stat"><div className="v num">{data?.stats.games ?? '–'}</div><div className="k">Played</div></div>
            <div className="stat"><div className="v num" style={{ color: 'var(--mint)' }}>{data?.stats.wins ?? '–'}</div><div className="k">Won</div></div>
            <div className="stat"><div className="v num">{data?.stats.losses ?? '–'}</div><div className="k">Lost</div></div>
            <div className="stat"><div className="v num">{data ? `${pct(data.stats.wins, data.stats.games)}%` : '–'}</div><div className="k">Win rate</div></div>
          </div>
          {data && data.activity.length > 0 ? (
            <div className="panel list">
              {data.activity.map((a) => (
                <Link key={a.id} to={`/m/${a.id}`} className="list-item">
                  <span className={`chip ${a.outcome === 'win' ? 'chip-live' : a.outcome === 'loss' ? 'chip-arcade' : ''}`}>{a.outcome === 'win' ? 'Won' : a.outcome === 'loss' ? 'Lost' : 'Draw'}</span>
                  <span className="grow list-title">{GAME_BY_ID[a.game_id]?.name}</span>
                  <span className="small faint">{timeAgo(a.completed_at)}</span>
                </Link>
              ))}
            </div>
          ) : data && (
            <Empty title="No results yet">Finish a match against a friend or in quick play and it shows up here.</Empty>
          )}
        </section>

        <section className="stack">
          <div className="section-head"><h3>Tournaments</h3><Link to="/tournaments">Browse</Link></div>
          {data && data.tournaments.length > 0 ? (
            <div className="panel list">
              {data.tournaments.map((t) => (
                <Link key={t.id} to={`/t/${t.id}`} className="list-item">
                  <span className="grow"><span className="list-title">{t.title}</span><br /><span className="small muted">{GAME_BY_ID[t.game_id]?.name} · {t.status === 'IN_PROGRESS' ? 'Playing now' : `Starts ${when(t.starts_at)}`}</span></span>
                  {t.status === 'CHECK_IN' && t.my_status === 'registered' ? <span className="chip chip-warn">Check in</span> : t.status === 'IN_PROGRESS' ? <span className="chip chip-live">Live</span> : null}
                </Link>
              ))}
            </div>
          ) : data && (
            <Empty title="You’re not in any tournaments" action={<Link className="btn btn-board btn-sm" to="/tournaments/new">Host one</Link>}>
              Start a bracket for your friends or join an open one.
            </Empty>
          )}

          <div className="section-head" style={{ marginTop: 8 }}><h3>Friends online</h3><Link to="/friends">{data?.friendRequests ? `${data.friendRequests} request${data.friendRequests > 1 ? 's' : ''}` : 'All friends'}</Link></div>
          {data && data.friendsOnline.length > 0 ? (
            <div className="row-wrap">
              {data.friendsOnline.map((f) => (
                <Link key={f.user.id} to={`/u/${f.user.username}`} className="row" style={{ textDecoration: 'none', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 999, background: 'var(--felt-2)' }}>
                  <Avatar user={f.user} size={30} /><span className="small"><b>{f.user.username}</b></span><span className="presence on" />
                </Link>
              ))}
            </div>
          ) : data && <p className="small muted">Nobody online right now. Add friends by username from the <Link to="/friends">friends page</Link>.</p>}
        </section>
      </div>

      <AdSlot placement="banner" />
      {picking && <PlayNowDialog onClose={() => setPicking(false)} />}
    </div>
  );
}
