const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  API_KEY,
  QWEN_API_KEY,
  CHATGPT_MODEL,
  QWEN_MODEL,
  GOOGLE_SHEETS_CSV_URL,
  ARRANGEMENT_MAP_CSV_URL,
} = require('./config/env');
const { firestore, FieldValue } = require('./services/firebaseService');
const { createCatalogService } = require('./services/catalogService');
const { createProviderService } = require('./services/providerService');
const settingsStore = require('./services/settingsStore');
const { createProcessor } = require('./services/processor');
const { createMaintenanceRouter } = require('./controllers/maintenance');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const catalog = createCatalogService(GOOGLE_SHEETS_CSV_URL, ARRANGEMENT_MAP_CSV_URL);
const providerService = createProviderService();
const processor = createProcessor({ firestore, catalog, providerService, settingsStore, FieldValue });

let runtimeApiKey = String(process.env.API_KEY || API_KEY || '').trim();

// Dynamic response pool (original)
var DYNAMIC_RESPONSES = [
  'Available', 'Available chief', 'Available big chief', 'Available my Oga',
  'Big chief, this is available', 'Available boss', 'Available boss, we get am',
  'Available my guy', "My Oga, it's available", 'Available boss, make i paste address',
  'Available sir!', 'E dey o!', 'Available my king!', "Oga at the top, it's available!",
  'Available don!', 'My guy, e dey—available!', 'Available, we get am',
  'Big boss, it’s available!', 'Available legend', 'Abeg Oga, it’s available!',
  'Available my brother',
];
let responseIndex = 0;

// Forbidden phrases (original)
var FORBIDDEN_NEW_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'UK', 'Air', 'Used',
].map((p) => p.toLowerCase());

var FORBIDDEN_USED_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'NEW',
].map((p) => p.toLowerCase());

var DEFAULT_FORBIDDEN_NEW_PHRASES = [...FORBIDDEN_NEW_PHRASES];
var DEFAULT_FORBIDDEN_USED_PHRASES = [...FORBIDDEN_USED_PHRASES];
var DEFAULT_DYNAMIC_RESPONSES = [...DYNAMIC_RESPONSES];

let SUPPORTED_NEW_DEVICES = [];
let SUPPORTED_USED_DEVICES = [];

// Forbidden phrases (original)
const FORBIDDEN_NEW_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'UK', 'Air', 'Used',
].map((p) => p.toLowerCase());

const FORBIDDEN_USED_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'NEW',
].map((p) => p.toLowerCase());

let SUPPORTED_NEW_DEVICES = [];
let SUPPORTED_USED_DEVICES = [];

function sanitizeStringArray(value, { lowerCase = false } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .map((v) => (lowerCase ? v.toLowerCase() : v));
}

function normalizeDeviceName(deviceType) {
  if (!deviceType) return null;
  return String(deviceType)
    .toLowerCase()
    .replace(/galaxy /gi, '')
    .replace(/\s+/g, ' ')
    .replace(/pro max/g, 'pro max')
    .replace(/pro xl/g, 'pro xl')
    .replace(/iphone /gi, 'iphone ')
    .trim();
}

function isUsedCondition(condition) {
  if (!condition) return false;
  const lower = String(condition).toLowerCase();
  return lower.includes('used') || lower.includes('grade a') || lower.includes('uk used');
}

function normalizeDeviceName(deviceType) {
  if (!deviceType) return null;
  return String(deviceType)
    .toLowerCase()
    .replace(/galaxy /gi, '')
    .replace(/\s+/g, ' ')
    .replace(/pro max/g, 'pro max')
    .replace(/pro xl/g, 'pro xl')
    .replace(/iphone /gi, 'iphone ')
    .trim();
}

function isUsedCondition(condition) {
  if (!condition) return false;
  const lower = String(condition).toLowerCase();
  return lower.includes('used') || lower.includes('grade a') || lower.includes('uk used');
}

function normalizeDeviceName(deviceType) {
  if (!deviceType) return null;
  return String(deviceType)
    .toLowerCase()
    .replace(/galaxy /gi, '')
    .replace(/\s+/g, ' ')
    .replace(/pro max/g, 'pro max')
    .replace(/pro xl/g, 'pro xl')
    .replace(/iphone /gi, 'iphone ')
    .trim();
}

