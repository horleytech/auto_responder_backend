import { useEffect, useMemo, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

const initialState = {
  onlineCustomersSpreadsheetUrl: '',
  onlineCustomersSheetNames: [],
  rowCount: 0,
  sheetsScanned: [],
  lastSyncedAt: 0,
  error: '',
};

function todayDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function OnlineCustomersPage({ dateRange: externalDateRange, onDateRangeChange }) {
  const today = todayDateInputValue();
  const [internalDateRange, setInternalDateRange] = useState({ start: '', end: '' });
  const dateRange = externalDateRange || internalDateRange;
  const setDateRange = onDateRangeChange || setInternalDateRange;
  const [source, setSource] = useState(initialState);
  const [onlineCustomers, setOnlineCustomers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [sheetNamesInput, setSheetNamesInput] = useState('');
  const [excludedSheetNamesInput, setExcludedSheetNamesInput] = useState('');
  const [filters, setFilters] = useState({ sheet: '', customer: '', device: '' });

  async function loadSource() {
    const { response, data } = await fetchJsonSafe('/api/online-customers-source');
    if (!response.ok) return;
    setSource((prev) => ({ ...prev, ...data }));
    setSheetNamesInput(Array.isArray(data.onlineCustomersSheetNames) ? data.onlineCustomersSheetNames.join(', ') : '');
    setExcludedSheetNamesInput(Array.isArray(data.onlineCustomersExcludedSheetNames) ? data.onlineCustomersExcludedSheetNames.join(', ') : '');
  }

  async function loadCustomers() {
    setIsLoading(true);
    setMessage('');
    const params = new URLSearchParams();
    if (dateRange.start) params.set('start', dateRange.start);
    if (dateRange.end) params.set('end', dateRange.end);
    const { response, data } = await fetchJsonSafe(`/api/online-customers?${params.toString()}`);
    if (response.ok) {
      setOnlineCustomers(Array.isArray(data.onlineCustomers) ? data.onlineCustomers : []);
    } else {
      setMessage(data?.error || 'Failed to load online customers.');
    }
    setIsLoading(false);
  }

  useEffect(() => {
    loadSource();
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [dateRange.start, dateRange.end]);

  const availableSheets = useMemo(
    () => Array.from(new Set(onlineCustomers.map((row) => row.sheet).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [onlineCustomers],
  );

  const filteredCustomers = useMemo(() => {
    const normalizedSheet = filters.sheet.trim().toLowerCase();
    const normalizedCustomer = filters.customer.trim().toLowerCase();
    const normalizedDevice = filters.device.trim().toLowerCase();
    return onlineCustomers.filter((row) => {
      const rowSheet = String(row.sheet || '').toLowerCase();
      const rowCustomer = String(row.customerName || '').toLowerCase();
      const rowDevice = String(row.device || '').toLowerCase();
      if (normalizedSheet && rowSheet !== normalizedSheet) return false;
      if (normalizedCustomer && !rowCustomer.includes(normalizedCustomer)) return false;
      if (normalizedDevice && !rowDevice.includes(normalizedDevice)) return false;
      return true;
    });
  }, [onlineCustomers, filters.sheet, filters.customer, filters.device]);

  const topDevices = useMemo(() => rankRows(filteredCustomers, (row) => row.device || 'Unknown'), [filteredCustomers]);
  const topCustomers = useMemo(() => rankRows(filteredCustomers, (row) => row.customerName || 'Unknown'), [filteredCustomers]);
  const topSheets = useMemo(() => rankRows(filteredCustomers, (row) => row.sheet || 'Unknown'), [filteredCustomers]);
  const filteredRecordsWithTimestamp = useMemo(
    () => filteredCustomers.filter((row) => Number.isFinite(Number(row.timestamp))).length,
    [filteredCustomers],
  );

  async function saveSource(event) {
    event.preventDefault();
    setIsSaving(true);
    setMessage('');
    const { response, data } = await fetchJsonSafe('/api/online-customers-source', {
      method: 'POST',
      body: JSON.stringify({
        onlineCustomersSpreadsheetUrl: source.onlineCustomersSpreadsheetUrl,
        onlineCustomersSheetNames: sheetNamesInput.split(',').map((item) => item.trim()).filter(Boolean),
        onlineCustomersExcludedSheetNames: excludedSheetNamesInput.split(',').map((item) => item.trim()).filter(Boolean),
      }),
    });
    if (response.ok) {
      setMessage(`Records synced: ${data.rowCount || 0} row(s).`);
      await Promise.all([loadSource(), loadCustomers()]);
    } else {
      setMessage(data?.error || 'Failed to save spreadsheet URL.');
    }
    setIsSaving(false);
  }

  async function refreshCustomers() {
    setIsSaving(true);
    setMessage('');
    const { response, data } = await fetchJsonSafe('/api/online-customers/refresh', { method: 'POST', body: '{}' });
    if (response.ok) {
      setMessage(`Records refreshed: ${data.rowCount || 0} row(s).`);
      await Promise.all([loadSource(), loadCustomers()]);
    } else {
      setMessage(data?.error || 'Failed to refresh online buyers.');
    }
    setIsSaving(false);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-xl font-semibold">Records</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Read all sheet tabs and normalize customer/device records from your CSV source.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="date"
            value={dateRange.start}
            onChange={(event) => setDateRange((prev) => ({ ...prev, start: event.target.value }))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <input
            type="date"
            value={dateRange.end}
            onChange={(event) => setDateRange((prev) => ({ ...prev, end: event.target.value }))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="button"
            onClick={() => setDateRange({ start: today, end: today })}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setDateRange({ start: '', end: '' })}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
          >
            All
          </button>
        </div>

        <form className="mt-4 space-y-3" onSubmit={saveSource}>
          <label className="block text-sm font-medium">Google Sheet URL</label>
          <input
            value={source.onlineCustomersSpreadsheetUrl}
            onChange={(event) => setSource((prev) => ({ ...prev, onlineCustomersSpreadsheetUrl: event.target.value }))}
            placeholder="https://docs.google.com/spreadsheets/d/.../edit"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <div className="flex flex-wrap gap-2">
            <button disabled={isSaving} type="submit" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{isSaving ? 'Saving...' : 'Save & Sync'}</button>
            <button disabled={isSaving} type="button" onClick={refreshCustomers} className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">Refresh</button>
          </div>
          <label className="block text-sm font-medium pt-1">Sheet tabs to read (optional, comma-separated)</label>
          <input
            value={sheetNamesInput}
            onChange={(event) => setSheetNamesInput(event.target.value)}
            placeholder="Records (Responses), iPhones, Laptop"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <label className="block text-sm font-medium pt-1">Sheet tabs to exclude (optional, comma-separated)</label>
          <input
            value={excludedSheetNamesInput}
            onChange={(event) => setExcludedSheetNamesInput(event.target.value)}
            placeholder="Archive, Testing, Duplicate"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <button disabled={isSaving} type="submit" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {isSaving ? 'Saving...' : 'Save Exclusions & Sync'}
            </button>
          </div>
        </form>

        {message && <p className="mt-3 text-sm text-indigo-600 dark:text-indigo-300">{message}</p>}
        {!!source.error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">Last sync error: {source.error}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Total Records" value={filteredCustomers.length} />
        <SummaryCard label="Records With Timestamp" value={filteredRecordsWithTimestamp} />
        <SummaryCard label="Records Missing Timestamp" value={Math.max(filteredCustomers.length - filteredRecordsWithTimestamp, 0)} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-lg font-semibold">Record Filters</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-slate-500">Sheet</span>
            <select
              value={filters.sheet}
              onChange={(event) => setFilters((prev) => ({ ...prev, sheet: event.target.value }))}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">All sheets</option>
              {availableSheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-500">Customer</span>
            <input
              value={filters.customer}
              onChange={(event) => setFilters((prev) => ({ ...prev, customer: event.target.value }))}
              placeholder="Search customer"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-500">Device</span>
            <input
              value={filters.device}
              onChange={(event) => setFilters((prev) => ({ ...prev, device: event.target.value }))}
              placeholder="Search device"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setFilters({ sheet: '', customer: '', device: '' })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
            >
              Clear filters
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Leaderboard
          title="Top Devices"
          rows={topDevices}
          onRowClick={(row) => setFilters((prev) => ({ ...prev, device: row.key }))}
        />
        <Leaderboard
          title="Top Customers"
          rows={topCustomers}
          onRowClick={(row) => setFilters((prev) => ({ ...prev, customer: row.key }))}
        />
        <Leaderboard
          title="Top Sheets"
          rows={topSheets}
          onRowClick={(row) => setFilters((prev) => ({ ...prev, sheet: row.key }))}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <p>Sheets scanned: <strong>{source.sheetsScanned?.length || 0}</strong></p>
        <p>Last synced: <strong>{source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : 'Not synced yet'}</strong></p>
      </div>

      <SimpleTable
        title={`Records (${filteredCustomers.length})`}
        rows={filteredCustomers}
        emptyLabel={isLoading ? 'Loading records...' : 'No records loaded yet.'}
        extraColumns={(row) => (
          <>
            <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">{row.timestamp ? new Date(row.timestamp).toLocaleString() : row.rawTimestamp || '-'}</td>
            <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">{row.customerPhone || '-'}</td>
            <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">{row.sheet || '-'}</td>
            <td className="px-2 py-2 text-xs text-slate-500 max-w-xl">
              {row.extraDetailsText
                ? <span className="whitespace-normal break-words">{row.extraDetailsText}</span>
                : '-'}
            </td>
          </>
        )}
        extraHeader={(
          <>
            <th className="px-2 py-2">Timestamp</th>
            <th className="px-2 py-2">Phone</th>
            <th className="px-2 py-2">Sheet</th>
            <th className="px-2 py-2">Extra Details</th>
          </>
        )}
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-2 text-lg font-semibold">Detected Sheet Headings</h3>
        <div className="space-y-2 text-sm">
          {source.sheetsScanned?.map((sheet) => (
            <div key={`${sheet.gid}-${sheet.title}`} className="rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
              <p className="font-medium">{sheet.title}</p>
              <p className="text-slate-500">Header row: {sheet.headerRowNumber || 1}</p>
              <p className="text-slate-500">Timestamp: {sheet.matchedTimestampColumn || 'Not found'}</p>
              <p className="text-slate-500">Buyer Column: {sheet.matchedBuyerColumn || 'Not found'} | Device Column: {sheet.matchedDeviceColumn || 'Not found'}</p>
              <p className="text-slate-500">Customer Phone: {sheet.matchedCustomerPhoneColumn || 'Not found'}</p>
            </div>
          ))}
          {!source.sheetsScanned?.length && <p className="text-slate-500">No sheet metadata yet.</p>}
        </div>
      </div>
    </section>
  );
}

function rankRows(rows, getter, limit = 10) {
  const map = new Map();
  rows.forEach((row) => {
    const key = String(getter(row) || 'Unknown').trim() || 'Unknown';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 break-words text-2xl font-bold">{value}</p>
    </div>
  );
}

function SimpleTable({ title, rows, emptyLabel, extraColumns, extraHeader }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="rounded-xl border border-slate-300 px-3 py-1 text-xs dark:border-slate-700"
        >
          {isOpen ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {!isOpen && <p className="text-sm text-slate-500">Records table is collapsed.</p>}
      {isOpen && !rows.length && <p className="text-sm text-slate-500">{emptyLabel}</p>}
      {isOpen && !!rows.length && (
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="px-2 py-2">Customer</th>
                <th className="px-2 py-2">Device</th>
                {extraHeader}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id || `${row.customerName}-${row.device}`} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-2">{row.customerName || '-'}</td>
                  <td className="px-2 py-2">{row.device || '-'}</td>
                  {extraColumns?.(row)}
                </tr>
              ))}
            </tbody>
          </table>
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
            <span className="truncate pr-2">{row.key}</span>
            <span className="font-semibold">{row.count}</span>
          </button>
        ))}
        {!rows.length && <p className="text-sm text-slate-500">No data yet.</p>}
      </div>
    </div>
  );
}
