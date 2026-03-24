const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const {
  API_KEY, OPENAI_API_KEY, QWEN_API_KEY, GOOGLE_SHEETS_CSV_URL, ARRANGEMENT_MAP_CSV_URL,
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
const DASHBOARD_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

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

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  const cookies = {};
  raw.split(';').forEach((part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return;
    cookies[k] = decodeURIComponent(rest.join('=') || '');
  });
  return cookies;
}

function generateDashboardSessionToken() {
  const expiresAt = Date.now() + DASHBOARD_SESSION_TTL_MS;
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${expiresAt}.${nonce}`;
  const secret = String(process.env.DASHBOARD_PASSWORD || process.env.API_KEY || API_KEY || 'dashboard-fallback-secret');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function createDashboardSession(res) {
  const token = generateDashboardSessionToken();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `dashboard_session=${token}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=28800`);
  return token;
}

function verifyDashboardToken(token) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const [expiresRaw, nonce, incomingSig] = parts;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || !nonce || expiresAt < Date.now()) {
    return false;
  }
  const payload = `${expiresRaw}.${nonce}`;
  const secret = String(process.env.DASHBOARD_PASSWORD || process.env.API_KEY || API_KEY || 'dashboard-fallback-secret');
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (incomingSig.length !== expectedSig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(incomingSig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

function isDashboardAuthorized(req) {
  const cookieToken = parseCookies(req).dashboard_session;
  if (verifyDashboardToken(cookieToken)) return true;
  const authHeader = String(req.headers.authorization || '');
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  if (verifyDashboardToken(bearerToken)) return true;
  const headerToken = String(req.headers['x-dashboard-session'] || '').trim();
  return verifyDashboardToken(headerToken);
}

// ─── NEW: SECURE LOGIN ENDPOINT ───────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const password = String(req.body?.password || '').trim();
  const correctPassword = String(process.env.DASHBOARD_PASSWORD || '').trim();

  if (!correctPassword) {
    return res.status(500).json({ error: 'Server Error: DASHBOARD_PASSWORD not configured in .env' });
  }

  if (password === correctPassword) {
    const sessionToken = createDashboardSession(res);
    res.json({ success: true, sessionToken, expiresInMs: DASHBOARD_SESSION_TTL_MS });
  } else {
    res.status(401).json({ error: 'Incorrect master password.' });
  }
});

app.post('/api/logout', (req, res) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `dashboard_session=; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=0`);
  res.json({ success: true });
});

// ─── DASHBOARD ENDPOINTS ──────────────────────────────────────────────────
app.get('/api/providers', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
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
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  const provider = String(req.body?.provider || '').toLowerCase().trim();
  providerService.setActiveProvider(provider);
  await settingsStore.updateSettings({ activeProvider: provider });
  if (firestore) {
    try { await firestore.collection('ar_settings').doc('system').set({ activeProvider: provider }, { merge: true }); }
    catch (e) { console.error("Firebase save error:", e.message); }
  }
  res.json({ success: true, activeProvider: provider });
});

app.get('/api/settings', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  res.json(await settingsStore.getSettings());
});

app.post('/api/settings', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  await settingsStore.updateSettings(req.body || {});
  res.json({ success: true });
});

app.get('/api/catalog-source', (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  res.json({ inventoryCsvUrl: catalog.getInventoryCsvUrl(), arrangementCsvUrl: catalog.getArrangementCsvUrl() });
});

app.post('/api/catalog-source', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  catalog.setInventoryCsvUrl(String(req.body?.inventoryCsvUrl || '').trim());
  catalog.setArrangementCsvUrl(String(req.body?.arrangementCsvUrl || '').trim());
  const loaded = await catalog.loadCatalog();
  if (!loaded.success) return res.status(400).json(loaded);
  await settingsStore.updateSettings({ inventoryCsvUrl: catalog.getInventoryCsvUrl(), arrangementCsvUrl: catalog.getArrangementCsvUrl() });
  return res.json({ success: true, ...loaded });
});

app.get('/api/bot-logic', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  const settings = await settingsStore.getSettings();
  res.json({
    forbiddenNewPhrases: sanitizeStringArray(settings.forbiddenNewPhrases),
    forbiddenUsedPhrases: sanitizeStringArray(settings.forbiddenUsedPhrases),
    dynamicResponses: sanitizeStringArray(settings.dynamicResponses),
  });
});

app.post('/api/bot-logic', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  const next = {
    forbiddenNewPhrases: sanitizeStringArray(req.body?.forbiddenNewPhrases),
    forbiddenUsedPhrases: sanitizeStringArray(req.body?.forbiddenUsedPhrases),
    dynamicResponses: sanitizeStringArray(req.body?.dynamicResponses),
  };
  await settingsStore.updateSettings(next);
  if (firestore) {
    try { await firestore.collection('ar_settings').doc('botLogic').set(next, { merge: true }); } 
    catch (e) { console.error("Firebase logic save error:", e.message); }
  }
  return res.json({ success: true, ...next });
});

app.get('/api/dictionary', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  const rows = await processor.listDictionary();
  res.json({ dictionary: rows });
});

app.post('/api/dictionary', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  try {
    await processor.upsertDictionary(req.body || {});
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/dictionary/:id', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  await processor.deleteDictionary(req.params.id);
  res.json({ success: true });
});

app.get('/api/requests', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  if (!firestore) return res.json({ requests: [] });
  try {
    const snap = await firestore.collection('ar_raw_requests').orderBy('timestamp', 'desc').limit(50).get();
    res.json({ requests: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  } catch(e) { res.json({ requests: [] }); }
});

app.get('/api/clean-analytics', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
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
    } catch (e) { console.error("Firebase analytics read error:", e.message); }
  }
  res.json({ devices, customers, timeframe });
});

app.use('/api/maintenance', createMaintenanceRouter({ firestore, processor, settingsStore, isDashboardAuthorized }));
app.get('/healthz', (req, res) => res.json({ ok: true, persistence: firestore ? 'firebase' : 'memory' }));

// ─── THE WEBHOOK (UNCHANGED) ──────────────────────────────────────────────
app.post('/api/respond', async (req, res) => {
  console.log(`\n🔔 [WEBHOOK] Request received!`);
  
  if (!isAuthorized(req)) return res.sendStatus(403);

  const userMessage = String(req.body?.senderMessage || '').trim();
  if (!userMessage) return res.status(400).json({ error: 'Missing senderMessage' });

  console.log(`📥 INCOMING MESSAGE: "${userMessage}"`);

  try {
    const settings = await settingsStore.getSettings();
    const loadedNew = catalog.getNewDevices();
    const loadedUsed = catalog.getUsedDevices();
    const activeNewDevices = loadedNew && loadedNew.length ? loadedNew : ['iphone 13 pro max'];
    const activeUsedDevices = loadedUsed && loadedUsed.length ? loadedUsed : ['iphone 13 pro max'];
    
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
RULES: 
1. "device": Find the closest match from the active list. It MUST match exactly how it is spelled in the list. Include storage (e.g. 256gb) if it exists in the item name in the list.
2. "forbidden": First matching forbidden phrase in the list. Both can be found. 
3. Exception: 'esim' is not forbidden if 'physical' is also in the message.`;

    const activeProvider = String(settings.activeProvider || providerService.getActiveProvider() || 'chatgpt').toLowerCase();
    console.log(`🤖 Routing request to ${activeProvider.toUpperCase()} API...`);

    const rawAiString = await providerService.runProvider(
      activeProvider, prompt, userMessage,
      { openAiKey: OPENAI_API_KEY || process.env.OPENAI_API_KEY, qwenKey: QWEN_API_KEY || process.env.QWEN_API_KEY }
    );

    const cleanedString = String(rawAiString).replace(/```json/gi, '').replace(/```/g, '').trim();
    const aiResponse = JSON.parse(cleanedString || '{}');

    const category = aiResponse.category === 'used' ? 'used' : 'new';
    const foundDevice = aiResponse.device ? String(aiResponse.device).toLowerCase() : null;
    const foundForbidden = aiResponse.forbidden ? String(aiResponse.forbidden).toLowerCase() : null;

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
      } catch (err) { console.error('Failed to log request:', err.message); }
    });

    if (finalResponse) return res.json({ data: [{ message: finalResponse }] });
    return res.sendStatus(204);

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
    if (firestore) {
      const doc = await firestore.collection('ar_settings').doc('botLogic').get();
      if (doc.exists) {
        console.log('📥 Loading saved Bot Logic from Firebase...');
        await settingsStore.updateSettings(doc.data());
      }
      const sys = await firestore.collection('ar_settings').doc('system').get();
      if (sys.exists && sys.data().activeProvider) {
         providerService.setActiveProvider(sys.data().activeProvider);
      }
    }
    const settings = await settingsStore.getSettings();
    catalog.setInventoryCsvUrl(settings.inventoryCsvUrl || GOOGLE_SHEETS_CSV_URL);
    catalog.setArrangementCsvUrl(settings.arrangementCsvUrl || ARRANGEMENT_MAP_CSV_URL);
    await catalog.loadCatalog();
  } catch (e) { console.error('Error during init:', e.message); }
})();

module.exports = app;
