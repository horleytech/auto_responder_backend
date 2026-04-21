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

function normalizeHeaderValue(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeCategory(value) {
  const lower = normalizeHeaderValue(value);
  if (!lower) return 'new';
  if (lower.includes('used')) return 'used';
  return 'new';
}

function isUsedCondition(condition) {
  if (!condition) return false;
  const lower = String(condition).toLowerCase();
  return lower.includes('used') || lower.includes('grade a') || lower.includes('uk used');
}

function normalizeSimValue(value) {
  const lower = normalizeHeaderValue(value);
  if (!lower) return '';
  const compact = lower.replace(/\s+/g, '');
  if (compact.includes('physical') && compact.includes('esim')) return 'physical+esim';
  if (compact.includes('dual') && compact.includes('esim')) return 'physical+esim';
  if (compact.includes('esim')) return 'esim';
  if (compact.includes('physical')) return 'physical';
  return lower;
}

function normalizeStorageValue(value) {
  const raw = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(tb|gb)/i);
  if (!match) return '';
  return `${match[1]}${match[2].toLowerCase()}`;
}

function buildProductId({
  category = 'new',
  deviceType = '',
  condition = '',
  simType = '',
  storageValue = '',
}) {
  return [
    normalizeCategory(category),
    normalizeDeviceName(deviceType) || '',
    normalizeHeaderValue(condition),
    normalizeSimValue(simType),
    normalizeStorageValue(storageValue),
  ].join('|');
}

function deviceHasStorageToken(deviceName, storageToken) {
  if (!storageToken) return false;
  const compact = String(deviceName || '').toLowerCase().replace(/\s+/g, '');
  return compact.includes(storageToken);
}

function stripStorageFromDeviceName(deviceName) {
  return normalizeDeviceName(String(deviceName || '').replace(/\b\d+(?:\.\d+)?\s*(?:gb|tb)\b/gi, ' '));
}

