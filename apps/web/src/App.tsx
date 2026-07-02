import { Navigate, Route, Routes, Link } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { CafeAvailabilityPage } from './pages/CafeAvailabilityPage';
import { CafeListPage } from './pages/CafeListPage';
import { LoginPage } from './pages/LoginPage';
import { MyReservationsPage } from './pages/MyReservationsPage';
import { SignupPage } from './pages/SignupPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export function App() {
  const { isAuthenticated, user, logout } = useAuth();

  return (
    <div className="app">
      <nav>
        <Link to="/cafes">Café De App</Link>
        <div className="nav-links">
          <Link to="/cafes">Cafés</Link>
          {isAuthenticated ? (
            <>
              <Link to="/reservations">My reservations</Link>
              <span className="user-email">{user?.email}</span>
              <button onClick={logout}>Log out</button>
            </>
          ) : (
            <>
              <Link to="/login">Log in</Link>
              <Link to="/signup">Sign up</Link>
            </>
          )}
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
        </Routes>
      </main>
    </div>
  );
}
