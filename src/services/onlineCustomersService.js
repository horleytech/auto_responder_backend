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

function findPreferredColumn(headers, preferredNames = [], fallbackTokens = []) {
  const normalizedHeaders = headers.map(toHeaderKey);
  const exactIndex = normalizedHeaders.findIndex((header) => preferredNames.includes(header));
  if (exactIndex >= 0) return exactIndex;
  if (!fallbackTokens.length) return -1;
  return normalizedHeaders.findIndex((header) => fallbackTokens.some((token) => header.includes(token)));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseTimestampValue(value) {
  const raw = normalizeText(value);
  if (!raw) return { timestamp: null, dateKey: '', rawTimestamp: '' };

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 59) {
    const excelMillis = Math.round((numeric - 25569) * 86400 * 1000);
    if (Number.isFinite(excelMillis) && excelMillis > 0) {
      const isoDate = new Date(excelMillis).toISOString().slice(0, 10);
      return { timestamp: excelMillis, dateKey: isoDate, rawTimestamp: raw };
    }
  }

  const parsed = new Date(raw).getTime();
  if (Number.isFinite(parsed)) {
    return { timestamp: parsed, dateKey: new Date(parsed).toISOString().slice(0, 10), rawTimestamp: raw };
  }

  return { timestamp: null, dateKey: '', rawTimestamp: raw };
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
  let includedSheetNames = [];
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

      const selectedSheetNames = includedSheetNames.length
        ? workbook.SheetNames.filter((name) => includedSheetNames.includes(String(name || '').toLowerCase()))
        : workbook.SheetNames;

      selectedSheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = worksheetRows(worksheet);
        if (!rows.length) {
          nextScannedSheets.push({ title: sheetName, gid: '', headers: [], matchedBuyerColumn: '', matchedDeviceColumn: '' });
          return;
        }

        const headers = rows[0] || [];
        const timestampIndex = findPreferredColumn(headers, ['timestamp', 'time stamp', 'date', 'date time'], ['timestamp', 'date', 'time']);
        const buyerIndex = findPreferredColumn(headers, ['customer name'], ['customer', 'buyer', 'client', 'name']);
        const deviceIndex = findPreferredColumn(
          headers,
          ['item name model', 'item name / model', 'new item name', 'model name model number'],
          ['model', 'item', 'product', 'specification', 'storage', 'device']
        );
        const customerPhoneIndex = findPreferredColumn(headers, ['customer phone number', 'customer phone'], ['customer phone', 'phone']);

        nextScannedSheets.push({
          title: sheetName,
          gid: '',
          headers,
          matchedTimestampColumn: timestampIndex >= 0 ? headers[timestampIndex] : '',
          matchedBuyerColumn: buyerIndex >= 0 ? headers[buyerIndex] : '',
          matchedDeviceColumn: deviceIndex >= 0 ? headers[deviceIndex] : '',
          matchedCustomerPhoneColumn: customerPhoneIndex >= 0 ? headers[customerPhoneIndex] : '',
        });

        if (buyerIndex < 0 || deviceIndex < 0) return;

        for (let i = 1; i < rows.length; i += 1) {
          const row = rows[i] || [];
          const customerName = normalizeText(row[buyerIndex]);
          const device = normalizeText(row[deviceIndex]);
          const customerPhone = customerPhoneIndex >= 0 ? normalizeText(row[customerPhoneIndex]) : '';
          const parsedTimestamp = timestampIndex >= 0 ? parseTimestampValue(row[timestampIndex]) : { timestamp: null, dateKey: '', rawTimestamp: '' };
          if (!customerName || !device) continue;
          buyers.push({
            id: `${sheetName}-${i}`,
            customerName,
            customerPhone,
            device,
            sheet: sheetName,
            rowNumber: i + 1,
            timestamp: parsedTimestamp.timestamp,
            dateKey: parsedTimestamp.dateKey,
            rawTimestamp: parsedTimestamp.rawTimestamp,
          });
        }
      });

      const dedupe = new Map();
      buyers.forEach((row) => {
        const dateKey = String(row.dateKey || 'unknown-date').toLowerCase();
        const customerKey = String(row.customerName || '').toLowerCase();
        const productKey = String(row.device || '').toLowerCase();
        const phoneKey = String(row.customerPhone || '').toLowerCase();
        const key = `${dateKey}::${customerKey}::${productKey}::${phoneKey}`;
        if (!dedupe.has(key)) dedupe.set(key, row);
      });

      cachedCustomers = Array.from(dedupe.values());
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
    getIncludedSheetNames: () => includedSheetNames,
    setIncludedSheetNames: (list = []) => {
      includedSheetNames = Array.isArray(list)
        ? list.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
        : [];
    },
    getCustomers: () => cachedCustomers,
    getScannedSheets: () => scannedSheets,
    getLastSyncedAt: () => lastSyncedAt,
    getLastSyncError: () => lastSyncError,
    loadCustomers,
  };
}

module.exports = { createOnlineCustomersService, normalizeSpreadsheetUrl };
