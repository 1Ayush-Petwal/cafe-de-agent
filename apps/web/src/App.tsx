import { Navigate, NavLink, Route, Routes, Link } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { formatRupees } from './money';
import { OfflineBanner } from './OfflineBanner';
import { AgentChatPage } from './pages/AgentChatPage';
import { CafeAvailabilityPage } from './pages/CafeAvailabilityPage';
import { CafeListPage } from './pages/CafeListPage';
import { LoginPage } from './pages/LoginPage';
import { MandatePage } from './pages/MandatePage';
import { MyReservationsPage } from './pages/MyReservationsPage';
import { OwnerDashboardPage } from './pages/OwnerDashboardPage';
import { SignupPage } from './pages/SignupPage';
import { ThemeToggle } from './theme/ThemeToggle';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function RequireOwner({ children }: { children: JSX.Element }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return user?.role === 'owner' ? children : <Navigate to="/cafes" replace />;
}

export function App() {
  const { isAuthenticated, user, logout } = useAuth();

  return (
    <div className="app">
      <OfflineBanner />
      <nav>
        <Link to="/cafes" className="nav-brand">
          Café De
        </Link>
        <div className="nav-links">
          <NavLink to="/cafes">Cafés</NavLink>
          {isAuthenticated ? (
            <>
              {user?.role === 'owner' ? (
                <NavLink to="/owner">Owner dashboard</NavLink>
              ) : (
                <>
                  <NavLink to="/reservations">My reservations</NavLink>
                  <NavLink to="/agent">Booking agent</NavLink>
                  <NavLink to="/mandate">Agent mandate</NavLink>
                </>
              )}
              <span className="user-email">{user?.email}</span>
              <span className="wallet-balance">{user ? formatRupees(user.walletBalance) : ''}</span>
              <button onClick={logout}>Log out</button>
            </>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <NavLink to="/signup">Sign up</NavLink>
            </>
          )}
          <ThemeToggle />
        </div>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/cafes" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/cafes" element={<CafeListPage />} />
          <Route path="/cafes/:cafeId" element={<CafeAvailabilityPage />} />
          <Route
            path="/reservations"
            element={
              <RequireAuth>
                <MyReservationsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/agent"
            element={
              <RequireAuth>
                <AgentChatPage />
              </RequireAuth>
            }
          />
          <Route
            path="/mandate"
            element={
              <RequireAuth>
                <MandatePage />
              </RequireAuth>
            }
          />
          <Route
            path="/owner"
            element={
              <RequireOwner>
                <OwnerDashboardPage />
              </RequireOwner>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
