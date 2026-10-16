import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Avatar, NotificationItem, PublicConfig } from '../../shared/types';
import { api, post } from './api';
import { getSocket, resetSocket } from './socket';

export interface Me { id: string; username: string; avatar: Avatar; role: 'user' | 'admin' }
interface Toast { id: number; text: string; tone?: 'err'; href?: string; action?: string }

interface AppCtx {
  me: Me | null;
  ready: boolean;
  config: PublicConfig | null;
  setMe(me: Me | null): void;
  refreshMe(): Promise<void>;
  signOut(): Promise<void>;
  toast(text: string, opts?: Omit<Toast, 'id' | 'text'>): void;
  unread: number;
  notifications: NotificationItem[];
  loadNotifications(): Promise<void>;
  markAllRead(): Promise<void>;
  connected: boolean;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

export function describeNotification(n: NotificationItem): { text: string; href?: string } {
  const p = n.payload as Record<string, any>;
  switch (n.type) {
    case 'friend.request': return { text: `${p.from} wants to be friends.`, href: '/friends' };
    case 'friend.accepted': return { text: `${p.from} accepted your friend request.`, href: `/u/${p.from}` };
    case 'match.invite': return { text: `${p.from} challenged you.`, href: `/m/${p.matchId}` };
    case 'achievement': return { text: `Achievement unlocked: ${p.name}.`, href: '/me' };
    case 'tournament.registered': return { text: `${p.username} joined ${p.title}.`, href: `/t/${p.tournamentId}` };
    case 'tournament.checkin': return { text: `Check-in is open for ${p.title}. Check in to keep your spot.`, href: `/t/${p.tournamentId}` };
    case 'tournament.started': return { text: `${p.title} has started.`, href: `/t/${p.tournamentId}` };
    case 'tournament.match_ready': return { text: `Round ${p.round} of ${p.title}: you vs ${p.opponent}. Your match is ready.`, href: `/t/${p.tournamentId}` };
    case 'tournament.completed': return { text: `${p.champion} won ${p.title}${p.bragging ? ` — ${p.bragging}` : ''}.`, href: `/t/${p.tournamentId}` };
    case 'tournament.cancelled': return { text: `${p.title} was cancelled.${p.reason ? ` ${p.reason}` : ''}`, href: `/t/${p.tournamentId}` };
    case 'tournament.post': return { text: `${p.title}: ${p.text}`, href: `/t/${p.tournamentId}` };
    case 'admin.ads': return { text: String(p.text), href: '/admin' };
    default: return { text: 'You have a new notification.' };
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(true);
  const seq = useRef(0);
  const navigate = useNavigate();

  const toast = useCallback((text: string, opts: Omit<Toast, 'id' | 'text'> = {}) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.href ? 7000 : 4200);
  }, []);

  const setMe = useCallback((m: Me | null) => {
    setMeState(m);
    resetSocket();
  }, []);

  const refreshMe = useCallback(async () => {
    const r = await api<{ user: Me | null }>('/auth/session').catch(() => ({ user: null }));
    setMeState(r.user);
  }, []);

  const loadNotifications = useCallback(async () => {
    const r = await api<{ items: NotificationItem[]; unread: number }>('/notifications').catch(() => null);
    if (r) { setNotifications(r.items); setUnread(r.unread); }
  }, []);

  const markAllRead = useCallback(async () => {
    await post('/notifications/read', {}).catch(() => {});
    setUnread(0);
    setNotifications((n) => n.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
  }, []);

  const signOut = useCallback(async () => {
    await post('/auth/logout').catch(() => {});
    setMe(null);
    navigate('/');
  }, [navigate, setMe]);

  useEffect(() => {
    Promise.all([refreshMe(), api<PublicConfig>('/config').then(setConfig).catch(() => {})]).finally(() => setReady(true));
  }, [refreshMe]);

  useEffect(() => {
    if (!me) { setNotifications([]); setUnread(0); return; }
    loadNotifications();
    const s = getSocket();
    const onNotify = (n: NotificationItem) => {
      setNotifications((list) => [n, ...list].slice(0, 40));
      setUnread((u) => u + 1);
      const d = describeNotification(n);
      toast(d.text, { href: d.href, action: 'Open' });
    };
    const onFound = ({ matchId }: { matchId: string }) => navigate(`/m/${matchId}`);
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on('notify', onNotify);
    s.on('mm:found', onFound);
    s.on('connect', on);
    s.on('disconnect', off);
    return () => { s.off('notify', onNotify); s.off('mm:found', onFound); s.off('connect', on); s.off('disconnect', off); };
  }, [me, loadNotifications, navigate, toast]);

  const value = useMemo<AppCtx>(() => ({
    me, ready, config, setMe, refreshMe, signOut, toast, unread, notifications, loadNotifications, markAllRead, connected,
  }), [me, ready, config, setMe, refreshMe, signOut, toast, unread, notifications, loadNotifications, markAllRead, connected]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'err' ? 'err' : ''}`}>
            <span className="grow">{t.text}</span>
            {t.href && <a href={t.href} onClick={(e) => { e.preventDefault(); navigate(t.href!); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action ?? 'Open'}</a>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Run an async action, surfacing its error as a toast. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e: any) {
      toast(e?.message ?? 'Something went wrong.', { tone: 'err' });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}

export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api<T>(path)); setError(null); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
