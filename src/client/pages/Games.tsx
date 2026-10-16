import { useMemo, useState } from 'react';
import { CATEGORY_LABEL, GAMES, type Category, type GameMeta } from '../../shared/catalog';
import { Icons } from '../components/art';
import { Empty, GameToken, Segmented } from '../components/ui';
import { useFetch } from '../lib/app';

export default function Games() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'all' | Category>('all');
  const { data } = useFetch<{ games: (GameMeta & { playing: number })[] }>('/games');
  const playing = Object.fromEntries((data?.games ?? []).map((g) => [g.id, g.playing]));
  const list = useMemo(() => GAMES.filter((g) =>
    (cat === 'all' || g.category === cat) && (g.name + g.blurb).toLowerCase().includes(q.trim().toLowerCase()),
  ).sort((a, b) => Number(a.status !== 'live') - Number(b.status !== 'live')), [q, cat]);

  return (
    <div className="page stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 'clamp(2.2rem, 6vw, 3.4rem)' }}>Games</h1>
        <p className="muted">Pick one to play quick matches, challenge a friend, or practise.</p>
      </div>
      <div className="row-wrap between">
        <label className="row" style={{ flex: '1 1 260px', maxWidth: 420, position: 'relative' }}>
          <span className="sr-only">Search games</span>
          <span style={{ position: 'absolute', left: 14, width: 20, color: 'var(--faint)' }}>{Icons.search}</span>
          <input className="input" style={{ paddingLeft: 44 }} placeholder="Search games" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Segmented label="Category" value={cat} onChange={setCat}
          options={[{ value: 'all', label: 'All' }, ...(['board', 'arcade', 'word'] as Category[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]} />
      </div>
      {list.length ? (
        <div className="shelf">{list.map((g) => <GameToken key={g.id} game={g} playing={playing[g.id]} />)}</div>
      ) : (
        <Empty title={`No games match “${q}”`} action={<button className="btn btn-sm" onClick={() => { setQ(''); setCat('all'); }}>Show all games</button>} />
      )}
    </div>
  );
}
