import { useEffect, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

export default function RequestsPage() {
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    (async () => {
      const { response, data } = await fetchJsonSafe('/api/requests');
      if (response.ok) setRequests(data.requests || []);
    })();
  }, []);

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
                <td className="py-2">{request.time ? new Date(request.time).toLocaleString() : ''}</td>
                <td>{request.senderId || '-'}</td>
                <td>{request.status}</td>
                <td>{request.senderMessage}</td>
                <td>{request.matchedDevice || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
