import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GAME_BY_ID, GAMES } from '../../shared/catalog';
import { GameArt } from '../components/art';
import { AdSlot, Empty, Segmented } from '../components/ui';
import { useApp, useFetch } from '../lib/app';
import { when } from '../lib/format';

const TABS = [
  { value: 'open', label: 'Open' }, { value: 'live', label: 'Live' }, { value: 'done', label: 'Finished' }, { value: 'mine', label: 'Mine' },
] as const;

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', REGISTRATION_OPEN: 'Registration open', CHECK_IN: 'Check-in open', IN_PROGRESS: 'Live',
  COMPLETED: 'Finished', CANCELLED: 'Cancelled',
};

export default function Tournaments() {
  const { me } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('open');
  const [game, setGame] = useState('');
  const { data, loading } = useFetch<{ tournaments: any[] }>(`/tournaments?tab=${tab}${game ? `&game=${game}` : ''}`);
  return (
    <div className="page stack-lg">
      <div className="row-wrap between" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 'clamp(2.2rem, 6vw, 3.4rem)' }}>Tournaments</h1>
          <p className="muted">Free knockout brackets. Winners keep the bragging rights.</p>
        </div>
        <Link className="btn btn-board btn-lg" to={me ? '/tournaments/new' : '/signup?next=/tournaments/new'}>Host a tournament</Link>
      </div>
      <div className="row-wrap between">
        <Segmented label="Show" value={tab} onChange={setTab} options={TABS.filter((t) => t.value !== 'mine' || me).map((t) => ({ ...t }))} />
        <select className="input" style={{ width: 'auto', minWidth: 180 }} value={game} onChange={(e) => setGame(e.target.value)} aria-label="Filter by game">
          <option value="">All games</option>
          {GAMES.filter((g) => g.status === 'live').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      {loading && !data ? <div className="skeleton" style={{ height: 200 }} /> : data && data.tournaments.length ? (
        <div className="grid-2">
          {data.tournaments.map((t) => {
            const g = GAME_BY_ID[t.game_id];
            return (
              <Link key={t.id} to={`/t/${t.id}`} className="card stack" style={{ textDecoration: 'none' }}>
                <div className="row">
                  <span style={{ width: 52, height: 40, borderRadius: 10, background: `var(--${g.category})`, border: '2px solid var(--ink)', display: 'grid', placeItems: 'center', flex: 'none' }}><GameArt id={g.id} /></span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</h3>
                    <span className="small muted">{g.name} · hosted by {t.host}{t.host_completed ? ` (${t.host_completed} run)` : ''}</span>
                  </div>
                </div>
                <div className="row-wrap">
                  <span className={`chip ${t.status === 'IN_PROGRESS' ? 'chip-live' : t.status === 'CHECK_IN' ? 'chip-warn' : ''}`}>{STATUS_LABEL[t.status]}</span>
                  <span className="chip num">{t.players}/{t.capacity} players</span>
                  {t.status !== 'COMPLETED' && <span className="chip">{when(t.starts_at)}</span>}
                  {t.visibility === 'private' && <span className="chip">Invite only</span>}
                </div>
                {t.champion ? <p className="small"><b style={{ color: 'var(--word)' }}>Champion: {t.champion}</b>{t.bragging ? ` — ${t.bragging}` : ''}</p>
                  : t.bragging ? <p className="small muted">Prize: {t.bragging}</p> : null}
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty title={tab === 'open' ? 'No open tournaments right now' : tab === 'live' ? 'Nothing live right now' : tab === 'mine' ? 'You haven’t joined any yet' : 'No finished tournaments yet'}
          action={<Link className="btn btn-board btn-sm" to={me ? '/tournaments/new' : '/signup'}>Host one</Link>}>
          Brackets fill fastest when you share the link in a group chat.
        </Empty>
      )}
      <AdSlot placement="sidebar" />
    </div>
  );
}
