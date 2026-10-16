import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Empty } from '../components/ui';
import { api, post } from '../lib/api';
import { useAction, useFetch } from '../lib/app';
import { timeAgo } from '../lib/format';

export default function Friends() {
  const { data, reload } = useFetch<any>('/friends');
  const blocked = useFetch<any>('/blocks');
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  return (
    <div className="page stack-lg" style={{ maxWidth: 760 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 'clamp(2.2rem, 6vw, 3.4rem)' }}>Friends</h1>
        <p className="muted">Add people by their exact username. Friends can invite you straight into a room.</p>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/friends/request', { username: name.trim() }); setName(''); await reload(); }, 'Request sent.'); }}>
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Username" aria-label="Username to add" autoCapitalize="off" />
        <button className="btn btn-primary" disabled={busy || name.trim().length < 3}>Add friend</button>
      </form>

      {data?.incoming.length > 0 && (
        <section className="stack">
          <h3>Requests</h3>
          <div className="panel list">
            {data.incoming.map((f: any) => (
              <div key={f.user.id} className="list-item">
                <Avatar user={f.user} size={34} /><Link to={`/u/${f.user.username}`} className="grow list-title">{f.user.username}</Link>
                <button className="btn btn-sm btn-mint" onClick={() => run(async () => { await post('/friends/accept', { userId: f.user.id }); reload(); }, `You and ${f.user.username} are friends.`)}>Accept</button>
                <button className="btn btn-sm btn-ghost" onClick={() => run(async () => { await api(`/friends/${f.user.id}`, { method: 'DELETE' }); reload(); })}>Ignore</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack">
        <h3>Your friends</h3>
        {data && data.friends.length === 0 ? <Empty title="No friends yet">Add someone above, or accept a request when one comes in.</Empty> : (
          <div className="panel list">
            {data?.friends.map((f: any) => (
              <div key={f.user.id} className="list-item">
                <Avatar user={f.user} size={34} />
                <Link to={`/u/${f.user.username}`} className="grow" style={{ textDecoration: 'none' }}>
                  <span className="list-title">{f.user.username}</span><br />
                  <span className="tiny muted row" style={{ gap: 6 }}><span className={`presence ${f.online ? 'on' : ''}`} />{f.online ? 'Online' : `Seen ${timeAgo(f.lastSeenAt)}`}</span>
                </Link>
                <button className="btn btn-sm btn-ghost" onClick={() => { if (confirm(`Remove ${f.user.username} from your friends?`)) run(async () => { await api(`/friends/${f.user.id}`, { method: 'DELETE' }); reload(); }); }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {data?.outgoing.length > 0 && (
        <section className="stack">
          <h3>Sent requests</h3>
          <div className="row-wrap">{data.outgoing.map((f: any) => <span key={f.user.id} className="chip">{f.user.username}</span>)}</div>
        </section>
      )}

      {blocked.data?.blocked.length > 0 && (
        <section className="stack">
          <h3>Blocked</h3>
          <div className="panel list">
            {blocked.data.blocked.map((u: any) => (
              <div key={u.id} className="list-item">
                <Avatar user={u} size={30} /><span className="grow list-title">{u.username}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => run(async () => { await api(`/blocks/${u.id}`, { method: 'DELETE' }); blocked.reload(); })}>Unblock</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
