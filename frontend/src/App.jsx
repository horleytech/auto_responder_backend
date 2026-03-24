import { useEffect, useState } from 'react';
import DashboardLayout from './components/DashboardLayout';
import AnalyticsPage from './pages/AnalyticsPage';
import AutoCorrectPage from './pages/AutoCorrectPage';
import BotLogicPage from './pages/BotLogicPage';
import RequestsPage from './pages/RequestsPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import { fetchJsonSafe, saveDashboardToken } from './lib/api';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activePage, setActivePage] = useState('dashboard');
  const [darkMode, setDarkMode] = useState(true);
  const [providerState, setProviderState] = useState({ activeProvider: 'chatgpt', providers: [] });
  const [catalogState, setCatalogState] = useState({ inventoryCsvUrl: '', arrangementCsvUrl: '' });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    const onAuthExpired = () => setIsAuthenticated(false);
    window.addEventListener('dashboard-auth-expired', onAuthExpired);
    return () => window.removeEventListener('dashboard-auth-expired', onAuthExpired);
  }, []);

  // Fetch Dashboard data ONLY if logged in
  useEffect(() => {
    if (!isAuthenticated) return;

    (async () => {
      const providersResult = await fetchJsonSafe('/api/providers');
      if (providersResult.response?.ok) {
        setProviderState({
          activeProvider: providersResult.data.activeProvider,
          providers: providersResult.data.providers || [],
        });
      }

      const catalogResult = await fetchJsonSafe('/api/catalog-source');
      if (catalogResult.response?.ok) {
        setCatalogState({
          inventoryCsvUrl: catalogResult.data.inventoryCsvUrl || '',
          arrangementCsvUrl: catalogResult.data.arrangementCsvUrl || '',
        });
      }
    })();
  }, [isAuthenticated]);

  // THE LOCK SCREEN
  if (!isAuthenticated) {
    return <LoginPage onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <DashboardLayout activePage={activePage} onPageChange={setActivePage} darkMode={darkMode} onToggleTheme={() => setDarkMode((prev) => !prev)}>
      {(activePage === 'dashboard' || activePage === 'analytics') && <AnalyticsPage />}
      {activePage === 'requests' && <RequestsPage />}
      {activePage === 'dictionary' && <AutoCorrectPage />}
      {activePage === 'bot-logic' && <BotLogicPage />}
      {activePage === 'settings' && (
        <SettingsPage
          providerState={providerState}
          setProviderState={setProviderState}
          catalogState={catalogState}
          setCatalogState={setCatalogState}
        />
      )}
    </DashboardLayout>
  );
}
