import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GAME_BY_ID } from '../../shared/catalog';
import type { ChatMessage, MatchSnapshot } from '../../shared/types';
import { Icons } from '../components/art';
import { AdSlot, Avatar, Confetti, Dialog, showBreak, useNow } from '../components/ui';
import { BOARDS } from '../games';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { clock } from '../lib/format';
import { emit, getSocket } from '../lib/socket';

const REACTIONS = ['👏', '🔥', '😂', '😮', '😤', 'GG'];
const MODE_LABEL: Record<string, string> = { practice: 'Practice', casual: 'Casual', ranked: 'Ranked', private: 'Private room', tournament: 'Tournament' };

function useMatch(id: string) {
  const [snap, setSnap] = useState<MatchSnapshot | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reacts, setReacts] = useState<{ key: number; emoji: string; x: number }[]>([]);
  const skew = useRef(0);
  const { me } = useApp();

  useEffect(() => {
    let alive = true;
    setSnap(null);
    api<{ match: MatchSnapshot; chat: ChatMessage[] }>(`/matches/${id}`)
      .then((r) => { if (!alive) return; skew.current = r.match.serverNow - Date.now(); setSnap(r.match); setChat(r.chat); })
      .catch((e) => alive && setError(e.message));
    const s = getSocket();
    const watch = () => emit('match:watch', { matchId: id }).then((r: any) => { if (r.ok && r.chat) setChat(r.chat); });
    const onState = (m: MatchSnapshot) => { if (m.id !== id) return; skew.current = m.serverNow - Date.now(); setSnap(m); };
    const onChat = ({ matchId, message }: { matchId: string; message: ChatMessage }) => { if (matchId === id) setChat((c) => [...c.slice(-59), message]); };
    const onReact = ({ matchId, emoji }: { matchId: string; emoji: string }) => {
      if (matchId !== id) return;
      const key = Math.random();
      setReacts((r) => [...r, { key, emoji, x: 20 + Math.random() * 60 }]);
      setTimeout(() => setReacts((r) => r.filter((x) => x.key !== key)), 1700);
    };
    s.on('match:state', onState);
    s.on('match:chat', onChat);
    s.on('match:react', onReact);
    s.on('connect', watch);
    if (s.connected) watch();
    return () => {
      alive = false;
      s.off('match:state', onState); s.off('match:chat', onChat); s.off('match:react', onReact); s.off('connect', watch);
      s.emit('match:unwatch', { matchId: id });
    };
  }, [id, me?.id]);

  return { snap, chat, error, reacts, skew };
}

function PlayerStrip({ snap, now }: { snap: MatchSnapshot; now: number }) {
  const turnSeat = snap.status === 'IN_PROGRESS' ? snap.deadline?.seat ?? null : null;
  const total = useRef<{ at: number; span: number } | null>(null);
  if (snap.deadline && (!total.current || total.current.at !== snap.deadline.at)) total.current = { at: snap.deadline.at, span: Math.max(1, snap.deadline.at - now) };
  return (
    <div className="players">
      {snap.seats.map((s) => {
        const turn = turnSeat === s.seat;
        const left = turn && snap.deadline ? snap.deadline.at - now : null;
        const frac = left !== null && total.current ? Math.max(0, Math.min(1, left / total.current.span)) : 0;
        const name = s.user?.username ?? s.bot ?? 'Open seat';
        return (
          <div key={s.seat} className={`player-pill ${turn ? 'turn' : ''} ${s.out ? 'out' : ''}`}>
            <Avatar user={s.user ?? { username: name, avatar: { color: (s.seat * 3) % 8, glyph: 4 } }} size={38} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="name">{s.user ? <Link to={`/u/${s.user.username}`} style={{ textDecoration: 'none' }}>{name}</Link> : name}{snap.you === s.seat && <span className="faint small"> (you)</span>}</div>
              <div className="tiny muted row" style={{ gap: 6 }}>
                {s.bot ? 'Bot' : <><span className={`presence ${s.connected ? 'on' : ''}`} />{s.connected ? 'Here' : 'Away'}</>}
                {s.rating !== null && <span className="num">· {s.rating}</span>}
                {snap.status === 'WAITING' && <span style={{ color: s.ready ? 'var(--mint)' : undefined }}>· {s.ready ? 'Ready' : 'Not ready'}</span>}
                {s.out && <span>· Out</span>}
              </div>
            </div>
            {left !== null && <span className={`num small ${left < 6000 ? 'error' : 'muted'}`}>{clock(left)}</span>}
            {left !== null && <div className={`timer-bar ${left < 6000 ? 'low' : ''}`}><i style={{ transform: `scaleX(${frac})` }} /></div>}
          </div>
        );
      })}
      {snap.status === 'WAITING' && Array.from({ length: snap.maxSeats - snap.seats.length }, (_, i) => (
        <div key={`open-${i}`} className="player-pill" style={{ borderStyle: 'dashed', borderColor: 'var(--felt-4)' }}>
          <span className="avatar" style={{ ['--c' as string]: 'var(--felt-3)', ['--size' as string]: '38px', color: 'var(--faint)' }}>?</span>
          <span className="muted">Waiting for a player</span>
        </div>
      ))}
    </div>
  );
}