function isUsedCondition(condition) {
  if (!condition) return false;
  const lower = String(condition).toLowerCase();
  return lower.includes('used') || lower.includes('grade a') || lower.includes('uk used');
}

function normalizeDeviceName(deviceType) {
  if (!deviceType) return null;
  return String(deviceType)
    .toLowerCase()
    .replace(/galaxy /gi, '')
    .replace(/\s+/g, ' ')
    .replace(/pro max/g, 'pro max')
    .replace(/pro xl/g, 'pro xl')
    .replace(/iphone /gi, 'iphone ')
    .trim();
}

function isUsedCondition(condition) {
  if (!condition) return false;
  const lower = String(condition).toLowerCase();
  return lower.includes('used') || lower.includes('grade a') || lower.includes('uk used');
}

function normalizeDeviceName(deviceType) {
  if (!deviceType) return null;
  return String(deviceType)
    .toLowerCase()
    .replace(/galaxy /gi, '')
    .replace(/\s+/g, ' ')
    .replace(/pro max/g, 'pro max')
    .replace(/pro xl/g, 'pro xl')
    .replace(/iphone /gi, 'iphone ')
    .trim();
}

function isUsedCondition(condition) {
  if (!condition) return false;
  const lower = String(condition).toLowerCase();
  return lower.includes('used') || lower.includes('grade a') || lower.includes('uk used');
}

function resolveExpectedApiKey() {
  return String(process.env.API_KEY || runtimeApiKey || API_KEY || '').trim();
}

function isAuthorized(req, { allowWhenUnconfigured = false } = {}) {
  const expected = resolveExpectedApiKey();
  if (!expected) return Boolean(allowWhenUnconfigured);
  const incoming = String(req.headers['x-api-key'] || req.query.key || '').trim();
  return incoming === expected;
}

async function loadCatalogFromGoogleSheets(url = GOOGLE_SHEETS_CSV_URL) {
  try {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) throw new Error('Missing Google Sheets CSV URL');

    const axios = require('axios');
    console.log('📥 Loading catalog from Google Sheets...');
    const response = await axios.get(targetUrl);
    const lines = String(response.data).split('\n').filter((line) => line.trim() !== '');

    const rows = [];
    for (const line of lines) {
      const row = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.replace(/^"(.*)"$/, '$1').trim());
      rows.push(row);
    }

    const headers = rows[0] || [];
    const deviceIndex = headers.indexOf('Device Type');
    const conditionIndex = headers.indexOf('Condition');
    const priceIndex = headers.indexOf('Regular price');

    const newSet = new Set();
    const usedSet = new Set();

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.length <= Math.max(deviceIndex, conditionIndex, priceIndex)) continue;

      const deviceType = row[deviceIndex];
      const condition = row[conditionIndex];
      const price = row[priceIndex];

      if (!deviceType || !price || price.startsWith('#') || price === '') continue;

      const normalized = normalizeDeviceName(deviceType);
      if (!normalized) continue;

      if (isUsedCondition(condition)) usedSet.add(normalized);
      else newSet.add(normalized);
    }

    SUPPORTED_NEW_DEVICES = Array.from(newSet);
    SUPPORTED_USED_DEVICES = Array.from(usedSet);

    // Keep catalog service in sync for frontend/data endpoints
    await catalog.loadCatalog();

    console.log(`✅ Loaded: ${SUPPORTED_NEW_DEVICES.length} new, ${SUPPORTED_USED_DEVICES.length} used devices.`);
    return { success: true, newCount: SUPPORTED_NEW_DEVICES.length, usedCount: SUPPORTED_USED_DEVICES.length };
  } catch (err) {
    console.error('❌ Failed to load catalog:', err.message);
    return { success: false, error: err.message };
  }
}

