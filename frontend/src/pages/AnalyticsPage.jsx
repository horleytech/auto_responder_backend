import { useEffect, useMemo, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

function todayDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function AnalyticsPage({ dateRange: externalDateRange, onDateRangeChange, onCustomerSelect, onRecordsClick, onDeviceSelect }) {
  const today = todayDateInputValue();
  const [internalDateRange, setInternalDateRange] = useState({ start: today, end: today });
  const dateRange = externalDateRange || internalDateRange;
  const setDateRange = onDateRangeChange || setInternalDateRange;
  const [data, setData] = useState({ devices: [], customers: [] });
  const [requestSummary, setRequestSummary] = useState({ total: 0, matchedTotal: 0, byStatus: {}, byHour: {}, byDevice: {}, bySender: {} });
  const [recordsSummary, setRecordsSummary] = useState({ rowCount: 0, lastSyncedAt: 0 });
  const [status, setStatus] = useState('');

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams();
      if (dateRange.start) params.set('start', dateRange.start);
      if (dateRange.end) params.set('end', dateRange.end);

      const [analyticsResponse, requestsResponse, recordsSourceResponse] = await Promise.all([
        fetchJsonSafe(`/api/clean-analytics?${params.toString()}`),
        fetchJsonSafe(`/api/requests?${params.toString()}`),
        fetchJsonSafe('/api/online-customers-source'),
      ]);

      if (!analyticsResponse.response.ok) {
        setStatus(`Analytics API unavailable (${analyticsResponse.response.status}). ${analyticsResponse.data?.error || 'Check if server is running and Firebase is configured.'}`);
        setData({ devices: [], customers: [] });
        setRequestSummary({ total: 0, matchedTotal: 0, byStatus: {}, byHour: {}, byDevice: {}, bySender: {} });
        return;
      }

      const devices = Array.isArray(analyticsResponse.data?.devices) ? analyticsResponse.data.devices : [];
      const customersFromAnalytics = Array.isArray(analyticsResponse.data?.customers) ? analyticsResponse.data.customers : [];
      const summary = requestsResponse.response.ok
        ? normalizeSummary(requestsResponse.data?.summary)
        : { total: 0, matchedTotal: 0, byStatus: {}, byHour: {}, byDevice: {}, bySender: {} };
      const customers = customersFromAnalytics.length
        ? customersFromAnalytics
        : Object.entries(summary.bySender || {})
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .slice(0, 5)
          .map(([senderId, totalRequests]) => ({ senderId, totalRequests }));

      if (recordsSourceResponse.response.ok) {
        setRecordsSummary({
          rowCount: Number(recordsSourceResponse.data?.rowCount || 0),
          lastSyncedAt: Number(recordsSourceResponse.data?.lastSyncedAt || 0),
        });
      }

      setStatus('');
      setData({ devices, customers });
      setRequestSummary(summary);
    })();
  }, [dateRange.start, dateRange.end]);
  const recordsLastSyncedLabel = useMemo(() => {
    if (!recordsSummary.lastSyncedAt) return 'Not synced';
    return new Date(recordsSummary.lastSyncedAt).toLocaleString();
  }, [recordsSummary.lastSyncedAt]);

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Analytics Dashboard</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Showing data for the selected day range.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
        </div>
      </div>

      {status && <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{status}</p>}

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="Records (CSV rows)"
          value={recordsSummary.rowCount || 0}
          onClick={() => onRecordsClick?.()}
        />
        <SummaryCard label="Total Requests" value={requestSummary.total} />
        <SummaryCard label="Matched Requests" value={requestSummary.matchedTotal} />
        <SummaryCard label="Matched Devices" value={Object.keys(requestSummary.byDevice || {}).length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PieChartCard title="Request Status Distribution" data={requestSummary.byStatus} />
        <HourlyBarChart title="Matched Requests by Hour" data={requestSummary.byHour} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Records Last Sync" value={recordsLastSyncedLabel} />
        <SummaryCard label="Replied Matches" value={requestSummary.byStatus.replied || 0} />
        <SummaryCard label="Unmatched / Other Requests" value={Math.max(requestSummary.total - requestSummary.matchedTotal, 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PieChartCard title="Top Matched Devices Distribution" data={requestSummary.byDevice} />
        <Leaderboard
          title="Top 10 Most Requested Devices"
          rows={data.devices.map((d) => ({ key: d.deviceName || 'Unknown', count: d.requestCount || 0 }))}
          onRowClick={(row) => onDeviceSelect?.(row.key)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-1">
        <Leaderboard
          title="Top 5 Customers / Vendors"
          rows={data.customers.map((c) => ({ key: c.senderId || 'Unknown', count: c.totalRequests || 0 }))}
          onRowClick={(row) => onCustomerSelect?.(row.key)}
        />
      </div>
    </section>
  );
}

function normalizeSummary(summary) {
  const byStatus = typeof summary?.byStatus === 'object' && summary?.byStatus ? summary.byStatus : {};
  const replied = Number(byStatus.replied || 0);
  const matchedNoReply = Number(byStatus.matched_no_reply || 0);
  return {
    total: Number(summary?.total || 0),
    matchedTotal: replied + matchedNoReply,
    byStatus,
    byHour: typeof summary?.byHour === 'object' && summary?.byHour ? summary.byHour : {},
    byDevice: typeof summary?.byDevice === 'object' && summary?.byDevice ? summary.byDevice : {},
    bySender: typeof summary?.bySender === 'object' && summary?.bySender ? summary.bySender : {},
  };
}

function SummaryCard({ label, value, onClick }) {
  const isClickable = typeof onClick === 'function';
  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!isClickable) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={`rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 ${isClickable ? 'cursor-pointer transition hover:border-indigo-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500' : ''}`}
    >
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 break-words text-3xl font-bold">{typeof value === 'number' ? Number(value || 0) : value}</p>
    </div>
  );
}

