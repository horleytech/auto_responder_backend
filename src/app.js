const express = require('express');
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
const { firestore } = require('./services/firebaseService');
const { createCatalogService } = require('./services/catalogService');
const { createProviderService } = require('./services/providerService');
const { createRequestStore } = require('./services/requestStore');
const { createSettingsStore } = require('./services/settingsStore');

const DEFAULT_FORBIDDEN_NEW_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'UK', 'Air', 'Used',
];

const DEFAULT_FORBIDDEN_USED_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'NEW',
];

const DEFAULT_DYNAMIC_RESPONSES = [
  'Available', 'Available chief', 'Available big chief', 'Available my Oga',
  'Big chief, this is available', 'Available boss', 'Available boss, we get am',
  'Available my guy', "My Oga, it's available", 'Available boss, make i paste address',
  'Available sir!', 'E dey o!', 'Available my king!', "Oga at the top, it's available!",
  'Available don!', 'My guy, e dey—available!', 'Available, we get am',
  'Big boss, it’s available!', 'Available legend', 'Abeg Oga, it’s available!',
  'Available my brother',
];

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

const envApiKey = process.env.API_KEY || API_KEY;
const envOpenAi = process.env.OPENAI_API_KEY || process.env.OPENAI_CHATGPT || OPENAI_API_KEY;
const envQwen = process.env.QWEN_API_KEY || QWEN_API_KEY;

if (!envApiKey || (!envOpenAi && !envQwen)) {
  console.error('❌ Missing API_KEY or provider key(s). Set API_KEY and at least one provider key.');
  process.exit(1);
}

let responseIndex = 0;
let botLogic = {
  forbiddenNewPhrases: [...DEFAULT_FORBIDDEN_NEW_PHRASES],
  forbiddenUsedPhrases: [...DEFAULT_FORBIDDEN_USED_PHRASES],
  dynamicResponses: [...DEFAULT_DYNAMIC_RESPONSES],
};

const catalog = createCatalogService(GOOGLE_SHEETS_CSV_URL, ARRANGEMENT_MAP_CSV_URL);
const providerService = createProviderService();
const requestStore = createRequestStore(firestore);
const settingsStore = createSettingsStore(firestore);

function isAuthorized(req) {
  return req.headers['x-api-key'] === (process.env.API_KEY || API_KEY);
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
}

function getSystemPrompt() {
  const newForbidden = botLogic.forbiddenNewPhrases;
  const usedForbidden = botLogic.forbiddenUsedPhrases;

  return `
You are the Gatekeeper for an inventory checker.
Analyze the user message and return ONLY a JSON object.

Return format:
{
  "category": "new" | "used",
  "intentItem": string | null,
  "forbidden": string | null,
  "isApproved": boolean,
  "reason": string
}

Rules:
1) Category is "used" if user explicitly indicates used/uk used/second hand; otherwise "new".
2) Forbidden list for NEW: ${newForbidden.join(', ')}
3) Forbidden list for USED: ${usedForbidden.join(', ')}
4) "esim" is forbidden ONLY when "physical" or "physical sim" is absent.
5) intentItem should be the primary requested device phrase as written by user.
6) If forbidden is detected, isApproved must be false.
7) Return strict JSON only.
`.trim();
}

app.get('/api/providers', (req, res) => {
  return res.json({
    ...providerService.listProviders(),
    envKeysLoaded: {
      API_KEY: Boolean(process.env.API_KEY || API_KEY),
      OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_CHATGPT || OPENAI_API_KEY),
      QWEN_API_KEY: Boolean(process.env.QWEN_API_KEY || QWEN_API_KEY),
    },
    persistence: firestore ? 'firebase' : 'memory',
  });
});

app.post('/api/providers', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);

  const provider = String(req.body?.provider || '').toLowerCase().trim();
  if (!['chatgpt', 'qwen'].includes(provider)) {
    return res.status(400).json({ error: 'Unsupported provider. Use chatgpt or qwen.' });
  }

  providerService.setActiveProvider(provider);
  await settingsStore.write({ activeProvider: provider });
  return res.json({
    ...providerService.listProviders(),
    persistence: firestore ? 'firebase' : 'memory',
  });
});