function Lobby({ snap, meId }: { snap: MatchSnapshot; meId: string | null }) {
  const { toast } = useApp();
  const [friends, setFriends] = useState<any[] | null>(null);
  const link = `${location.origin}/m/${snap.id}`;
  const mine = snap.you !== null ? snap.seats[snap.you] : null;
  const isHost = snap.hostId === meId;
  const full = snap.seats.length >= snap.maxSeats;
  const game = GAME_BY_ID[snap.gameId];
  const share = async () => {
    const text = `Play ${game.name} with me on GamePact`;
    if (navigator.share) await navigator.share({ title: 'GamePact', text, url: link }).catch(() => {});
    else { await navigator.clipboard?.writeText(link); toast('Invite link copied.'); }
  };
  const loadFriends = async () => setFriends((await api('/friends')).friends);
  const act = async (event: string, payload: object = {}) => {
    const r = await emit(event, { matchId: snap.id, ...payload });
    if (!r.ok) toast(r.error ?? 'That didn’t work.', { tone: 'err' });
  };

  if (snap.tournament) {
    return (
      <div className="card stack center" style={{ alignItems: 'center' }}>
        <h2>Round {snap.tournament.round}</h2>
        <p className="muted">Both players need to be here and ready. If your opponent doesn’t show before the deadline, you advance.</p>
        {mine && <button className={`btn btn-lg ${mine.ready ? 'btn-ghost' : 'btn-mint'}`} onClick={() => act('match:ready', { ready: !mine.ready })}>{mine.ready ? 'Not ready yet' : 'I’m ready'}</button>}
        <Link to={`/t/${snap.tournament.id}`} className="small">Back to the bracket</Link>
      </div>
    );
  }

  return (
    <div className="card stack-lg">
      {snap.you === null && !full && !meId && (
        <div className="banner info">Sign in to take a seat. <Link to={`/signup?next=/m/${snap.id}`}>Pick a username</Link></div>
      )}
      {snap.you === null && full && <div className="banner info">This room is full — you’re watching.</div>}
      {snap.code && (
        <div className="stack center" style={{ alignItems: 'center', gap: 6 }}>
          <span className="muted small">Room code</span>
          <span className="invite-code num">{snap.code}</span>
        </div>
      )}
      <div className="row-wrap" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={share}>{Icons.share}Share invite link</button>
        <button className="btn" onClick={async () => { await navigator.clipboard?.writeText(link); toast('Link copied.'); }}>{Icons.link}Copy link</button>
        {meId && <button className="btn btn-ghost" onClick={loadFriends}>Invite a friend</button>}
      </div>
      {friends && (
        friends.length ? (
          <div className="list">
            {friends.map((f) => (
              <div key={f.user.id} className="list-item">
                <Avatar user={f.user} size={30} /><span className="grow list-title">{f.user.username}</span><span className={`presence ${f.online ? 'on' : ''}`} />
                <button className="btn btn-sm" onClick={async () => {
                  try { await api(`/matches/${snap.id}/invite`, { body: { userId: f.user.id } }); toast(`Invite sent to ${f.user.username}.`); } catch (e: any) { toast(e.message, { tone: 'err' }); }
                }}>Invite</button>
              </div>
            ))}
          </div>
        ) : <p className="small muted center">No friends yet — add them by username on the <Link to="/friends">friends page</Link>, or just share the link.</p>
      )}
      {mine && (
        <div className="row-wrap" style={{ justifyContent: 'center' }}>
          {!isHost && <button className={`btn btn-lg ${mine.ready ? 'btn-ghost' : 'btn-mint'}`} onClick={() => act('match:ready', { ready: !mine.ready })}>{mine.ready ? 'Not ready' : 'I’m ready'}</button>}
          {isHost && (snap.maxSeats === 2
            ? <button className={`btn btn-lg ${mine.ready ? 'btn-ghost' : 'btn-mint'}`} onClick={() => act('match:ready', { ready: !mine.ready })}>{mine.ready ? 'Not ready' : 'I’m ready'}</button>
            : <button className="btn btn-lg btn-mint" disabled={snap.seats.length < 2} onClick={() => act('match:start')}>Start with {snap.seats.length} player{snap.seats.length === 1 ? '' : 's'}</button>)}
          <button className="btn btn-danger" onClick={() => act(isHost ? 'match:cancel' : 'match:leave')}>{isHost ? 'Close room' : 'Leave'}</button>
        </div>
      )}
      <p className="tiny faint center">
        {snap.maxSeats === 2 ? 'The match starts as soon as both players are ready.' : `Up to ${snap.maxSeats} players. The host starts once everyone is ready.`}
        {snap.expiresAt ? ' Unused invites expire after an hour.' : ''}
      </p>
    </div>
  );
}

