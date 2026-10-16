import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GAME_BY_ID } from '../../shared/catalog';
import { ACHIEVEMENTS } from '../../shared/types';
import { Icons } from '../components/art';
import { Avatar, Empty } from '../components/ui';
import { api, post } from '../lib/api';
import { useAction, useApp, useFetch } from '../lib/app';
import { ordinal, pct, timeAgo } from '../lib/format';

export default function Profile() {
  const { username = '' } = useParams();
  const { me, toast } = useApp();
  const { busy, run } = useAction();
  const { data, error, reload } = useFetch<any>(`/players/${encodeURIComponent(username)}`);
  const [more, setMore] = useState<any[]>([]);
  const [noMore, setNoMore] = useState(false);
  if (error) return <div className="page stack" style={{ alignItems: 'flex-start' }}><h2>Player not found</h2><p className="muted">Check the spelling — usernames must match exactly.</p></div>;
  if (!data) return <div className="page"><div className="skeleton" style={{ height: 300 }} /></div>;

  const p = data.player;
  const mine = me?.id === p.id;
  const earned = new Set(data.achievements.map((a: any) => a.key));
  const matches = [...data.recent, ...more];
  const loadMore = async () => {
    const last = matches[matches.length - 1];
    const r = await api(`/players/${encodeURIComponent(p.username)}/matches?before=${encodeURIComponent(last.completed_at)}`);
    setMore((m) => [...m, ...r.matches]);
    if (r.matches.length < 20) setNoMore(true);
  };

  return (
    <div className="page stack-lg">
      <section className="row-wrap" style={{ alignItems: 'center', gap: 20 }}>
        <Avatar user={p} size={88} />
        <div className="stack grow" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 'clamp(2rem, 7vw, 3.2rem)', wordBreak: 'break-word' }}>{p.username}</h1>
          <span className="muted small row" style={{ gap: 8 }}><span className={`presence ${p.online ? 'on' : ''}`} />{p.online ? 'Online now' : `Joined ${new Date(p.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`}</span>
        </div>
        <div className="row-wrap">
          {mine && <Link className="btn" to="/settings">{Icons.settings}Settings</Link>}
          {mine && me?.role === 'admin' && <Link className="btn btn-ghost" to="/admin">Admin</Link>}
          {!mine && me && data.relation === 'none' && <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { await post('/friends/request', { username: p.username }); reload(); }, 'Friend request sent.')}>Add friend</button>}
          {!mine && me && data.relation === 'incoming' && <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { await post('/friends/accept', { userId: p.id }); reload(); }, 'You’re now friends.')}>Accept friend request</button>}
          {!mine && data.relation === 'requested' && <span className="chip">Request sent</span>}
          {!mine && data.relation === 'friends' && <span className="chip chip-live">Friends</span>}
          {!mine && me && data.relation !== 'blocked' && (
            <button className="btn btn-ghost btn-sm" onClick={() => run(async () => { await post('/blocks', { userId: p.id }); reload(); }, `${p.username} is blocked. You won’t be matched or see their chat.`)}>Block</button>
          )}
          {!mine && data.relation === 'blocked' && <button className="btn btn-ghost btn-sm" onClick={() => run(async () => { await api(`/blocks/${p.id}`, { method: 'DELETE' }); reload(); }, 'Unblocked.')}>Unblock</button>}
          {!mine && me && (
            <button className="btn btn-ghost btn-sm" onClick={async () => {
              const reason = prompt(`Why are you reporting ${p.username}?`);
              if (!reason) return;
              try { await api('/reports', { body: { targetType: 'user', targetId: p.id, reason } }); toast('Thanks — a moderator will look at it.'); } catch (e: any) { toast(e.message, { tone: 'err' }); }
            }}>{Icons.flag}Report</button>
          )}
        </div>
      </section>

      <div className="stat-strip">
        <div className="stat"><div className="v num">{data.totals.games}</div><div className="k">Played</div></div>
        <div className="stat"><div className="v num" style={{ color: 'var(--mint)' }}>{data.totals.wins}</div><div className="k">Won</div></div>
        <div className="stat"><div className="v num">{data.totals.losses}</div><div className="k">Lost</div></div>
        <div className="stat"><div className="v num">{pct(data.totals.wins, data.totals.games)}%</div><div className="k">Win rate</div></div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="panel stack">
          <h3>By game</h3>
          {data.games.length === 0 ? <p className="small muted">No finished games yet.</p> : (
            <table className="table small">
              <thead><tr><th>Game</th><th>Rating</th><th className="num">W–L–D</th></tr></thead>
              <tbody>
                {data.games.map((g: any) => (
                  <tr key={g.game_id}>
                    <td><Link to={`/games/${g.game_id}`}>{GAME_BY_ID[g.game_id]?.name}</Link></td>
                    <td className="num">{g.rated_games > 0 ? <><b>{g.rating}</b> <span className="faint">peak {g.peak}</span></> : <span className="faint">Unrated</span>}</td>
                    <td className="num muted">{g.wins}–{g.losses}–{g.draws}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel stack">
          <h3>Tournaments</h3>
          {data.tournaments.length === 0 ? <p className="small muted">{mine ? 'You haven’t played in a tournament yet.' : 'No tournaments yet.'}</p> : (
            <div className="list">
              {data.tournaments.map((t: any) => (
                <Link key={t.id} to={`/t/${t.id}`} className="list-item">
                  <span className="grow"><span className="list-title">{t.title}</span><br /><span className="small muted">{GAME_BY_ID[t.game_id]?.name}</span></span>
                  {t.final_placement === 1 ? <span className="chip chip-word">Champion</span> : t.final_placement ? <span className="chip">{ordinal(t.final_placement)}</span> : <span className="chip chip-live">Playing</span>}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="stack">
        <h3>Achievements</h3>
        <div className="badge-grid">
          {Object.entries(ACHIEVEMENTS).map(([key, a]) => (
            <div key={key} className={`badge ${earned.has(key) ? '' : 'locked'}`} title={a.description}>
              <span className="medal">★</span>
              <span className="stack" style={{ gap: 0 }}><b className="small">{a.name}</b><span className="tiny muted">{a.description}</span></span>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <h3>Recent matches</h3>
        {matches.length === 0 ? <Empty title="No matches yet">{mine ? <Link to="/games">Pick a game to get started.</Link> : null}</Empty> : (
          <div className="panel list">
            {matches.map((m: any) => (
              <Link key={m.id} to={`/m/${m.id}`} className="list-item">
                <span className={`chip ${m.outcome === 'win' ? 'chip-live' : m.outcome === 'loss' ? 'chip-arcade' : ''}`} style={{ minWidth: 52, justifyContent: 'center' }}>{m.outcome === 'win' ? 'Won' : m.outcome === 'loss' ? 'Lost' : m.outcome === 'draw' ? 'Draw' : '—'}</span>
                <span className="grow">
                  <span className="list-title">{GAME_BY_ID[m.game_id]?.name}</span>
                  <span className="small muted"> vs {(m.opponents ?? []).map((o: any) => o.username + (o.bot ? ' (bot)' : '')).join(', ') || 'solo'}</span>
                </span>
                {m.rating_after !== null && m.rating_before !== null && <span className={`small num ${m.rating_after >= m.rating_before ? 'ok' : 'error'}`}>{m.rating_after >= m.rating_before ? '+' : ''}{m.rating_after - m.rating_before}</span>}
                <span className="tiny faint" style={{ whiteSpace: 'nowrap' }}>{timeAgo(m.completed_at)}</span>
              </Link>
            ))}
          </div>
        )}
        {matches.length >= 20 && !noMore && <button className="btn btn-sm" style={{ alignSelf: 'center' }} onClick={loadMore}>Show older</button>}
      </section>
    </div>
  );
}
