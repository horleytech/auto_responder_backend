import { useEffect, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

export default function RequestsPage() {
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams();
      if (dateRange.start) params.set('start', dateRange.start);
      if (dateRange.end) params.set('end', dateRange.end);
      const query = params.toString();
      const { response, data } = await fetchJsonSafe(`/api/requests${query ? `?${query}` : ''}`);
      if (response.ok) setRequests(data.requests || []);
      setIsLoading(false);
    })();
  }, [dateRange.start, dateRange.end]);

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

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Request Log</h2>
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
        </div>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">Time</th><th>Sender</th><th>Status</th><th>Message</th><th>Matched</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2">{getRequestTime(request)}</td>
                <td>{request.senderId || '-'}</td>
                <td>{getStatus(request)}</td>
                <td>{request.senderMessage || '-'}</td>
                <td>{getMatchedDevice(request)}</td>
              </tr>
            ))}
            {!isLoading && requests.length === 0 && (
              <tr>
                <td className="py-4 text-slate-500 dark:text-slate-400" colSpan={5}>
                  No requests logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
