import { useMemo, useState } from 'react';
import PasswordField from '../components/PasswordField';
import { fetchJsonSafe } from '../lib/api';

export default function SettingsPage({ apiKey, setApiKey, providerState, setProviderState, catalogState, setCatalogState, envKeysLoaded }) {
  const [status, setStatus] = useState('');

  const authHeaders = useMemo(() => {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey.trim()) headers['x-api-key'] = apiKey.trim();
    return headers;
  }, [apiKey]);

  async function saveProvider() {
    const { response, data } = await fetchJsonSafe('/api/providers', {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ provider: providerState.activeProvider }),
    });
    setStatus(response.ok ? `Saved provider: ${data.activeProvider}` : `Provider save failed (${response.status})`);
  }

  async function saveCatalog() {
    const { response } = await fetchJsonSafe('/api/catalog-source', {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ inventoryCsvUrl: catalogState.inventoryCsvUrl, arrangementCsvUrl: catalogState.arrangementCsvUrl }),
    });
    setStatus(response.ok ? 'Catalog sources updated.' : `Catalog save failed (${response.status})`);
  }

  async function saveApiFallback() {
    const { response } = await fetchJsonSafe('/api/settings', {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ apiKey }),
    });
    setStatus(response.ok ? 'API key fallback saved to Firebase settings.' : `API key save failed (${response.status})`);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-premium dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-2 text-xl font-semibold">API Security</h2>
        <p className="mb-4 text-sm text-slate-500">Keys are loaded from environment by default. Input fields are optional fallbacks/overrides.</p>
        <div className="mb-4 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
          <div>API_KEY: <strong>{envKeysLoaded.API_KEY ? 'Loaded from Environment' : 'Fallback Needed'}</strong></div>
          <div>OPENAI_API_KEY: <strong>{envKeysLoaded.OPENAI_API_KEY ? 'Loaded from Environment' : 'Fallback Needed'}</strong></div>
          <div>QWEN_API_KEY: <strong>{envKeysLoaded.QWEN_API_KEY ? 'Loaded from Environment' : 'Fallback Needed'}</strong></div>
        </div>
        <PasswordField label="API_KEY fallback" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <button onClick={saveApiFallback} className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Save API Key Fallback</button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-xl font-semibold">Runtime Configuration</h2>
        <div className="grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Active Provider</span>
            <select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" value={providerState.activeProvider} onChange={(e) => setProviderState((p) => ({ ...p, activeProvider: e.target.value }))}>
              {providerState.providers.map((provider) => <option key={provider.name} value={provider.name}>{provider.name}</option>)}
            </select>
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Inventory CSV URL</span>
            <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" value={catalogState.inventoryCsvUrl} onChange={(e) => setCatalogState((p) => ({ ...p, inventoryCsvUrl: e.target.value }))} />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Arrangement Map CSV URL</span>
            <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" value={catalogState.arrangementCsvUrl} onChange={(e) => setCatalogState((p) => ({ ...p, arrangementCsvUrl: e.target.value }))} />
          </label>
          <div className="flex gap-3">
            <button onClick={saveProvider} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Save Provider</button>
            <button onClick={saveCatalog} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white dark:bg-slate-700">Save Catalog Sources</button>
          </div>
          <p className="text-sm text-slate-500">{status}</p>
        </div>
      </div>
    </section>
  );
}
