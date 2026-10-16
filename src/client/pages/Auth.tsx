import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, post } from '../lib/api';
import { useApp, type Me } from '../lib/app';

function AuthFrame({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <div className="page" style={{ maxWidth: 520 }}>
      <div className="card stack-lg" style={{ marginTop: 'min(8vh, 64px)' }}>
        <div className="stack" style={{ gap: 6 }}>
          <h2>{title}</h2>
          <p className="muted">{intro}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, label = 'Password', autoComplete, min }: { value: string; onChange(v: string): void; label?: string; autoComplete: string; min?: number }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={`pw-${label}`}>{label}</label>
      <div className="row">
        <input id={`pw-${label}`} className="input grow" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete} required minLength={min} maxLength={200} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
      </div>
      {min && <span className={value.length >= min ? 'ok' : 'hint'}>{value.length >= min ? 'Long enough.' : `At least ${min} characters — a short phrase like “jollof on sunday” works well.`}</span>}
    </div>
  );
}

function RecoveryCode({ code, onDone }: { code: string; onDone(): void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const download = () => {
    const blob = new Blob([`GamePact recovery code\n\n${code}\n\nUse it with your username at /recover if you forget your password. It can be used once.\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gamepact-recovery-code.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h2>Save your recovery code</h2>
        <p className="muted">We don’t ask for your email, so this code is the only way back in if you forget your password. We’ll show it once.</p>
      </div>
      <div className="panel center invite-code num" style={{ fontSize: 'clamp(1.2rem, 5.5vw, 1.9rem)', letterSpacing: '0.06em', wordBreak: 'break-all' }}>{code}</div>
      <div className="row-wrap">
        <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(code).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy code'}</button>
        <button className="btn btn-sm" onClick={download}>Download as file</button>
      </div>
      <label className="row" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ width: 22, height: 22 }} />
        <span>I’ve saved it somewhere safe</span>
      </label>
      <button className="btn btn-primary btn-block" disabled={!saved} onClick={onDone}>Start playing</button>
    </div>
  );
}

export function SignUpPage() {
  const [params] = useSearchParams();
  const [username, setUsername] = useState(params.get('u') ?? '');
  const [password, setPassword] = useState('');
  const [honey, setHoney] = useState('');
  const [check, setCheck] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState<Me | null>(null);
  const { config, setMe } = useApp();
  const navigate = useNavigate();
  const min = config?.passwordMinLength ?? 12;
  const next = params.get('next') || '/home';

  useEffect(() => {
    if (!username) { setCheck(null); return; }
    const t = setTimeout(() => {
      api(`/auth/username-available?u=${encodeURIComponent(username)}`).then(setCheck).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [username]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ user: Me; recoveryCode: string }>('/auth/register', { username, password, website: honey });
      setPending(r.user);
      setCode(r.recoveryCode);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (code && pending) {
    return (
      <div className="page" style={{ maxWidth: 520 }}>
        <div className="card" style={{ marginTop: 'min(8vh, 64px)' }}>
          <RecoveryCode code={code} onDone={() => { setMe(pending); navigate(next, { replace: true }); }} />
        </div>
      </div>
    );
  }

  return (
    <AuthFrame title="Pick a username" intro="That’s your name on every board, bracket and leaderboard. No email or phone number needed.">
      <form className="stack-lg" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
            autoCapitalize="off" spellCheck={false} maxLength={20} required aria-invalid={check ? !check.available : undefined} aria-describedby="u-hint" />
          <span id="u-hint" className={check ? (check.available ? 'ok' : 'error') : 'hint'}>
            {check ? (check.available ? `${username} is yours if you want it.` : check.reason) : '3–20 characters: letters, numbers, dots, dashes, underscores.'}
          </span>
        </div>
        <PasswordField value={password} onChange={setPassword} autoComplete="new-password" min={min} />
        <input type="text" name="website" value={honey} onChange={(e) => setHoney(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !check?.available || password.length < min}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="small muted center">Already have one? <Link to={`/signin${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link></p>
      </form>
    </AuthFrame>
  );
}

export function SignInPage() {
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { setMe } = useApp();
  const navigate = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ user: Me }>('/auth/login', { username, password });
      setMe(r.user);
      navigate(params.get('next') || '/home', { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title="Welcome back" intro="Sign in with your username and password.">
      <form className="stack-lg" onSubmit={submit}>
        <div className="field">
          <label htmlFor="si-user">Username</label>
          <input id="si-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} required />
        </div>
        <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="row between small">
          <Link to="/recover">Forgot your password?</Link>
          <Link to="/signup">New here? Pick a username</Link>
        </div>
      </form>
    </AuthFrame>
  );
}

export function RecoverPage() {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ user: Me; recoveryCode: string } | null>(null);
  const { setMe, config } = useApp();
  const navigate = useNavigate();
  const min = config?.passwordMinLength ?? 12;

  if (result) {
    return (
      <div className="page" style={{ maxWidth: 520 }}>
        <div className="card" style={{ marginTop: 'min(8vh, 64px)' }}>
          <p className="ok" style={{ marginBottom: 16 }}>Password reset. Your old recovery code no longer works — here’s a new one.</p>
          <RecoveryCode code={result.recoveryCode} onDone={() => { setMe(result.user); navigate('/home', { replace: true }); }} />
        </div>
      </div>
    );
  }

  return (
    <AuthFrame title="Recover your account" intro="Enter your username and the recovery code you saved when you signed up. If you’ve lost both your password and your code, we can’t restore the account.">
      <form className="stack-lg" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try { setResult(await post('/auth/recovery/redeem', { username, code, newPassword: password })); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
      }}>
        <div className="field">
          <label htmlFor="r-user">Username</label>
          <input id="r-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" required />
        </div>
        <div className="field">
          <label htmlFor="r-code">Recovery code</label>
          <input id="r-code" className="input num" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoCapitalize="characters" spellCheck={false} required />
        </div>
        <PasswordField value={password} onChange={setPassword} label="New password" autoComplete="new-password" min={min} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || password.length < min}>{busy ? 'Checking…' : 'Reset password'}</button>
      </form>
    </AuthFrame>
  );
}
