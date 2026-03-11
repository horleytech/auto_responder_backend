import { useCallback, useEffect, useMemo, useState } from 'react';

function esc(value) {
  return value || '';
}

async function fetchJsonSafe(url, options) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }

  return { response, data };
}

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [providers, setProviders] = useState([]);
  const [activeProvider, setActiveProvider] = useState('');
  const [providerStatus, setProviderStatus] = useState('');
  const [csvUrl, setCsvUrl] = useState('');
  const [catalogStatus, setCatalogStatus] = useState('');
  const [requests, setRequests] = useState([]);
  const [groupedRequests, setGroupedRequests] = useState([]);
  const [persistence, setPersistence] = useState('memory');

  const authHeaders = useMemo(() => {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey.trim()) headers['x-api-key'] = apiKey.trim();
    return headers;
  }, [apiKey]);

  const loadProviders = useCallback(async () => {
    setProviderStatus('Loading providers...');
    const { response, data } = await fetchJsonSafe('/api/providers');
    if (!response.ok) {
      setProviderStatus(`Failed to load providers (${response.status})`);
      return;
    }

    setProviders(data.providers || []);
    setActiveProvider(data.activeProvider || '');
    setPersistence(data.persistence || 'memory');
    setProviderStatus(`Current: ${data.activeProvider || 'unknown'}`);
  }, []);

  const saveProvider = useCallback(async () => {
    setProviderStatus('Saving provider...');
    const { response, data } = await fetchJsonSafe('/api/providers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ provider: activeProvider }),
    });

    if (!response.ok) {
      setProviderStatus(`Save failed (${response.status}): ${data.error || data.raw || 'Unknown error'}`);
      return;
    }

    setProviderStatus(`Saved: ${data.activeProvider}`);
    await loadProviders();
  }, [activeProvider, authHeaders, loadProviders]);

  const loadCatalogSource = useCallback(async () => {
    const { response, data } = await fetchJsonSafe('/api/catalog-source');
    if (!response.ok) {
      setCatalogStatus(`Catalog load failed (${response.status})`);
      return;
    }

    setCsvUrl(data.csvUrl || '');
    setCatalogStatus(`Catalog: ${data.newCount || 0} new, ${data.usedCount || 0} used`);
    setPersistence(data.persistence || 'memory');
  }, []);

  const saveCatalogSource = useCallback(async () => {
    setCatalogStatus('Saving CSV URL + reloading...');
    const { response, data } = await fetchJsonSafe('/api/catalog-source', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ csvUrl: csvUrl.trim() }),
    });

    if (!response.ok) {
      setCatalogStatus(`Save failed (${response.status}): ${data.error || data.raw || 'Unknown error'}`);
      return;
    }

    setCatalogStatus(`Reloaded: ${data.newCount || 0} new, ${data.usedCount || 0} used`);
    setPersistence(data.persistence || 'memory');
  }, [authHeaders, csvUrl]);

  const reloadCatalog = useCallback(async () => {
    setCatalogStatus('Reloading catalog...');
    const { response, data } = await fetchJsonSafe('/api/reload-catalog', {
      method: 'POST',
      headers: authHeaders,
    });

    if (!response.ok) {
      setCatalogStatus(`Reload failed (${response.status}): ${data.error || data.raw || 'Unknown error'}`);
      return;
    }

    setCatalogStatus(`Reloaded: ${data.newCount || 0} new, ${data.usedCount || 0} used`);
    setPersistence(data.persistence || 'memory');
    await loadCatalogSource();
  }, [authHeaders, loadCatalogSource]);

  const loadRequests = useCallback(async () => {
    const { response, data } = await fetchJsonSafe('/api/requests');
    if (!response.ok) return;

    setRequests(data.requests || []);
    setPersistence(data.persistence || 'memory');
  }, []);

  const loadGroupedRequests = useCallback(async () => {
    const { response, data } = await fetchJsonSafe('/api/grouped-requests');
    if (!response.ok) return;

    setGroupedRequests(data.grouped || []);
    setPersistence(data.persistence || 'memory');
  }, []);

  useEffect(() => {
    loadProviders();
    loadCatalogSource();
    loadRequests();
    loadGroupedRequests();
  }, [loadProviders, loadCatalogSource, loadRequests, loadGroupedRequests]);

  useEffect(() => {
    const id = setInterval(() => {
      loadRequests();
      loadGroupedRequests();
    }, 7000);

    return () => clearInterval(id);
  }, [loadRequests, loadGroupedRequests]);

  return (
    <main className="page">
      <section className="row page-header">
        <h1>Market Request Dashboard</h1>
        <a className="home-link" href="https://scrapebot.horleytech.com/hub">Home</a>
      </section>

      <section className="card row">
        <label htmlFor="apiKey">Admin API Key:</label>
        <input
          id="apiKey"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="x-api-key for save/reload actions"
        />
        <span className="hint">Storage: {persistence}</span>
      </section>

      <section className="card row">
        <label htmlFor="provider">Active Provider:</label>
        <select id="provider" value={activeProvider} onChange={(event) => setActiveProvider(event.target.value)}>
          {providers.map((provider) => (
            <option key={provider.name} value={provider.name}>
              {provider.configured ? '✅' : '⚠️'} {provider.name} · {provider.model}
            </option>
          ))}
        </select>
        <button onClick={saveProvider}>Save Provider</button>
        <span className="hint">{providerStatus}</span>
      </section>

      <section className="card row">
        <label htmlFor="csvUrl">CSV URL:</label>
        <input
          id="csvUrl"
          type="text"
          value={csvUrl}
          onChange={(event) => setCsvUrl(event.target.value)}
          placeholder="https://.../export?format=csv"
        />
        <button onClick={saveCatalogSource}>Save + Reload Catalog</button>
        <button onClick={reloadCatalog}>Reload Catalog</button>
        <span className="hint">{catalogStatus}</span>
      </section>

      <section className="card">
        <div className="row card-header">
          <strong>Grouped Requests (Most Frequent)</strong>
          <button onClick={loadGroupedRequests}>Refresh</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Rank</th><th>Request</th><th>Count</th><th>Last Seen</th></tr>
            </thead>
            <tbody>
              {groupedRequests.map((item, index) => (
                <tr key={`${item.key || item.sampleMessage}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{esc(item.sampleMessage || item.key)}</td>
                  <td>{esc(item.count)}</td>
                  <td>{item.lastSeen ? new Date(item.lastSeen).toLocaleString() : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="row card-header">
          <strong>All Incoming Requests</strong>
          <button onClick={loadRequests}>Refresh</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Time</th><th>Provider</th><th>Status</th><th>Sender Message</th><th>Matched Device</th><th>Error</th></tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id || `${request.time}-${request.senderMessage}`}>
                  <td>{request.time ? new Date(request.time).toLocaleString() : ''}</td>
                  <td>{esc(request.provider)}</td>
                  <td>{esc(request.status)}</td>
                  <td>{esc(request.senderMessage)}</td>
                  <td>{esc(request.matchedDevice)}</td>
                  <td>{esc(request.error)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
