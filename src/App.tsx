import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { TradesPage } from './features/trades/TradesPage';
import { TradeForm } from './features/trades/TradeForm';
import { TradeDetail } from './features/trades/TradeDetail';
import { AnalyticsPage } from './features/analytics/AnalyticsPage';
import { JournalPage } from './features/journal/JournalPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { GlossaryPage } from './features/settings/GlossaryPage';
import { initializeSeedData } from './db';
import { useAppStore } from './stores/appStore';

function App() {
  const { setDbInitialized } = useAppStore();

  useEffect(() => {
    // Initialize database with seed data on first load
    initializeSeedData()
      .then(() => {
        setDbInitialized(true);
      })
      .catch((error) => {
        console.error('Failed to initialize database:', error);
      });
  }, [setDbInitialized]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="trades" element={<TradesPage />} />
          <Route path="trades/new" element={<TradeForm />} />
          <Route path="trades/:id" element={<TradeDetail />} />
          <Route path="trades/:id/edit" element={<TradeForm />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="journal" element={<JournalPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/glossary" element={<GlossaryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
