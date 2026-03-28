const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const {
  API_KEY, DASHBOARD_PASSWORD, OPENAI_API_KEY, QWEN_API_KEY, GOOGLE_SHEETS_CSV_URL, ARRANGEMENT_MAP_CSV_URL, CORS_ALLOWED_ORIGINS,
} = require('./config/env');
const { firestore, FieldValue } = require('./services/firebaseService');
const { createCatalogService } = require('./services/catalogService');
const { createProviderService } = require('./services/providerService');
const settingsStore = require('./services/settingsStore');
const { createProcessor } = require('./services/processor');
const { createMaintenanceRouter } = require('./controllers/maintenance');

const app = express();
const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://autoresponder.horleytech.com',
  'https://www.autoresponder.horleytech.com',
];
const allowedOrigins = CORS_ALLOWED_ORIGINS.length ? CORS_ALLOWED_ORIGINS : defaultAllowedOrigins;

function originMatchesRule(origin, rule) {
  const normalizedRule = String(rule || '').trim();
  if (!normalizedRule) return false;
  if (normalizedRule === '*') return true;
  if (!normalizedRule.includes('*')) return normalizedRule === origin;
  const escaped = normalizedRule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const pattern = new RegExp(`^${escaped}$`);
  return pattern.test(origin);
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.some((rule) => originMatchesRule(origin, rule))) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const catalog = createCatalogService(GOOGLE_SHEETS_CSV_URL, ARRANGEMENT_MAP_CSV_URL);
const providerService = createProviderService();
const processor = createProcessor({ firestore, catalog, providerService, settingsStore, FieldValue });
let responseIndex = 0;
let runtimeApiKey = process.env.API_KEY || API_KEY;
const DASHBOARD_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REQUEST_STATUSES = {
  BLOCKED_FORBIDDEN: 'blocked_forbidden',
  REPLIED: 'replied',
  MATCHED_NO_REPLY: 'matched_no_reply',
  NO_MATCH: 'no_match',
};
const PERSISTED_REQUEST_STATUSES = new Set([REQUEST_STATUSES.REPLIED, REQUEST_STATUSES.MATCHED_NO_REPLY]);

function resolveSenderId(body = {}) {
  const candidates = [
    body.senderName,
    body.customerName,
    body.name,
    body.senderId,
    body.sender,
    body.sender?.name,
    body.sender?.id,
    body.sender?.phone,
    body.senderPhone,
    body.phone,
    body.customer,
    body.customerId,
    body.contact,
    body.contactName,
    body.chatId,
    body.from,
  ];
  for (const value of candidates) {
    const cleaned = String(value || '').trim();
    if (cleaned) return cleaned;
  }
  return 'Unknown';
}

function parseDateRange(query = {}) {
  const startRaw = String(query.start || '').trim();
  const endRaw = String(query.end || '').trim();

  const start = startRaw ? new Date(startRaw).getTime() : 0;
  const endBase = endRaw ? new Date(endRaw).getTime() : Number.POSITIVE_INFINITY;
  const end = Number.isFinite(endBase) ? endBase + 86400000 - 1 : Number.POSITIVE_INFINITY;

  return {
    start: Number.isFinite(start) ? start : 0,
    end,
  };
}

function requestTimestamp(row) {
  const rawTime = row.timestamp || row.processedAt || row.createdAt;
  return typeof rawTime === 'number' ? rawTime : new Date(rawTime).getTime();
}

function resolveRequestStatus(row = {}) {
  const status = String(row.status || '').trim();
  if (status) return status;
  if (row.replied === true) return REQUEST_STATUSES.REPLIED;
  if (row.matchedDevice || row.aiDeviceMatch) return REQUEST_STATUSES.MATCHED_NO_REPLY;
  return REQUEST_STATUSES.NO_MATCH;
}

function isDashboardVisibleRequest(row = {}) {
  const status = resolveRequestStatus(row);
  if (PERSISTED_REQUEST_STATUSES.has(status)) return true;
  if (row.replied === true) return true;
  if (row.matchedDevice || row.aiDeviceMatch) return true;
  return false;
}

async function persistCatalogHistory() {
  const historicalCatalogDevices = catalog.getHistoricalDevices();
  await settingsStore.updateSettings({ historicalCatalogDevices });
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
}

