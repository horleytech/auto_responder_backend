const express = require('express');
const cors = require('cors');
const path = require('path');
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

// ─── DASHBOARD ENDPOINTS ──────────────────────────────────────────────────
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
  const available = providerService.listProviders().providers.map((entry) => entry.name);
  if (!available.includes(provider)) return res.status(400).json({ error: `Unknown provider: ${provider}` });
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
  console.log(`\n🔔 [WEBHOOK] Request received!`);
  
  if (!isAuthorized(req)) {
    console.log(`🚫 [BLOCKED] Unauthorized Request.`);
    return res.sendStatus(403);
  }

  const userMessage = String(req.body?.senderMessage || '').trim();
  if (!userMessage) {
    console.log(`⚠️ [BLOCKED] Missing 'senderMessage'.`);
    return res.status(400).json({ error: 'Missing senderMessage' });
  }

  console.log(`📥 INCOMING MESSAGE: "${userMessage}"`);

  try {
    const settings = await settingsStore.getSettings();
    const activeProvider = String(settings.activeProvider || providerService.getActiveProvider() || 'chatgpt').toLowerCase();
    providerService.setActiveProvider(activeProvider);

    // Dynamically load live catalog data
    const activeNewDevices = catalog.getNewDevices().length ? catalog.getNewDevices() : ['iphone 13 pro max'];
    const activeUsedDevices = catalog.getUsedDevices().length ? catalog.getUsedDevices() : ['iphone 13 pro max'];
    
    let activeForbiddenNew = sanitizeStringArray(settings.forbiddenNewPhrases);
    if (!activeForbiddenNew.length) activeForbiddenNew = ['esim', 'locked', 'idm', 'wifi only', 'panel', 'Used'];
    
    let activeForbiddenUsed = sanitizeStringArray(settings.forbiddenUsedPhrases);
    if (!activeForbiddenUsed.length) activeForbiddenUsed = ['esim', 'locked', 'idm', 'wifi only', 'panel', 'NEW'];
    
    let activeDynamicResponses = sanitizeStringArray(settings.dynamicResponses);
    if (!activeDynamicResponses.length) activeDynamicResponses = ["Available", "Available chief", "Available boss"];

    const prompt = `You are a JSON-based entity extractor. Return JSON ONLY.
Category: If message contains 'used', category is 'used'. Else 'new'.
List of NEW devices: ${activeNewDevices.join(', ')}
List of NEW forbidden phrases: ${activeForbiddenNew.join(', ')}
List of USED devices: ${activeUsedDevices.join(', ')}
List of USED forbidden phrases: ${activeForbiddenUsed.join(', ')}

Format: {"device": string | null, "forbidden": string | null, "category": "new" | "used"}
RULES: "device" must perfectly match a string in the active list. "forbidden" must perfectly match a phrase in the active list. Both can be found. Exception: 'esim' is not forbidden if 'physical' is also in the message.`;

    const aiRawResponse = await providerService.runProvider(
      activeProvider,
      prompt,
      userMessage,
      {
        openAiKey: String(settings.OPENAI_API_KEY || '').trim() || OPENAI_API_KEY || process.env.OPENAI_API_KEY,
        qwenKey: String(settings.QWEN_API_KEY || '').trim() || QWEN_API_KEY || process.env.QWEN_API_KEY,
      }
    );
    const aiResponse = JSON.parse(aiRawResponse || '{}');
    const { category, device, forbidden } = aiResponse;
    const foundDevice = device ? device.toLowerCase() : null;
    const foundForbidden = forbidden ? forbidden.toLowerCase() : null;

    const activeSupportedList = (category === 'used') ? activeUsedDevices : activeNewDevices;
    const activeForbiddenList = (category === 'used') ? activeForbiddenUsed : activeForbiddenNew;

    let finalResponse = null;

    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      console.log(`🚫 Blocked by forbidden phrase: ${foundForbidden}`);
    } else if (foundDevice && activeSupportedList.includes(foundDevice)) {
      finalResponse = activeDynamicResponses[responseIndex % activeDynamicResponses.length];
      responseIndex++;
      console.log(`✅ Match found: ${foundDevice}. Sending reply: ${finalResponse}`);
    } else {
      console.log(`🤷 No match or forbidden phrase found.`);
    }

    // Log to Processor before returning response (important in serverless environments)
    try {
      await processor.saveRawRequest({
        senderId: req.body?.senderId || 'Unknown',
        senderMessage: userMessage,
        aiCategory: category,
        aiDeviceMatch: foundDevice,
        replied: !!finalResponse,
        provider: activeProvider,
        timestamp: Date.now(),
        processed: false,
      });
    } catch (err) {
      console.error('Failed to log request:', err.message);
    }

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

(async () => {
  try {
    const settings = await settingsStore.getSettings();
    runtimeApiKey = settings.apiKey || runtimeApiKey;
    providerService.setActiveProvider(settings.activeProvider || providerService.getActiveProvider());
    catalog.setInventoryCsvUrl(settings.inventoryCsvUrl || GOOGLE_SHEETS_CSV_URL);
    catalog.setArrangementCsvUrl(settings.arrangementCsvUrl || ARRANGEMENT_MAP_CSV_URL);
    await catalog.loadCatalog();
  } catch (e) {
    console.error('Error during init:', e.message);
  }
})();

module.exports = app;
