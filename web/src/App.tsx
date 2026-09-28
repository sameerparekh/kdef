import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { PlayPage } from './pages/PlayPage';
import { QuizPage } from './pages/QuizPage';
import { StatsPage } from './pages/StatsPage';
import { SummaryPage } from './pages/SummaryPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/players/:playerId/play" element={<PlayPage />} />
        <Route path="/players/:playerId/stats" element={<StatsPage />} />
        <Route path="/rounds/:roundId" element={<QuizPage />} />
        <Route path="/rounds/:roundId/summary" element={<SummaryPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
      </Route>
    </Routes>
  );
}
