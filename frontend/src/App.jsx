import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import BattlePage from './pages/BattlePage';
import DashboardPage from './pages/DashboardPage';
import DeckPage from './pages/DeckPage';
import FriendsPage from './pages/FriendsPage';
import LeaderboardPage from './pages/LeaderboardPage';
import LedgerPage from './pages/LedgerPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ShopPage from './pages/ShopPage';
import TradePage from './pages/TradePage';

function RequireLogin({ children }) {
  const { me, loading } = useAuth();
  if (loading && !me) return <p className="loading-screen">Loading...</p>;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireLogin><Layout /></RequireLogin>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/deck" element={<DeckPage />} />
        <Route path="/battle" element={<BattlePage />} />
        <Route path="/trade" element={<TradePage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/friends" element={<FriendsPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