function resolveExpectedApiKey() {
  return String(process.env.API_KEY || runtimeApiKey || API_KEY).trim();
}

function isAuthorized(req) {
  const incoming = String(req.headers['x-api-key'] || '').trim();
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
  if (!DASHBOARD_PASSWORD) return null;
  const expiresAt = Date.now() + DASHBOARD_SESSION_TTL_MS;
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${expiresAt}.${nonce}`;
  const sig = crypto.createHmac('sha256', DASHBOARD_PASSWORD).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function createDashboardSession(res) {
  const token = generateDashboardSessionToken();
  if (!token) return null;
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
  if (!DASHBOARD_PASSWORD) return false;
  const payload = `${expiresRaw}.${nonce}`;
  const expectedSig = crypto.createHmac('sha256', DASHBOARD_PASSWORD).update(payload).digest('hex');
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
  const correctPassword = String(DASHBOARD_PASSWORD || '').trim();

  if (!correctPassword) {
    return res.status(500).json({ error: 'Server Error: DASHBOARD_PASSWORD not configured in .env' });
  }

  if (password === correctPassword) {
    const sessionToken = createDashboardSession(res);
    if (!sessionToken) {
      return res.status(500).json({ error: 'Server Error: DASHBOARD_PASSWORD not configured in .env' });
    }
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
  await settingsStore.updateSettings({
    inventoryCsvUrl: catalog.getInventoryCsvUrl(),
  });
  await persistCatalogHistory();
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
  if (!firestore) return res.json({ requests: [], summary: { total: 0, byStatus: {}, byHour: {}, byDevice: {} } });
  const { start, end } = parseDateRange(req.query || {});

  const summarizeRequests = (requests) => {
    const byStatus = requests.reduce((acc, row) => {
      const key = resolveRequestStatus(row);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const byDevice = requests.reduce((acc, row) => {
      const key = String(row.matchedDevice || row.aiDeviceMatch || '').trim();
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const byHour = requests.reduce((acc, row) => {
      const rawTime = row.timestamp || row.processedAt || row.createdAt;
      const millis = typeof rawTime === 'number' ? rawTime : new Date(rawTime).getTime();
      if (!Number.isFinite(millis)) return acc;
      const hourBucket = new Date(millis).toISOString().slice(0, 13) + ':00';
      acc[hourBucket] = (acc[hourBucket] || 0) + 1;
      return acc;
    }, {});

    const bySender = requests.reduce((acc, row) => {
      const key = String(row.senderId || 'Unknown').trim() || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return { total: requests.length, byStatus, byHour, byDevice, bySender };
  };

  try {
    const snap = await firestore.collection('ar_raw_requests').orderBy('timestamp', 'desc').limit(150).get();
    const rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const requests = rows.filter((row) => {
      if (!isDashboardVisibleRequest(row)) return false;
      const time = requestTimestamp(row);
      if (!Number.isFinite(time)) return true;
      return time >= start && time <= end;
    });
    res.json({ requests: requests.slice(0, 50), summary: summarizeRequests(requests) });
  } catch(e) { res.json({ requests: [], summary: { total: 0, byStatus: {}, byHour: {}, byDevice: {} } }); }
});

app.post('/api/requests/clear', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  if (!firestore) return res.json({ success: true, deleted: 0, mode: 'memory' });

  try {
    let deleted = 0;
    while (true) {
      const snap = await firestore.collection('ar_raw_requests').limit(300).get();
      if (snap.empty) break;

      const batch = firestore.batch();
      snap.docs.forEach((doc) => {
        batch.delete(doc.ref);
        deleted += 1;
      });
      await batch.commit();
      if (snap.size < 300) break;
    }

    return res.json({ success: true, deleted, mode: 'firebase' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to clear request logs' });
  }
});

app.get('/api/clean-analytics', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  const timeframe = String(req.query.timeframe || '1m').toLowerCase();
  const now = Date.now();
  const defaultSince = timeframe === '1w' ? now - 7 * 86400000 : timeframe === '1m' ? now - 30 * 86400000 : 0;
  const { start, end } = parseDateRange(req.query || {});
  const since = req.query.start ? start : defaultSince;
  const until = req.query.end ? end : Number.POSITIVE_INFINITY;
  let devices = [], customers = [];
  if (firestore) {
    try {
      const [aSnap, cSnap] = await Promise.all([
        firestore.collection('ar_analytics').orderBy('requestCount', 'desc').get(),
        firestore.collection('ar_customers').orderBy('totalRequests', 'desc').get()
      ]);
      devices = aSnap.docs.map((d) => d.data()).filter((d) => {
        if (!since && !Number.isFinite(until)) return true;
        const at = Number(d.lastRequestAt || 0);
        return at >= since && at <= until;
      }).slice(0, 10);
      customers = cSnap.docs.map((d) => d.data()).filter((d) => {
        if (!since && !Number.isFinite(until)) return true;
        const at = Number(d.lastActive || 0);
        return at >= since && at <= until;
      }).slice(0, 5);

      if (!customers.length || !devices.length) {
        const rawSnap = await firestore.collection('ar_raw_requests').orderBy('timestamp', 'desc').limit(1200).get();
        const persisted = rawSnap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((row) => isDashboardVisibleRequest(row))
          .filter((row) => {
            const at = requestTimestamp(row);
            return Number.isFinite(at) ? at >= since && at <= until : true;
          });

        if (!devices.length) {
          const byDevice = persisted.reduce((acc, row) => {
            const deviceName = String(row.matchedDevice || row.aiDeviceMatch || '').trim();
            if (!deviceName) return acc;
            acc[deviceName] = (acc[deviceName] || 0) + 1;
            return acc;
          }, {});
          devices = Object.entries(byDevice)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([deviceName, requestCount]) => ({ deviceName, requestCount }));
        }

        if (!customers.length) {
          const byCustomer = persisted.reduce((acc, row) => {
            const senderId = String(row.senderId || 'Unknown').trim() || 'Unknown';
            acc[senderId] = (acc[senderId] || 0) + 1;
            return acc;
          }, {});
          customers = Object.entries(byCustomer)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([senderId, totalRequests]) => ({ senderId, totalRequests }));
        }
      }
    } catch (e) { console.error("Firebase analytics read error:", e.message); }
  }
  res.json({ devices, customers, timeframe, start: since || null, end: Number.isFinite(until) ? until : null });
});

app.get('/api/catalog-mappings', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);

  const csvMappings = Object.entries(catalog.getArrangementMap())
    .map(([alias, normalizedName]) => ({ alias, normalizedName }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
  const catalogDevices = catalog.getAllCatalogDevices();

  const dictionaryRows = await processor.listDictionary();
  const csvAliasSet = new Set(csvMappings.map((row) => row.alias));
  const manualMappings = dictionaryRows
    .map((row) => ({
      alias: catalog.normalizeDeviceName(row.slang),
      normalizedName: catalog.normalizeDeviceName(row.normalizedName),
      source: 'manual',
    }))
    .filter((row) => row.alias && row.normalizedName && !csvAliasSet.has(row.alias))
    .sort((a, b) => a.alias.localeCompare(b.alias));

  const mergedMappings = [...csvMappings.map((row) => ({ ...row, source: 'csv' })), ...manualMappings];
  const historicalCatalogDevices = catalog.getHistoricalDevices();
  const historicalSet = new Set(historicalCatalogDevices);
  catalogDevices.forEach((name) => historicalSet.delete(name));
  const removedFromCsv = Array.from(historicalSet).sort();
  const seenMap = new Map();

  dictionaryRows.forEach((row) => {
    const normalizedName = String(row.normalizedName || '').trim();
    if (!normalizedName || catalogDevices.includes(normalizedName.toLowerCase())) return;
    if (!seenMap.has(normalizedName)) {
      seenMap.set(normalizedName, { normalizedName, source: 'dictionary', aliases: new Set([String(row.slang || '').trim()]) });
    }
  });

  if (firestore) {
    try {
      const rawSnap = await firestore.collection('ar_raw_requests').orderBy('timestamp', 'desc').limit(800).get();
      rawSnap.docs.forEach((doc) => {
        const row = doc.data() || {};
        const normalizedName = String(row.matchedDevice || row.aiDeviceMatch || '').trim();
        if (!normalizedName || catalogDevices.includes(normalizedName.toLowerCase())) return;
        const item = seenMap.get(normalizedName) || { normalizedName, source: 'requests', aliases: new Set() };
        item.aliases.add(String(row.senderMessage || '').slice(0, 80));
        seenMap.set(normalizedName, item);
      });
    } catch (err) {
      console.error('Failed to read raw requests for mapping insights:', err.message);
    }
  }

  const seenOutsideCatalog = Array.from(seenMap.values()).map((item) => ({
    normalizedName: item.normalizedName,
    source: item.source,
    aliases: Array.from(item.aliases).filter(Boolean).slice(0, 3),
  })).sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));

  res.json({
    csvMappings,
    manualMappings,
    mergedMappings,
    catalogDevices,
    removedFromCsv,
    seenOutsideCatalog,
    lastLoadedAt: catalog.getLastLoadedAt(),
  });
});



app.get('/api/catalog-preview', (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  res.json({
    inventory: catalog.getInventoryPreview(),
    inventoryCsvUrl: catalog.getInventoryCsvUrl(),
    lastLoadedAt: catalog.getLastLoadedAt(),
  });
});

app.post('/api/catalog-refresh', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  const loaded = await catalog.loadCatalog();
  if (!loaded.success) return res.status(400).json(loaded);
  await persistCatalogHistory();
  return res.json({ success: true, ...loaded });
});

app.use('/api/maintenance', createMaintenanceRouter({ firestore, processor, settingsStore, isDashboardAuthorized, catalog }));
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
    const resolvedDevice = foundDevice ? catalog.resolveDeviceForMessage({ mappedDevice: foundDevice, userMessage, category }) : null;

    let finalResponse = null;

    let requestStatus = REQUEST_STATUSES.NO_MATCH;

    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      requestStatus = REQUEST_STATUSES.BLOCKED_FORBIDDEN;
      console.log(`🚫 Blocked by forbidden phrase: ${foundForbidden}`);
    } else if (foundDevice) {
      if (resolvedDevice && activeSupportedList.includes(resolvedDevice)) {
        finalResponse = activeDynamicResponses[responseIndex % activeDynamicResponses.length];
        responseIndex++;
        requestStatus = finalResponse ? REQUEST_STATUSES.REPLIED : REQUEST_STATUSES.MATCHED_NO_REPLY;
        console.log(`✅ Match found: ${resolvedDevice}. Sending reply: ${finalResponse}`);
      }
    }

    if (!finalResponse && requestStatus === REQUEST_STATUSES.NO_MATCH && foundDevice) {
      console.log(`🤷 Device mapped but inventory/storage variant not available for message: ${foundDevice}`);
    } else if (!finalResponse && requestStatus === REQUEST_STATUSES.NO_MATCH) {
      console.log(`🤷 No match or forbidden phrase found.`);
    }

    if (PERSISTED_REQUEST_STATUSES.has(requestStatus)) {
      setImmediate(async () => {
        try {
          await processor.saveRawRequest({
            senderId: resolveSenderId(req.body),
            senderMessage: userMessage,
            aiCategory: category,
            aiDeviceMatch: resolvedDevice || foundDevice,
            matchedDevice: resolvedDevice || foundDevice,
            status: requestStatus,
            replied: !!finalResponse,
            timestamp: Date.now(),
            processed: false,
          });
        } catch (err) { console.error('Failed to log request:', err.message); }
      });
    }

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
    catalog.setHistoricalDevices(settings.historicalCatalogDevices || []);
    catalog.setInventoryCsvUrl(settings.inventoryCsvUrl || GOOGLE_SHEETS_CSV_URL);
    catalog.setArrangementCsvUrl(settings.arrangementCsvUrl || ARRANGEMENT_MAP_CSV_URL);
    const loaded = await catalog.loadCatalog();
    if (loaded.success) {
      await persistCatalogHistory();
      console.log(
        `📦 Catalog ready (${loaded.newCount} new, ${loaded.usedCount} used, ${loaded.arrangementCount} mapped aliases).`
      );
    } else {
      console.error(`❌ Catalog failed to load: ${loaded.error}`);
    }
  } catch (e) { console.error('Error during init:', e.message); }
})();

module.exports = app;
