import { useEffect, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

export default function AutoCorrectPage() {
  const [rows, setRows] = useState([]);
  const [csvMappings, setCsvMappings] = useState([]);
  const [learnedMappings, setLearnedMappings] = useState([]);
  const [manualMappings, setManualMappings] = useState([]);
  const [mergedMappings, setMergedMappings] = useState([]);
  const [catalogDevices, setCatalogDevices] = useState([]);
  const [activeProductGroups, setActiveProductGroups] = useState([]);
  const [inactiveProductGroups, setInactiveProductGroups] = useState([]);
  const [seenOutsideCatalog, setSeenOutsideCatalog] = useState([]);
  const [lastLoadedAt, setLastLoadedAt] = useState(0);
  const [slang, setSlang] = useState('');
  const [normalizedName, setNormalizedName] = useState('');
  const [editingId, setEditingId] = useState('');
  const [status, setStatus] = useState('');

  const normalizedOptions = Array.from(new Set([
    ...catalogDevices,
    ...seenOutsideCatalog.map((row) => row.normalizedName).filter(Boolean),
    ...mergedMappings.map((row) => row.normalizedName).filter(Boolean),
  ])).sort((a, b) => a.localeCompare(b));

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
    setLearnedMappings(data.learnedMappings || []);
    setManualMappings(data.manualMappings || []);
    setMergedMappings(data.mergedMappings || []);
    setCatalogDevices(data.catalogDevices || []);
    setActiveProductGroups(data.activeProductGroups || []);
    setInactiveProductGroups(data.inactiveProductGroups || []);
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

  async function nukeInactiveMappings() {
    const confirmed = window.confirm('This will permanently clear all inactive mappings. Continue?');
    if (!confirmed) return;
    const { response } = await fetchJsonSafe('/api/catalog-mappings/inactive/nuke', { method: 'POST' });
    if (!response.ok) {
      setStatus('Failed to clear inactive mappings.');
      return;
    }
    await loadCatalogMappings();
    setStatus('Inactive mappings cleared.');
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
          Add mapping aliases here. Pick an existing product from active mappings (or type a new one) and it will be added as an extra mapping.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={slang} onChange={(e) => setSlang(e.target.value)} placeholder="alias/customer wording e.g. 15 pm" className="rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
          <>
            <input
              list="normalized-product-options"
              value={normalizedName}
              onChange={(e) => setNormalizedName(e.target.value)}
              placeholder="choose or type product mapping"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
            />
            <datalist id="normalized-product-options">
              {normalizedOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </>
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
          Active mappings (from CSV): {csvMappings.length} • Learned mappings (CSV + Auto + Manual): {mergedMappings.length} (Manual/Auto add-ons: {manualMappings.length}) • catalog products: {catalogDevices.length}
          {lastLoadedAt ? ` • last sync: ${new Date(lastLoadedAt).toLocaleString()}` : ''}
        </p>

        {!!manualMappings.length && (
          <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300">
            Manual mappings are additive: they are kept as extra mappings and do not overwrite CSV aliases.
          </p>
        )}

        <details className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 shadow-sm dark:border-indigo-800/50 dark:bg-indigo-950/30" open>
          <summary className="cursor-pointer rounded-lg px-1 py-1 text-base font-semibold transition hover:bg-indigo-100 dark:hover:bg-indigo-900/30">
            Active Mappings ({activeProductGroups.length} products)
          </summary>
          <div className="mt-3 space-y-2">
            {activeProductGroups.map((group) => (
              <details key={group.product} className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900" open>
                <summary className="cursor-pointer rounded-md px-2 py-2 font-medium transition hover:bg-slate-100 dark:hover:bg-slate-800">
                  {group.product} <span className="text-xs text-slate-500">({group.aliases.length} matches)</span>
                </summary>
                <div className="mt-2 grid gap-1 px-2 pb-1 text-sm">
                  {group.aliases.map((alias) => (
                    <div key={`${group.product}-${alias}`} className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {alias}
                    </div>
                  ))}
                </div>
              </details>
            ))}
            {!activeProductGroups.length && (
              <p className="rounded-lg bg-white px-3 py-2 text-sm text-slate-500 dark:bg-slate-900">No active products in CSV yet.</p>
            )}
          </div>
        </details>

        <details className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-sm dark:border-amber-800/40 dark:bg-amber-950/20" open>
          <summary className="cursor-pointer rounded-lg px-1 py-1 text-base font-semibold transition hover:bg-amber-100 dark:hover:bg-amber-900/30">
            Inactive Mappings ({inactiveProductGroups.length} products)
          </summary>
          <div className="mt-2 flex items-center justify-end">
            <button
              type="button"
              onClick={nukeInactiveMappings}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700"
            >
              Nuke All Inactive
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {inactiveProductGroups.map((group) => (
              <details key={`inactive-${group.product}`} className="rounded-lg border border-amber-200 bg-white p-2 dark:border-amber-700/40 dark:bg-slate-900" open>
                <summary className="cursor-pointer rounded-md px-2 py-2 font-medium transition hover:bg-amber-100 dark:hover:bg-amber-900/20">
                  {group.product} <span className="text-xs text-slate-500">({group.aliases.length} saved mappings)</span>
                </summary>
                <div className="mt-2 grid gap-1 px-2 pb-1 text-sm">
                  {group.aliases.map((alias) => (
                    <div key={`inactive-${group.product}-${alias}`} className="rounded-md bg-amber-100 px-2 py-1 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                      {alias}
                    </div>
                  ))}
                </div>
              </details>
            ))}
            {!inactiveProductGroups.length && (
              <p className="rounded-lg bg-white px-3 py-2 text-sm text-slate-500 dark:bg-slate-900">No inactive products archived yet.</p>
            )}
          </div>
        </details>

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
