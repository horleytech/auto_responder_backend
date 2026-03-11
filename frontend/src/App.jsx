import { useEffect, useState } from 'react';
import DashboardLayout from './components/DashboardLayout';
import AnalyticsPage from './pages/AnalyticsPage';
import RequestsPage from './pages/RequestsPage';
import SettingsPage from './pages/SettingsPage';
import { fetchJsonSafe } from './lib/api';

export default function App() {
  const [activePage, setActivePage] = useState('analytics');
  const [darkMode, setDarkMode] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [providerState, setProviderState] = useState({ activeProvider: 'chatgpt', providers: [] });
  const [catalogState, setCatalogState] = useState({ inventoryCsvUrl: '', arrangementCsvUrl: '' });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    (async () => {
      const providersResult = await fetchJsonSafe('/api/providers');
      if (providersResult.response.ok) {
        setProviderState({
          activeProvider: providersResult.data.activeProvider,
          providers: providersResult.data.providers || [],
        });
      }

      const catalogResult = await fetchJsonSafe('/api/catalog-source');
      if (catalogResult.response.ok) {
        setCatalogState({
          inventoryCsvUrl: catalogResult.data.inventoryCsvUrl || '',
          arrangementCsvUrl: catalogResult.data.arrangementCsvUrl || '',
        });
      }
    })();
  }, []);

  return (
    <DashboardLayout activePage={activePage} onPageChange={setActivePage} darkMode={darkMode} onToggleTheme={() => setDarkMode((prev) => !prev)}>
      {activePage === 'analytics' && <AnalyticsPage />}
      {activePage === 'requests' && <RequestsPage />}
      {activePage === 'settings' && (
        <SettingsPage
          apiKey={apiKey}
          setApiKey={setApiKey}
          providerState={providerState}
          setProviderState={setProviderState}
          catalogState={catalogState}
          setCatalogState={setCatalogState}
        />
      )}
    </DashboardLayout>
  );
}
