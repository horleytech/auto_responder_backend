const axios = require('axios');
let xlsxModule = null;

function getXlsxModule() {
  if (xlsxModule) return xlsxModule;
  try {
    // Optional dependency on some deployments.
    // If unavailable, we gracefully fallback to CSV-only mode.
    // eslint-disable-next-line global-require
    xlsxModule = require('xlsx');
    return xlsxModule;
  } catch {
    return null;
  }
}

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

function resolveColumnIndexes(headers = []) {
  const timestampIndex = findPreferredColumn(
    headers,
    ['timestamp', 'time stamp', 'date', 'date time', 'created at', 'time'],
    ['timestamp', 'date', 'time', 'created']
  );
  const buyerIndex = findPreferredColumn(
    headers,
    ['customer name', 'buyer name', 'name of customer', 'full name'],
    ['customer', 'buyer', 'client', 'name']
  );
  const deviceIndex = findPreferredColumn(
    headers,
    ['item name model', 'item name / model', 'new item name', 'model name model number', 'device', 'product'],
    ['model', 'item', 'product', 'specification', 'storage', 'device', 'phone', 'laptop']
  );
  const customerPhoneIndex = findPreferredColumn(
    headers,
    ['customer phone number', 'customer phone', 'phone number', 'whatsapp number'],
    ['customer phone', 'phone', 'mobile', 'whatsapp', 'contact']
  );

  return { timestampIndex, buyerIndex, deviceIndex, customerPhoneIndex };
}

function resolveSheetHeaderRow(rows = []) {
  const maxRowsToScan = Math.min(rows.length, 20);
  let best = null;

  for (let rowIndex = 0; rowIndex < maxRowsToScan; rowIndex += 1) {
    const headers = (rows[rowIndex] || []).map((cell) => normalizeText(cell));
    if (!headers.length) continue;
    const indexes = resolveColumnIndexes(headers);
    const score = [
      indexes.buyerIndex >= 0,
      indexes.deviceIndex >= 0,
      indexes.timestampIndex >= 0,
      indexes.customerPhoneIndex >= 0,
    ].filter(Boolean).length;

    if (!best || score > best.score) {
      best = { rowIndex, headers, score, ...indexes };
    }
  }

  if (!best) {
    return {
      rowIndex: 0,
      headers: rows[0] || [],
      ...resolveColumnIndexes(rows[0] || []),
    };
  }
  return best;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
        } else insideQuotedField = false;
      } else if (atCellStart) insideQuotedField = true;
      else currentCell += char;
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

function worksheetRows(xlsxLib, sheet) {
  return xlsxLib.utils.sheet_to_json(sheet, {
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
      const xlsxLib = getXlsxModule();
      const buyers = [];
      const nextScannedSheets = [];
      const sources = [];

      if (xlsxLib) {
        const xlsxUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
        const response = await axios.get(xlsxUrl, { responseType: 'arraybuffer' });
        const workbook = xlsxLib.read(response.data, { type: 'buffer' });
        const selectedSheetNames = includedSheetNames.length
          ? workbook.SheetNames.filter((name) => includedSheetNames.includes(String(name || '').toLowerCase()))
          : workbook.SheetNames;
        selectedSheetNames.forEach((sheetName) => {
          sources.push({ sheetName, rows: worksheetRows(xlsxLib, workbook.Sheets[sheetName]) });
        });
      } else {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
        const response = await axios.get(csvUrl);
        sources.push({ sheetName: 'PrimarySheet', rows: parseCsv(response.data) });
      }

      sources.forEach(({ sheetName, rows }) => {
        if (!rows.length) {
          nextScannedSheets.push({ title: sheetName, gid: '', headers: [], matchedBuyerColumn: '', matchedDeviceColumn: '' });
          return;
        }

        const headerInfo = resolveSheetHeaderRow(rows);
        const headers = headerInfo.headers || [];
        const timestampIndex = headerInfo.timestampIndex;
        const buyerIndex = headerInfo.buyerIndex;
        const deviceIndex = headerInfo.deviceIndex;
        const customerPhoneIndex = headerInfo.customerPhoneIndex;

        nextScannedSheets.push({
          title: sheetName,
          gid: '',
          headers,
          headerRowNumber: Number(headerInfo.rowIndex || 0) + 1,
          matchedTimestampColumn: timestampIndex >= 0 ? headers[timestampIndex] : '',
          matchedBuyerColumn: buyerIndex >= 0 ? headers[buyerIndex] : '',
          matchedDeviceColumn: deviceIndex >= 0 ? headers[deviceIndex] : '',
          matchedCustomerPhoneColumn: customerPhoneIndex >= 0 ? headers[customerPhoneIndex] : '',
        });

        if (buyerIndex < 0 || deviceIndex < 0) return;

        for (let i = headerInfo.rowIndex + 1; i < rows.length; i += 1) {
          const row = rows[i] || [];
          const customerName = normalizeText(row[buyerIndex]);
          const device = normalizeText(row[deviceIndex]);
          const customerPhone = customerPhoneIndex >= 0 ? normalizeText(row[customerPhoneIndex]) : '';
          const parsedTimestamp = timestampIndex >= 0 ? parseTimestampValue(row[timestampIndex]) : { timestamp: null, dateKey: '', rawTimestamp: '' };
          if (!customerName || !device) continue;
          const extraDetails = {};
          headers.forEach((header, headerIndex) => {
            if ([buyerIndex, deviceIndex, timestampIndex, customerPhoneIndex].includes(headerIndex)) return;
            const key = normalizeText(header);
            const value = normalizeText(row[headerIndex]);
            if (!key || !value) return;
            extraDetails[key] = value;
          });

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
            extraDetails,
            extraDetailsText: Object.entries(extraDetails)
              .slice(0, 12)
              .map(([key, value]) => `${key}: ${value}`)
              .join(' | '),
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
