import { useEffect, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

export default function SettingsPage({ providerState, setProviderState, catalogState, setCatalogState, onNavigate }) {
  const [status, setStatus] = useState('');
  const [showNukeModal, setShowNukeModal] = useState(false);
  const [showClearLogsModal, setShowClearLogsModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [onlineSource, setOnlineSource] = useState({ onlineCustomersSpreadsheetUrl: '', onlineCustomersSheetNamesText: '' });
  const [replySettings, setReplySettings] = useState({
    enablePriceReply: false,
    enableLinkReply: false,
    generalProductLinkOverride: '',
  });

  useEffect(() => {
    (async () => {
      const { response, data } = await fetchJsonSafe('/api/online-customers-source');
      if (!response.ok) return;
      setOnlineSource({
        onlineCustomersSpreadsheetUrl: data.onlineCustomersSpreadsheetUrl || '',
        onlineCustomersSheetNamesText: Array.isArray(data.onlineCustomersSheetNames) ? data.onlineCustomersSheetNames.join(', ') : '',
      });
    })();
    (async () => {
      const { response, data } = await fetchJsonSafe('/api/settings');
      if (!response.ok) return;
      setReplySettings({
        enablePriceReply: Boolean(data.enablePriceReply),
        enableLinkReply: Boolean(data.enableLinkReply),
        generalProductLinkOverride: data.generalProductLinkOverride || '',
      });
    })();
  }, []);

  async function saveProvider() {
    const { response, data } = await fetchJsonSafe('/api/providers', {
      method: 'POST', body: JSON.stringify({ provider: providerState.activeProvider }),
    });
    if (response.ok) return setStatus(`Saved provider: ${data.activeProvider}`);
    if (response.status === 403) return setStatus('Provider save failed (403). Your admin session expired — log in again.');
    return setStatus(`Provider save failed (${response.status})`);
  }

  async function saveCatalog() {
    const { response } = await fetchJsonSafe('/api/catalog-source', {
      method: 'POST',
      body: JSON.stringify({ inventoryCsvUrl: catalogState.inventoryCsvUrl, arrangementCsvUrl: catalogState.arrangementCsvUrl }),
    });
    if (response.ok) return setStatus('Catalog sources updated.');
    if (response.status === 403) return setStatus('Catalog save failed (403). Your admin session expired — log in again.');
    return setStatus(`Catalog save failed (${response.status})`);
  }

  async function saveOnlineSource() {
    const payload = {
      onlineCustomersSpreadsheetUrl: onlineSource.onlineCustomersSpreadsheetUrl,
      onlineCustomersSheetNames: onlineSource.onlineCustomersSheetNamesText.split(',').map((item) => item.trim()).filter(Boolean),
    };
    const { response, data } = await fetchJsonSafe('/api/online-customers-source', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (response.ok) return setStatus(`Online source saved (${data.rowCount || 0} rows synced).`);
    if (response.status === 403) return setStatus('Online source save failed (403). Your admin session expired — log in again.');
    return setStatus(`Online source save failed (${response.status}): ${data?.error || 'Unknown error'}`);
  }

  async function saveReplySettings() {
    const { response, data } = await fetchJsonSafe('/api/settings', {
      method: 'POST',
      body: JSON.stringify(replySettings),
    });
    if (response.ok) return setStatus('Reply settings saved.');
    if (response.status === 403) return setStatus('Reply settings save failed (403). Your admin session expired — log in again.');
    return setStatus(`Reply settings save failed (${response.status}): ${data?.error || 'Unknown error'}`);
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

  async function clearRequestLogs() {
    if (clearConfirmText !== 'CLEAR') {
      setStatus('Type CLEAR exactly to confirm request-log deletion.');
      return;
    }

    const { response, data } = await fetchJsonSafe('/api/requests/clear', { method: 'POST' });
    if (response.ok) {
      setStatus(`Request logs cleared. Deleted ${data.deleted || 0} records (${data.mode || 'unknown'}).`);
    } else {
      setStatus(`Request log clear failed (${response.status}): ${data.error || 'Unknown error'}`);
    }

    setShowClearLogsModal(false);
    setClearConfirmText('');
  }

  return (
    <section className="space-y-6">
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
            <button type="button" onClick={saveProvider} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Save Provider</button>
            <button type="button" onClick={saveCatalog} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white dark:bg-slate-700">Save Catalog Sources</button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-xl font-semibold">Online Customers Source</h2>
        <div className="grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Online Google Sheet URL</span>
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              value={onlineSource.onlineCustomersSpreadsheetUrl}
              onChange={(e) => setOnlineSource((prev) => ({ ...prev, onlineCustomersSpreadsheetUrl: e.target.value }))}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Sheet Tabs (optional)</span>
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              value={onlineSource.onlineCustomersSheetNamesText}
              onChange={(e) => setOnlineSource((prev) => ({ ...prev, onlineCustomersSheetNamesText: e.target.value }))}
              placeholder="Records (Responses), iPhones, Laptop"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={saveOnlineSource} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Save & Sync Online Source</button>
            <button type="button" onClick={() => onNavigate?.('online-customers')} className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">Open Online Customers Page</button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-xl font-semibold">Reply Settings</h2>
        <div className="grid gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={replySettings.enablePriceReply}
              onChange={(e) => setReplySettings((prev) => ({ ...prev, enablePriceReply: e.target.checked }))}
            />
            Include matched price in auto-replies
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={replySettings.enableLinkReply}
              onChange={(e) => setReplySettings((prev) => ({ ...prev, enableLinkReply: e.target.checked }))}
            />
            Include product link in auto-replies
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">General link override (optional)</span>
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              value={replySettings.generalProductLinkOverride}
              onChange={(e) => setReplySettings((prev) => ({ ...prev, generalProductLinkOverride: e.target.value }))}
              placeholder="https://your-general-link.example.com"
            />
            <span className="text-xs text-slate-500">When set, this link is used instead of CSV link for all matched replies.</span>
          </label>
          <div>
            <button type="button" onClick={saveReplySettings} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Save Reply Settings</button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-xl font-semibold">Maintenance Controls</h2>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => runMaintenance('/api/maintenance/sync')} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Force Build</button>
          <button type="button" onClick={() => runMaintenance('/api/maintenance/backup')} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white">Log Backup</button>
          <button type="button" onClick={() => setShowClearLogsModal(true)} className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white">Clear Request Log</button>
          <button type="button" onClick={() => setShowNukeModal(true)} className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-medium text-white">Nuke System</button>
        </div>
      </div>

      {showClearLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 dark:bg-slate-900">
            <h3 className="text-lg font-semibold">Clear Request Log</h3>
            <p className="mt-2 text-sm text-slate-500">Type <strong>CLEAR</strong> below to delete all request-log records from Firebase.</p>
            <input
              className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              value={clearConfirmText}
              onChange={(e) => setClearConfirmText(e.target.value)}
              placeholder="Type CLEAR"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowClearLogsModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">Cancel</button>
              <button type="button" onClick={clearRequestLogs} className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white">Clear Logs</button>
            </div>
          </div>
        </div>
      )}

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
              <button type="button" onClick={() => setShowNukeModal(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">Cancel</button>
              <button type="button" onClick={confirmNuke} className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-medium text-white">Confirm Nuke</button>
            </div>
          </div>
        </div>
      )}

      <p className="text-sm text-slate-500">{status}</p>
    </section>
  );
}
