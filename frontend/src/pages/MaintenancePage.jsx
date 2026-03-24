import { useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

export default function MaintenancePage() {
  const [status, setStatus] = useState('');

  async function run(path) {
    const { response, data } = await fetchJsonSafe(path, { method: 'POST' });
    setStatus(response.ok ? JSON.stringify(data) : `Failed: ${data.error || response.status}`);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-xl font-semibold">Maintenance Suite</h2>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => run('/api/maintenance/sync')} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Force Build Sync</button>
          <button onClick={() => run('/api/maintenance/backup')} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white">Log Backup</button>
          <button
            onClick={() => {
              if (window.confirm('Type confirmation in your mind and click OK to NUKE the system.')) run('/api/maintenance/nuke');
            }}
            className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-medium text-white"
          >
            Nuke System
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-500 break-all">{status}</p>
      </div>
    </section>
  );
}
