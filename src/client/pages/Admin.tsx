import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GAME_BY_ID } from '../../shared/catalog';
import { api, post } from '../lib/api';
import { useAction, useApp, useFetch } from '../lib/app';
import { timeAgo } from '../lib/format';

export default function Admin() {
  const { me } = useApp();
  const { data, error } = useFetch<any>(me?.role === 'admin' ? '/admin/overview' : null);
  const reports = useFetch<any>(me?.role === 'admin' ? '/admin/reports' : null);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const { run } = useAction();
  if (me?.role !== 'admin') return <div className="page"><h2>Admins only</h2><p className="muted">Add your username to ADMIN_USERNAMES on the server to get access.</p></div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page"><div className="skeleton" style={{ height: 300 }} /></div>;
  const ads = data.ads;

  return (
    <div className="page stack-lg">
      <h1 style={{ fontSize: 'clamp(2.2rem, 6vw, 3.4rem)' }}>Admin</h1>
      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <div className="stat"><div className="v num">{data.counts.users}</div><div className="k">Accounts</div></div>
        <div className="stat"><div className="v num">{data.counts.new_users}</div><div className="k">New this week</div></div>
        <div className="stat"><div className="v num">{data.counts.dau}</div><div className="k">Active today</div></div>
        <div className="stat"><div className="v num">{data.live.online}</div><div className="k">Online now</div></div>
        <div className="stat"><div className="v num">{data.live.matches}</div><div className="k">Live matches</div></div>
        <div className="stat"><div className="v num">{data.counts.open_reports}</div><div className="k">Open reports</div></div>
      </div>

      <section className="card stack">
        <div className="row between"><h3>Ads</h3><span className={`chip ${ads.live ? 'chip-live' : ''}`}>{ads.live ? 'Live' : 'Off'}</span></div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row between small"><span>{ads.users.toLocaleString()} of {ads.threshold.toLocaleString()} active players</span><span className="num">{Math.round(ads.progress * 100)}%</span></div>
          <div style={{ height: 14, borderRadius: 7, background: 'var(--felt)', overflow: 'hidden', border: '2px solid var(--ink)' }}>
            <div style={{ width: `${ads.progress * 100}%`, height: '100%', background: 'var(--word)' }} />
          </div>
        </div>
        <ul className="small muted stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
          <li>Provider: {ads.provider === 'none' ? 'not set (ADS_PROVIDER)' : ads.provider}{ads.configured ? '' : ' — add ADS_PROVIDER=adsense and ADS_CLIENT_ID to enable'}</li>
          <li>Mode: {ads.mode === 'auto' ? `switches on automatically at ${ads.threshold.toLocaleString()} players` : ads.mode === 'on' ? 'forced on' : 'forced off'}</li>
          <li>Slots: banner {ads.slots.banner ? '✓' : '—'}, results {ads.slots.results ? '✓' : '—'}, sidebar {ads.slots.sidebar ? '✓' : '—'}; between-match ads {ads.interstitial ? 'on' : 'off'}</li>
          {ads.thresholdReachedAt && <li>Threshold reached {timeAgo(ads.thresholdReachedAt)}</li>}
        </ul>
      </section>

      <section className="panel stack">
        <h3>Matches in the last day</h3>
        {data.matchesToday.length === 0 ? <p className="small muted">None yet.</p> : (
          <div className="row-wrap">{data.matchesToday.map((m: any) => <span key={m.game_id} className="chip">{GAME_BY_ID[m.game_id]?.name ?? m.game_id}: {m.n}</span>)}</div>
        )}
      </section>

      <section className="panel stack">
        <h3>Reports</h3>
        {reports.data?.reports.length === 0 ? <p className="small muted">No reports.</p> : (
          <div className="list">
            {reports.data?.reports.map((r: any) => (
              <div key={r.id} className="list-item" style={{ alignItems: 'flex-start', opacity: r.status === 'open' ? 1 : 0.5 }}>
                <div className="grow stack" style={{ gap: 2 }}>
                  <span className="small"><b>{r.reporter}</b> reported a {r.target_type}{' '}
                    {r.target_type === 'user' && r.target_username ? <Link to={`/u/${r.target_username}`}>{r.target_username}</Link>
                      : r.target_type === 'tournament' ? <Link to={`/t/${r.target_id}`}>tournament</Link> : <Link to={`/m/${r.target_id}`}>match</Link>}</span>
                  <span className="small muted">{r.reason}</span>
                  <span className="tiny faint">{timeAgo(r.created_at)}</span>
                </div>
                {r.status === 'open' && <button className="btn btn-sm" onClick={() => run(async () => { await post(`/admin/reports/${r.id}/resolve`); reports.reload(); }, 'Resolved.')}>Resolve</button>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel stack">
        <h3>Players</h3>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); setUsers((await api(`/admin/users?q=${encodeURIComponent(q)}`)).users); }}>
          <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search usernames" aria-label="Search usernames" />
          <button className="btn">Search</button>
        </form>
        <div className="list">
          {users.map((u) => (
            <div key={u.id} className="list-item">
              <Link to={`/u/${u.username}`} className="grow list-title">{u.username}</Link>
              <span className="small muted">{u.role} · seen {timeAgo(u.last_seen_at)}</span>
              <button className={`btn btn-sm ${u.status === 'active' ? 'btn-danger' : ''}`} onClick={() => run(async () => {
                await post(`/admin/users/${u.id}/status`, { status: u.status === 'active' ? 'suspended' : 'active' });
                setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, status: x.status === 'active' ? 'suspended' : 'active' } : x)));
              }, u.status === 'active' ? 'Suspended and signed out.' : 'Reinstated.')}>{u.status === 'active' ? 'Suspend' : 'Reinstate'}</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
