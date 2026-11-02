import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import PageHeader from '../components/PageHeader';

export default function LeaderboardPage() {
  const { api, me } = useAuth();
  const [players, setPlayers] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/leaderboard').then(setPlayers).catch((err) => setError(err.message));
  }, [api]);

  const top = players ? Math.max(...players.map((p) => p.rating)) : 0;

  return (
    <div className="page">
      <PageHeader title="Leaderboard" />
      <Alert kind="error">{error}</Alert>
      {players && (
        <section className="panel">
          <div className="table-wrap">
            <table className="leaderboard">
              <thead>
                <tr><th>Rank</th><th>Player</th><th>Rating</th><th>Wins</th><th>Losses</th><th>Draws</th><th>Win streak</th></tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.playerId} className={p.playerId === me.player.playerId ? 'current-row' : ''}>
                    <td><span className={`rank rank-${p.rank}`}>{p.rank}</span></td>
                    <td>
                      <div className="lb-player">
                        <strong>{p.username}</strong>
                        <span className="muted mono">{p.playerId}</span>
                      </div>
                    </td>
                    <td>
                      <div className="lb-rating">
                        <strong>{p.rating}</strong>
                        <div className="bar"><div style={{ width: `${top ? (p.rating / top) * 100 : 0}%` }} /></div>
                      </div>
                    </td>
                    <td>{p.wins}</td>
                    <td>{p.losses}</td>
                    <td>{p.draws}</td>
                    <td>{p.winStreak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
