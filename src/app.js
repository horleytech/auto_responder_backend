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

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

if (!API_KEY || (!OPENAI_API_KEY && !QWEN_API_KEY)) {
  console.error('❌ Missing API_KEY or provider key(s). Set API_KEY and at least one provider key.');
  process.exit(1);
}

const FORBIDDEN_NEW_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'any iphone lower than iphone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iphone 8', 'iphone 7', 'charging port', 'icloud', 'panel', 'nfid', 'uk', 'air', 'used',
];

const FORBIDDEN_USED_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'any iphone lower than iphone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iphone 8', 'iphone 7', 'charging port', 'icloud', 'panel', 'nfid', 'new',
];

const DYNAMIC_RESPONSES = [
  'Available', 'Available chief', 'Available big chief', 'Available my Oga',
  'Big chief, this is available', 'Available boss', 'Available boss, we get am',
  'Available my guy', "My Oga, it's available", 'Available boss, make i paste address',
  'Available sir!', 'E dey o!', 'Available my king!', "Oga at the top, it's available!",
  'Available don!', 'My guy, e dey—available!', 'Available, we get am',
  'Big boss, it’s available!', 'Available legend', 'Abeg Oga, it’s available!',
  'Available my brother',
];
let responseIndex = 0;

const catalog = createCatalogService(GOOGLE_SHEETS_CSV_URL, ARRANGEMENT_MAP_CSV_URL);
const providerService = createProviderService();
const requestStore = createRequestStore(firestore);
const settingsStore = createSettingsStore(firestore);

function isAuthorized(req) {
  return req.headers['x-api-key'] === API_KEY;
}

app.get('/api/providers', (req, res) => {
  return res.json({
    ...providerService.listProviders(),
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
      newForbidden: FORBIDDEN_NEW_PHRASES,
      usedForbidden: FORBIDDEN_USED_PHRASES,
      catalog,
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
      const dynamic = DYNAMIC_RESPONSES[responseIndex];
      responseIndex = (responseIndex + 1) % DYNAMIC_RESPONSES.length;
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

  if (saved.inventoryCsvUrl) {
    catalog.setInventoryCsvUrl(saved.inventoryCsvUrl);
  }

  if (saved.arrangementCsvUrl) {
    catalog.setArrangementCsvUrl(saved.arrangementCsvUrl);
  }

  await catalog.loadCatalog();
})();

module.exports = app;
