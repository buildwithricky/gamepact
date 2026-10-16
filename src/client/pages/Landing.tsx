import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CATEGORY_LABEL, GAMES, type Category } from '../../shared/catalog';
import { Wordmark } from '../components/Shell';
import { Avatar, GameToken } from '../components/ui';
import { api } from '../lib/api';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const winner = (b: (string | null)[]) => {
  for (const l of LINES) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { mark: b[l[0]]!, line: l };
  return null;
};

function pipMove(b: (string | null)[]): number {
  const empty = b.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  for (const mark of ['O', 'X']) {
    for (const i of empty) { const t = [...b]; t[i] = mark; if (winner(t)) return i; }
  }
  if (b[4] === null && Math.random() < 0.7) return 4;
  return empty[Math.floor(Math.random() * empty.length)];
}

/** A real, playable round in the hero: the fastest way to show what the product is. */
function HeroGame() {
  const [board, setBoard] = useState<(string | null)[]>(Array(9).fill(null));
  const [thinking, setThinking] = useState(false);
  const win = winner(board);
  const full = board.every(Boolean);
  const over = Boolean(win) || full;

  const play = (i: number) => {
    if (board[i] || over || thinking) return;
    const next = [...board];
    next[i] = 'X';
    setBoard(next);
    if (winner(next) || next.every(Boolean)) return;
    setThinking(true);
    setTimeout(() => {
      setBoard((b) => { const n = [...b]; n[pipMove(n)] = 'O'; return n; });
      setThinking(false);
    }, 450);
  };

  const status = win ? (win.mark === 'X' ? 'You beat Pip. Your friends are next.' : 'Pip got you. Rematch?') : full ? 'A draw. Pip is harder than he looks.' : thinking ? 'Pip is thinking…' : 'Your move — you’re X.';

  return (
    <div className="table-felt">
      <div className="label-line upright">
        <div className="row"><Avatar user={{ username: 'Pip', avatar: { color: 3, glyph: 4 } }} size={34} /><strong>Warm up against Pip</strong></div>
        <span className="chip">Practice bot</span>
      </div>
      <div className="ttt upright" role="grid" aria-label="Tic-tac-toe practice board">
        {board.map((c, i) => (
          <button key={i} className={`ttt-cell ${c === 'X' ? 'x' : c === 'O' ? 'o' : ''} ${win?.line.includes(i) ? 'win' : ''}`}
            onClick={() => play(i)} disabled={Boolean(c) || over} aria-label={c ? `Square ${i + 1}, ${c}` : `Square ${i + 1}, empty`}>
            {c && <span className="mark">{c}</span>}
          </button>
        ))}
      </div>
      <div className="row between upright" style={{ marginTop: 16, minHeight: 48 }}>
        <span className="toast-line" aria-live="polite">{status}</span>
        {over && (win?.mark === 'X'
          ? <Link className="btn btn-primary btn-sm" to="/signup">Challenge a friend</Link>
          : <button className="btn btn-sm" onClick={() => setBoard(Array(9).fill(null))}>Play again</button>)}
      </div>
    </div>
  );
}

function ClaimName() {
  const [name, setName] = useState('');
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!name) { setState(null); return; }
    const t = setTimeout(async () => {
      const r = await api<{ available: boolean; reason: string | null }>(`/auth/username-available?u=${encodeURIComponent(name)}`).catch(() => null);
      if (r) setState({ ok: r.available, msg: r.available ? `${name} is free.` : r.reason ?? 'Not available.' });
    }, 300);
    return () => clearTimeout(t);
  }, [name]);
  return (
    <form className="stack" style={{ maxWidth: 460 }} onSubmit={(e) => { e.preventDefault(); navigate(`/signup?u=${encodeURIComponent(name)}`); }}>
      <div className="row" style={{ alignItems: 'stretch' }}>
        <input className="input grow" placeholder="Your username" value={name} onChange={(e) => setName(e.target.value)} aria-label="Username" maxLength={20} autoComplete="username" />
        <button className="btn btn-primary" disabled={state ? !state.ok : false}>Claim it</button>
      </div>
      <span className={state ? (state.ok ? 'ok' : 'error') : 'hint'} aria-live="polite">{state?.msg ?? '3–20 letters or numbers. No email needed.'}</span>
    </form>
  );
}

