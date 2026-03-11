import { useEffect, useMemo, useState } from 'react';
import { fetchJsonSafe } from '../lib/api';

function toLines(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function fromLines(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function BotLogicPage({ apiKey }) {
  const [forbiddenNewText, setForbiddenNewText] = useState('');
  const [forbiddenUsedText, setForbiddenUsedText] = useState('');
  const [responsesText, setResponsesText] = useState('');
  const [status, setStatus] = useState('');

  const authHeaders = useMemo(() => {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey.trim()) headers['x-api-key'] = apiKey.trim();
    return headers;
  }, [apiKey]);

  async function loadBotLogic() {
    const { response, data } = await fetchJsonSafe('/api/bot-logic');
    if (!response.ok) {
      setStatus(`Failed to load bot logic (${response.status})`);
      return;
    }

    setForbiddenNewText(toLines(data.forbiddenNewPhrases));
    setForbiddenUsedText(toLines(data.forbiddenUsedPhrases));
    setResponsesText(toLines(data.dynamicResponses));
    setStatus('Bot logic loaded.');
  }

  async function saveBotLogic() {
    setStatus('Saving bot logic...');
    const payload = {
      forbiddenNewPhrases: fromLines(forbiddenNewText),
      forbiddenUsedPhrases: fromLines(forbiddenUsedText),
      dynamicResponses: fromLines(responsesText),
    };

    const { response, data } = await fetchJsonSafe('/api/bot-logic', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setStatus(`Save failed (${response.status}): ${data.error || 'Unknown error'}`);
      return;
    }

    setStatus('Bot logic updated successfully.');
  }

  useEffect(() => {
    loadBotLogic();
  }, []);

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Bot Logic Manager</h2>
          <button onClick={loadBotLogic} className="rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">Reload</button>
        </div>

        <div className="grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Forbidden New (one phrase per line)</span>
            <textarea value={forbiddenNewText} onChange={(e) => setForbiddenNewText(e.target.value)} rows={8} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Forbidden Used (one phrase per line)</span>
            <textarea value={forbiddenUsedText} onChange={(e) => setForbiddenUsedText(e.target.value)} rows={8} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium">Dynamic Responses (one response per line)</span>
            <textarea value={responsesText} onChange={(e) => setResponsesText(e.target.value)} rows={10} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </label>

          <div className="flex gap-3">
            <button onClick={saveBotLogic} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Save Bot Logic</button>
          </div>

          <p className="text-sm text-slate-500">{status}</p>
        </div>
      </div>
    </section>
  );
}
