import { useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

export default function SettingsPage({ providerState, setProviderState, catalogState, setCatalogState, envKeysLoaded }) {
  const [status, setStatus] = useState('');
  const [showNukeModal, setShowNukeModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  async function saveProvider() {
    const { response, data } = await fetchJsonSafe('/api/providers', {
      method: 'POST', body: JSON.stringify({ provider: providerState.activeProvider }),
    });
    setStatus(response.ok ? `Saved provider: ${data.activeProvider}` : `Provider save failed (${response.status})`);
  }

  async function saveCatalog() {
    const { response } = await fetchJsonSafe('/api/catalog-source', {
      method: 'POST',
      body: JSON.stringify({ inventoryCsvUrl: catalogState.inventoryCsvUrl, arrangementCsvUrl: catalogState.arrangementCsvUrl }),
    });
    setStatus(response.ok ? 'Catalog sources updated.' : `Catalog save failed (${response.status})`);
  }

  async function runMaintenance(path) {
    const { response, data } = await fetchJsonSafe(path, { method: 'POST' });
    setStatus(response.ok ? `${path} success` : `${path} failed: ${data.error || response.status}`);
  }

  async function confirmNuke() {
    if (confirmText !== 'NUKE') {
      setStatus('Type NUKE exactly to confirm.');
      return;
    }
    await runMaintenance('/api/maintenance/nuke');
    setShowNukeModal(false);
    setConfirmText('');
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-premium dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-2 text-xl font-semibold">API Security</h2>
        <p className="mb-4 text-sm text-slate-500">Keys are loaded from backend environment only. Dashboard auth now uses secure session cookies.</p>
        <div className="mb-4 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
          <div>API_KEY: <strong>{envKeysLoaded.API_KEY ? 'Loaded from Environment' : 'Fallback Needed'}</strong></div>
          <div>OPENAI_API_KEY: <strong>{envKeysLoaded.OPENAI_API_KEY ? 'Loaded from Environment' : 'Fallback Needed'}</strong></div>
          <div>QWEN_API_KEY: <strong>{envKeysLoaded.QWEN_API_KEY ? 'Loaded from Environment' : 'Fallback Needed'}</strong></div>
        </div>
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
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-xl font-semibold">Maintenance Controls</h2>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => runMaintenance('/api/maintenance/sync')} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Force Build</button>
          <button onClick={() => runMaintenance('/api/maintenance/backup')} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white">Log Backup</button>
          <button onClick={() => setShowNukeModal(true)} className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-medium text-white">Nuke System</button>
        </div>
      </div>

      {showNukeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 dark:bg-slate-900">
            <h3 className="text-lg font-semibold">Strict Confirmation Required</h3>
            <p className="mt-2 text-sm text-slate-500">Type <strong>NUKE</strong> below to permanently clear raw logs and reset analytics counters.</p>
            <input
              className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type NUKE"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowNukeModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">Cancel</button>
              <button onClick={confirmNuke} className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-medium text-white">Confirm Nuke</button>
            </div>
          </div>
        </div>
      )}

      <p className="text-sm text-slate-500">{status}</p>
    </section>
  );
}
