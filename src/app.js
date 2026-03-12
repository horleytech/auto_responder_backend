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

let responseIndex = 0;
let runtimeApiKey = process.env.API_KEY || API_KEY;

const DEFAULT_FORBIDDEN_NEW = ['esim', 'locked', 'idm', 'wifi only', 'panel', 'used'];
const DEFAULT_FORBIDDEN_USED = ['esim', 'locked', 'idm', 'wifi only', 'panel', 'new'];
const DEFAULT_DYNAMIC_RESPONSES = ['Available', 'Available chief', 'Available boss'];

function sanitizeStringArray(value, { lowerCase = false } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .map((v) => (lowerCase ? v.toLowerCase() : v));
}

function resolveExpectedApiKey() {
  return String(process.env.API_KEY || runtimeApiKey || API_KEY).trim();
}

function isAuthorized(req) {
  const incoming = String(req.headers['x-api-key'] || req.query.key || '').trim();
  return incoming === resolveExpectedApiKey();
}

function buildWebhookPrompt({ newDevices, usedDevices, forbiddenNew, forbiddenUsed }) {
  return `You are a JSON-based entity extractor for an availability checker.
Your SOLE purpose is to analyze the user's message and return a JSON object.
Do not add any other text, conversation, or explanations.

First, determine the category: 'new' or 'used'. If the message contains 'used', the category is 'used'. Otherwise, default to 'new'.

Based on the category, use the appropriate lists:

List of NEW devices: ${newDevices.join(', ')}
List of NEW forbidden phrases: ${forbiddenNew.join(', ')}

List of USED devices: ${usedDevices.join(', ')}
List of USED forbidden phrases: ${forbiddenUsed.join(', ')}

Return JSON in this exact format:
{"device": string | null, "forbidden": string | null, "category": "new" | "used"}

RULES:
1. "device": Find the first item from the active device list that is the closest match to the user's request. The string you return MUST be spelled exactly as it appears in the list.
2. "forbidden": Find the first matching forbidden phrase from the active list. The string MUST be spelled exactly as it appears in the list. If no forbidden phrase is found, this MUST be null.
3. "category": The category you detected ('new' or 'used').
4. PRIORITY: A message can have BOTH a device and a forbidden phrase. Find both.
5. "esim" EXCEPTION: The phrase "esim" is only forbidden if the message does not also mention "physical". If the message contains "physical" (or "physical sim") and "esim", it is considered "physical" and "esim" should not be listed as forbidden.`;
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
  if (!isAuthorized(req)) return res.sendStatus(403);
  const provider = String(req.body?.provider || '').toLowerCase().trim();
  providerService.setActiveProvider(provider);
  await settingsStore.updateSettings({ activeProvider: provider });
  res.json({ success: true, activeProvider: provider });
});

app.get('/api/settings', async (req, res) => res.json(await settingsStore.getSettings()));

app.post('/api/settings', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  const nextApiKey = String(req.body?.apiKey || '').trim();
  if (nextApiKey) runtimeApiKey = nextApiKey;
  await settingsStore.updateSettings(req.body || {});
  res.json({ success: true });
});

app.get('/api/catalog-source', (req, res) => {
  res.json({ inventoryCsvUrl: catalog.getInventoryCsvUrl(), arrangementCsvUrl: catalog.getArrangementCsvUrl() });
});

app.post('/api/catalog-source', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  catalog.setInventoryCsvUrl(String(req.body?.inventoryCsvUrl || '').trim());
  catalog.setArrangementCsvUrl(String(req.body?.arrangementCsvUrl || '').trim());
  const loaded = await catalog.loadCatalog();
  if (!loaded.success) return res.status(400).json(loaded);
  await settingsStore.updateSettings({ inventoryCsvUrl: catalog.getInventoryCsvUrl(), arrangementCsvUrl: catalog.getArrangementCsvUrl() });
  return res.json({ success: true, ...loaded });
});

app.get('/api/bot-logic', async (req, res) => {
  const settings = await settingsStore.getSettings();
  res.json({
    forbiddenNewPhrases: sanitizeStringArray(settings.forbiddenNewPhrases),
    forbiddenUsedPhrases: sanitizeStringArray(settings.forbiddenUsedPhrases),
    dynamicResponses: sanitizeStringArray(settings.dynamicResponses),
  });
});