function ResultBanner({ snap, onRematch }: { snap: MatchSnapshot; onRematch(): void }) {
  const r = snap.result!;
  const you = snap.you;
  const name = (seat: number) => snap.seats[seat]?.user?.username ?? snap.seats[seat]?.bot ?? 'Player';
  let tone: 'win' | 'loss' | 'draw' = 'draw';
  let title = 'Draw';
  const solo = snap.seats.length === 1;
  if (snap.status === 'CANCELLED' || snap.status === 'ABANDONED') { title = snap.status === 'CANCELLED' ? 'Room closed' : 'Match ended'; tone = 'draw'; }
  else if (solo) { tone = 'win'; title = 'Finished'; }
  else if (r.kind === 'draw') { tone = 'draw'; title = 'Draw'; }
  else if (you !== null) {
    const place = r.ranking.findIndex((g) => g.includes(you));
    if (place === 0 && r.ranking[0].length === 1) { tone = 'win'; title = 'You win!'; }
    else if (place === 0) { tone = 'draw'; title = 'Shared win'; }
    else { tone = 'loss'; title = r.ranking.length > 2 ? `You came ${['1st', '2nd', '3rd', '4th', '5th', '6th'][place]}` : `${name(r.ranking[0][0])} wins`; }
  } else if (r.ranking[0]) title = `${r.ranking[0].map(name).join(' & ')} win${r.ranking[0].length > 1 ? '' : 's'}`;
  const change = you !== null ? r.ratingChanges?.[you] : undefined;
  const requested = snap.rematch.requested;
  const iAsked = you !== null && requested.includes(you);
  const humans = snap.seats.filter((s) => s.user);
  const canRematch = snap.status === 'COMPLETED' && !snap.tournament && you !== null;

  return (
    <div className={`result-banner ${tone} stack`} style={{ alignItems: 'center' }}>
      {tone === 'win' && !solo && <Confetti />}
      <h2>{title}</h2>
      <p className="muted" style={{ fontWeight: 700 }}>{r.summary}{r.reason && r.reason !== r.summary ? ` · ${r.reason}` : ''}</p>
      {change && (
        <p className="num" style={{ fontWeight: 800 }}>Rating {change.before} → {change.after} ({change.after - change.before >= 0 ? '+' : ''}{change.after - change.before})</p>
      )}
      <div className="row-wrap" style={{ justifyContent: 'center' }}>
        {canRematch && (snap.rematch.nextId
          ? <Link className="btn btn-primary btn-lg" to={`/m/${snap.rematch.nextId}`}>Go to rematch</Link>
          : <button className="btn btn-primary btn-lg" disabled={iAsked} onClick={onRematch}>
            {iAsked ? `Waiting for ${humans.filter((h) => !requested.includes(h.seat)).map((h) => h.user!.username).join(', ')}` : snap.mode === 'practice' ? 'Play again' : 'Rematch'}
          </button>)}
        {snap.tournament && <Link className="btn btn-primary btn-lg" to={`/t/${snap.tournament.id}`}>Back to the bracket</Link>}
        <Link className="btn btn-lg" to={`/games/${snap.gameId}`}>New game</Link>
      </div>
      {canRematch && !snap.rematch.nextId && requested.length > 0 && !iAsked && (
        <p className="small" style={{ fontWeight: 700 }}>{requested.map((s) => name(s)).join(', ')} wants a rematch.</p>
      )}
    </div>
  );
}

