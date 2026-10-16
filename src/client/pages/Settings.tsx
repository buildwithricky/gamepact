import { useState } from 'react';
import { GAMES } from '../../shared/catalog';
import { AVATAR_COLORS, AVATAR_GLYPHS } from '../../shared/types';
import { Avatar } from '../components/ui';
import { api, post } from '../lib/api';
import { useAction, useApp } from '../lib/app';

export default function Settings() {
  const { me, refreshMe, signOut, config, toast } = useApp();
  const { busy, run } = useAction();
  const [avatar, setAvatar] = useState(me!.avatar);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [favs, setFavs] = useState<string[]>([]);
  const min = config?.passwordMinLength ?? 12;

  return (
    <div className="page stack-lg" style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 'clamp(2.2rem, 6vw, 3.4rem)' }}>Settings</h1>

      <section className="card stack-lg">
        <h3>Your token</h3>
        <div className="row" style={{ gap: 20 }}>
          <Avatar user={{ username: me!.username, avatar }} size={72} />
          <div className="stack grow">
            <div className="row-wrap" role="radiogroup" aria-label="Colour">
              {AVATAR_COLORS.map((c, i) => (
                <button key={c} role="radio" aria-checked={avatar.color === i} aria-label={`Colour ${i + 1}`} onClick={() => setAvatar({ ...avatar, color: i })}
                  style={{ width: 36, height: 36, borderRadius: '50%', background: c, border: avatar.color === i ? '3px solid var(--chalk)' : '2px solid var(--ink)', cursor: 'pointer' }} />
              ))}
            </div>
            <div className="row-wrap" role="radiogroup" aria-label="Badge">
              {AVATAR_GLYPHS.map((g, i) => (
                <button key={g} role="radio" aria-checked={avatar.glyph === i} onClick={() => setAvatar({ ...avatar, glyph: i })} className="btn btn-sm btn-ghost"
                  style={{ minWidth: 40, padding: 0, borderColor: avatar.glyph === i ? 'var(--chalk)' : undefined }}>{g}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <span className="label">Favourite games (shown on your profile)</span>
          <div className="row-wrap">
            {GAMES.filter((g) => g.status === 'live').map((g) => (
              <button key={g.id} type="button" className={`chip ${favs.includes(g.id) ? 'chip-word' : ''}`} style={{ border: 0, cursor: 'pointer' }} aria-pressed={favs.includes(g.id)}
                onClick={() => setFavs((f) => (f.includes(g.id) ? f.filter((x) => x !== g.id) : [...f, g.id].slice(-5)))}>{g.name}</button>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy}
          onClick={() => run(async () => { await api('/me', { method: 'PATCH', body: { avatar, favoriteGames: favs.length ? favs : undefined } }); await refreshMe(); }, 'Saved.')}>Save</button>
      </section>

      <section className="card stack">
        <h3>Change password</h3>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/auth/password', { currentPassword: cur, newPassword: next }); setCur(''); setNext(''); }, 'Password changed. Other devices were signed out.'); }}>
          <input className="input" type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" aria-label="Current password" />
          <input className="input" type="password" placeholder={`New password (${min}+ characters)`} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-label="New password" />
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy || !cur || next.length < min}>Change password</button>
        </form>
      </section>

      <section className="card stack">
        <h3>Recovery code</h3>
        <p className="muted small">Lost your recovery code? Make a new one. The old code stops working straight away.</p>
        {code ? (
          <div className="panel center invite-code num" style={{ fontSize: '1.6rem', wordBreak: 'break-all' }}>{code}</div>
        ) : (
          <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await post('/auth/recovery/regenerate', { password: pw }); setCode(r.recoveryCode); setPw(''); }); }}>
            <input className="input grow" type="password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" />
            <button className="btn" disabled={busy || !pw}>New code</button>
          </form>
        )}
        {code && <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigator.clipboard?.writeText(code).then(() => toast('Copied.'))}>Copy code</button>}
      </section>

      <section className="card stack">
        <h3>Sessions</h3>
        <div className="row-wrap">
          <button className="btn" onClick={signOut}>Sign out</button>
          <button className="btn btn-danger" onClick={() => run(async () => { await post('/auth/logout-everywhere'); await signOut(); })}>Sign out everywhere</button>
        </div>
      </section>
    </div>
  );
}
