import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

export default function Join() {
  const params = useParams();
  const [code, setCode] = useState(params.code ?? '');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const go = async (c: string) => {
    setError(null);
    try { const r = await api<{ id: string }>(`/matches/code/${encodeURIComponent(c.trim())}`); navigate(`/m/${r.id}`, { replace: true }); }
    catch (e: any) { setError(e.message); }
  };
  useEffect(() => { if (params.code) go(params.code); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page" style={{ maxWidth: 520 }}>
      <form className="card stack-lg" style={{ marginTop: 48 }} onSubmit={(e) => { e.preventDefault(); go(code); }}>
        <div className="stack" style={{ gap: 6 }}>
          <h2>Enter a room code</h2>
          <p className="muted">Your friend sees a six-character code in their lobby.</p>
        </div>
        <input className="input invite-code center" style={{ minHeight: 76, fontSize: '2rem' }} value={code} maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ABC123" autoCapitalize="characters" aria-label="Room code" autoFocus />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-lg" disabled={code.length !== 6}>Join room</button>
      </form>
    </div>
  );
}
