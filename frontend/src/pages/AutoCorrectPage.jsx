import { useEffect, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

export default function AutoCorrectPage() {
  const [rows, setRows] = useState([]);
  const [csvMappings, setCsvMappings] = useState([]);
  const [manualMappings, setManualMappings] = useState([]);
  const [mergedMappings, setMergedMappings] = useState([]);
  const [catalogDevices, setCatalogDevices] = useState([]);
  const [removedFromCsv, setRemovedFromCsv] = useState([]);
  const [seenOutsideCatalog, setSeenOutsideCatalog] = useState([]);
  const [lastLoadedAt, setLastLoadedAt] = useState(0);
  const [slang, setSlang] = useState('');
  const [normalizedName, setNormalizedName] = useState('');
  const [editingId, setEditingId] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    const { response, data } = await fetchJsonSafe('/api/dictionary');
    if (!response.ok) return setStatus(response.status === 403 ? 'Session expired. Please log in again.' : `Failed to load dictionary (${response.status})`);
    const nextRows = data.dictionary || [];
    setRows(nextRows);
    setStatus(nextRows.length ? `Loaded ${nextRows.length} mapping(s).` : 'No mappings saved yet.');
  }

  async function loadCatalogMappings() {
    const { response, data } = await fetchJsonSafe('/api/catalog-mappings');
    if (!response.ok) return;
    setCsvMappings(data.csvMappings || []);
    setManualMappings(data.manualMappings || []);
    setMergedMappings(data.mergedMappings || []);
    setCatalogDevices(data.catalogDevices || []);
    setRemovedFromCsv(data.removedFromCsv || []);
    setSeenOutsideCatalog(data.seenOutsideCatalog || []);
    setLastLoadedAt(Number(data.lastLoadedAt || 0));
  }

  async function refreshCatalog() {
    const { response, data } = await fetchJsonSafe('/api/catalog-refresh', { method: 'POST' });
    if (!response.ok) {
      setStatus(`Catalog refresh failed (${response.status}): ${data.error || 'Unknown error'}`);
      return;
    }
    await loadCatalogMappings();
    setStatus(`Catalog refreshed. ${data.newCount || 0} new, ${data.usedCount || 0} used, ${data.arrangementCount || 0} mappings.`);
  }

  function startEdit(row) {
    setEditingId(row.id);
    setSlang(row.slang || '');
    setNormalizedName(row.normalizedName || '');
  }

  function resetForm() {
    setEditingId('');
    setSlang('');
    setNormalizedName('');
  }

  async function save() {
    const payload = { slang, normalizedName };
    const { response, data } = await fetchJsonSafe('/api/dictionary', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) return setStatus(response.status === 403 ? 'Session expired. Please log in again.' : (data.error || 'Failed to save'));
    setStatus(editingId ? 'Mapping updated.' : 'Mapping added.');
    resetForm();
    await load();
  }

  async function remove(id) {
    await fetchJsonSafe(`/api/dictionary/${id}`, { method: 'DELETE' });
    if (editingId === id) resetForm();
    await load();
  }

  useEffect(() => {
    load();
    loadCatalogMappings();

    const timer = setInterval(() => {
      loadCatalogMappings();
    }, 120000);

    return () => clearInterval(timer);
  }, []);

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-xl font-semibold">Auto Correct Dictionary</h2>
        <p className="mb-4 text-sm text-slate-500">
          This dictionary is primarily auto-learned by the bot from real requests. Use this form only when you want to override or pre-seed a mapping.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={slang} onChange={(e) => setSlang(e.target.value)} placeholder="slang e.g. 15 pm" className="rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
          <input value={normalizedName} onChange={(e) => setNormalizedName(e.target.value)} placeholder="normalized e.g. iPhone 15 Pro Max" className="rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={save} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">{editingId ? 'Save Edit' : 'Add Mapping'}</button>
          {editingId && <button type="button" onClick={resetForm} className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">Cancel Edit</button>}
        </div>
        <p className="mt-2 text-sm text-slate-500">{status}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Current Mappings</h3>
          <button type="button" onClick={refreshCatalog} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-medium text-white">Refresh CSV Now</button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Total active mappings: {mergedMappings.length} (CSV: {csvMappings.length}, Manual add-ons: {manualMappings.length}) • catalog products: {catalogDevices.length}
          {lastLoadedAt ? ` • last sync: ${new Date(lastLoadedAt).toLocaleString()}` : ''}
        </p>

        {!!removedFromCsv.length && (
          <details className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-700/40 dark:bg-orange-950/20" open>
            <summary className="cursor-pointer text-sm font-medium">Previously in CSV, currently removed ({removedFromCsv.length})</summary>
            <p className="mt-1 text-xs text-orange-700 dark:text-orange-300">
              If any of these products return to the CSV, they will automatically move back into active CSV mappings.
            </p>
            <div className="mt-2 max-h-56 space-y-1 overflow-auto text-sm">
              {removedFromCsv.map((name) => <div key={name}>{name}</div>)}
            </div>
          </details>
        )}

        {!!manualMappings.length && (
          <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300">
            Manual mappings are additive: they are kept as extra mappings and do not overwrite CSV aliases.
          </p>
        )}

        {!!mergedMappings.length && (
          <details className="mb-4 rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/20" open>
            <summary className="cursor-pointer text-sm font-medium">Active Mappings (CSV + Manual) ({mergedMappings.length})</summary>
            <div className="mt-2 max-h-72 space-y-1 overflow-auto text-sm">
              {mergedMappings.map((row) => (
                <div key={`${row.source}-${row.alias}-${row.normalizedName}`}>
                  <span className="font-medium">[{row.source}]</span> {row.alias} → {row.normalizedName}
                </div>
              ))}
            </div>
          </details>
        )}

        {!!csvMappings.length && (
          <details className="mb-4 rounded-lg bg-slate-100 p-3 dark:bg-slate-800" open>
            <summary className="cursor-pointer text-sm font-medium">CSV Arrangement Mappings ({csvMappings.length})</summary>
            <div className="mt-2 max-h-72 space-y-1 overflow-auto text-sm">
              {csvMappings.map((row) => (
                <div key={`${row.alias}-${row.normalizedName}`}>{row.alias} → {row.normalizedName}</div>
              ))}
            </div>
          </details>
        )}

        {!!seenOutsideCatalog.length && (
          <details className="mb-4 rounded-lg bg-amber-50 p-3 dark:bg-amber-950/20" open>
            <summary className="cursor-pointer text-sm font-medium">Seen but not in CSV ({seenOutsideCatalog.length})</summary>
            <div className="mt-2 space-y-2 text-sm">
              {seenOutsideCatalog.map((row) => (
                <div key={row.normalizedName} className="rounded bg-white p-2 dark:bg-slate-900">
                  <div className="font-medium">{row.normalizedName}</div>
                  <div className="text-xs text-slate-500">source: {row.source}</div>
                  {!!row.aliases?.length && <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">examples: {row.aliases.join(' | ')}</div>}
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
              <span>{row.slang} → {row.normalizedName}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => startEdit(row)} className="rounded-lg bg-slate-700 px-3 py-1 text-xs text-white">Edit</button>
                <button type="button" onClick={() => remove(row.id)} className="rounded-lg bg-rose-600 px-3 py-1 text-xs text-white">Delete</button>
              </div>
            </div>
          ))}
          {!rows.length && <p className="text-sm text-slate-500">No mappings yet. Add one above and it will be saved to Firebase when configured.</p>}
        </div>
      </div>
    </section>
  );
}