function getSystemPrompt() {
  return `
You are a JSON-based entity extractor for an availability checker.
Your SOLE purpose is to analyze the user's message and return a JSON object.
Do not add any other text, conversation, or explanations.

First, determine the category: 'new' or 'used'. If the message contains 'used', the category is 'used'. Otherwise, default to 'new'.

Based on the category, use the appropriate lists:

List of NEW devices: ${SUPPORTED_NEW_DEVICES.join(', ')}
List of NEW forbidden phrases: ${FORBIDDEN_NEW_PHRASES.join(', ')}

List of USED devices: ${SUPPORTED_USED_DEVICES.join(', ')}
List of USED forbidden phrases: ${FORBIDDEN_USED_PHRASES.join(', ')}

Return JSON in this exact format:
{"device": string | null, "forbidden": string | null, "category": "new" | "used"}

RULES:
1.  "device": Find the *first* item from the active device list that is the *closest match* to the user's request. The string you return MUST be spelled *exactly* as it appears in the list.
2.  "forbidden": Find the *first* matching forbidden phrase from the active list. The string MUST be spelled *exactly* as it appears in the list. If no forbidden phrase is found, this MUST be null.
3.  "category": The category you detected ('new' or 'used').
4.  **PRIORITY:** A message can have BOTH a device and a forbidden phrase. Find both.
5.  ***"esim" EXCEPTION:*** The phrase "esim" is only forbidden if the message does *not* also mention "physical". If the message contains "physical" (or "physical sim") AND "esim", it is considered "physical" and "esim" should *not* be listed as forbidden.
`.trim();
}

async function logRawToFirebase({ req, userMessage, category, foundDevice, foundForbidden, finalResponse, error }) {
  try {
    await processor.saveRawRequest({
      senderId: req.body?.senderId || 'Unknown',
      senderMessage: userMessage,
      aiCategory: category || null,
      aiDeviceMatch: foundDevice || null,
      aiForbiddenMatch: foundForbidden || null,
      replied: Boolean(finalResponse),
      responseMessage: finalResponse || null,
      error: error || null,
      provider: providerService.getActiveProvider(),
      timestamp: Date.now(),
      processed: false,
      rawPayload: req.body || {},
    });
  } catch (logErr) {
    console.error('❌ Failed to log raw request:', logErr.message);
  }
}

// ─── DASHBOARD ENDPOINTS ──────────────────────────────────────────────────
app.get('/api/providers', async (req, res) => {
  const saved = await settingsStore.getSettings();
  res.json({
    ...providerService.listProviders(),
    activeProvider: saved.activeProvider || providerService.getActiveProvider(),
    envKeysLoaded: {
      API_KEY: Boolean(process.env.API_KEY),
      OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_CHATGPT),
      QWEN_API_KEY: Boolean(process.env.QWEN_API_KEY || QWEN_API_KEY),
    },
    models: {
      chatgpt: CHATGPT_MODEL,
      qwen: QWEN_MODEL,
    },
  });
});

app.post('/api/providers', async (req, res) => {
  if (!isAuthorized(req, { allowWhenUnconfigured: true })) return res.sendStatus(403);
  const provider = String(req.body?.provider || '').toLowerCase().trim();
  providerService.setActiveProvider(provider);
  await settingsStore.updateSettings({ activeProvider: provider });
  res.json({ success: true, activeProvider: provider });
});

app.get('/api/settings', async (req, res) => res.json(await settingsStore.getSettings()));

app.post('/api/settings', async (req, res) => {
  if (!isAuthorized(req, { allowWhenUnconfigured: true })) return res.sendStatus(403);
  const nextApiKey = String(req.body?.apiKey || '').trim();
  if (nextApiKey) runtimeApiKey = nextApiKey;
  await settingsStore.updateSettings(req.body || {});
  res.json({ success: true });
});

app.get('/api/catalog-source', (req, res) => {
  res.json({ inventoryCsvUrl: catalog.getInventoryCsvUrl(), arrangementCsvUrl: catalog.getArrangementCsvUrl() });
});

app.post('/api/catalog-source', async (req, res) => {
  if (!isAuthorized(req, { allowWhenUnconfigured: true })) return res.sendStatus(403);
  catalog.setInventoryCsvUrl(String(req.body?.inventoryCsvUrl || '').trim());
  catalog.setArrangementCsvUrl(String(req.body?.arrangementCsvUrl || '').trim());
  const loaded = await catalog.loadCatalog();
  if (!loaded.success) return res.status(400).json(loaded);
  await settingsStore.updateSettings({ inventoryCsvUrl: catalog.getInventoryCsvUrl(), arrangementCsvUrl: catalog.getArrangementCsvUrl() });
  return res.json({ success: true, ...loaded });
});

