import { useEffect, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

export default function RequestsPage() {
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { response, data } = await fetchJsonSafe('/api/requests');
      if (response.ok) setRequests(data.requests || []);
      setIsLoading(false);
    })();
  }, []);

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
      <h2 className="mb-4 text-xl font-semibold">Request Log</h2>
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
