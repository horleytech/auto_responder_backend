import { useEffect, useMemo, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

function todayDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function RequestsPage({
  dateRange: externalDateRange,
  onDateRangeChange,
  senderFocus,
  onSenderFocusConsumed,
  deviceFocus,
  onDeviceFocusConsumed,
}) {
  const today = todayDateInputValue();
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [internalDateRange, setInternalDateRange] = useState({ start: today, end: today });
  const dateRange = externalDateRange || internalDateRange;
  const setDateRange = onDateRangeChange || setInternalDateRange;
  const [expandedSenders, setExpandedSenders] = useState({});
  const [deviceFilter, setDeviceFilter] = useState('');

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (dateRange.start) params.set('start', dateRange.start);
      if (dateRange.end) params.set('end', dateRange.end);
      const query = params.toString();
      const { response, data } = await fetchJsonSafe(`/api/requests${query ? `?${query}` : ''}`);
      if (response.ok) setRequests(data.requests || []);
      setIsLoading(false);
    })();
  }, [dateRange.start, dateRange.end]);

  useEffect(() => {
    if (!senderFocus) return;
    setExpandedSenders((prev) => ({ ...prev, [senderFocus]: true }));
    setTimeout(() => {
      const target = document.getElementById(`sender-group-${senderFocus}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    onSenderFocusConsumed?.();
  }, [senderFocus, onSenderFocusConsumed]);

  useEffect(() => {
    if (!deviceFocus) return;
    setDeviceFilter(deviceFocus);
    onDeviceFocusConsumed?.();
  }, [deviceFocus, onDeviceFocusConsumed]);

  const availableDevices = useMemo(() => (
    Array.from(new Set(requests.map((request) => getMatchedDevice(request)).filter((device) => device && device !== '-')))
      .sort((a, b) => a.localeCompare(b))
  ), [requests]);

  const filteredRequests = useMemo(() => {
    if (!deviceFilter) return requests;
    return requests.filter((request) => requestMatchesDeviceFilter(request, deviceFilter));
  }, [requests, deviceFilter]);

  const groupedRequests = useMemo(() => {
    const map = new Map();
    filteredRequests.forEach((request) => {
      const sender = request.senderId || 'Unknown';
      const current = map.get(sender) || { sender, requests: [], matchedDevices: new Set(), statuses: {} };
      current.requests.push(request);
      const matched = getMatchedDevice(request);
      if (matched !== '-') current.matchedDevices.add(matched);
      const status = getStatus(request);
      current.statuses[status] = (current.statuses[status] || 0) + 1;
      map.set(sender, current);
    });
    return Array.from(map.values()).sort((a, b) => b.requests.length - a.requests.length);
  }, [filteredRequests]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Requests Log</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Grouped by sender for faster review.</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <input
            list="request-device-options"
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
            placeholder="Filter by matched device"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <datalist id="request-device-options">
            {availableDevices.map((device) => <option key={device} value={device} />)}
          </datalist>
          {!!deviceFilter && (
            <button
              type="button"
              onClick={() => setDeviceFilter('')}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
            >
              Clear Device Filter
            </button>
          )}
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Showing <strong>{filteredRequests.length}</strong> of <strong>{requests.length}</strong> request(s).
      </p>

      <div className="space-y-3">
        {groupedRequests.map((group) => {
          const isOpen = Boolean(expandedSenders[group.sender]);
          const isFocused = senderFocus && senderFocus === group.sender;

          return (
            <div
              id={`sender-group-${group.sender}`}
              key={group.sender}
              className={`rounded-xl border bg-slate-50 p-3 dark:bg-slate-800/40 ${isFocused ? 'border-indigo-500 shadow-[0_0_0_1px_rgba(99,102,241,0.4)]' : 'border-slate-200 dark:border-slate-700'}`}
            >
              <button
                type="button"
                onClick={() => setExpandedSenders((prev) => ({ ...prev, [group.sender]: !isOpen }))}
                className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
              >
                <div>
                  <p className="text-base font-semibold">{group.sender}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{group.requests.length} request(s)</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {Object.entries(group.statuses).map(([status, count]) => (
                    <span key={status} className="rounded-full bg-slate-200 px-2 py-1 dark:bg-slate-700">{status}: {count}</span>
                  ))}
                  {Array.from(group.matchedDevices).slice(0, 3).map((device) => (
                    <span key={device} className="rounded-full bg-indigo-100 px-2 py-1 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">{device}</span>
                  ))}
                  <span className="rounded-full border border-slate-300 px-2 py-1 dark:border-slate-600">{isOpen ? 'Hide' : 'View'}</span>
                </div>
              </button>

              {isOpen && (
                <div className="mt-3 overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="py-2">Time</th><th>Status</th><th>Message</th><th>Matched</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.requests.map((request) => (
                        <tr key={request.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                          <td className="py-2 pr-3 whitespace-nowrap">{getRequestTime(request)}</td>
                          <td className="pr-3 whitespace-nowrap">{getStatus(request)}</td>
                          <td className="pr-3 break-words">{request.senderMessage || '-'}</td>
                          <td className="whitespace-nowrap">{getMatchedDevice(request)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

        {!isLoading && groupedRequests.length === 0 && (
          <p className="py-4 text-sm text-slate-500 dark:text-slate-400">No requests logged yet for this date range.</p>
        )}
      </div>
    </section>
  );
}

function getRequestTime(request) {
  const value = request.time || request.timestamp || request.createdAt;
  if (!value) return '-';
  const millis = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(millis)) return '-';
  return new Date(millis).toLocaleString();
}

function getStatus(request) {
  if (typeof request.status === 'string' && request.status.trim()) return request.status;
  if (request.replied === true) return 'replied';
  if (request.aiDeviceMatch) return 'matched_no_reply';
  return 'no_match';
}

function getMatchedDevice(request) {
  return request.matchedDevice || request.aiDeviceMatch || '-';
}

function normalizeDeviceToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function requestMatchesDeviceFilter(request, filterText) {
  const normalizedFilter = normalizeDeviceToken(filterText);
  if (!normalizedFilter) return true;
  const candidates = [
    request.matchedDevice,
    request.aiDeviceMatch,
    request.device,
    request.senderMessage,
  ];
  return candidates.some((candidate) => normalizeDeviceToken(candidate).includes(normalizedFilter));
}
