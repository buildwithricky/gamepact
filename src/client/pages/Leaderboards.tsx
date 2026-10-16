import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GAME_BY_ID, GAMES } from '../../shared/catalog';
import { AdSlot, Avatar, Empty, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/app';

type Period = 'all' | 'week' | 'month';

export default function Leaderboards() {
  const { me } = useApp();
  const [params, setParams] = useSearchParams();
  const [board, setBoard] = useState<'players' | 'champions'>('players');
  const game = params.get('game') ?? '';
  const [period, setPeriod] = useState<Period>('all');
  const [friends, setFriends] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [metric, setMetric] = useState<'rating' | 'wins'>('wins');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    setRows(null); setPage(0);
    if (board === 'champions') { api('/leaderboards/champions').then((r) => { setRows(r.rows); setHasMore(false); }); return; }
    api(`/leaderboards?period=${period}${game ? `&game=${game}` : ''}${friends ? '&friends=1' : ''}`).then((r) => { setRows(r.rows); setMetric(r.metric); setHasMore(r.hasMore); });
  }, [board, game, period, friends]);

  const more = async () => {
    const r = await api(`/leaderboards?period=${period}${game ? `&game=${game}` : ''}${friends ? '&friends=1' : ''}&page=${page + 1}`);
    setRows((x) => [...(x ?? []), ...r.rows]); setPage(page + 1); setHasMore(r.hasMore);
  };

  const subtitle = board === 'champions' ? 'Most tournament titles' : game
    ? (period === 'all' ? `${GAME_BY_ID[game]?.name} ratings from ranked games` : `Most ${GAME_BY_ID[game]?.name} wins this ${period}`)
    : period === 'all' ? 'Most wins across every game' : `Most wins this ${period === 'week' ? 'week' : 'month (this season)'}`;

  return (
    <div className="page stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 'clamp(2.2rem, 6vw, 3.4rem)' }}>Leaderboards</h1>
        <p className="muted">{subtitle}. Only results our servers verified count.</p>
      </div>
      <div className="row-wrap">
        <Segmented label="Board" value={board} onChange={setBoard} options={[{ value: 'players', label: 'Players' }, { value: 'champions', label: 'Champions' }]} />
        {board === 'players' && (
          <>
            <select className="input" style={{ width: 'auto', minWidth: 170 }} value={game} aria-label="Game"
              onChange={(e) => setParams(e.target.value ? { game: e.target.value } : {})}>
              <option value="">All games</option>
              {GAMES.filter((g) => g.ranked).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: 'all', label: 'All time' }, { value: 'month', label: 'Season' }, { value: 'week', label: 'This week' }]} />
            {me && <Segmented label="Who" value={friends ? 'friends' : 'everyone'} onChange={(v) => setFriends(v === 'friends')} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'friends', label: 'Friends' }]} />}
          </>
        )}
      </div>
      {rows === null ? <div className="skeleton" style={{ height: 300 }} /> : rows.length === 0 ? (
        <Empty title="No one here yet" action={<Link className="btn btn-primary btn-sm" to="/games">Play a game</Link>}>
          {board === 'champions' ? 'Win a tournament to be the first name on this board.' : 'Finish a match to get on the board.'}
        </Empty>
      ) : (
        <div className="panel" style={{ padding: '8px 12px', overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>#</th><th>Player</th>{board === 'champions' ? <th>Titles</th> : <><th>{metric === 'rating' ? 'Rating' : 'Wins'}</th><th className="num">W–L–D</th></>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user.id} className={r.user.id === me?.id ? 'me' : ''}>
                  <td className={`rank rank-${r.rank}`}>{r.rank}</td>
                  <td><Link to={`/u/${r.user.username}`} className="row" style={{ textDecoration: 'none', gap: 10 }}><Avatar user={r.user} size={32} /><b>{r.user.username}</b></Link></td>
                  {board === 'champions' ? <td className="num big-score" style={{ fontSize: '1.3rem' }}>{r.titles}</td> : (
                    <>
                      <td className="num big-score" style={{ fontSize: '1.3rem' }}>{metric === 'rating' ? r.rating : r.wins}</td>
                      <td className="num muted small">{r.wins}–{r.losses}–{r.draws}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && <div className="center" style={{ padding: 12 }}><button className="btn btn-sm" onClick={more}>Show more</button></div>}
        </div>
      )}
      <AdSlot placement="sidebar" />
    </div>
  );
}