function buildDeviceNameWithStorage(deviceType, storageValue) {
  const normalizedDevice = normalizeDeviceName(deviceType);
  if (!normalizedDevice) return null;
  const storageToken = normalizeStorageValue(storageValue);
  if (!storageToken) return normalizedDevice;
  if (deviceHasStorageToken(normalizedDevice, storageToken)) return normalizedDevice;
  return normalizeDeviceName(`${normalizedDevice} ${storageToken}`);
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
  let arrangementMap = {};
  let inventoryPreview = { headers: [], rows: [] };
  let arrangementPreview = { headers: [], rows: [] };
  let inventoryItems = [];
  let inventoryByProductId = {};
  let lastLoadedAt = 0;
  const historicalDevices = new Set();

  async function loadInventory() {
    const csvUrl = normalizeCsvUrl(inventoryCsvUrl);
    console.log(`📄 Loading inventory CSV from: ${csvUrl}`);
    const response = await axios.get(csvUrl);
    if (String(response.data || '').toLowerCase().includes('<html')) {
      throw new Error('Inventory URL returned HTML, not CSV. Use a Google Sheets CSV export URL.');
    }
    const rows = parseCsv(response.data);
    const headers = rows[0] || [];
    const normalizedHeaders = headers.map(normalizeHeaderValue);
    const deviceIndex = normalizedHeaders.findIndex((h) => h === 'device type');
    const conditionIndex = normalizedHeaders.findIndex((h) => h === 'condition');
    const categoryIndex = normalizedHeaders.findIndex((h) => h === 'category');
    const simTypeIndex = normalizedHeaders.findIndex((h) => h.includes('sim type'));
    const priceIndex = normalizedHeaders.findIndex((h) => h === 'regular price');
    const salePriceIndex = normalizedHeaders.findIndex((h) => h === 'sale price');
    const linkIndex = normalizedHeaders.findIndex((h) => h === 'link');
    const storageIndex = normalizedHeaders.findIndex((h) => h.includes('storage capacity/configuration') || h.includes('storage'));

    if (deviceIndex < 0 || conditionIndex < 0 || priceIndex < 0) {
      throw new Error('Inventory CSV missing required headers: Device Type, Condition, Regular price');
    }

    const newSet = new Set();
    const usedSet = new Set();
    const nextItems = [];
    const nextByProductId = {};

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.length <= Math.max(deviceIndex, conditionIndex, priceIndex)) continue;

      const deviceType = row[deviceIndex];
      const condition = row[conditionIndex];
      const price = row[priceIndex];
      if (!deviceType || !price || price.startsWith('#')) continue;

      const storageValue = storageIndex >= 0 ? row[storageIndex] : '';
      const normalized = buildDeviceNameWithStorage(deviceType, storageValue);
      if (!normalized) continue;
      const category = categoryIndex >= 0 ? normalizeCategory(row[categoryIndex]) : (isUsedCondition(condition) ? 'used' : 'new');
      const productId = buildProductId({
        category,
        deviceType,
        condition,
        simType: simTypeIndex >= 0 ? row[simTypeIndex] : '',
        storageValue,
      });
      const item = {
        productId,
        category,
        deviceName: normalized,
        condition: normalizeHeaderValue(condition),
        simType: normalizeSimValue(simTypeIndex >= 0 ? row[simTypeIndex] : ''),
        storage: normalizeStorageValue(storageValue),
        regularPrice: String(price || '').trim(),
        salePrice: salePriceIndex >= 0 ? String(row[salePriceIndex] || '').trim() : '',
        link: linkIndex >= 0 ? String(row[linkIndex] || '').trim() : '',
      };
      nextItems.push(item);
      nextByProductId[productId] = item;

      if (isUsedCondition(condition)) usedSet.add(normalized);
      else newSet.add(normalized);
    }

    inventoryItems = nextItems;
    inventoryByProductId = nextByProductId;
    supportedNewDevices = Array.from(newSet);
    supportedUsedDevices = Array.from(usedSet);
    inventoryPreview = { headers, rows: rows.slice(1, 201) };
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
    arrangementPreview = { headers: rows[0] || [], rows: rows.slice(1, 201) };
    console.log(`✅ Arrangement map loaded: ${Object.keys(arrangementMap).length} aliases.`);
  }

  async function loadCatalog() {
    try {
      await Promise.all([loadInventory(), loadArrangementMap()]);
      [...supportedNewDevices, ...supportedUsedDevices].forEach((name) => historicalDevices.add(name));
      lastLoadedAt = Date.now();
      return {
        success: true,
        newCount: supportedNewDevices.length,
        usedCount: supportedUsedDevices.length,
        arrangementCount: Object.keys(arrangementMap).length,
        lastLoadedAt,
        historicalCount: historicalDevices.size,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }



  function resolveDeviceForMessage({ mappedDevice, userMessage, category = 'new' }) {
    const product = resolveProductForMessage({ mappedDevice, userMessage, category });
    return product ? product.deviceName : normalizeDeviceName(mappedDevice);
  }

  function resolveProductForMessage({ mappedDevice, userMessage, category = 'new' }) {
    const normalizedMapped = normalizeDeviceName(mappedDevice);
    if (!normalizedMapped) return null;

    const inventoryPool = inventoryItems.filter((item) => item.category === category);
    if (!inventoryPool.length) return null;

    const direct = inventoryPool.find((item) => item.deviceName === normalizedMapped);
    if (direct) return direct;

    const mappedBase = stripStorageFromDeviceName(normalizedMapped);
    const candidates = inventoryPool.filter((item) => stripStorageFromDeviceName(item.deviceName) === mappedBase);
    if (!candidates.length) return null;

    const requestedStorage = normalizeStorageValue(userMessage);
    const requestedSim = normalizeSimValue(userMessage);
    if (requestedStorage) {
      const exactStorageCandidate = candidates.find((item) => item.storage === requestedStorage);
      if (exactStorageCandidate) {
        if (!requestedSim) return exactStorageCandidate;
        const exactSimCandidate = candidates.find((item) => item.storage === requestedStorage && item.simType === requestedSim);
        return exactSimCandidate || exactStorageCandidate;
      }
    }

    if (requestedSim) {
      const exactSimCandidate = candidates.find((item) => item.simType === requestedSim);
      if (exactSimCandidate) return exactSimCandidate;
    }

    return candidates[0];
  }

  function mapArrangement(input) {
    const normalized = normalizeDeviceName(input);
    if (!normalized) return null;
    return arrangementMap[normalized] || normalized;
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
    getArrangementMap: () => arrangementMap,
    getInventoryPreview: () => inventoryPreview,
    getInventoryItems: () => inventoryItems,
    getInventoryByProductId: () => inventoryByProductId,
    getAllCatalogDevices: () => Array.from(new Set([...supportedNewDevices, ...supportedUsedDevices])).sort(),
    getHistoricalDevices: () => Array.from(historicalDevices).sort(),
    setHistoricalDevices: (list = []) => {
      historicalDevices.clear();
      list.forEach((item) => {
        const normalized = normalizeDeviceName(item);
        if (normalized) historicalDevices.add(normalized);
      });
    },
    getLastLoadedAt: () => lastLoadedAt,
    mapArrangement,
    resolveProductForMessage,
    buildProductId,
    resolveDeviceForMessage,
    normalizeDeviceName,
    loadCatalog,
  };
}

module.exports = { createCatalogService, normalizeDeviceName };
