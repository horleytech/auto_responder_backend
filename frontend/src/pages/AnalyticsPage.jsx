import { useEffect, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

const timeframeOptions = [
  { label: '1 Week', value: '1w' },
  { label: '1 Month', value: '1m' },
  { label: 'All Time', value: 'all' },
];

export default function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState('1m');
  const [data, setData] = useState({ devices: [], customers: [] });

  useEffect(() => {
    (async () => {
      const { response, data: payload } = await fetchJsonSafe(`/api/clean-analytics?timeframe=${timeframe}`);
      if (response.ok) setData(payload);
    })();
  }, [timeframe]);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-xl font-semibold">Analytics Dashboard</h2>
        <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
          {timeframeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Leaderboard title="Top 10 Most Requested Devices" rows={data.devices.map((d) => ({ key: d.deviceName, count: d.requestCount }))} />
        <Leaderboard title="Top 5 Customers / Vendors" rows={data.customers.map((c) => ({ key: c.senderId, count: c.totalRequests }))} />
      </div>
    </section>
  );
}

function Leaderboard({ title, rows }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-lg font-semibold">{title}</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
            <span>{row.key}</span>
            <span className="font-semibold">{row.count}</span>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-500">No data yet.</p>}
      </div>
    </div>
  );
}
