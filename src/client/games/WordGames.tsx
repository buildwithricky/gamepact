import { useEffect, useMemo, useRef, useState } from 'react';
import { clock } from '../lib/format';
import { type BoardProps, seatName } from './common';

function useTyping(enabled: boolean, onKey: (k: string) => void) {
  const ref = useRef(onKey);
  ref.current = onKey;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === 'Backspace' || /^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); ref.current(e.key); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [enabled]);
}

function Countdown({ at, now, label }: { at: number; now: number; label: string }) {
  const left = Math.max(0, at - now);
  return <span className={`chip num ${left < 10_000 ? 'chip-arcade' : ''}`} aria-label={`${label} ${clock(left)}`}>{clock(left)}</span>;
}

// ------------------------------------------------------------------ Word Guess

interface WgView {
  mine: { guesses: string[]; marks: string[] } | null;
  others: { seat: number; marks: string[]; solved: boolean; timeMs: number | null; done: boolean }[];
  tries: number; endsAt: number; answer: string | null;
}

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export function WordGuessBoard({ snap, view, act, now }: BoardProps<WgView>) {
  const [cur, setCur] = useState('');
  const [shake, setShake] = useState(false);
  const mine = view.mine ?? { guesses: [], marks: [] };
  const done = snap.status !== 'IN_PROGRESS' || mine.marks.includes('ggggg') || mine.guesses.length >= view.tries;
  const keyState = useMemo(() => {
    const s: Record<string, string> = {};
    mine.guesses.forEach((g, i) => g.split('').forEach((ch, j) => {
      const m = mine.marks[i][j];
      if (m === 'g' || (m === 'y' && s[ch] !== 'g') || (m === '.' && !s[ch])) s[ch] = m === '.' ? 'x' : m;
    }));
    return s;
  }, [mine.guesses, mine.marks]);

  const press = async (k: string) => {
    if (done || snap.you === null) return;
    if (k === 'Enter') {
      if (cur.length !== 5) { setShake(true); setTimeout(() => setShake(false), 400); return; }
      const r = await act({ guess: cur });
      if (r.ok) setCur(''); else { setShake(true); setTimeout(() => setShake(false), 400); }
    } else if (k === 'Backspace') setCur((c) => c.slice(0, -1));
    else if (/^[a-z]$/i.test(k) && cur.length < 5) setCur((c) => c + k.toLowerCase());
  };
  useTyping(!done && snap.you !== null, press);

  const rows = Array.from({ length: view.tries }, (_, i) => {
    if (i < mine.guesses.length) return { word: mine.guesses[i], mark: mine.marks[i] };
    if (i === mine.guesses.length && !done) return { word: cur, mark: null, current: true };
    return { word: '', mark: null };
  });

  return (
    <div className="board-wrap stack" style={{ alignItems: 'center' }}>
      <div className="row between" style={{ width: '100%' }}>
        <span className="small muted">{view.answer ? 'The word was' : 'Guess the five-letter word'}</span>
        {snap.status === 'IN_PROGRESS' && <Countdown at={view.endsAt} now={now} label="Time left" />}
      </div>
      {view.answer && <div className="letters">{view.answer.split('').map((c, i) => <span key={i} className="tile g">{c}</span>)}</div>}
      <div className="stack" style={{ gap: 6, animation: shake ? 'pop 300ms' : undefined }}>
        {rows.map((r, i) => (
          <div key={i} className="letters" style={{ gap: 6 }}>
            {Array.from({ length: 5 }, (_, j) => {
              const ch = r.word[j] ?? '';
              const m = r.mark?.[j];
              return <span key={j} className={`tile ${m === 'g' ? 'g' : m === 'y' ? 'y' : m === '.' ? 'x' : ch ? 'pending' : 'empty'}`}>{ch}</span>;
            })}
          </div>
        ))}
      </div>
      {view.others.filter((o) => o.seat !== snap.you).length > 0 && (
        <div className="row-wrap" style={{ justifyContent: 'center', gap: 20 }}>
          {view.others.filter((o) => o.seat !== snap.you).map((o) => (
            <div key={o.seat} className="stack center" style={{ gap: 4, alignItems: 'center' }}>
              <span className="tiny" style={{ fontWeight: 800 }}>{seatName(snap, o.seat)}</span>
              <div className="stack" style={{ gap: 2 }}>
                {Array.from({ length: view.tries }, (_, i) => (
                  <div key={i} className="mini-grid">{Array.from({ length: 5 }, (_, j) => <span key={j} className={o.marks[i]?.[j] === 'g' ? 'g' : o.marks[i]?.[j] === 'y' ? 'y' : ''} style={{ opacity: o.marks[i] ? 1 : 0.35 }} />)}</div>
                ))}
              </div>
              <span className="tiny muted">{o.solved ? `Solved in ${o.marks.length}` : o.done ? 'Out of guesses' : 'Thinking…'}</span>
            </div>
          ))}
        </div>
      )}
      {!done && snap.you !== null && (
        <div className="keyboard" style={{ width: '100%' }}>
          {ROWS.map((row, i) => (
            <div key={row} className="krow">
              {i === 2 && <button className="key wide" onClick={() => press('Enter')}>Enter</button>}
              {row.split('').map((k) => <button key={k} className={`key ${keyState[k] ?? ''}`} onClick={() => press(k)}>{k}</button>)}
              {i === 2 && <button className="key wide" onClick={() => press('Backspace')} aria-label="Delete">⌫</button>}
            </div>
          ))}
        </div>
      )}
      {done && snap.status === 'IN_PROGRESS' && <p className="muted">{mine.marks.includes('ggggg') ? 'Solved! Waiting for the others…' : 'Out of guesses. Waiting for the others…'}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ shared rack input (scramble + duel)

function RackInput({ letters, onSubmit, disabled, values, submitLabel }: { letters: string[]; onSubmit(word: string): Promise<boolean>; disabled: boolean; values?: Record<string, number>; submitLabel: string }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [order, setOrder] = useState(() => letters.map((_, i) => i));
  useEffect(() => { setPicked([]); setOrder(letters.map((_, i) => i)); }, [letters.join('')]); // eslint-disable-line react-hooks/exhaustive-deps
  const word = picked.map((i) => letters[i]).join('');
  const submit = async () => { if (!word) return; if (await onSubmit(word)) setPicked([]); };
  useTyping(!disabled, (k) => {
    if (k === 'Enter') submit();
    else if (k === 'Backspace') setPicked((p) => p.slice(0, -1));
    else {
      const idx = letters.findIndex((l, i) => l === k.toLowerCase() && !picked.includes(i));
      if (idx >= 0) setPicked((p) => [...p, idx]);
    }
  });
  const shuffle = () => setOrder((o) => [...o].sort(() => Math.random() - 0.5));
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <div className="letters" style={{ minHeight: 60 }} aria-live="polite" aria-label={`Current word ${word || 'empty'}`}>
        {word ? word.split('').map((c, i) => <button key={i} className="tile" onClick={() => setPicked((p) => p.filter((_, k) => k !== i))}>{c}</button>)
          : <span className="muted">Tap letters or type</span>}
      </div>
      <div className="letters rack">
        {order.map((i) => (
          <button key={i} className={`tile pick ${picked.includes(i) ? 'used' : ''}`} disabled={disabled || picked.includes(i)} onClick={() => setPicked((p) => [...p, i])} style={{ position: 'relative' }}>
            {letters[i]}
            {values && <span className="val">{values[letters[i]]}</span>}
          </button>
        ))}
      </div>
      <div className="row">
        <button className="btn btn-ghost btn-sm" onClick={() => setPicked([])} disabled={!word}>Clear</button>
        <button className="btn btn-ghost btn-sm" onClick={shuffle}>Shuffle</button>
        <button className="btn btn-primary" onClick={submit} disabled={disabled || !word}>{submitLabel}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Word Scramble

interface WsView {
  round: number; rounds: number; letters: string; phase: 'play' | 'break'; phaseEndsAt: number; scores: number[];
  results: { seat: number | null; word: string; points: number }[]; reveal: string | null;
}

export function WordScrambleBoard({ snap, view, act, now }: BoardProps<WsView>) {
  const last = view.results[view.results.length - 1];
  const showResult = view.phase === 'break' && last;
  return (
    <div className="board-wrap stack">
      <div className="row between">
        <span className="small muted">Word {view.round} of {view.rounds}</span>
        {snap.status === 'IN_PROGRESS' && <Countdown at={view.phaseEndsAt} now={now} label={view.phase === 'play' ? 'Time left' : 'Next word in'} />}
      </div>
      {showResult ? (
        <div className="panel center stack" style={{ alignItems: 'center' }}>
          <div className="letters">{(last.word ?? '').split('').map((c, i) => <span key={i} className="tile g">{c}</span>)}</div>
          <p style={{ fontWeight: 800 }}>{last.seat === null ? 'Nobody got it.' : `${seatName(snap, last.seat)} got it · +${last.points}`}</p>
        </div>
      ) : (
        <RackInput letters={view.letters.split('')} disabled={snap.status !== 'IN_PROGRESS' || snap.you === null} submitLabel="Submit"
          onSubmit={async (w) => (await act({ guess: w })).ok} />
      )}
      <div className="panel list" style={{ padding: '4px 16px' }}>
        {view.scores.map((sc, i) => ({ sc, i })).sort((a, b) => b.sc - a.sc).map(({ sc, i }) => (
          <div key={i} className="list-item"><span className="grow list-title">{seatName(snap, i)}</span><span className="num big-score" style={{ fontSize: '1.4rem' }}>{sc}</span></div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Word Duel

interface WdView {
  round: number; rounds: number; rack: string[]; phase: 'play' | 'break'; phaseEndsAt: number; mine: string[]; myScore: number | null;
  counts: number[]; scores: number[]; reveal: { found: string[][]; best: string[]; possible: number } | null; values: Record<string, number>;
}

export function WordDuelBoard({ snap, view, act, now }: BoardProps<WdView>) {
  const [fresh, setFresh] = useState<string | null>(null);
  const opp = view.counts.map((_, i) => i).filter((i) => i !== snap.you);
  const foundBy = (w: string) => view.reveal?.found.filter((f) => f.includes(w)).length ?? 0;
  return (
    <div className="board-wrap stack">
      <div className="row between">
        <span className="small muted">Round {view.round} of {view.rounds}</span>
        {snap.status === 'IN_PROGRESS' && <Countdown at={view.phaseEndsAt} now={now} label={view.phase === 'play' ? 'Time left' : 'Next round in'} />}
      </div>
      <div className="row-wrap between">
        <div className="stack" style={{ gap: 0 }}><span className="tiny muted">You</span><span className="big-score num">{view.myScore ?? '–'}</span></div>
        {opp.map((i) => (
          <div key={i} className="stack" style={{ gap: 0, textAlign: 'right' }}>
            <span className="tiny muted">{seatName(snap, i)}</span>
            <span className="big-score num">{view.reveal ? view.scores[i] : view.scores[i]}</span>
            <span className="tiny muted">{view.counts[i]} word{view.counts[i] === 1 ? '' : 's'} this round</span>
          </div>
        ))}
      </div>
      {view.phase === 'play' ? (
        <RackInput letters={view.rack} values={view.values} disabled={snap.status !== 'IN_PROGRESS' || snap.you === null} submitLabel="Add word"
          onSubmit={async (w) => { const r = await act({ word: w }); if (r.ok) { setFresh(w); setTimeout(() => setFresh(null), 600); } return r.ok; }} />
      ) : view.reveal && (
        <div className="stack">
          {view.reveal.found.map((words, i) => (
            <div key={i} className="panel stack" style={{ padding: 12 }}>
              <span className="small" style={{ fontWeight: 800 }}>{seatName(snap, i)} · {words.length} words</span>
              <div className="wordchips">{words.length ? words.map((w) => <span key={w} className={`wordchip ${foundBy(w) > 1 ? 'shared' : ''}`}>{w}</span>) : <span className="small muted">No words</span>}</div>
            </div>
          ))}
          <p className="small muted">Best in this rack: {view.reveal.best.join(', ')} · {view.reveal.possible} words were possible.</p>
        </div>
      )}
      {view.phase === 'play' && (
        <div className="wordchips">{view.mine.map((w) => <span key={w} className={`wordchip ${fresh === w ? 'new' : ''}`}>{w}</span>)}</div>
      )}
    </div>
  );
}