app.get('/api/bot-logic', async (req, res) => {
  const settings = await settingsStore.getSettings();
  const forbiddenNew = sanitizeStringArray(settings.forbiddenNewPhrases).map((p) => p.toLowerCase());
  const forbiddenUsed = sanitizeStringArray(settings.forbiddenUsedPhrases).map((p) => p.toLowerCase());
  const dynamicResponses = sanitizeStringArray(settings.dynamicResponses);

  res.json({
    forbiddenNewPhrases: forbiddenNew.length ? forbiddenNew : DEFAULT_FORBIDDEN_NEW_PHRASES,
    forbiddenUsedPhrases: forbiddenUsed.length ? forbiddenUsed : DEFAULT_FORBIDDEN_USED_PHRASES,
    dynamicResponses: dynamicResponses.length ? dynamicResponses : DEFAULT_DYNAMIC_RESPONSES,
  });
});

app.post('/api/bot-logic', async (req, res) => {
  if (!isAuthorized(req, { allowWhenUnconfigured: true })) return res.sendStatus(403);
  const next = {
    forbiddenNewPhrases: sanitizeStringArray(req.body?.forbiddenNewPhrases).map((p) => p.toLowerCase()),
    forbiddenUsedPhrases: sanitizeStringArray(req.body?.forbiddenUsedPhrases).map((p) => p.toLowerCase()),
    dynamicResponses: sanitizeStringArray(req.body?.dynamicResponses),
  };
  await settingsStore.updateSettings(next);
  return res.json({ success: true, ...next });
});

app.get('/api/dictionary', async (req, res) => {
  const rows = await processor.listDictionary();
  res.json({ dictionary: rows });
});

