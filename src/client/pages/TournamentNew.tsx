import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { defaultOptions, GAME_BY_ID, GAMES } from '../../shared/catalog';
import { Segmented } from '../components/ui';
import { post } from '../lib/api';
import { useAction } from '../lib/app';

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TournamentNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const live = GAMES.filter((g) => g.status === 'live');
  const [gameId, setGameId] = useState(params.get('game') && GAME_BY_ID[params.get('game')!]?.status === 'live' ? params.get('game')! : 'chess');
  const game = GAME_BY_ID[gameId];
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bragging, setBragging] = useState('');
  const [capacity, setCapacity] = useState('8');
  const [startsAt, setStartsAt] = useState(() => {
    const d = new Date(Date.now() + 30 * 60_000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    return localInput(d);
  });
  const [checkin, setCheckin] = useState('10');
  const [deadline, setDeadline] = useState('10');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [hostPlays, setHostPlays] = useState(true);
  const [options, setOptions] = useState<Record<string, string>>(() => defaultOptions(game));
  const opts = useMemo(() => ({ ...defaultOptions(game), ...options }), [game, options]);

  const submit = (publish: boolean) => run(async () => {
    const r = await post<{ id: string }>('/tournaments', {
      gameId, title, description, bragging, capacity: Number(capacity), startsAt: new Date(startsAt).toISOString(),
      checkinMinutes: Number(checkin), matchDeadlineMinutes: Number(deadline), visibility, hostPlays, options: opts, publish,
    });
    navigate(`/t/${r.id}`);
  });

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); submit(true); }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 'clamp(2rem, 6vw, 3rem)' }}>Host a tournament</h1>
          <p className="muted">Single elimination. Seeds come from ratings, byes go to the top seeds, and the bracket runs itself.</p>
        </div>

        <div className="card stack-lg">
          <div className="field">
            <label htmlFor="t-title">Name</label>
            <input id="t-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Friday night chess" required />
          </div>
          <div className="field">
            <label htmlFor="t-game">Game</label>
            <select id="t-game" className="input" value={gameId} onChange={(e) => { setGameId(e.target.value); setOptions({}); }}>
              {live.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          {game.options.map((o) => (
            <div key={o.key} className="field">
              <span className="label">{o.label}</span>
              <Segmented label={o.label} value={opts[o.key]} onChange={(v) => setOptions((s) => ({ ...s, [o.key]: v }))} options={o.choices} />
            </div>
          ))}
          <div className="field">
            <label htmlFor="t-brag">What does the winner get?</label>
            <input id="t-brag" className="input" value={bragging} onChange={(e) => setBragging(e.target.value)} maxLength={60} placeholder="Bragging rights and the group chat title" />
            <span className="hint">Just for fun — GamePact tournaments don’t take entry fees or pay cash prizes.</span>
          </div>
          <div className="field">
            <label htmlFor="t-desc">Description <span className="faint">(optional)</span></label>
            <textarea id="t-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="House rules, who it’s for, when the final will be." />
          </div>
        </div>

        <div className="card stack-lg">
          <div className="field">
            <span className="label">Players</span>
            <Segmented label="Players" value={capacity} onChange={setCapacity} options={['4', '8', '16', '32', '64'].map((v) => ({ value: v, label: v }))} />
          </div>
          <div className="field">
            <label htmlFor="t-start">Starts</label>
            <input id="t-start" className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
            <span className="hint">You can also start early from the tournament page once two or more players have joined.</span>
          </div>
          <div className="field">
            <span className="label">Check-in before the start</span>
            <Segmented label="Check-in" value={checkin} onChange={setCheckin} options={[{ value: '0', label: 'None' }, { value: '10', label: '10 min' }, { value: '15', label: '15 min' }, { value: '30', label: '30 min' }]} />
            <span className="hint">With check-in, only players who confirm they’re around get seeded — no waiting on no-shows.</span>
          </div>
          <div className="field">
            <span className="label">Time to show up for each match</span>
            <Segmented label="Match deadline" value={deadline} onChange={setDeadline} options={['5', '10', '15', '30'].map((v) => ({ value: v, label: `${v} min` }))} />
          </div>
          <div className="field">
            <span className="label">Who can join</span>
            <Segmented label="Visibility" value={visibility} onChange={setVisibility} options={[{ value: 'public', label: 'Anyone' }, { value: 'private', label: 'Invite link only' }]} />
          </div>
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={hostPlays} onChange={(e) => setHostPlays(e.target.checked)} style={{ width: 22, height: 22 }} />
            <span>I’m playing in it too</span>
          </label>
        </div>

        <div className="row-wrap">
          <button className="btn btn-primary btn-lg" disabled={busy || title.trim().length < 3}>Publish tournament</button>
          <button type="button" className="btn btn-ghost btn-lg" disabled={busy || title.trim().length < 3} onClick={() => submit(false)}>Save as draft</button>
        </div>
        <p className="tiny faint">Rules, size and timing are locked once you publish, so players know exactly what they signed up for.</p>
      </form>
    </div>
  );
}
