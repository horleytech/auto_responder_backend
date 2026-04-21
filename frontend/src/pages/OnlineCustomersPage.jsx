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

export default function OnlineCustomersPage({ dateRange }) {
  const [source, setSource] = useState(initialState);
  const [onlineCustomers, setOnlineCustomers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [sheetNamesInput, setSheetNamesInput] = useState('');

  async function loadSource() {
    const { response, data } = await fetchJsonSafe('/api/online-customers-source');
    if (!response.ok) return;
    setSource((prev) => ({ ...prev, ...data }));
    setSheetNamesInput(Array.isArray(data.onlineCustomersSheetNames) ? data.onlineCustomersSheetNames.join(', ') : '');
  }

  async function loadCustomers() {
    setIsLoading(true);
    setMessage('');
    const params = new URLSearchParams();
    if (dateRange?.start) params.set('start', dateRange.start);
    if (dateRange?.end) params.set('end', dateRange.end);
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
  }, [dateRange?.start, dateRange?.end]);

  const recordsWithTimestamp = useMemo(
    () => onlineCustomers.filter((row) => Number.isFinite(Number(row.timestamp))).length,
    [onlineCustomers]
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
        </form>

        {message && <p className="mt-3 text-sm text-indigo-600 dark:text-indigo-300">{message}</p>}
        {!!source.error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">Last sync error: {source.error}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Total Records" value={onlineCustomers.length} />
        <SummaryCard label="Records With Timestamp" value={recordsWithTimestamp} />
        <SummaryCard label="Records Missing Timestamp" value={Math.max(onlineCustomers.length - recordsWithTimestamp, 0)} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <p>Sheets scanned: <strong>{source.sheetsScanned?.length || 0}</strong></p>
        <p>Last synced: <strong>{source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : 'Not synced yet'}</strong></p>
      </div>

      <SimpleTable
        title={`Records (${onlineCustomers.length})`}
        rows={onlineCustomers.slice(0, 300)}
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

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 break-words text-2xl font-bold">{value}</p>
    </div>
  );
}

function SimpleTable({ title, rows, emptyLabel, extraColumns, extraHeader }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-lg font-semibold">{title}</h3>
      {!rows.length && <p className="text-sm text-slate-500">{emptyLabel}</p>}
      {!!rows.length && (
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