app.post('/api/bot-logic', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  const next = {
    forbiddenNewPhrases: sanitizeStringArray(req.body?.forbiddenNewPhrases),
    forbiddenUsedPhrases: sanitizeStringArray(req.body?.forbiddenUsedPhrases),
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
  if (!isAuthorized(req)) return res.sendStatus(403);
  try {
    await processor.upsertDictionary(req.body || {});
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/dictionary/:id', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  await processor.deleteDictionary(req.params.id);
  res.json({ success: true });
});

app.get('/api/requests', async (req, res) => {
  if (!firestore) return res.json({ requests: [] });
  try {
    const snap = await firestore.collection('ar_raw_requests').orderBy('timestamp', 'desc').limit(50).get();
    res.json({ requests: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  } catch {
    res.json({ requests: [] });
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

app.post('/api/respond', async (req, res) => {
  console.log('\n🔔 Incoming /api/respond request');
  console.log('🔑 Key Provided:', req.headers['x-api-key'] || req.query.key || 'NONE');

  if (!isAuthorized(req)) {
    console.log(`🚫 Unauthorized request. Server expects key: ${resolveExpectedApiKey()}`);
    return res.sendStatus(403);
  }

  const userMessage = String(req.body?.senderMessage || '').trim();
  if (!userMessage) {
    return res.status(400).json({ error: 'Missing senderMessage' });
  }

  try {
    const settings = await settingsStore.getSettings();

    const newDevices = catalog.getNewDevices();
    const usedDevices = catalog.getUsedDevices();

    const activeNewDevices = newDevices.length ? newDevices : ['iphone 13 pro max'];
    const activeUsedDevices = usedDevices.length ? usedDevices : ['iphone 13 pro max'];

    const forbiddenNew = sanitizeStringArray(settings.forbiddenNewPhrases, { lowerCase: true });
    const forbiddenUsed = sanitizeStringArray(settings.forbiddenUsedPhrases, { lowerCase: true });
    const activeForbiddenNew = forbiddenNew.length ? forbiddenNew : DEFAULT_FORBIDDEN_NEW;
    const activeForbiddenUsed = forbiddenUsed.length ? forbiddenUsed : DEFAULT_FORBIDDEN_USED;

    const dynamicResponses = sanitizeStringArray(settings.dynamicResponses);
    const activeResponses = dynamicResponses.length ? dynamicResponses : DEFAULT_DYNAMIC_RESPONSES;

    const provider = String(settings.activeProvider || providerService.getActiveProvider() || 'chatgpt').toLowerCase();
    providerService.setActiveProvider(provider);

    const prompt = buildWebhookPrompt({
      newDevices: activeNewDevices,
      usedDevices: activeUsedDevices,
      forbiddenNew: activeForbiddenNew,
      forbiddenUsed: activeForbiddenUsed,
    });

    const rawProviderResult = await providerService.runProvider(provider, prompt, userMessage);
    const aiResponse = JSON.parse(rawProviderResult || '{}');

    const category = aiResponse.category === 'used' ? 'used' : 'new';
    const foundDevice = aiResponse.device ? String(aiResponse.device).toLowerCase() : null;
    const foundForbidden = aiResponse.forbidden ? String(aiResponse.forbidden).toLowerCase() : null;

    const activeSupportedList = category === 'used' ? activeUsedDevices : activeNewDevices;
    const activeForbiddenList = category === 'used' ? activeForbiddenUsed : activeForbiddenNew;

    let finalResponse = null;

    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      console.log(`🚫 Blocked by forbidden phrase: ${foundForbidden}`);
    } else if (foundDevice && activeSupportedList.includes(foundDevice)) {
      finalResponse = activeResponses[responseIndex % activeResponses.length];
      responseIndex += 1;
      console.log(`✅ Match found: ${foundDevice}; reply: ${finalResponse}`);
    } else {
      console.log('🤷 No matching supported device.');
    }

    setImmediate(async () => {
      try {
        await processor.saveRawRequest({
          senderId: req.body?.senderId || 'Unknown',
          senderMessage: userMessage,
          aiCategory: category,
          aiDeviceMatch: foundDevice,
          replied: Boolean(finalResponse),
          timestamp: Date.now(),
          processed: false,
        });
      } catch (err) {
        console.error('Failed to log request:', err.message);
      }
    });

    if (finalResponse) return res.json({ data: [{ message: finalResponse }] });
    return res.sendStatus(204);
  } catch (err) {
    console.error('💥 Webhook server error:', err.message);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

(async () => {
  try {
    const settings = await settingsStore.getSettings();
    runtimeApiKey = settings.apiKey || runtimeApiKey;
    providerService.setActiveProvider(String(settings.activeProvider || providerService.getActiveProvider() || 'chatgpt').toLowerCase());
    catalog.setInventoryCsvUrl(settings.inventoryCsvUrl || GOOGLE_SHEETS_CSV_URL);
    catalog.setArrangementCsvUrl(settings.arrangementCsvUrl || ARRANGEMENT_MAP_CSV_URL);
    await catalog.loadCatalog();
  } catch (e) {
    console.error('Error during init:', e.message);
  }
})();

module.exports = app;
