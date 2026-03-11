const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  API_KEY,
  OPENAI_API_KEY,
  QWEN_API_KEY,
  CUSTOM_RESPONSE,
  DEFAULT_AI_PROVIDER,
  GOOGLE_SHEETS_CSV_URL,
  ARRANGEMENT_MAP_CSV_URL,
} = require('./config/env');
const { firestore, FieldValue } = require('./services/firebaseService');
const { createCatalogService } = require('./services/catalogService');
const { createProviderService } = require('./services/providerService');
const { createSettingsStore } = require('./services/settingsStore');
const { createProcessor } = require('./services/processor');
const { createMaintenanceRouter } = require('./controllers/maintenance');

const DEFAULT_FORBIDDEN_NEW_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'UK', 'Air', 'Used',
];
const DEFAULT_FORBIDDEN_USED_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'NEW',
];
const DEFAULT_DYNAMIC_RESPONSES = [
  'Available', 'Available chief', 'Available big chief', 'Available my Oga', 'Big chief, this is available', 'Available boss',
  'Available boss, we get am', 'Available my guy', "My Oga, it's available", 'Available boss, make i paste address', 'Available sir!',
  'E dey o!', 'Available my king!', "Oga at the top, it's available!", 'Available don!', 'My guy, e dey—available!', 'Available, we get am',
  'Big boss, it’s available!', 'Available legend', 'Abeg Oga, it’s available!', 'Available my brother',
];

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const catalog = createCatalogService(GOOGLE_SHEETS_CSV_URL, ARRANGEMENT_MAP_CSV_URL);
const providerService = createProviderService();
const settingsStore = createSettingsStore(firestore);
const processor = createProcessor({ firestore, catalog, providerService, settingsStore, FieldValue });

let responseIndex = 0;
let botLogic = {
  forbiddenNewPhrases: [...DEFAULT_FORBIDDEN_NEW_PHRASES],
  forbiddenUsedPhrases: [...DEFAULT_FORBIDDEN_USED_PHRASES],
  dynamicResponses: [...DEFAULT_DYNAMIC_RESPONSES],
};
let runtimeApiKey = process.env.API_KEY || API_KEY;

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
}

function resolveExpectedApiKey() {
  return process.env.API_KEY || runtimeApiKey || API_KEY;
}

function isAuthorized(req) {
  const incoming = String(req.headers['x-api-key'] || req.query.key || '').trim();
  return incoming && incoming === resolveExpectedApiKey();
}

function getDynamicResponse() {
  const pool = botLogic.dynamicResponses.length ? botLogic.dynamicResponses : DEFAULT_DYNAMIC_RESPONSES;
  const next = pool[responseIndex % pool.length] || CUSTOM_RESPONSE;
  responseIndex += 1;
  return next;
}

function buildLayer1Prompt() {
  return `You are a fast gatekeeper classifier. Return ONLY JSON: {"category":"new|used","blocked":boolean,"forbidden":string|null}.\nForbidden NEW: ${botLogic.forbiddenNewPhrases.join(', ')}\nForbidden USED: ${botLogic.forbiddenUsedPhrases.join(', ')}\nRules: if message contains used/uk used then category=used else new. 'esim' is only forbidden when physical/physical sim is absent.`;
}

async function runLayer1(provider, senderMessage, overrides = {}) {
  try {
    const raw = await providerService.runProvider(provider, buildLayer1Prompt(), senderMessage, overrides);
    const parsed = JSON.parse(raw || '{}');
    return {
      category: parsed.category === 'used' ? 'used' : 'new',
      blocked: Boolean(parsed.blocked),
      forbidden: parsed.forbidden || null,
    };
  } catch {
    const lower = String(senderMessage || '').toLowerCase();
    const category = lower.includes('used') ? 'used' : 'new';
    const banned = (category === 'used' ? botLogic.forbiddenUsedPhrases : botLogic.forbiddenNewPhrases).map((x) => x.toLowerCase());
    const forbidden = banned.find((term) => lower.includes(term.toLowerCase()));
    return { category, blocked: Boolean(forbidden), forbidden: forbidden || null };
  }
}

app.get('/api/providers', async (req, res) => {
  const saved = await settingsStore.read();
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


app.get('/api/settings', async (req, res) => {
  const settings = await settingsStore.read();
  res.json({
    apiKeyConfigured: Boolean(settings.apiKey || process.env.API_KEY || API_KEY),
    activeProvider: settings.activeProvider || providerService.getActiveProvider(),
  });
});

app.post('/api/settings', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  const nextApiKey = String(req.body?.apiKey || '').trim();
  if (nextApiKey) {
    runtimeApiKey = nextApiKey;
    await settingsStore.write({ apiKey: nextApiKey });
  }
  res.json({ success: true });
});
app.post('/api/providers', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  const provider = String(req.body?.provider || '').toLowerCase().trim();
  if (!['chatgpt', 'qwen'].includes(provider)) return res.status(400).json({ error: 'Unsupported provider.' });
  providerService.setActiveProvider(provider);
  await settingsStore.write({ activeProvider: provider });
  res.json({ success: true, activeProvider: provider });
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
  await settingsStore.write({ inventoryCsvUrl: catalog.getInventoryCsvUrl(), arrangementCsvUrl: catalog.getArrangementCsvUrl() });
  return res.json({ success: true, ...loaded });
});

