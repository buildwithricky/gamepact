import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../components/ui';
import { clock } from '../lib/format';
import { type BoardProps, seatName, TurnLine } from './common';

// ------------------------------------------------------------------ Tic-tac-toe

interface TttView {
  board: (number | null)[]; turn: number; round: number; bestOf: number; wins: [number, number]; draws: number;
  lastRound: { winner: number | null; line: number[] | null; board: (number | null)[] } | null; winLine: number[] | null;
}

export function TicTacToeBoard({ snap, view, act, myTurn }: BoardProps<TttView>) {
  const [flash, setFlash] = useState<TttView['lastRound']>(null);
  const roundKey = `${view.round}-${view.wins.join()}-${view.draws}`;
  useEffect(() => {
    if (!view.lastRound) return;
    setFlash(view.lastRound);
    const t = setTimeout(() => setFlash(null), 1300);
    return () => clearTimeout(t);
  }, [roundKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = snap.status !== 'IN_PROGRESS';
  const board = flash && !done ? flash.board : view.board;
  const line = flash && !done ? flash.line : view.lastRound && done ? view.lastRound.line : view.winLine;
  const mark = (v: number | null) => (v === 0 ? 'X' : v === 1 ? 'O' : '');
  return (
    <div className="board-wrap">
      <div className="board-hud">
        <span className="big-score num" style={{ color: 'var(--arcade)' }}>X {view.wins[0]}</span>
        <span className="muted small">{view.bestOf > 1 ? `Round ${view.round} of ${view.bestOf}` : 'Single game'}{view.draws ? ` · ${view.draws} drawn` : ''}</span>
        <span className="big-score num" style={{ color: 'var(--mint)' }}>{view.wins[1]} O</span>
      </div>
      <div className="ttt" role="grid" aria-label="Board">
        {board.map((c, i) => (
          <button key={i} className={`ttt-cell ${c === 0 ? 'x' : c === 1 ? 'o' : ''} ${line?.includes(i) ? 'win' : ''}`}
            disabled={!myTurn || c !== null || Boolean(flash)} onClick={() => act({ cell: i })}
            aria-label={`Square ${i + 1}${c !== null ? `, ${mark(c)}` : ''}`}>
            {c !== null && <span className="mark">{mark(c)}</span>}
          </button>
        ))}
      </div>
      <TurnLine snap={snap} seat={view.turn}>
        {flash ? (flash.winner === null ? 'Round drawn' : `${seatName(snap, flash.winner)} took the round`) : undefined}
      </TurnLine>
      {snap.you !== null && <p className="tiny faint center">You’re {snap.you === 0 ? 'X' : 'O'}.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Chess

interface ChessView {
  fen: string; moves: string[]; lastMove: { from: string; to: string } | null; turn: number; inCheck: boolean;
  clocks: [number, number]; timed: boolean; drawOffer: number | null; legal: { from: string; to: string; promo: boolean }[];
  end: { detail: string } | null;
}

const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';

function parseFen(fen: string): Record<string, string> {
  const out: Record<string, string> = {};
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else { out[`${FILES[f]}${8 - r}`] = ch; f++; }
    }
  });
  return out;
}

export function ChessBoard({ snap, view, act, now, myTurn }: BoardProps<ChessView>) {
  const [sel, setSel] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const pieces = useMemo(() => parseFen(view.fen), [view.fen]);
  const flip = snap.you === 1;
  const targets = sel ? view.legal.filter((m) => m.from === sel) : [];
  useEffect(() => setSel(null), [view.fen]);

  const squares: string[] = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const file = flip ? 7 - f : f, rank = flip ? r + 1 : 8 - r;
    squares.push(`${FILES[file]}${rank}`);
  }
  const kingSq = view.inCheck ? Object.entries(pieces).find(([, p]) => p === (view.turn === 0 ? 'K' : 'k'))?.[0] : null;
  const click = (sq: string) => {
    if (!myTurn) return;
    const t = targets.find((m) => m.to === sq);
    if (sel && t) {
      if (t.promo) setPromo({ from: sel, to: sq });
      else act({ type: 'move', from: sel, to: sq });
      setSel(null);
      return;
    }
    setSel(view.legal.some((m) => m.from === sq) ? sq : null);
  };

  const clockFor = (seat: number) => {
    const running = snap.status === 'IN_PROGRESS' && view.turn === seat && view.timed;
    const ms = running && snap.deadline ? Math.max(0, snap.deadline.at - now) : view.clocks[seat];
    return <span className={`clock ${running ? 'running' : ''} ${running && ms < 20_000 ? 'low' : ''}`}>{view.timed ? clock(ms) : '—'}</span>;
  };
  const top = flip ? 0 : 1, bottom = flip ? 1 : 0;

  return (
    <div className="board-wrap stack" style={{ gap: 10 }}>
      <div className="row between"><span className="small muted">{seatName(snap, top)} · {top === 0 ? 'White' : 'Black'}</span>{clockFor(top)}</div>
      <div className="chessboard" role="grid" aria-label="Chess board">
        {squares.map((sq, i) => {
          const file = FILES.indexOf(sq[0]), rank = Number(sq[1]);
          const light = (file + rank) % 2 === 0;
          const p = pieces[sq];
          const target = targets.find((m) => m.to === sq);
          const last = view.lastMove && (view.lastMove.from === sq || view.lastMove.to === sq);
          return (
            <button key={sq} className={`sq ${light ? 'light' : 'dark'} ${last ? 'last' : ''} ${sel === sq ? 'sel' : ''} ${kingSq === sq ? 'check' : ''}`}
              onClick={() => click(sq)} aria-label={`${sq}${p ? ` ${p === p.toUpperCase() ? 'white' : 'black'} ${({ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' } as any)[p.toLowerCase()]}` : ''}`}>
              {p && <span className={`piece ${p === p.toUpperCase() ? 'w' : 'b'}`}>{GLYPH[p.toLowerCase()]}{'︎'}</span>}
              {target && (p ? <span className="hint-ring" /> : <span className="hint-dot" />)}
              {i % 8 === 0 && <span className="coord rank">{rank}</span>}
              {i >= 56 && <span className="coord file">{sq[0]}</span>}
            </button>
          );
        })}
      </div>
      <div className="row between"><span className="small muted">{seatName(snap, bottom)} · {bottom === 0 ? 'White' : 'Black'}</span>{clockFor(bottom)}</div>
      <TurnLine snap={snap} seat={view.turn}>{view.inCheck && snap.status === 'IN_PROGRESS' ? (myTurn ? 'Check — you must respond' : 'Check!') : undefined}</TurnLine>
      {snap.status === 'IN_PROGRESS' && snap.you !== null && (
        <div className="row-wrap" style={{ justifyContent: 'center' }}>
          {view.drawOffer === null && <button className="btn btn-ghost btn-sm" onClick={() => act({ type: 'offerDraw' })}>Offer a draw</button>}
          {view.drawOffer === snap.you && <span className="small muted">You offered a draw.</span>}
          {view.drawOffer !== null && view.drawOffer !== snap.you && (
            <>
              <span className="small" style={{ fontWeight: 700 }}>{seatName(snap, view.drawOffer)} offers a draw.</span>
              <button className="btn btn-sm btn-mint" onClick={() => act({ type: 'acceptDraw' })}>Accept</button>
              <button className="btn btn-sm" onClick={() => act({ type: 'declineDraw' })}>Decline</button>
            </>
          )}
        </div>
      )}
      {view.moves.length > 0 && (
        <div className="movelist num" aria-label="Moves">
          {view.moves.map((m, i) => <span key={i}>{i % 2 === 0 ? <b className="faint">{i / 2 + 1}. </b> : null}{m}</span>)}
        </div>
      )}
      {promo && (
        <Dialog title="Promote to" onClose={() => setPromo(null)}>
          <div className="suit-pick">
            {(['q', 'r', 'b', 'n'] as const).map((p) => (
              <button key={p} className="btn" onClick={() => { act({ type: 'move', ...promo, promotion: p }); setPromo(null); }} aria-label={({ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' })[p]}>
                <span className={`piece ${snap.you === 0 ? 'w' : 'b'}`} style={{ fontSize: '2.2rem' }}>{GLYPH[p]}{'︎'}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Crazy Eights

interface C8View {
  hand: string[] | null; counts: number[]; top: string; suit: string; drawCount: number; turn: number;
  drawnCard: string | null; hasDrawn: boolean; out: boolean[]; totals: number[]; target: number; round: number;
  lastRound: { winner: number; points: number } | null; log: { seat: number; text: string }[]; reveal: string[][] | null;
}

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAME: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const rankOf = (c: string) => c.slice(0, -1);
const suitOf = (c: string) => c.slice(-1);

function Card({ card, onClick, state }: { card: string; onClick?(): void; state?: 'playable' | 'dim' }) {
  const red = suitOf(card) === 'H' || suitOf(card) === 'D';
  const sym = SUIT_SYMBOL[suitOf(card)] + '︎';
  return (
    <button className={`playing-card ${red ? 'red' : ''} ${state ?? ''}`} onClick={onClick} disabled={!onClick} aria-label={`${rankOf(card)} of ${SUIT_NAME[suitOf(card)]}`}>
      <span>{rankOf(card)}{sym}</span>
      <span className="pip">{sym}</span>
      <span className="corner-b">{rankOf(card)}{sym}</span>
    </button>
  );
}

export function CrazyEightsBoard({ snap, view, act, myTurn }: BoardProps<C8View>) {
  const [eight, setEight] = useState<string | null>(null);
  const playable = (c: string) => rankOf(c) === '8' || suitOf(c) === view.suit || rankOf(c) === rankOf(view.top);
  const canPlay = (c: string) => myTurn && playable(c) && (!view.drawnCard || c === view.drawnCard);
  const play = (c: string) => (rankOf(c) === '8' ? setEight(c) : act({ type: 'play', card: c }));
  const others = view.counts.map((n, i) => ({ n, i })).filter((x) => x.i !== snap.you);
  const sorted = [...(view.hand ?? [])].sort((a, b) => 'SHDC'.indexOf(suitOf(a)) - 'SHDC'.indexOf(suitOf(b)) || 'A2345678910JQK'.indexOf(rankOf(a)) - 'A2345678910JQK'.indexOf(rankOf(b)));

  return (
    <div className="board-wrap wide stack">
      <div className="row-wrap" style={{ justifyContent: 'center' }}>
        {others.map(({ n, i }) => (
          <div key={i} className="panel stack center" style={{ padding: 12, alignItems: 'center', gap: 6, borderColor: view.turn === i ? 'var(--word)' : undefined, borderWidth: 2, borderStyle: 'solid' }}>
            <span className="small" style={{ fontWeight: 800 }}>{seatName(snap, i)}{view.out[i] ? ' (left)' : ''}</span>
            <div className="row" style={{ gap: 0 }}>
              {Array.from({ length: Math.min(n, 8) }, (_, k) => <span key={k} className="playing-card back" style={{ width: 28, height: 40, marginLeft: k ? -16 : 0 }} />)}
            </div>
            <span className="tiny muted">{n} card{n === 1 ? '' : 's'}{view.target ? ` · ${view.totals[i]} pts` : ''}</span>
          </div>
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'center', gap: 24, padding: '12px 0' }}>
        <button className="playing-card back" style={{ width: 76, height: 108, cursor: myTurn && !view.hasDrawn ? 'pointer' : 'default' }}
          onClick={() => myTurn && !view.hasDrawn && act({ type: 'draw' })} aria-label={`Draw a card, ${view.drawCount} left`} disabled={!myTurn || view.hasDrawn} />
        <div style={{ transform: 'scale(1.18)' }}><Card card={view.top} /></div>
        <div className="stack center" style={{ gap: 2 }}>
          <span className="tiny muted">Play on</span>
          <span style={{ fontSize: '2.4rem', lineHeight: 1, color: view.suit === 'H' || view.suit === 'D' ? '#ff6b80' : 'var(--chalk)' }}>{SUIT_SYMBOL[view.suit]}{'︎'}</span>
          <span className="tiny muted">{SUIT_NAME[view.suit]}</span>
        </div>
      </div>

      <TurnLine snap={snap} seat={view.turn}>
        {myTurn ? (view.drawnCard ? 'You drew a playable card — play it or pass.' : sorted.some(playable) ? 'Your turn — play a highlighted card' : 'No match — draw a card') : undefined}
      </TurnLine>

      {view.hand && (
        <div className="hand">
          {sorted.map((c) => <Card key={c} card={c} state={canPlay(c) ? 'playable' : myTurn ? 'dim' : undefined} onClick={canPlay(c) ? () => play(c) : undefined} />)}
        </div>
      )}
      {myTurn && view.drawnCard && <div className="center"><button className="btn" onClick={() => act({ type: 'pass' })}>Pass</button></div>}
      {view.target > 0 && <p className="small muted center">First to {view.target} · Round {view.round}{view.lastRound ? ` · Last round: ${seatName(snap, view.lastRound.winner)} +${view.lastRound.points}` : ''}</p>}

      {view.log.length > 0 && (
        <div className="panel small muted" style={{ padding: 12 }}>
          {view.log.slice(-4).map((l, i) => <div key={i}><b style={{ color: 'var(--chalk)' }}>{seatName(snap, l.seat)}</b> {l.text}</div>)}
        </div>
      )}
      {view.reveal && (
        <div className="panel stack" style={{ padding: 12 }}>
          <span className="small muted">Final hands</span>
          {view.reveal.map((h, i) => (
            <div key={i} className="row-wrap"><b className="small" style={{ minWidth: 80 }}>{seatName(snap, i)}</b>{h.length ? h.map((c) => <span key={c} className="wordchip">{rankOf(c)}{SUIT_SYMBOL[suitOf(c)]}</span>) : <span className="small muted">Out!</span>}</div>
          ))}
        </div>
      )}
      {eight && (
        <Dialog title="Call a suit" onClose={() => setEight(null)}>
          <div className="suit-pick">
            {['S', 'H', 'D', 'C'].map((s) => (
              <button key={s} className="btn" style={{ color: s === 'H' || s === 'D' ? '#e0314e' : undefined, background: 'var(--chalk)' }}
                onClick={() => { act({ type: 'play', card: eight, suit: s }); setEight(null); }} aria-label={SUIT_NAME[s]}>{SUIT_SYMBOL[s]}{'︎'}</button>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
