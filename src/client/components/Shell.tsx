import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { describeNotification, useApp } from '../lib/app';
import { timeAgo } from '../lib/format';
import { Icons, Logo } from './art';
import { Avatar } from './ui';

export function Wordmark() {
  return <Link to="/" className="wordmark" aria-label="GamePact home"><Logo /><span>GamePact</span></Link>;
}

function Bell() {
  const { unread, notifications, markAllRead } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-ghost icon-btn bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}
        onClick={() => { setOpen((o) => !o); if (!open && unread) markAllRead(); }}>
        {Icons.bell}
        {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="card card-tight" style={{ position: 'absolute', right: 0, top: 54, width: 'min(360px, 92vw)', zIndex: 50, maxHeight: 420, overflow: 'auto' }}>
          {notifications.length === 0 ? <p className="muted small">Nothing yet. Invites, friend requests and tournament news will show up here.</p> : (
            <div className="list">
              {notifications.map((n) => {
                const d = describeNotification(n);
                return (
                  <Link key={n.id} to={d.href ?? '#'} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <span className="grow small">{d.text}</span>
                    <span className="tiny faint" style={{ whiteSpace: 'nowrap' }}>{timeAgo(n.createdAt)}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Shell() {
  const { me, connected } = useApp();
  const loc = useLocation();
  const inMatch = loc.pathname.startsWith('/m/');
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          {me && (
            <nav className="topnav" aria-label="Main">
              <NavLink to="/home">Home</NavLink>
              <NavLink to="/games">Games</NavLink>
              <NavLink to="/tournaments">Tournaments</NavLink>
              <NavLink to="/leaderboards">Leaderboards</NavLink>
              <NavLink to="/friends">Friends</NavLink>
            </nav>
          )}
          <div className="grow" />
          {me ? (
            <>
              <Bell />
              <Link to="/me" aria-label="Your profile"><Avatar user={me} size={38} /></Link>
            </>
          ) : (
            <div className="row">
              <Link className="btn btn-ghost btn-sm hide-sm" to="/signin">Sign in</Link>
              <Link className="btn btn-primary btn-sm" to="/signup">Pick a username</Link>
            </div>
          )}
        </div>
      </header>
      {me && !connected && <div className="banner" style={{ borderRadius: 0, textAlign: 'center' }}>Reconnecting to the game server…</div>}
      <main><Outlet /></main>
      {me && !inMatch && (
        <nav className="bottomnav" aria-label="Main">
          <NavLink to="/home">{Icons.home}Home</NavLink>
          <NavLink to="/games">{Icons.games}Games</NavLink>
          <NavLink to="/tournaments">{Icons.trophy}Tourneys</NavLink>
          <NavLink to="/leaderboards">{Icons.ranks}Ranks</NavLink>
          <NavLink to="/me">{Icons.user}You</NavLink>
        </nav>
      )}
    </>
  );
}
