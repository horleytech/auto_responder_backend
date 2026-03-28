const axios = require('axios');

function normalizeCsvUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return raw;

  const match = raw.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return raw;

  let gid = '';
  try {
    const parsed = new URL(raw);
    gid = parsed.searchParams.get('gid') || '';
  } catch {
    gid = '';
  }

  const gidQuery = gid ? `&gid=${gid}` : '';
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv${gidQuery}`;
}

function normalizeDeviceName(deviceType) {
  if (!deviceType) return null;
  return String(deviceType)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .trim();
}

function isUsedCondition(condition) {
  if (!condition) return false;
  const lower = String(condition).toLowerCase();
  return lower.includes('used') || lower.includes('grade a') || lower.includes('uk used');
}

function parseCsv(text) {
  const input = String(text ?? '');
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuotedField = false;
  let atCellStart = true;

  const pushCell = () => {
    currentRow.push(currentCell.trim());
    currentCell = '';
    atCellStart = true;
  };

  const pushRow = () => {
    if (currentRow.some((cell) => cell !== '')) {
      rows.push(currentRow);
    }
    currentRow = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const nextChar = input[i + 1];

    if (char === '"') {
      if (insideQuotedField) {
        if (nextChar === '"') {
          currentCell += '"';
          i += 1;
        } else {
          insideQuotedField = false;
        }
      } else if (atCellStart) {
        insideQuotedField = true;
      } else {
        currentCell += char;
      }
      continue;
    }

    if (char === ',' && !insideQuotedField) {
      pushCell();
      continue;
    }

    if ((char === '\n' || char === '\r') && !insideQuotedField) {
      if (char === '\r' && nextChar === '\n') i += 1;
      pushCell();
      pushRow();
      continue;
    }

    currentCell += char;
    atCellStart = false;
  }

  if (currentCell !== '' || currentRow.length > 0) {
    pushCell();
  }
  pushRow();

  return rows;
}

function createCatalogService(initialInventoryCsvUrl, initialArrangementCsvUrl) {
  let inventoryCsvUrl = initialInventoryCsvUrl;
  let arrangementCsvUrl = initialArrangementCsvUrl;
  let supportedNewDevices = [];
  let supportedUsedDevices = [];
  let legacyHistoricalDevices = [];
  let arrangementMap = {};
  let lastLoadedAt = 0;

  async function loadInventory() {
    const csvUrl = normalizeCsvUrl(inventoryCsvUrl);
    console.log(`📄 Loading inventory CSV from: ${csvUrl}`);
    const response = await axios.get(csvUrl);
    if (String(response.data || '').toLowerCase().includes('<html')) {
      throw new Error('Inventory URL returned HTML, not CSV. Use a Google Sheets CSV export URL.');
    }
    const rows = parseCsv(response.data);
    const headers = rows[0] || [];
    const deviceIndex = headers.indexOf('Device Type');
    const conditionIndex = headers.indexOf('Condition');
    const priceIndex = headers.indexOf('Regular price');

    if (deviceIndex < 0 || conditionIndex < 0 || priceIndex < 0) {
      throw new Error('Inventory CSV missing required headers: Device Type, Condition, Regular price');
    }

    const newSet = new Set();
    const usedSet = new Set();

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.length <= Math.max(deviceIndex, conditionIndex, priceIndex)) continue;

      const deviceType = row[deviceIndex];
      const condition = row[conditionIndex];
      const price = row[priceIndex];
      if (!deviceType || !price || price.startsWith('#')) continue;

      const normalized = normalizeDeviceName(deviceType);
      if (!normalized) continue;

      if (isUsedCondition(condition)) usedSet.add(normalized);
      else newSet.add(normalized);
    }

    supportedNewDevices = Array.from(newSet);
    supportedUsedDevices = Array.from(usedSet);
    console.log(`✅ Inventory CSV loaded: ${supportedNewDevices.length} new, ${supportedUsedDevices.length} used devices.`);
  }

  async function loadArrangementMap() {
    const csvUrl = normalizeCsvUrl(arrangementCsvUrl);
    console.log(`🗺️ Loading arrangement CSV from: ${csvUrl}`);
    const response = await axios.get(csvUrl);
    if (String(response.data || '').toLowerCase().includes('<html')) {
      throw new Error('Arrangement URL returned HTML, not CSV. Use a Google Sheets CSV export URL.');
    }
    const rows = parseCsv(response.data);
    const headers = (rows[0] || []).map((h) => h.toLowerCase());

    const aliasIndex = headers.findIndex((h) => ['alias', 'slang', 'arrangement', 'query', 'input'].includes(h));
    const canonicalIndex = headers.findIndex((h) => ['device', 'canonical', 'normalized', 'product', 'mapped'].includes(h));

    const fallbackAliasIndex = aliasIndex >= 0 ? aliasIndex : 0;
    const fallbackCanonicalIndex = canonicalIndex >= 0 ? canonicalIndex : 1;

    const nextMap = {};
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const alias = normalizeDeviceName(row[fallbackAliasIndex]);
      const canonical = normalizeDeviceName(row[fallbackCanonicalIndex]);
      if (!alias || !canonical) continue;
      nextMap[alias] = canonical;
    }

    arrangementMap = nextMap;
    console.log(`✅ Arrangement map loaded: ${Object.keys(arrangementMap).length} aliases.`);
  }

  async function loadCatalog() {
    try {
      await Promise.all([loadInventory(), loadArrangementMap()]);
      lastLoadedAt = Date.now();
      return {
        success: true,
        newCount: supportedNewDevices.length,
        usedCount: supportedUsedDevices.length,
        arrangementCount: Object.keys(arrangementMap).length,
        lastLoadedAt,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return {
    getInventoryCsvUrl: () => inventoryCsvUrl,
    getArrangementCsvUrl: () => arrangementCsvUrl,
    setInventoryCsvUrl: (nextUrl) => {
      inventoryCsvUrl = normalizeCsvUrl(nextUrl);
    },
    setArrangementCsvUrl: (nextUrl) => {
      arrangementCsvUrl = normalizeCsvUrl(nextUrl);
    },
    getNewDevices: () => supportedNewDevices,
    getUsedDevices: () => supportedUsedDevices,
    getAllCatalogDevices: () => Array.from(new Set([...supportedNewDevices, ...supportedUsedDevices])),
    // Backward-compatible no-op support for legacy callers.
    setHistoricalDevices: (nextDevices) => {
      legacyHistoricalDevices = Array.isArray(nextDevices)
        ? nextDevices.map((item) => normalizeDeviceName(item)).filter(Boolean)
        : [];
    },
    getHistoricalDevices: () => legacyHistoricalDevices,
    getLastLoadedAt: () => lastLoadedAt,
    getArrangementMap: () => arrangementMap,
    normalizeDeviceName,
    loadCatalog,
  };
}

module.exports = { createCatalogService, normalizeDeviceName };