export default function Match() {
  const { id = '' } = useParams();
  const { me, toast, config } = useApp();
  const navigate = useNavigate();
  const { snap, chat, error, reacts, skew } = useMatch(id);
  const [rules, setRules] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [text, setText] = useState('');
  const now = useNow(200, snap?.status === 'IN_PROGRESS') + skew.current;
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [chat.length]);
  useEffect(() => {
    if (snap?.rematch.nextId && snap.you !== null && snap.rematch.requested.includes(snap.you)) navigate(`/m/${snap.rematch.nextId}`);
  }, [snap?.rematch.nextId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(async (action: unknown) => {
    const r = await emit('match:action', { matchId: id, action, nonce: crypto.randomUUID?.() ?? String(Math.random()) });
    if (!r.ok) toast(r.error ?? 'That move didn’t go through.', { tone: 'err' });
    return r;
  }, [id, toast]);

  const game = snap ? GAME_BY_ID[snap.gameId] : null;
  const Board = snap ? BOARDS[snap.gameId] : null;
  const playing = snap?.status === 'IN_PROGRESS';
  const done = snap && ['COMPLETED', 'CANCELLED', 'ABANDONED'].includes(snap.status);
  const myTurn = useMemo(() => !!snap && playing && snap.you !== null && (snap.deadline?.seat === snap.you || snap.deadline?.seat === null), [snap, playing]);

  if (error) {
    return <div className="page stack" style={{ alignItems: 'flex-start' }}><h2>Match not found</h2><p className="muted">{error} The link may be wrong, or the room may have been closed.</p><Link className="btn btn-primary" to="/home">Go home</Link></div>;
  }
  if (!snap || !game) return <div className="page"><div className="skeleton" style={{ height: 420 }} /></div>;

  const claimable = snap.claimableAt !== null && now >= snap.claimableAt;
  const rematch = async () => {
    await showBreak(config, 'rematch');
    const r = await emit('match:rematch', { matchId: id });
    if (!r.ok) toast(r.error ?? 'Couldn’t request a rematch.', { tone: 'err' });
  };

  return (
    <div className="page stack" style={{ paddingBottom: 'calc(var(--s7) + var(--safe-b))' }}>
      <div className="row between">
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <Link to={snap.tournament ? `/t/${snap.tournament.id}` : `/games/${snap.gameId}`} className="btn btn-ghost icon-btn" aria-label="Back">{Icons.back}</Link>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{game.name}</h3>
            <span className="tiny muted">{snap.tournament ? `${snap.tournament.title} · Round ${snap.tournament.round}` : MODE_LABEL[snap.mode]}{snap.spectators > 0 ? ` · ${snap.spectators} watching` : ''}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-ghost icon-btn" aria-label="How to play" onClick={() => setRules(true)}>{Icons.info}</button>
          {playing && snap.you !== null && <button className="btn btn-danger btn-sm" onClick={() => setConfirmResign(true)}>{snap.seats.length === 1 ? 'Quit' : 'Resign'}</button>}
        </div>
      </div>

      <PlayerStrip snap={snap} now={now} />

      {claimable && (
        <div className="banner row between">
          <span>Your opponent has been gone for a while.</span>
          <button className="btn btn-sm btn-arcade" onClick={async () => { const r = await emit('match:claim', { matchId: id }); if (!r.ok) toast(r.error!, { tone: 'err' }); }}>Claim the win</button>
        </div>
      )}

      <div className="match-layout">
        <div className="stack">
          {done && snap.result && <ResultBanner snap={snap} onRematch={rematch} />}
          {snap.status === 'WAITING' && <Lobby snap={snap} meId={me?.id ?? null} />}
          {(playing || (done && snap.view !== null)) && Board && (
            <Board snap={snap} view={snap.view as any} act={act} now={now} myTurn={myTurn} />
          )}
          {done && snap.view === null && snap.status === 'COMPLETED' && <p className="muted small center">This match is archived — the final board isn’t kept.</p>}
          {done && <AdSlot placement="results" />}
        </div>

        <aside className="stack">
          {snap.you !== null && (playing || done) && (
            <div className="reactions" aria-label="Reactions">
              {REACTIONS.map((r) => <button key={r} onClick={() => emit('match:react', { matchId: id, emoji: r })} aria-label={`React ${r}`}>{r}</button>)}
            </div>
          )}
          <div className="panel stack" style={{ padding: 'var(--s4)' }}>
            <h3 className="row" style={{ gap: 8 }}><span style={{ width: 20 }}>{Icons.chat}</span>Chat</h3>
            <div className="chat-log" aria-live="polite">
              {chat.length === 0 && <span className="faint small">Say hello. Be nice — players can report and block.</span>}
              {chat.map((m) => <div key={m.id}><b>{m.username}</b> {m.text}</div>)}
              <div ref={chatEnd} />
            </div>
            {me ? (
              <form className="row" onSubmit={async (e) => {
                e.preventDefault();
                if (!text.trim()) return;
                const r = await emit('match:chat', { matchId: id, text });
                if (!r.ok) toast(r.error ?? 'Message not sent.', { tone: 'err' }); else setText('');
              }}>
                <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder="Message" aria-label="Chat message" />
                <button className="btn btn-sm">Send</button>
              </form>
            ) : <p className="small muted"><Link to={`/signin?next=/m/${id}`}>Sign in</Link> to chat.</p>}
          </div>
          {snap.seats.some((s) => s.user && s.user.id !== me?.id) && me && (
            <button className="btn btn-ghost btn-sm" onClick={async () => {
              const other = snap.seats.find((s) => s.user && s.user.id !== me.id)!;
              const reason = prompt(`What happened with ${other.user!.username}?`);
              if (!reason) return;
              try { await api('/reports', { body: { targetType: 'match', targetId: id, reason: `${other.user!.username}: ${reason}` } }); toast('Thanks — a moderator will look at it.'); } catch (e: any) { toast(e.message, { tone: 'err' }); }
            }}>{Icons.flag}Report a problem</button>
          )}
        </aside>
      </div>

      {reacts.map((r) => <span key={r.key} className="float-react" style={{ left: `${r.x}%`, bottom: '20%' }}>{r.emoji}</span>)}

      {rules && (
        <Dialog title={`How to play ${game.name}`} onClose={() => setRules(false)}>
          <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>{game.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </Dialog>
      )}
      {confirmResign && (
        <Dialog title={snap.seats.length === 1 ? 'Quit this game?' : 'Resign this match?'} onClose={() => setConfirmResign(false)}>
          <p className="muted">{snap.seats.length === 1 ? 'Your progress in this practice round will be lost.' : snap.mode === 'practice' ? 'It’s only practice — nothing is recorded.' : 'It counts as a loss on your record.'}</p>
          <div className="row">
            <button className="btn btn-danger grow" onClick={async () => { setConfirmResign(false); const r = await emit('match:resign', { matchId: id }); if (!r.ok) toast(r.error!, { tone: 'err' }); }}>{snap.seats.length === 1 ? 'Quit' : 'Resign'}</button>
            <button className="btn grow" onClick={() => setConfirmResign(false)}>Keep playing</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
