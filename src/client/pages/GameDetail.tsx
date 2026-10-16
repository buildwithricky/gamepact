import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CATEGORY_LABEL, defaultOptions, GAME_BY_ID } from '../../shared/catalog';
import { GameArt } from '../components/art';
import { Avatar, Dialog, Segmented, useNow } from '../components/ui';
import { api, post } from '../lib/api';
import { useAction, useApp, useFetch } from '../lib/app';
import { clock } from '../lib/format';
import { emit, getSocket } from '../lib/socket';

function Searching({ gameId, mode, onCancel }: { gameId: string; mode: 'casual' | 'ranked'; onCancel(): void }) {
  const [since] = useState(Date.now());
  const now = useNow(1000);
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    const t = setInterval(() => api(`/queue?game=${gameId}&mode=${mode}`).then((r) => setWaiting(r.waiting)).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [gameId, mode]);
  return (
    <Dialog title={mode === 'ranked' ? 'Finding a ranked opponent' : 'Finding an opponent'} onClose={onCancel}>
      <div className="center stack" style={{ alignItems: 'center' }}>
        <div className="big-score num">{clock(now - since)}</div>
        <p className="muted">{waiting > 1 ? `${waiting - 1} other player${waiting > 2 ? 's are' : ' is'} in the queue.` : 'You’re first in the queue. Share the game with a friend to get matched faster.'}</p>
        <p className="small faint">We’ll take you to the match as soon as someone joins. You can keep this tab in the background.</p>
        <button className="btn btn-danger" onClick={onCancel}>Stop searching</button>
      </div>
    </Dialog>
  );
}

export default function GameDetail() {
  const { id = '' } = useParams();
  const game = GAME_BY_ID[id];
  const { me, toast } = useApp();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const [options, setOptions] = useState<Record<string, string>>(() => (game ? defaultOptions(game) : {}));
  const [bots, setBots] = useState('1');
  const [searching, setSearching] = useState<'casual' | 'ranked' | null>(null);
  const { data: top } = useFetch<{ rows: any[] }>(game?.ranked ? `/leaderboards?game=${id}` : null);

  useEffect(() => {
    if (!searching) return;
    const s = getSocket();
    return () => { s.emit('mm:leave', {}, () => {}); };
  }, [searching]);

  if (!game) return <div className="page"><h2>Game not found</h2><Link to="/games">Back to games</Link></div>;
  const live = game.status === 'live';
  const needAuth = () => { if (!me) { navigate(`/signup?next=/games/${id}`); return true; } return false; };

  const quick = async (mode: 'casual' | 'ranked') => {
    if (needAuth()) return;
    const r = await emit('mm:join', { gameId: id, mode });
    if (!r.ok) return toast(r.error ?? 'Couldn’t join the queue.', { tone: 'err' });
    setSearching(mode);
  };
  const create = (mode: 'private' | 'practice') => {
    if (needAuth()) return;
    run(async () => {
      const r = await post<{ id: string }>('/matches', { gameId: id, mode, options, bots: Number(bots) });
      navigate(`/m/${r.id}`);
    });
  };

  return (
    <div className="page stack-lg">
      <Link to="/games" className="small muted">← All games</Link>
      <section className="game-hero">
        <div className="game-token" data-cat={game.category} style={{ pointerEvents: 'none' }}>
          <div className="art" style={{ aspectRatio: '16 / 9' }}><GameArt id={game.id} /></div>
        </div>
        <div className="stack">
          <div className="row-wrap">
            <span className={`chip chip-${game.category}`}>{CATEGORY_LABEL[game.category]}</span>
            <span className="chip">{game.minPlayers === game.maxPlayers ? `${game.maxPlayers} players` : `${Math.max(2, game.minPlayers)}–${game.maxPlayers} players`}</span>
            <span className="chip">{game.duration}</span>
          </div>
          <h1 style={{ fontSize: 'clamp(2.4rem, 7vw, 3.8rem)' }}>{game.name}</h1>
          <p className="muted" style={{ fontSize: '1.1rem' }}>{game.blurb}</p>
          {!live && <p className="banner info">{game.rules[0]}</p>}
        </div>
      </section>

      {live && (
        <section className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card stack-lg">
            {game.options.length > 0 && (
              <div className="stack">
                {game.options.map((o) => (
                  <div key={o.key} className="field">
                    <span className="label">{o.label}</span>
                    <Segmented label={o.label} value={options[o.key]} onChange={(v) => setOptions((s) => ({ ...s, [o.key]: v }))} options={o.choices} />
                  </div>
                ))}
                <p className="tiny faint">Settings apply to rooms and practice. Quick play uses the standard settings.</p>
              </div>
            )}
            <div className="stack">
              <span className="label">Play a friend</span>
              <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => create('private')}>Create a room and get a link</button>
            </div>
            <div className="stack">
              <span className="label">Quick play</span>
              <div className="row">
                <button className="btn grow" onClick={() => quick('casual')}>Casual</button>
                {game.ranked && <button className="btn btn-board grow" onClick={() => quick('ranked')}>Ranked</button>}
              </div>
            </div>
            {game.practice !== 'none' && (
              <div className="stack">
                <span className="label">Practice</span>
                {game.practice === 'bot' && game.maxPlayers > 2 && (
                  <Segmented label="Bots" value={bots} onChange={setBots} options={Array.from({ length: game.maxPlayers - 1 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} bot${i ? 's' : ''}` }))} />
                )}
                <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => create('practice')}>
                  {game.practice === 'bot' ? 'Practise against a bot' : 'Practise solo'}
                </button>
                <p className="tiny faint">Practice games don’t count toward your record.</p>
              </div>
            )}
            <Link className="btn btn-ghost btn-block" to={`/tournaments/new?game=${game.id}`}>Host a {game.name} tournament</Link>
          </div>

          <div className="stack-lg">
            <div className="panel stack">
              <h3>How to play</h3>
              <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>{game.rules.map((r) => <li key={r} className="muted">{r}</li>)}</ul>
            </div>
            {game.ranked && (
              <div className="panel stack">
                <div className="section-head" style={{ margin: 0 }}><h3>Top rated</h3><Link to={`/leaderboards?game=${game.id}`}>Full table</Link></div>
                {top && top.rows.length > 0 ? (
                  <div className="list">
                    {top.rows.slice(0, 5).map((r) => (
                      <Link key={r.user.id} to={`/u/${r.user.username}`} className="list-item">
                        <span className={`rank rank-${r.rank}`}>{r.rank}</span>
                        <Avatar user={r.user} size={30} />
                        <span className="grow list-title">{r.user.username}</span>
                        <span className="num">{r.rating}</span>
                      </Link>
                    ))}
                  </div>
                ) : <p className="small muted">Nobody has a rating yet. Win a ranked match to take the top spot.</p>}
              </div>
            )}
          </div>
        </section>
      )}
      {searching && <Searching gameId={id} mode={searching} onCancel={() => { emit('mm:leave'); setSearching(null); }} />}
    </div>
  );
}
