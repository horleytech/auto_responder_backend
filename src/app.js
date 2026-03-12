const express = require('express');
const cors = require('cors');
const path = require('path');
const { OpenAI } = require('openai');
const {
  API_KEY,
  OPENAI_API_KEY,
  QWEN_API_KEY,
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
const openai = new OpenAI({ apiKey: OPENAI_API_KEY || process.env.OPENAI_API_KEY });

let responseIndex = 0;
let runtimeApiKey = process.env.API_KEY || API_KEY;

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
}

function resolveExpectedApiKey() {
  return String(process.env.API_KEY || runtimeApiKey || API_KEY).trim();
}

function isAuthorized(req) {
  const incoming = String(req.headers['x-api-key'] || req.query.key || '').trim();
  return incoming === resolveExpectedApiKey();
}

// ─── DASHBOARD ENDPOINTS (RESTORED) ───────────────────────────────────────
app.get('/api/providers', async (req, res) => {
  const saved = await settingsStore.getSettings();
  res.json({
    ...providerService.listProviders(),
    activeProvider: saved.activeProvider || providerService.getActiveProvider(),
    envKeysLoaded: {
      API_KEY: Boolean(process.env.API_KEY),
      OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_CHATGPT || OPENAI_API_KEY),
      QWEN_API_KEY: Boolean(process.env.QWEN_API_KEY || QWEN_API_KEY),
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
  } catch (err) { res.status(400).json({ error: err.message }); }
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
  } catch(e) { res.json({ requests: [] }); }
});

// ─── THE MISSING ANALYTICS ENDPOINT ───────────────────────────────────────
app.get('/api/clean-analytics', async (req, res) => {
  const timeframe = String(req.query.timeframe || '1m').toLowerCase();
  const now = Date.now();
  const since = timeframe === '1w' ? now - 7 * 86400000 : timeframe === '1m' ? now - 30 * 86400000 : 0;
  let devices = [], customers = [];
  if (firestore) {
    try {
      const [aSnap, cSnap] = await Promise.all([
        firestore.collection('ar_analytics').orderBy('requestCount', 'desc').get(),
        firestore.collection('ar_customers').orderBy('totalRequests', 'desc').get()
      ]);
      devices = aSnap.docs.map((d) => d.data()).filter((d) => !since || !d.lastRequestAt || d.lastRequestAt >= since).slice(0, 10);
      customers = cSnap.docs.map((d) => d.data()).filter((d) => !since || !d.lastActive || d.lastActive >= since).slice(0, 5);
    } catch (e) {
      console.error("Firebase analytics read error:", e.message);
    }
  }
  res.json({ devices, customers, timeframe });
});

app.use('/api/maintenance', createMaintenanceRouter({ firestore, processor, settingsStore, resolveApiKey: resolveExpectedApiKey }));

app.get('/healthz', (req, res) => res.json({ ok: true, persistence: firestore ? 'firebase' : 'memory' }));

