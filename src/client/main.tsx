import '@fontsource/lilita-one/latin-400.css';
import '@fontsource-variable/figtree';
import './styles.css';
import { StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { AppProvider, useApp } from './lib/app';
import Landing from './pages/Landing';
import { RecoverPage, SignInPage, SignUpPage } from './pages/Auth';

const Home = lazy(() => import('./pages/Home'));
const Games = lazy(() => import('./pages/Games'));
const GameDetail = lazy(() => import('./pages/GameDetail'));
const Match = lazy(() => import('./pages/Match'));
const Join = lazy(() => import('./pages/Join'));
const Tournaments = lazy(() => import('./pages/Tournaments'));
const TournamentNew = lazy(() => import('./pages/TournamentNew'));
const Tournament = lazy(() => import('./pages/Tournament'));
const Leaderboards = lazy(() => import('./pages/Leaderboards'));
const Profile = lazy(() => import('./pages/Profile'));
const Friends = lazy(() => import('./pages/Friends'));
const Settings = lazy(() => import('./pages/Settings'));
const Admin = lazy(() => import('./pages/Admin'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, ready } = useApp();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!me) return <Navigate to={`/signup?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function Root() {
  const { me, ready } = useApp();
  if (!ready) return <Loading />;
  return me ? <Navigate to="/home" replace /> : <Landing />;
}

function MeRedirect() {
  const { me } = useApp();
  return <Navigate to={`/u/${me!.username}`} replace />;
}

export function Loading() {
  return (
    <div className="page stack" aria-busy="true">
      <div className="skeleton" style={{ height: 48, width: '40%' }} />
      <div className="skeleton" style={{ height: 180 }} />
      <div className="skeleton" style={{ height: 120 }} />
    </div>
  );
}

function NotFound() {
  return (
    <div className="page stack center" style={{ alignItems: 'center', paddingTop: 80 }}>
      <h1>Off the board</h1>
      <p className="muted">That page doesn’t exist. It may have been a match that ended or a link that was mistyped.</p>
      <a className="btn btn-primary" href="/">Go home</a>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<Root />} />
              <Route path="/signup" element={<SignUpPage />} />
              <Route path="/signin" element={<SignInPage />} />
              <Route path="/recover" element={<RecoverPage />} />
              <Route path="/games" element={<Games />} />
              <Route path="/games/:id" element={<GameDetail />} />
              <Route path="/m/:id" element={<Match />} />
              <Route path="/join" element={<RequireAuth><Join /></RequireAuth>} />
              <Route path="/join/:code" element={<RequireAuth><Join /></RequireAuth>} />
              <Route path="/home" element={<RequireAuth><Home /></RequireAuth>} />
              <Route path="/tournaments" element={<Tournaments />} />
              <Route path="/tournaments/new" element={<RequireAuth><TournamentNew /></RequireAuth>} />
              <Route path="/t/:id" element={<Tournament />} />
              <Route path="/leaderboards" element={<Leaderboards />} />
              <Route path="/u/:username" element={<Profile />} />
              <Route path="/me" element={<RequireAuth><MeRedirect /></RequireAuth>} />
              <Route path="/friends" element={<RequireAuth><Friends /></RequireAuth>} />
              <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
              <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