app.get('/api/bot-logic', async (req, res) => {
  res.json(botLogic);
});

app.post('/api/bot-logic', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  const next = {
    forbiddenNewPhrases: sanitizeStringArray(req.body?.forbiddenNewPhrases),
    forbiddenUsedPhrases: sanitizeStringArray(req.body?.forbiddenUsedPhrases),
    dynamicResponses: sanitizeStringArray(req.body?.dynamicResponses),
  };
  if (!next.forbiddenNewPhrases.length || !next.forbiddenUsedPhrases.length || !next.dynamicResponses.length) {
    return res.status(400).json({ error: 'All arrays are required.' });
  }
  botLogic = next;
  await settingsStore.write(next);
  return res.json({ success: true, ...botLogic });
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

app.get('/api/clean-analytics', async (req, res) => {
  const timeframe = String(req.query.timeframe || '1m').toLowerCase();
  const now = Date.now();
  const since = timeframe === '1w' ? now - 7 * 86400000 : timeframe === '1m' ? now - 30 * 86400000 : 0;

  let devices = [];
  let customers = [];

  if (firestore) {
    const [aSnap, cSnap] = await Promise.all([firestore.collection('ar_analytics').orderBy('requestCount', 'desc').get(), firestore.collection('ar_customers').orderBy('totalRequests', 'desc').get()]);
    devices = aSnap.docs.map((d) => d.data()).filter((d) => !since || !d.lastRequestAt || d.lastRequestAt >= since).slice(0, 10);
    customers = cSnap.docs.map((d) => d.data()).filter((d) => !since || !d.lastActive || d.lastActive >= since).slice(0, 5);
  }

  res.json({ devices, customers, timeframe });
});

app.post('/api/respond', async (req, res) => {
  const authorized = isAuthorized(req);
  if (!authorized) return res.sendStatus(403);

  const settings = await settingsStore.read();
  const provider = String(req.body?.provider || settings.activeProvider || providerService.getActiveProvider()).toLowerCase();
  const senderMessage = String(req.body?.senderMessage || '').trim();
  if (!senderMessage) return res.status(400).json({ error: 'Missing senderMessage' });

  const layer1 = await runLayer1(provider, senderMessage, {
    openAiKey: req.body?.OPENAI_API_KEY,
    qwenKey: req.body?.QWEN_API_KEY,
  });

  const message = layer1.blocked ? '' : getDynamicResponse();
  res.status(200).json({ data: [{ message }], category: layer1.category, blocked: layer1.blocked });

  setImmediate(async () => {
    try {
      await processor.saveRawRequest({
        senderId: req.body?.senderId || 'Unknown',
        senderMessage,
        aiCategory: layer1.category,
        timestamp: Date.now(),
        processed: false,
      });
    } catch (err) {
      console.error('Failed to save raw request:', err.message);
    }
  });
});

app.use('/api/maintenance', createMaintenanceRouter({
  firestore,
  processor,
  settingsStore,
  resolveApiKey: resolveExpectedApiKey,
}));

app.get('/healthz', (req, res) => {
  res.json({ ok: true, persistence: firestore ? 'firebase' : 'memory' });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found' });
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

(async () => {
  const settings = await settingsStore.read();
  runtimeApiKey = settings.apiKey || runtimeApiKey;
  const activeProvider = settings.activeProvider || DEFAULT_AI_PROVIDER;
  providerService.setActiveProvider(activeProvider);

  catalog.setInventoryCsvUrl(settings.inventoryCsvUrl || GOOGLE_SHEETS_CSV_URL);
  catalog.setArrangementCsvUrl(settings.arrangementCsvUrl || ARRANGEMENT_MAP_CSV_URL);

  const nextBotLogic = {
    forbiddenNewPhrases: sanitizeStringArray(settings.forbiddenNewPhrases),
    forbiddenUsedPhrases: sanitizeStringArray(settings.forbiddenUsedPhrases),
    dynamicResponses: sanitizeStringArray(settings.dynamicResponses),
  };

  botLogic = {
    forbiddenNewPhrases: nextBotLogic.forbiddenNewPhrases.length ? nextBotLogic.forbiddenNewPhrases : [...DEFAULT_FORBIDDEN_NEW_PHRASES],
    forbiddenUsedPhrases: nextBotLogic.forbiddenUsedPhrases.length ? nextBotLogic.forbiddenUsedPhrases : [...DEFAULT_FORBIDDEN_USED_PHRASES],
    dynamicResponses: nextBotLogic.dynamicResponses.length ? nextBotLogic.dynamicResponses : [...DEFAULT_DYNAMIC_RESPONSES],
  };

  await settingsStore.write({
    forbiddenNewPhrases: botLogic.forbiddenNewPhrases,
    forbiddenUsedPhrases: botLogic.forbiddenUsedPhrases,
    dynamicResponses: botLogic.dynamicResponses,
  });

  await catalog.loadCatalog();
})();

module.exports = app;
