const express = require('express');
const { API_KEY, CUSTOM_RESPONSE, DEFAULT_AI_PROVIDER, GOOGLE_SHEETS_CSV_URL } = require('./config/env');
const { firestore } = require('./services/firebaseService');
const { createCatalogService } = require('./services/catalogService');
const { createProviderService } = require('./services/providerService');
const { createRequestStore } = require('./services/requestStore');
const { createSettingsStore } = require('./services/settingsStore');

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

if (!API_KEY) {
  console.error('❌ Missing API_KEY in environment');
  process.exit(1);
}

const FORBIDDEN_NEW_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'UK', 'Air', 'Used',
].map((p) => p.toLowerCase());

const FORBIDDEN_USED_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'NEW',
].map((p) => p.toLowerCase());

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

const catalog = createCatalogService(GOOGLE_SHEETS_CSV_URL);
const providerService = createProviderService();
const requestStore = createRequestStore(firestore);
const settingsStore = createSettingsStore(firestore);

function isAuthorized(req) {
  return req.headers['x-api-key'] === API_KEY;
}

function getSystemPrompt() {
  return `
You are a JSON-based entity extractor for an availability checker.
Your SOLE purpose is to analyze the user's message and return a JSON object.
Do not add any other text, conversation, or explanations.

First, determine the category: 'new' or 'used'. If the message contains 'used', the category is 'used'. Otherwise, default to 'new'.

Based on the category, use the appropriate lists:

List of NEW devices: ${catalog.getNewDevices().join(', ')}
List of NEW forbidden phrases: ${FORBIDDEN_NEW_PHRASES.join(', ')}

List of USED devices: ${catalog.getUsedDevices().join(', ')}
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
    csvUrl: catalog.getCsvUrl(),
    newCount: catalog.getNewDevices().length,
    usedCount: catalog.getUsedDevices().length,
    persistence: firestore ? 'firebase' : 'memory',
  });
});

app.post('/api/catalog-source', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);

  const nextUrl = String(req.body?.csvUrl || '').trim();
  if (!nextUrl) return res.status(400).json({ error: 'Missing csvUrl' });

  catalog.setCsvUrl(nextUrl);
  const result = await catalog.loadCatalog();
  if (!result.success) return res.status(400).json(result);

  await settingsStore.write({ csvUrl: nextUrl });
  return res.json({ csvUrl: catalog.getCsvUrl(), ...result, persistence: firestore ? 'firebase' : 'memory' });
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

app.post('/api/respond', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);

  const userMessage = req.body?.senderMessage;
  if (!userMessage) return res.status(400).json({ error: 'Missing senderMessage' });

  const provider = String(req.body?.provider || providerService.getActiveProvider()).toLowerCase();
  const requestEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    time: new Date().toISOString(),
    provider,
    senderMessage: userMessage,
    status: 'received',
  };

  try {
    const raw = await providerService.runProvider(provider, getSystemPrompt(), userMessage);
    let aiResponse;
    try {
      aiResponse = JSON.parse(raw);
    } catch {
      requestEntry.status = 'failed';
      requestEntry.error = 'AI response was not valid JSON';
      requestEntry.rawReply = raw;
      await requestStore.save(requestEntry);
      return res.status(500).json({ error: 'AI response was not valid JSON' });
    }

    const category = aiResponse.category;
    const foundDevice = aiResponse.device ? String(aiResponse.device).toLowerCase() : null;
    const foundForbidden = aiResponse.forbidden ? String(aiResponse.forbidden).toLowerCase() : null;

    const activeSupportedList = category === 'used' ? catalog.getUsedDevices() : catalog.getNewDevices();
    const activeForbiddenList = category === 'used' ? FORBIDDEN_USED_PHRASES : FORBIDDEN_NEW_PHRASES;

    requestEntry.rawReply = aiResponse;

    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      requestEntry.status = 'blocked_forbidden';
      requestEntry.matchedForbidden = foundForbidden;
      await requestStore.save(requestEntry);
      return res.sendStatus(204);
    }

    if (foundDevice && activeSupportedList.includes(foundDevice)) {
      const dynamic = DYNAMIC_RESPONSES[responseIndex];
      responseIndex = (responseIndex + 1) % DYNAMIC_RESPONSES.length;
      requestEntry.status = 'matched';
      requestEntry.matchedDevice = foundDevice;
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
    csvUrl: catalog.getCsvUrl(),
    newCount: catalog.getNewDevices().length,
    usedCount: catalog.getUsedDevices().length,
    persistence: firestore ? 'firebase' : 'memory',
  });
});

(async () => {
  const saved = await settingsStore.read();
  if (saved.activeProvider && ['chatgpt', 'qwen'].includes(saved.activeProvider)) {
    providerService.setActiveProvider(saved.activeProvider);
  } else {
    providerService.setActiveProvider(DEFAULT_AI_PROVIDER);
  }

  if (saved.csvUrl) {
    catalog.setCsvUrl(saved.csvUrl);
  }

  await catalog.loadCatalog();
})();

module.exports = app;