// ─── THE BULLETPROOF WEBHOOK ──────────────────────────────────────────────
app.post('/api/respond', async (req, res) => {
  console.log(`\n🔔 [WEBHOOK ATTACK] Request hit the server!`);
  console.log(`🔑 Key Provided:`, req.headers['x-api-key'] || req.query.key || 'NONE');

  if (!isAuthorized(req)) {
    console.log(`🚫 [BLOCKED] Unauthorized Request. Server expects: ${resolveExpectedApiKey()}`);
    return res.sendStatus(403);
  }

  const userMessage = String(req.body?.senderMessage || '').trim();
  if (!userMessage) {
    console.log(`⚠️ [BLOCKED] Missing 'senderMessage' in body.`);
    return res.status(400).json({ error: 'Missing senderMessage' });
  }

  console.log(`📥 INCOMING MESSAGE: "${userMessage}"`);

  try {
    const settings = await settingsStore.getSettings();

    // Load Live Catalog & Settings safely
    const NEW_DEVICES = (catalog.supportedNewDevices && catalog.supportedNewDevices.length) ? catalog.supportedNewDevices : ['iphone 13 pro max'];
    const USED_DEVICES = (catalog.supportedUsedDevices && catalog.supportedUsedDevices.length) ? catalog.supportedUsedDevices : ['iphone 13 pro max'];
    
    let FORBIDDEN_NEW = sanitizeStringArray(settings.forbiddenNewPhrases);
    if (!FORBIDDEN_NEW.length) FORBIDDEN_NEW = ['esim', 'locked', 'idm', 'wifi only', 'panel', 'Used'];
    
    let FORBIDDEN_USED = sanitizeStringArray(settings.forbiddenUsedPhrases);
    if (!FORBIDDEN_USED.length) FORBIDDEN_USED = ['esim', 'locked', 'idm', 'wifi only', 'panel', 'NEW'];
    
    let DYNAMIC_RESPONSES = sanitizeStringArray(settings.dynamicResponses);
    if (!DYNAMIC_RESPONSES.length) DYNAMIC_RESPONSES = ["Available", "Available chief", "Available boss"];

    const prompt = `You are a JSON-based entity extractor. Return JSON ONLY.
Category: If message contains 'used', category is 'used'. Else 'new'.
List of NEW devices: ${NEW_DEVICES.join(', ')}
List of NEW forbidden phrases: ${FORBIDDEN_NEW.join(', ')}
List of USED devices: ${USED_DEVICES.join(', ')}
List of USED forbidden phrases: ${FORBIDDEN_USED.join(', ')}

Format: {"device": string | null, "forbidden": string | null, "category": "new" | "used"}
RULES: "device" must perfectly match a string in the active list. "forbidden" must perfectly match a phrase in the active list. Both can be found. Exception: 'esim' is not forbidden if 'physical' is also in the message.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: userMessage }],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);
    const { category, device, forbidden } = aiResponse;
    const foundDevice = device ? device.toLowerCase() : null;
    const foundForbidden = forbidden ? forbidden.toLowerCase() : null;

    const activeSupportedList = (category === 'used') ? USED_DEVICES : NEW_DEVICES;
    const activeForbiddenList = (category === 'used') ? FORBIDDEN_USED : FORBIDDEN_NEW;

    let finalResponse = null;

    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      console.log(`🚫 Blocked by forbidden phrase: ${foundForbidden}`);
    } else if (foundDevice && activeSupportedList.includes(foundDevice)) {
      finalResponse = DYNAMIC_RESPONSES[responseIndex % DYNAMIC_RESPONSES.length];
      responseIndex++;
      console.log(`✅ Match found: ${foundDevice}. Sending reply: ${finalResponse}`);
    } else {
      console.log(`🤷 No match or forbidden phrase found.`);
    }

    // Process Analytics via the Dictionary & Processor system
    setImmediate(async () => {
      try {
        await processor.saveRawRequest({
          senderId: req.body?.senderId || 'Unknown',
          senderMessage: userMessage,
          aiCategory: category,
          aiDeviceMatch: foundDevice,
          replied: !!finalResponse,
          timestamp: Date.now(),
          processed: false,
        });
      } catch (err) { console.error('Failed to log request to processor:', err.message); }
    });

    if (finalResponse) {
      return res.json({ data: [{ message: finalResponse }] });
    } else {
      return res.sendStatus(204);
    }

  } catch (err) {
    console.error('💥 Webhook Server error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── INITIALIZATION ──────────────────────────────────────────────────────────
(async () => {
  try {
    const settings = await settingsStore.getSettings();
    runtimeApiKey = settings.apiKey || runtimeApiKey;
    catalog.setInventoryCsvUrl(settings.inventoryCsvUrl || GOOGLE_SHEETS_CSV_URL);
    catalog.setArrangementCsvUrl(settings.arrangementCsvUrl || ARRANGEMENT_MAP_CSV_URL);
    await catalog.loadCatalog();
  } catch (e) {
    console.error('Error during init:', e.message);
  }
})();

module.exports = app;