app.post('/api/dictionary', async (req, res) => {
  if (!isAuthorized(req, { allowWhenUnconfigured: true })) return res.sendStatus(403);
  try {
    await processor.upsertDictionary(req.body || {});
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/dictionary/:id', async (req, res) => {
  if (!isAuthorized(req, { allowWhenUnconfigured: true })) return res.sendStatus(403);
  await processor.deleteDictionary(req.params.id);
  res.json({ success: true });
});

app.get('/api/requests', async (req, res) => {
  if (!firestore) return res.status(503).json({ error: 'Firebase is not configured. No persistent request log available.' });
  try {
    const snap = await firestore.collection('ar_raw_requests').orderBy('timestamp', 'desc').limit(100).get();
    res.json({ requests: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/clean-analytics', async (req, res) => {
  const timeframe = String(req.query.timeframe || '1m').toLowerCase();
  const now = Date.now();
  const since = timeframe === '1w' ? now - 7 * 86400000 : timeframe === '1m' ? now - 30 * 86400000 : 0;
  let devices = [];
  let customers = [];
  if (firestore) {
    try {
      const [aSnap, cSnap] = await Promise.all([
        firestore.collection('ar_analytics').orderBy('requestCount', 'desc').get(),
        firestore.collection('ar_customers').orderBy('totalRequests', 'desc').get(),
      ]);
      devices = aSnap.docs.map((d) => d.data()).filter((d) => !since || !d.lastRequestAt || d.lastRequestAt >= since).slice(0, 10);
      customers = cSnap.docs.map((d) => d.data()).filter((d) => !since || !d.lastActive || d.lastActive >= since).slice(0, 5);
    } catch (e) {
      console.error('Firebase analytics read error:', e.message);
    }
  }
  res.json({ devices, customers, timeframe });
});

app.use('/api/maintenance', createMaintenanceRouter({ firestore, processor, settingsStore, resolveApiKey: resolveExpectedApiKey }));

app.get('/healthz', (req, res) => res.json({ ok: true, persistence: firestore ? 'firebase' : 'memory' }));

// Original-style catalog reload endpoint
app.post('/api/reload-catalog', async (req, res) => {
  const key = String(req.headers['x-api-key'] || '').trim();
  if (key !== resolveExpectedApiKey()) return res.sendStatus(403);
  const loaded = await loadCatalogFromGoogleSheets(catalog.getInventoryCsvUrl() || GOOGLE_SHEETS_CSV_URL);
  if (!loaded.success) return res.status(400).json(loaded);
  return res.json({ success: true, ...loaded });
});

// ─── MAIN ENDPOINT (RESTORED CORE LOGIC) ───────────────────────────────────
app.post('/api/respond', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.sendStatus(403);
  }

  const userMessage = String(req.body?.senderMessage || '').trim();
  if (!userMessage) {
    return res.status(400).json({ error: 'Missing senderMessage' });
  }

  let category = null;
  let foundDevice = null;
  let foundForbidden = null;
  let finalResponse = null;

  try {
    const settings = await settingsStore.getSettings();
    const provider = String(settings.activeProvider || providerService.getActiveProvider() || 'chatgpt').toLowerCase();
    providerService.setActiveProvider(provider);

    let aiResponse;
    try {
      const rawResponse = await providerService.runProvider(provider, getSystemPrompt(), userMessage);
      aiResponse = JSON.parse(rawResponse);
    } catch {
      await logRawToFirebase({ req, userMessage, error: 'AI response was not valid JSON or provider not configured' });
      return res.status(500).json({ error: 'AI response was not valid JSON or provider not configured' });
    }

    category = aiResponse.category;
    foundDevice = aiResponse.device ? String(aiResponse.device).toLowerCase() : null;
    foundForbidden = aiResponse.forbidden ? String(aiResponse.forbidden).toLowerCase() : null;

    const forbiddenNew = sanitizeStringArray(settings.forbiddenNewPhrases).map((p) => p.toLowerCase());
    const forbiddenUsed = sanitizeStringArray(settings.forbiddenUsedPhrases).map((p) => p.toLowerCase());
    const dynamicResponses = sanitizeStringArray(settings.dynamicResponses);

    const activeSupportedList = category === 'used' ? SUPPORTED_USED_DEVICES : SUPPORTED_NEW_DEVICES;
    const activeForbiddenList = category === 'used'
      ? (forbiddenUsed.length ? forbiddenUsed : DEFAULT_FORBIDDEN_USED_PHRASES)
      : (forbiddenNew.length ? forbiddenNew : DEFAULT_FORBIDDEN_NEW_PHRASES);
    const activeResponses = dynamicResponses.length ? dynamicResponses : DEFAULT_DYNAMIC_RESPONSES;

    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      await logRawToFirebase({ req, userMessage, category, foundDevice, foundForbidden, finalResponse: null });
      return res.sendStatus(204);
    }

    if (foundDevice && activeSupportedList.includes(foundDevice)) {
      finalResponse = activeResponses[responseIndex];
      responseIndex = (responseIndex + 1) % activeResponses.length;
      await logRawToFirebase({ req, userMessage, category, foundDevice, foundForbidden, finalResponse });
      return res.json({ data: [{ message: finalResponse }] });
    }

    await logRawToFirebase({ req, userMessage, category, foundDevice, foundForbidden, finalResponse: null });
    return res.sendStatus(204);
  } catch (err) {
    console.error('💥 Server error:', err.message);
    await logRawToFirebase({ req, userMessage, category, foundDevice, foundForbidden, finalResponse, error: err.message });
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

(async () => {
  try {
    const settings = await settingsStore.getSettings();
    runtimeApiKey = String(settings.apiKey || runtimeApiKey || '').trim();
    catalog.setInventoryCsvUrl(settings.inventoryCsvUrl || GOOGLE_SHEETS_CSV_URL);
    catalog.setArrangementCsvUrl(settings.arrangementCsvUrl || ARRANGEMENT_MAP_CSV_URL);
    await catalog.loadCatalog();
    await loadCatalogFromGoogleSheets(catalog.getInventoryCsvUrl() || GOOGLE_SHEETS_CSV_URL);
    providerService.setActiveProvider(String(settings.activeProvider || providerService.getActiveProvider() || 'chatgpt').toLowerCase());
  } catch (e) {
    console.error('Error during init:', e.message);
  }
})();

module.exports = app;
