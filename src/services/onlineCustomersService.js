const axios = require('axios');

function normalizeSpreadsheetUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const match = raw.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return raw;
  return `https://docs.google.com/spreadsheets/d/${match[1]}/edit`;
}

function extractSpreadsheetId(url) {
  const match = String(url || '').match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : '';
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
    if (currentRow.some((cell) => cell !== '')) rows.push(currentRow);
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

  if (currentCell !== '' || currentRow.length > 0) pushCell();
  pushRow();
  return rows;
}

function toHeaderKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findColumnIndex(headers, candidates) {
  const normalizedHeaders = headers.map(toHeaderKey);
  return normalizedHeaders.findIndex((header) => candidates.some((token) => header.includes(token)));
}

async function listSheets(spreadsheetId) {
  const feedUrl = `https://spreadsheets.google.com/feeds/worksheets/${spreadsheetId}/public/basic?alt=json`;
  const response = await axios.get(feedUrl);
  const entries = response?.data?.feed?.entry || [];
  return entries
    .map((entry) => {
      const title = String(entry?.title?.$t || '').trim();
      const links = Array.isArray(entry?.link) ? entry.link : [];
      const htmlLink = links.find((link) => link.type === 'text/html')?.href || '';
      const gidMatch = htmlLink.match(/[#?&]gid=(\d+)/);
      return {
        title,
        gid: gidMatch ? gidMatch[1] : '',
      };
    })
    .filter((sheet) => sheet.gid);
}

function createOnlineCustomersService(initialSpreadsheetUrl = '') {
  let spreadsheetUrl = normalizeSpreadsheetUrl(initialSpreadsheetUrl);
  let lastSyncedAt = 0;
  let lastSyncError = '';
  let cachedCustomers = [];
  let scannedSheets = [];

  async function loadCustomers() {
    const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
    if (!spreadsheetId) return { success: false, error: 'Online spreadsheet URL is not configured.' };

    try {
      const sheets = await listSheets(spreadsheetId);
      const buyers = [];
      const nextScannedSheets = [];

      for (const sheet of sheets) {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${sheet.gid}`;
        const response = await axios.get(csvUrl);
        if (String(response.data || '').toLowerCase().includes('<html')) continue;

        const rows = parseCsv(response.data);
        if (!rows.length) continue;

        const headers = rows[0] || [];
        const buyerIndex = findColumnIndex(headers, ['buyer', 'customer', 'name', 'client']);
        const deviceIndex = findColumnIndex(headers, ['device', 'product', 'model', 'phone', 'item']);

        nextScannedSheets.push({
          title: sheet.title || `Sheet ${sheet.gid}`,
          gid: sheet.gid,
          headers,
          matchedBuyerColumn: buyerIndex >= 0 ? headers[buyerIndex] : '',
          matchedDeviceColumn: deviceIndex >= 0 ? headers[deviceIndex] : '',
        });

        if (buyerIndex < 0 || deviceIndex < 0) continue;

        for (let i = 1; i < rows.length; i += 1) {
          const row = rows[i];
          const customerName = String(row[buyerIndex] || '').trim();
          const device = String(row[deviceIndex] || '').trim();
          if (!customerName || !device) continue;
          buyers.push({
            id: `${sheet.gid}-${i}`,
            customerName,
            device,
            sheet: sheet.title || `Sheet ${sheet.gid}`,
            rowNumber: i + 1,
          });
        }
      }

      cachedCustomers = buyers;
      scannedSheets = nextScannedSheets;
      lastSyncError = '';
      lastSyncedAt = Date.now();

      return {
        success: true,
        customers: cachedCustomers,
        rowCount: cachedCustomers.length,
        sheetCount: scannedSheets.length,
        lastSyncedAt,
      };
    } catch (err) {
      lastSyncError = err.message || 'Failed to read online buyers spreadsheet.';
      return { success: false, error: lastSyncError, customers: cachedCustomers, rowCount: cachedCustomers.length };
    }
  }

  return {
    getSpreadsheetUrl: () => spreadsheetUrl,
    setSpreadsheetUrl: (nextUrl) => {
      spreadsheetUrl = normalizeSpreadsheetUrl(nextUrl);
    },
    getCustomers: () => cachedCustomers,
    getScannedSheets: () => scannedSheets,
    getLastSyncedAt: () => lastSyncedAt,
    getLastSyncError: () => lastSyncError,
    loadCustomers,
  };
}

module.exports = { createOnlineCustomersService, normalizeSpreadsheetUrl };
