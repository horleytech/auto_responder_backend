const axios = require('axios');
const XLSX = require('xlsx');

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

function toHeaderKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findColumnIndex(headers, candidates) {
  const normalizedHeaders = headers.map(toHeaderKey);
  return normalizedHeaders.findIndex((header) => candidates.some((token) => header.includes(token)));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function worksheetRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    raw: false,
    defval: '',
  }).map((row) => (Array.isArray(row) ? row.map((cell) => normalizeText(cell)) : []));
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
      const xlsxUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
      const response = await axios.get(xlsxUrl, { responseType: 'arraybuffer' });
      const workbook = XLSX.read(response.data, { type: 'buffer' });
      const buyers = [];
      const nextScannedSheets = [];

      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = worksheetRows(worksheet);
        if (!rows.length) {
          nextScannedSheets.push({ title: sheetName, gid: '', headers: [], matchedBuyerColumn: '', matchedDeviceColumn: '' });
          return;
        }

        const headers = rows[0] || [];
        const buyerIndex = findColumnIndex(headers, ['buyer', 'customer', 'customer name', 'client', 'name']);
        const deviceIndex = findColumnIndex(headers, ['device', 'product', 'model', 'phone', 'item']);

        nextScannedSheets.push({
          title: sheetName,
          gid: '',
          headers,
          matchedBuyerColumn: buyerIndex >= 0 ? headers[buyerIndex] : '',
          matchedDeviceColumn: deviceIndex >= 0 ? headers[deviceIndex] : '',
        });

        if (buyerIndex < 0 || deviceIndex < 0) return;

        for (let i = 1; i < rows.length; i += 1) {
          const row = rows[i] || [];
          const customerName = normalizeText(row[buyerIndex]);
          const device = normalizeText(row[deviceIndex]);
          if (!customerName || !device) continue;
          buyers.push({
            id: `${sheetName}-${i}`,
            customerName,
            device,
            sheet: sheetName,
            rowNumber: i + 1,
          });
        }
      });

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
      const baseError = err.message || 'Failed to read online buyers spreadsheet.';
      const isRedirectIssue = baseError.toLowerCase().includes('redirect');
      const isForbidden = Number(err?.response?.status) === 403 || Number(err?.response?.status) === 401;
      lastSyncError = (isRedirectIssue || isForbidden)
        ? 'Google Sheets access failed. Make sure the sheet is shared publicly (Anyone with the link can view), then try sync again.'
        : baseError;
      return { success: false, error: lastSyncError, customers: cachedCustomers, rowCount: cachedCustomers.length, sheetCount: scannedSheets.length };
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