function PieChartCard({ title, data }) {
  const entries = Object.entries(data || {}).filter(([, value]) => Number(value) > 0);
  const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
  const colors = ['#4f46e5', '#f97316', '#0ea5e9', '#10b981', '#a855f7'];
  let offset = 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      {!total && <p className="text-sm text-slate-500">No request-status data yet.</p>}
      {!!total && (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <svg width="180" height="180" viewBox="0 0 120 120" className="shrink-0">
            {entries.map(([key, value], index) => {
              const percentage = Number(value) / total;
              const length = percentage * 314.159;
              const dashArray = `${length} ${314.159 - length}`;
              const segment = (
                <circle
                  key={key}
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  stroke={colors[index % colors.length]}
                  strokeWidth="20"
                  strokeDasharray={dashArray}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 60 60)"
                />
              );
              offset += length;
              return segment;
            })}
          </svg>
          <div className="w-full space-y-2">
            {entries.map(([key, value], index) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                  <span>{key.replace(/_/g, ' ')}</span>
                </div>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HourlyBarChart({ title, data }) {
  const rows = Object.entries(data || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12);
  const max = rows.reduce((m, [, count]) => Math.max(m, Number(count) || 0), 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      {!rows.length && <p className="text-sm text-slate-500">No hourly data yet.</p>}
      {!!rows.length && (
        <div className="space-y-3">
          {rows.map(([hour, count]) => {
            const value = Number(count) || 0;
            const width = max > 0 ? `${Math.max((value / max) * 100, 4)}%` : '0%';
            return (
              <div key={hour}>
                <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                  <span>{hour.replace('T', ' ')}</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{value}</span>
                </div>
                <div className="h-2 rounded bg-slate-200 dark:bg-slate-800">
                  <div className="h-2 rounded bg-indigo-500" style={{ width }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Leaderboard({ title, rows, onRowClick }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-lg font-semibold">{title}</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => onRowClick?.(row)}
            className="flex w-full items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-left text-sm transition hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
          >
            <span>{row.key}</span>
            <span className="font-semibold">{row.count}</span>
          </button>
        ))}
        {!rows.length && <p className="text-sm text-slate-500">No data yet.</p>}
      </div>
    </div>
  );
}
