import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { GAME_BY_ID } from '../../shared/catalog';
import { GameArt, Icons } from '../components/art';
import { Avatar, Dialog, Empty, useNow } from '../components/ui';
import { api, post } from '../lib/api';
import { useAction, useApp, useFetch } from '../lib/app';
import { clock, ordinal, timeAgo, when } from '../lib/format';
import { getSocket } from '../lib/socket';
import { STATUS_LABEL } from './Tournaments';

const roundName = (r: number, total: number) => (r === total ? 'Final' : r === total - 1 ? 'Semi-finals' : r === total - 2 ? 'Quarter-finals' : `Round ${r}`);

export default function Tournament() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const code = params.get('code') ?? undefined;
  const { me, toast } = useApp();
  const { busy, run } = useAction();
  const { data, error, reload } = useFetch<any>(`/tournaments/${id}${code ? `?code=${code}` : ''}`);
  const [confirm, setConfirm] = useState<null | 'withdraw' | 'cancel'>(null);
  const [postText, setPostText] = useState('');
  const now = useNow(1000);

  useEffect(() => {
    const s = getSocket();
    const onUpdate = (p: { id: string }) => { if (p.id === id) reload(); };
    s.emit('tournament:watch', { id });
    s.on('tournament:update', onUpdate);
    const t = setInterval(reload, 15_000);
    return () => { s.emit('tournament:unwatch', { id }); s.off('tournament:update', onUpdate); clearInterval(t); };
  }, [id, reload]);

  if (error) return <div className="page stack" style={{ alignItems: 'flex-start' }}><h2>Can’t open this tournament</h2><p className="muted">{error}</p><Link className="btn" to="/tournaments">All tournaments</Link></div>;
  if (!data) return <div className="page"><div className="skeleton" style={{ height: 400 }} /></div>;

  const t = data.tournament;
  const game = GAME_BY_ID[t.game_id];
  const users: Record<string, any> = Object.fromEntries(data.participants.map((p: any) => [p.user_id, p.user]));
  const rounds = Math.max(0, ...data.bracket.map((b: any) => b.round));
  const myMatch = me ? data.bracket.find((b: any) => !b.winner_id && (b.a_user === me.id || b.b_user === me.id) && b.match_id && ['live', 'ready'].includes(b.status)) : null;
  const registered = data.me && !['withdrawn'].includes(data.me.status);
  const open = ['REGISTRATION_OPEN', 'CHECK_IN'].includes(t.status);
  const count = data.participants.filter((p: any) => p.status !== 'withdrawn').length;
  const inviteLink = t.invite_code ? `${location.origin}/t/${t.id}?code=${t.invite_code}` : `${location.origin}/t/${t.id}`;
  const doPost = (path: string, body: object = {}, ok?: string) => run(async () => { await post(`/tournaments/${id}/${path}`, body); await reload(); }, ok);

  return (
    <div className="page stack-lg">
      <Link to="/tournaments" className="small muted">← Tournaments</Link>
      <section className="stack">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span style={{ width: 72, height: 56, borderRadius: 14, background: `var(--${game.category})`, border: '2px solid var(--ink)', boxShadow: '0 4px 0 var(--ink)', display: 'grid', placeItems: 'center', flex: 'none' }}><GameArt id={game.id} /></span>
          <div className="stack grow" style={{ gap: 6 }}>
            <h1 style={{ fontSize: 'clamp(1.9rem, 6vw, 3rem)' }}>{t.title}</h1>
            <span className="muted">{game.name} · hosted by <Link to={`/u/${t.host}`}>{t.host}</Link>{t.host_completed ? ` · ${t.host_completed} tournament${t.host_completed > 1 ? 's' : ''} run` : ''}</span>
          </div>
        </div>
        <div className="row-wrap">
          <span className={`chip ${t.status === 'IN_PROGRESS' ? 'chip-live' : t.status === 'CHECK_IN' ? 'chip-warn' : ''}`}>{STATUS_LABEL[t.status]}</span>
          <span className="chip num">{count}/{t.capacity} players</span>
          {!['COMPLETED', 'CANCELLED'].includes(t.status) && <span className="chip">{t.status === 'IN_PROGRESS' ? `Started ${timeAgo(t.started_at)}` : `Starts ${when(t.starts_at)}`}</span>}
          {t.checkin_minutes > 0 && open && <span className="chip">Check-in {t.checkin_minutes} min before</span>}
          <span className="chip">{t.match_deadline_minutes} min to show up</span>
          {t.visibility === 'private' && <span className="chip">Invite only</span>}
        </div>
        {t.bragging && <p><b style={{ color: 'var(--word)' }}>Winner gets:</b> {t.bragging}</p>}
        {t.description && <p className="muted" style={{ maxWidth: '68ch', whiteSpace: 'pre-wrap' }}>{t.description}</p>}
      </section>

      {t.status === 'COMPLETED' && t.champion && (
        <div className="result-banner win stack" style={{ alignItems: 'center' }}>
          <span style={{ width: 54, color: 'var(--ink)' }}>{Icons.trophy}</span>
          <h2>{t.champion}</h2>
          <p style={{ fontWeight: 700 }}>Champion{t.bragging ? ` — ${t.bragging}` : ''}</p>
        </div>
      )}

      {myMatch && (
        <Link to={`/m/${myMatch.match_id}`} className="card row" style={{ textDecoration: 'none', borderColor: 'var(--mint)' }}>
          <span className="chip chip-live">Your match</span>
          <span className="grow"><b>{roundName(myMatch.round, rounds)}</b> vs {users[myMatch.a_user === me!.id ? myMatch.b_user : myMatch.a_user]?.username}</span>
          {myMatch.status === 'live' && myMatch.ready_at && (() => {
            const left = new Date(myMatch.ready_at).getTime() + t.match_deadline_minutes * 60_000 - now;
            return left > 0 ? <span className="small muted num">Show up within {clock(left)}</span> : null;
          })()}
          <span className="btn btn-mint btn-sm">Play</span>
        </Link>
      )}

      <section className="row-wrap">
        {t.status === 'DRAFT' && data.isHost && <button className="btn btn-primary" disabled={busy} onClick={() => doPost('publish', {}, 'Published. Registration is open.')}>Publish</button>}
        {open && !registered && (me
          ? <button className="btn btn-primary btn-lg" disabled={busy || count >= t.capacity} onClick={() => doPost('register', { code }, 'You’re in.')}>{count >= t.capacity ? 'Full' : 'Join tournament'}</button>
          : <Link className="btn btn-primary btn-lg" to={`/signup?next=${encodeURIComponent(`/t/${id}${code ? `?code=${code}` : ''}`)}`}>Pick a username to join</Link>)}
        {t.status === 'CHECK_IN' && data.me?.status === 'registered' && <button className="btn btn-mint btn-lg" disabled={busy} onClick={() => doPost('check-in', {}, 'Checked in. See you in the bracket.')}>Check in</button>}
        {data.me?.status === 'checked_in' && open && <span className="chip chip-live">You’re checked in</span>}
        {registered && ['DRAFT', 'REGISTRATION_OPEN', 'CHECK_IN', 'IN_PROGRESS'].includes(t.status) && data.me.status !== 'eliminated' && data.me.status !== 'champion' && (
          <button className="btn btn-danger" onClick={() => setConfirm('withdraw')}>Withdraw</button>
        )}
        {data.isHost && open && <button className="btn btn-board" disabled={busy || count < 2} onClick={() => doPost('start', {}, 'Bracket generated. Good luck!')}>Start now</button>}
        {data.isHost && ['DRAFT', 'REGISTRATION_OPEN', 'CHECK_IN'].includes(t.status) && <button className="btn btn-ghost" onClick={() => setConfirm('cancel')}>Cancel tournament</button>}
        {!['COMPLETED', 'CANCELLED'].includes(t.status) && (
          <button className="btn btn-ghost" onClick={async () => {
            if (navigator.share) await navigator.share({ title: t.title, text: `Join ${t.title} on GamePact`, url: inviteLink }).catch(() => {});
            else { await navigator.clipboard?.writeText(inviteLink); toast('Invite link copied.'); }
          }}>{Icons.share}Share</button>
        )}
      </section>

      <section className="stack">
        <h2>Bracket</h2>
        {data.bracket.length === 0 ? (
          <Empty title={t.status === 'CANCELLED' ? 'This tournament was cancelled' : 'The bracket is drawn when the tournament starts'}>
            {t.status !== 'CANCELLED' && `Seeds go by ${game.name} rating, so the strongest players meet late.`}
          </Empty>
        ) : (
          <div className="bracket">
            {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
              <div key={r} className="bracket-round">
                <h4>{roundName(r, rounds)}</h4>
                {data.bracket.filter((b: any) => b.round === r).map((b: any) => {
                  const slot = (uid: string | null, seed: number | null) => {
                    const u = uid ? users[uid] : null;
                    const cls = !uid ? 'tbd' : b.winner_id ? (b.winner_id === uid ? 'win' : 'lose') : '';
                    return (
                      <div className={`bslot ${cls}`}>
                        <span className="seed">{seed ?? ''}</span>
                        {u ? <><Avatar user={u} size={22} /><span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.username}</span></> : <span>{b.status === 'bye' ? 'Bye' : 'To be decided'}</span>}
                      </div>
                    );
                  };
                  const inner = (
                    <div className={`bmatch ${b.status === 'live' ? 'live' : ''}`}>
                      {slot(b.a_user, b.a_seed)}
                      {slot(b.b_user, b.b_seed)}
                      {(b.result_note || b.status === 'live') && <div className="bnote">{b.status === 'live' ? (b.replays ? 'Replay after a draw · tap to watch' : 'Playing now · tap to watch') : b.result_note}</div>}
                    </div>
                  );
                  return b.match_id ? <Link key={b.id} to={`/m/${b.match_id}`} style={{ textDecoration: 'none' }}>{inner}</Link> : <div key={b.id}>{inner}</div>;
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="panel stack">
          <h3>Players</h3>
          {data.participants.length === 0 ? <p className="small muted">Nobody yet. Share the link to fill the bracket.</p> : (
            <div className="list">
              {data.participants.filter((p: any) => p.status !== 'withdrawn' || t.status !== 'REGISTRATION_OPEN').map((p: any) => (
                <Link key={p.user_id} to={`/u/${p.username}`} className="list-item">
                  <span className="seed faint num" style={{ width: 24 }}>{p.seed ?? ''}</span>
                  <Avatar user={p.user} size={30} />
                  <span className="grow list-title">{p.username}</span>
                  <span className="small muted">{p.final_placement ? ordinal(p.final_placement) : p.status === 'checked_in' ? 'Checked in' : p.status === 'withdrawn' ? 'Withdrew' : p.status === 'eliminated' ? 'Out' : ''}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel stack">
          <h3>Announcements</h3>
          {data.isHost && !['COMPLETED', 'CANCELLED'].includes(t.status) && (
            <form className="row" onSubmit={async (e) => { e.preventDefault(); await doPost('posts', { body: postText }); setPostText(''); }}>
              <input className="input grow" value={postText} onChange={(e) => setPostText(e.target.value)} maxLength={280} placeholder="Tell your players something" aria-label="Announcement" />
              <button className="btn btn-sm" disabled={!postText.trim()}>Post</button>
            </form>
          )}
          {data.posts.length === 0 ? <p className="small muted">No announcements yet.</p> : data.posts.map((p: any) => (
            <div key={p.id}><p>{p.body}</p><span className="tiny faint">{p.username} · {timeAgo(p.created_at)}</span></div>
          ))}
          {me && !data.isHost && (
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={async () => {
              const reason = prompt('What’s wrong with this tournament?');
              if (!reason) return;
              try { await api('/reports', { body: { targetType: 'tournament', targetId: id, reason } }); toast('Thanks — a moderator will look at it.'); } catch (e: any) { toast(e.message, { tone: 'err' }); }
            }}>{Icons.flag}Report</button>
          )}
        </section>
      </div>

      {confirm && (
        <Dialog title={confirm === 'withdraw' ? 'Withdraw from the tournament?' : 'Cancel the tournament?'} onClose={() => setConfirm(null)}>
          <p className="muted">{confirm === 'withdraw'
            ? t.status === 'IN_PROGRESS' ? 'Your current match counts as a loss and your opponent advances.' : 'Your spot opens up for someone else.'
            : 'Everyone who registered is notified. This can’t be undone.'}</p>
          <div className="row">
            <button className="btn btn-danger grow" disabled={busy} onClick={async () => { setConfirm(null); await doPost(confirm === 'withdraw' ? 'withdraw' : 'cancel', {}, confirm === 'withdraw' ? 'You’ve withdrawn.' : 'Tournament cancelled.'); }}>
              {confirm === 'withdraw' ? 'Withdraw' : 'Cancel tournament'}
            </button>
            <button className="btn grow" onClick={() => setConfirm(null)}>Go back</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