app.get('/api/catalog-source', (req, res) => {
  res.json({
    inventoryCsvUrl: catalog.getInventoryCsvUrl(),
    arrangementCsvUrl: catalog.getArrangementCsvUrl(),
    newCount: catalog.getNewDevices().length,
    usedCount: catalog.getUsedDevices().length,
    arrangementCount: Object.keys(catalog.getArrangementMap()).length,
    persistence: firestore ? 'firebase' : 'memory',
  });
});

app.post('/api/catalog-source', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);

  const inventoryCsvUrl = String(req.body?.inventoryCsvUrl || '').trim();
  const arrangementCsvUrl = String(req.body?.arrangementCsvUrl || '').trim();

  if (!inventoryCsvUrl || !arrangementCsvUrl) {
    return res.status(400).json({ error: 'Missing inventoryCsvUrl or arrangementCsvUrl' });
  }

  catalog.setInventoryCsvUrl(inventoryCsvUrl);
  catalog.setArrangementCsvUrl(arrangementCsvUrl);
  const result = await catalog.loadCatalog();
  if (!result.success) return res.status(400).json(result);

  await settingsStore.write({ inventoryCsvUrl, arrangementCsvUrl });
  return res.json({ inventoryCsvUrl, arrangementCsvUrl, ...result, persistence: firestore ? 'firebase' : 'memory' });
});

app.post('/api/reload-catalog', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  const result = await catalog.loadCatalog();
  if (!result.success) return res.status(500).json(result);
  return res.json({ ...result, persistence: firestore ? 'firebase' : 'memory' });
});

app.get('/api/bot-logic', (req, res) => {
  res.json({ ...botLogic, persistence: firestore ? 'firebase' : 'memory' });
});

app.post('/api/bot-logic', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);

  const next = {
    forbiddenNewPhrases: sanitizeStringArray(req.body?.forbiddenNewPhrases),
    forbiddenUsedPhrases: sanitizeStringArray(req.body?.forbiddenUsedPhrases),
    dynamicResponses: sanitizeStringArray(req.body?.dynamicResponses),
  };

  if (!next.forbiddenNewPhrases.length || !next.forbiddenUsedPhrases.length || !next.dynamicResponses.length) {
    return res.status(400).json({ error: 'All bot logic arrays must contain at least one value.' });
  }

  botLogic = next;
  await settingsStore.write(next);
  return res.json({ success: true, ...botLogic, persistence: firestore ? 'firebase' : 'memory' });
});

app.get('/api/requests', async (req, res) => {
  const requests = await requestStore.list();
  res.json({ count: requests.length, requests, persistence: firestore ? 'firebase' : 'memory' });
});

app.get('/api/grouped-requests', async (req, res) => {
  const grouped = await requestStore.grouped(30);
  res.json({ count: grouped.length, grouped, persistence: firestore ? 'firebase' : 'memory' });
});

app.get('/api/analytics', async (req, res) => {
  const timeframe = String(req.query.timeframe || '1m').toLowerCase();
  const daysMap = { '1w': 7, '1m': 30, '3m': 90, all: null };
  const timeframeDays = Object.prototype.hasOwnProperty.call(daysMap, timeframe) ? daysMap[timeframe] : 30;
  const data = await requestStore.analytics(timeframeDays);
  res.json({ timeframe, ...data, persistence: firestore ? 'firebase' : 'memory' });
});