export default function Landing() {
  const [top, setTop] = useState<any[]>([]);
  useEffect(() => { api('/leaderboards?period=week').then((r) => setTop(r.rows.slice(0, 5))).catch(() => {}); }, []);
  const cats: Category[] = ['board', 'arcade', 'word'];

  return (
    <>
      <div className="page" style={{ paddingBottom: 0 }}>
        <section className="landing-hero">
          <div className="stack-lg">
            <h1><span>Pick a game.</span><span>Send a link.</span><span>Settle it.</span></h1>
            <p className="hero-copy">Chess, darts, mini golf, word duels and seven more quick games you can play with anyone, right in your browser. No email — just pick a username.</p>
            <div className="row-wrap">
              <Link className="btn btn-primary btn-lg" to="/signup">Pick a username</Link>
              <Link className="btn btn-ghost btn-lg" to="/signin">Sign in</Link>
            </div>
          </div>
          <HeroGame />
        </section>

        <section className="landing-section stack-lg">
          <div className="stack" style={{ gap: 8 }}>
            <h2>Something for every group chat</h2>
            <p className="muted">Each one takes a few minutes, works on your phone, and is scored by our servers so nobody can fiddle the result.</p>
          </div>
          {cats.map((c) => (
            <div key={c} className="stack">
              <h3>{CATEGORY_LABEL[c]}</h3>
              <div className="shelf">{GAMES.filter((g) => g.category === c).map((g) => <GameToken key={g.id} game={g} />)}</div>
            </div>
          ))}
        </section>

        <section className="landing-section stack-lg">
          <h2>How a challenge works</h2>
          <div className="steps">
            <div className="step stack" style={{ gap: 6 }}><h3>Pick a game</h3><p className="muted">Choose from the shelf and set the rules — best of three, blitz clock, 501.</p></div>
            <div className="step stack" style={{ gap: 6 }}><h3>Send the link</h3><p className="muted">Drop it in WhatsApp, Discord or anywhere. Friends join with one tap, or with a six-letter code.</p></div>
            <div className="step stack" style={{ gap: 6 }}><h3>Play, then keep score</h3><p className="muted">Results land on both profiles and the leaderboards. Ask for a rematch before they leave.</p></div>
          </div>
        </section>

        <section className="landing-section grid-2" style={{ alignItems: 'center' }}>
          <div className="stack">
            <h2>Run a bracket for your crew</h2>
            <p className="muted">Host a free knockout tournament for up to 64 players. Seeding, byes, check-in and no-shows are handled for you. The winner takes the bragging rights — and a trophy on their profile forever.</p>
            <div><Link className="btn btn-board" to="/signup">Host a tournament</Link></div>
          </div>
          <div className="bracket" aria-label="Example bracket" style={{ justifyContent: 'center' }}>
            <div className="bracket-round">
              {[['You', 'Friend'], ['Friend', 'Friend']].map((pair, i) => (
                <div key={i} className="bmatch">
                  {pair.map((p, j) => <div key={j} className={`bslot ${i === 0 && j === 0 ? 'win' : i === 0 ? 'lose' : ''}`}><span className="seed">{i * 2 + j + 1}</span>{p}</div>)}
                </div>
              ))}
            </div>
            <div className="bracket-round">
              <div className="bmatch live"><div className="bslot"><span className="seed">1</span>You</div><div className="bslot tbd"><span className="seed" />Winner of 3 v 4</div><div className="bnote">Final</div></div>
            </div>
          </div>
        </section>

        {top.length > 0 && (
          <section className="landing-section stack">
            <h2>This week’s top players</h2>
            <div className="panel list">
              {top.map((r) => (
                <div key={r.user.id} className="list-item">
                  <span className={`rank rank-${r.rank}`}>{r.rank}</span>
                  <Avatar user={r.user} size={34} />
                  <span className="list-title grow">{r.user.username}</span>
                  <span className="num muted">{r.wins} wins</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="landing-section stack">
          <h2>Your username is waiting</h2>
          <ClaimName />
        </section>
      </div>
      <footer className="footer">
        <div className="footer-inner">
          <Wordmark />
          <div className="row-wrap">
            <Link to="/games">Games</Link>
            <Link to="/tournaments">Tournaments</Link>
            <Link to="/leaderboards">Leaderboards</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
