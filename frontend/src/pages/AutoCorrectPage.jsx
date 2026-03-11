import { useEffect, useMemo, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

export default function AutoCorrectPage({ apiKey }) {
  const [rows, setRows] = useState([]);
  const [slang, setSlang] = useState('');
  const [normalizedName, setNormalizedName] = useState('');
  const [status, setStatus] = useState('');

  const headers = useMemo(() => {
    const h = { 'Content-Type': 'application/json' };
    if (apiKey.trim()) h['x-api-key'] = apiKey.trim();
    return h;
  }, [apiKey]);

  async function load() {
    const { response, data } = await fetchJsonSafe('/api/dictionary');
    if (!response.ok) return setStatus('Failed to load dictionary');
    setRows(data.dictionary || []);
  }

  async function save() {
    const { response, data } = await fetchJsonSafe('/api/dictionary', {
      method: 'POST',
      headers,
      body: JSON.stringify({ slang, normalizedName }),
    });
    if (!response.ok) return setStatus(data.error || 'Failed to save');
    setSlang('');
    setNormalizedName('');
    setStatus('Saved');
    await load();
  }

  async function remove(id) {
    await fetchJsonSafe(`/api/dictionary/${id}`, { method: 'DELETE', headers });
    await load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-xl font-semibold">Auto Correct Dictionary</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={slang} onChange={(e) => setSlang(e.target.value)} placeholder="slang e.g. 15 pm" className="rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
          <input value={normalizedName} onChange={(e) => setNormalizedName(e.target.value)} placeholder="normalized e.g. iPhone 15 Pro Max" className="rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
        </div>
        <button onClick={save} className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Add / Update Mapping</button>
        <p className="mt-2 text-sm text-slate-500">{status}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-lg font-semibold">Current Mappings</h3>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
              <span>{row.slang} → {row.normalizedName}</span>
              <button onClick={() => remove(row.id)} className="rounded-lg bg-rose-600 px-3 py-1 text-xs text-white">Delete</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