app.post('/api/respond', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);

  const userMessage = req.body?.senderMessage;
  const senderId = String(req.body?.senderId || '').trim();
  if (!userMessage) return res.status(400).json({ error: 'Missing senderMessage' });
  if (!senderId) return res.status(400).json({ error: 'Missing senderId' });

  const provider = String(req.body?.provider || providerService.getActiveProvider()).toLowerCase();
  const requestEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    time: new Date().toISOString(),
    provider,
    senderId,
    senderMessage: userMessage,
    status: 'received',
  };

  try {
    const { gatekeeper, matchmaker } = await providerService.runTwoLayerCheck({
      provider,
      userMessage,
      newForbidden: botLogic.forbiddenNewPhrases,
      usedForbidden: botLogic.forbiddenUsedPhrases,
      gatekeeperPrompt: getSystemPrompt(),
      catalog,
      overrides: {
        openAiKey: req.body?.OPENAI_API_KEY,
        qwenKey: req.body?.QWEN_API_KEY,
      },
    });

    requestEntry.gatekeeper = gatekeeper;
    requestEntry.matchmaker = matchmaker;

    if (!gatekeeper.isApproved) {
      requestEntry.status = 'blocked_forbidden';
      requestEntry.matchedForbidden = gatekeeper.forbidden || 'unknown';
      await requestStore.save(requestEntry);
      return res.sendStatus(204);
    }

    if (matchmaker.inInventory && matchmaker.matchedDevice) {
      const responsePool = botLogic.dynamicResponses.length ? botLogic.dynamicResponses : DEFAULT_DYNAMIC_RESPONSES;
      const dynamic = responsePool[responseIndex % responsePool.length];
      responseIndex += 1;
      requestEntry.status = 'matched';
      requestEntry.matchedDevice = matchmaker.matchedDevice;
      requestEntry.outboundResponse = dynamic || CUSTOM_RESPONSE;
      await requestStore.save(requestEntry);
      return res.json({ data: [{ message: dynamic || CUSTOM_RESPONSE }] });
    }

    requestEntry.status = 'no_match';
    await requestStore.save(requestEntry);
    return res.sendStatus(204);
  } catch (err) {
    requestEntry.status = 'failed';
    requestEntry.error = err.message;
    await requestStore.save(requestEntry);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    provider: providerService.getActiveProvider(),
    inventoryCsvUrl: catalog.getInventoryCsvUrl(),
    arrangementCsvUrl: catalog.getArrangementCsvUrl(),
    newCount: catalog.getNewDevices().length,
    usedCount: catalog.getUsedDevices().length,
    arrangementCount: Object.keys(catalog.getArrangementMap()).length,
    persistence: firestore ? 'firebase' : 'memory',
  });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }

  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

(async () => {
  const saved = await settingsStore.read();

  if (saved.activeProvider && ['chatgpt', 'qwen'].includes(saved.activeProvider)) {
    providerService.setActiveProvider(saved.activeProvider);
  } else {
    providerService.setActiveProvider(DEFAULT_AI_PROVIDER);
  }

  if (saved.inventoryCsvUrl) catalog.setInventoryCsvUrl(saved.inventoryCsvUrl);
  if (saved.arrangementCsvUrl) catalog.setArrangementCsvUrl(saved.arrangementCsvUrl);

  const existingForbiddenNew = sanitizeStringArray(saved.forbiddenNewPhrases);
  const existingForbiddenUsed = sanitizeStringArray(saved.forbiddenUsedPhrases);
  const existingDynamicResponses = sanitizeStringArray(saved.dynamicResponses);

  botLogic = {
    forbiddenNewPhrases: existingForbiddenNew.length ? existingForbiddenNew : [...DEFAULT_FORBIDDEN_NEW_PHRASES],
    forbiddenUsedPhrases: existingForbiddenUsed.length ? existingForbiddenUsed : [...DEFAULT_FORBIDDEN_USED_PHRASES],
    dynamicResponses: existingDynamicResponses.length ? existingDynamicResponses : [...DEFAULT_DYNAMIC_RESPONSES],
  };

  if (!existingForbiddenNew.length || !existingForbiddenUsed.length || !existingDynamicResponses.length) {
    await settingsStore.write(botLogic);
  }

  await catalog.loadCatalog();
})();

module.exports = app;
