const providerSelect = document.getElementById('provider');
const providerStatus = document.getElementById('providerStatus');
const catalogStatus = document.getElementById('catalogStatus');
const requestBody = document.getElementById('requestBody');
const groupedBody = document.getElementById('groupedBody');
const csvUrlInput = document.getElementById('csvUrl');
const apiKeyInput = document.getElementById('apiKey');
const persistenceMode = document.getElementById('persistenceMode');

function esc(text) {
  return String(text || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function authHeaders() {
  const key = apiKeyInput.value.trim();
  return key ? { 'Content-Type': 'application/json', 'x-api-key': key } : { 'Content-Type': 'application/json' };
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

async function loadProviders() {
  providerStatus.textContent = 'Loading providers...';
  const { response, data } = await fetchJsonSafe('/api/providers');
  if (!response.ok) {
    providerStatus.textContent = `Failed to load providers (${response.status})`;
    return;
  }

  providerSelect.innerHTML = (data.providers || [])
    .map((p) => {
      const mark = p.configured ? '✅' : '⚠️';
      const selected = p.name === data.activeProvider ? 'selected' : '';
      return `<option value="${p.name}" ${selected}>${mark} ${p.name} · ${p.model}</option>`;
    })
    .join('');

  providerStatus.textContent = `Current: ${data.activeProvider}`;
  persistenceMode.textContent = `Storage: ${data.persistence || 'memory'}`;
}

async function saveProvider() {
  providerStatus.textContent = 'Saving provider...';
  const { response, data } = await fetchJsonSafe('/api/providers', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ provider: providerSelect.value }),
  });

  if (!response.ok) {
    providerStatus.textContent = `Save failed (${response.status}): ${data.error || data.raw || 'Unknown error'}`;
    return;
  }

  providerStatus.textContent = `Saved: ${data.activeProvider}`;
  await loadProviders();
}

async function loadCatalogSource() {
  const { response, data } = await fetchJsonSafe('/api/catalog-source');
  if (!response.ok) {
    catalogStatus.textContent = `Catalog load failed (${response.status})`;
    return;
  }

  csvUrlInput.value = data.csvUrl || '';
  catalogStatus.textContent = `Catalog: ${data.newCount || 0} new, ${data.usedCount || 0} used`;
  persistenceMode.textContent = `Storage: ${data.persistence || 'memory'}`;
}

async function saveCatalogSource() {
  catalogStatus.textContent = 'Saving CSV URL + reloading...';
  const { response, data } = await fetchJsonSafe('/api/catalog-source', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ csvUrl: csvUrlInput.value.trim() }),
  });

  if (!response.ok) {
    catalogStatus.textContent = `Save failed (${response.status}): ${data.error || data.raw || 'Unknown error'}`;
    return;
  }

  catalogStatus.textContent = `Reloaded: ${data.newCount || 0} new, ${data.usedCount || 0} used`;
  persistenceMode.textContent = `Storage: ${data.persistence || 'memory'}`;
}

async function reloadCatalog() {
  catalogStatus.textContent = 'Reloading catalog...';
  const { response, data } = await fetchJsonSafe('/api/reload-catalog', {
    method: 'POST',
    headers: authHeaders(),
  });

  if (!response.ok) {
    catalogStatus.textContent = `Reload failed (${response.status}): ${data.error || data.raw || 'Unknown error'}`;
    return;
  }

  catalogStatus.textContent = `Reloaded: ${data.newCount || 0} new, ${data.usedCount || 0} used`;
  persistenceMode.textContent = `Storage: ${data.persistence || 'memory'}`;
  await loadCatalogSource();
}

async function loadRequests() {
  const { response, data } = await fetchJsonSafe('/api/requests');
  if (!response.ok) return;

  requestBody.innerHTML = (data.requests || [])
    .map((r) => `
      <tr>
        <td>${esc(new Date(r.time).toLocaleString())}</td>
        <td>${esc(r.provider)}</td>
        <td>${esc(r.status)}</td>
        <td>${esc(r.senderMessage)}</td>
        <td>${esc(r.matchedDevice)}</td>
        <td>${esc(r.error)}</td>
      </tr>
    `)
    .join('');

  persistenceMode.textContent = `Storage: ${data.persistence || 'memory'}`;
}

async function loadGrouped() {
  const { response, data } = await fetchJsonSafe('/api/grouped-requests');
  if (!response.ok) return;

  groupedBody.innerHTML = (data.grouped || [])
    .map((g, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(g.sampleMessage || g.key)}</td>
        <td>${esc(g.count)}</td>
        <td>${esc(g.lastSeen ? new Date(g.lastSeen).toLocaleString() : '')}</td>
      </tr>
    `)
    .join('');

  persistenceMode.textContent = `Storage: ${data.persistence || 'memory'}`;
}

document.getElementById('saveProvider').addEventListener('click', saveProvider);
document.getElementById('saveCsv').addEventListener('click', saveCatalogSource);
document.getElementById('reloadCatalog').addEventListener('click', reloadCatalog);
document.getElementById('refreshRequests').addEventListener('click', loadRequests);
document.getElementById('refreshGrouped').addEventListener('click', loadGrouped);

loadProviders();
loadCatalogSource();
loadRequests();
loadGrouped();
setInterval(() => {
  loadRequests();
  loadGrouped();
}, 7000);
