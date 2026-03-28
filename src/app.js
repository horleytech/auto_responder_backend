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

function normalizeRequestStatus(value) {
  return String(value || '').trim().toLowerCase();
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

function deriveRequestStatus(row = {}) {
  const normalized = normalizeRequestStatus(row.status);
  if (normalized) return normalized;
  if (row.replied === true) return REQUEST_STATUSES.REPLIED;
  if (String(row.matchedDevice || row.aiDeviceMatch || '').trim()) return REQUEST_STATUSES.MATCHED_NO_REPLY;
  return REQUEST_STATUSES.NO_MATCH;
}

async function buildEffectiveMappings() {
  const csvMappings = Object.entries(catalog.getArrangementMap())
    .map(([alias, normalizedName]) => ({ alias, normalizedName, source: 'csv' }))
    .sort((a, b) => a.alias.localeCompare(b.alias));

  const effectiveMap = new Map();
  csvMappings.forEach((row) => effectiveMap.set(row.alias, row.normalizedName));

  const dictionaryRows = await processor.listDictionary();
  const learnedMappings = dictionaryRows
    .map((row) => {
      const alias = catalog.normalizeDeviceName(row.slang);
      const normalizedName = catalog.normalizeDeviceName(row.normalizedName);
      if (!alias || !normalizedName) return null;
      return { alias, normalizedName, source: 'dictionary' };
    })
    .filter(Boolean)
    .sort((a, b) => a.alias.localeCompare(b.alias));
  learnedMappings.forEach((row) => effectiveMap.set(row.alias, row.normalizedName));

  const settings = await settingsStore.getSettings();
  const manualMappings = (Array.isArray(settings.manualMappings) ? settings.manualMappings : [])
    .map((row) => {
      const alias = catalog.normalizeDeviceName(row?.alias);
      const normalizedName = catalog.normalizeDeviceName(row?.normalizedName);
      if (!alias || !normalizedName) return null;
      return { alias, normalizedName, source: 'manual' };
    })
    .filter(Boolean)
    .sort((a, b) => a.alias.localeCompare(b.alias));
  manualMappings.forEach((row) => effectiveMap.set(row.alias, row.normalizedName));

  return {
    csvMappings,
    learnedMappings,
    manualMappings,
    effectiveMap,
  };
}

function mergeArchiveProductMappings(existingArchive = {}, incomingGroups = []) {
  const nextArchive = { ...(existingArchive || {}) };
  incomingGroups.forEach((group) => {
    const product = catalog.normalizeDeviceName(group.product);
    if (!product) return;
    const current = nextArchive[product] || { product, aliases: [], sources: [], updatedAt: 0 };
    const aliasSet = new Set((current.aliases || []).map((alias) => catalog.normalizeDeviceName(alias)).filter(Boolean));
    const sourceSet = new Set((current.sources || []).filter(Boolean));
    (group.aliases || []).forEach((alias) => {
      const normalizedAlias = catalog.normalizeDeviceName(alias);
      if (normalizedAlias) aliasSet.add(normalizedAlias);
    });
    (group.sources || []).forEach((source) => sourceSet.add(source));
    nextArchive[product] = {
      product,
      aliases: Array.from(aliasSet).sort(),
      sources: Array.from(sourceSet).sort(),
      updatedAt: Date.now(),
    };
  });
  return nextArchive;
}

function formatProductGroupsFromArchive(archive = {}, activeProducts = new Set()) {
  return Object.values(archive)
    .filter((entry) => entry?.product && !activeProducts.has(entry.product))
    .map((entry) => ({
      product: entry.product,
      aliases: Array.isArray(entry.aliases) ? entry.aliases.filter(Boolean).sort() : [],
      sources: Array.isArray(entry.sources) ? entry.sources.filter(Boolean).sort() : [],
      updatedAt: Number(entry.updatedAt || 0),
    }))
    .sort((a, b) => a.product.localeCompare(b.product));
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
}

function sanitizeLowercaseStringArray(value) {
  return sanitizeStringArray(value).map((v) => v.toLowerCase());
}

async function persistCatalogHistory({ firestoreDb, catalogService, loaded }) {
  if (!firestoreDb || !loaded?.success) return;
  try {
    const payload = {
      newCount: Number(loaded.newCount || 0),
      usedCount: Number(loaded.usedCount || 0),
      arrangementCount: Number(loaded.arrangementCount || 0),
      sampleNewDevices: (catalogService.getNewDevices() || []).slice(0, 20),
      sampleUsedDevices: (catalogService.getUsedDevices() || []).slice(0, 20),
      updatedAt: Date.now(),
    };
    await firestoreDb.collection('ar_settings').doc('catalogHistory').set(payload, { merge: true });
  } catch (err) {
    console.error('Catalog history persistence skipped:', err.message);
  }
}

function resolveExpectedApiKey() {
  return String(process.env.API_KEY || runtimeApiKey || API_KEY).trim();
}

function isAuthorized(req) {
  const expected = resolveExpectedApiKey();
  if (!expected) return false;
  const incoming = String(req.headers['x-api-key'] || '').trim();
  if (!incoming) return false;
  return incoming === expected;
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
  let firebasePersisted = false;
  if (firestore) {
    try {
      await firestore.collection('ar_settings').doc('system').set({ activeProvider: provider }, { merge: true });
      firebasePersisted = true;
    }
    catch (e) { console.error("Firebase save error:", e.message); }
  }
  res.json({
    success: true,
    activeProvider: provider,
    persistence: firestore ? (firebasePersisted ? 'firebase' : 'memory-fallback') : 'memory',
  });
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
    arrangementCsvUrl: catalog.getArrangementCsvUrl(),
  });
  await persistCatalogHistory({ firestoreDb: firestore, catalogService: catalog, loaded });
  return res.json({ success: true, ...loaded });
});

app.get('/api/bot-logic', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  const settings = await settingsStore.getSettings();
  res.json({
    forbiddenNewPhrases: sanitizeLowercaseStringArray(settings.forbiddenNewPhrases),
    forbiddenUsedPhrases: sanitizeLowercaseStringArray(settings.forbiddenUsedPhrases),
    dynamicResponses: sanitizeStringArray(settings.dynamicResponses),
  });
});

app.post('/api/bot-logic', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  const next = {
    forbiddenNewPhrases: sanitizeLowercaseStringArray(req.body?.forbiddenNewPhrases),
    forbiddenUsedPhrases: sanitizeLowercaseStringArray(req.body?.forbiddenUsedPhrases),
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
  try {
    const dictionary = await processor.listDictionary();
    return res.json({ dictionary });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load dictionary' });
  }
});

app.post('/api/dictionary', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  try {
    await processor.upsertDictionary(req.body || {});
    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to save mapping' });
  }
});

app.delete('/api/dictionary/:id', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  try {
    await processor.deleteDictionary(String(req.params.id || ''));
    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to delete mapping' });
  }
});

app.get('/api/requests', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  if (!firestore) return res.json({ requests: [], summary: { total: 0, byStatus: {}, byHour: {}, byDevice: {} } });

  const summarizeRequests = (requests) => {
    const byStatus = requests.reduce((acc, row) => {
      const key = String(row.status || REQUEST_STATUSES.NO_MATCH);
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

    return { total: requests.length, byStatus, byHour, byDevice };
  };

  try {
    const snap = await firestore.collection('ar_raw_requests').orderBy('timestamp', 'desc').limit(150).get();
    const rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const requests = rows
      .map((row) => ({ ...row, status: deriveRequestStatus(row) }))
      .filter((row) => PERSISTED_REQUEST_STATUSES.has(row.status));
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
  let summaryFromRaw = null;
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
          .map((row) => ({ ...row, status: deriveRequestStatus(row) }))
          .filter((row) => PERSISTED_REQUEST_STATUSES.has(row.status))
          .filter((row) => {
            const at = requestTimestamp(row);
            return Number.isFinite(at) ? at >= since && at <= until : true;
          });

        if (persisted.length) {
          summaryFromRaw = persisted.reduce((acc, row) => {
            const status = normalizeRequestStatus(row.status) || REQUEST_STATUSES.NO_MATCH;
            const deviceName = String(row.matchedDevice || row.aiDeviceMatch || '').trim();
            const at = requestTimestamp(row);
            acc.total += 1;
            acc.byStatus[status] = (acc.byStatus[status] || 0) + 1;
            if (deviceName) acc.byDevice[deviceName] = (acc.byDevice[deviceName] || 0) + 1;
            if (Number.isFinite(at)) {
              const hourBucket = new Date(at).toISOString().slice(0, 13) + ':00';
              acc.byHour[hourBucket] = (acc.byHour[hourBucket] || 0) + 1;
            }
            return acc;
          }, { total: 0, byStatus: {}, byDevice: {}, byHour: {} });
        }

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
  const summaryFromDevices = devices.reduce((acc, row) => {
    const deviceName = String(row.deviceName || '').trim();
    const count = Number(row.requestCount || 0);
    if (!deviceName || count <= 0) return acc;
    acc.total += count;
    acc.byDevice[deviceName] = (acc.byDevice[deviceName] || 0) + count;
    const at = Number(row.lastRequestAt || 0);
    if (Number.isFinite(at) && at > 0) {
      const hourBucket = new Date(at).toISOString().slice(0, 13) + ':00';
      acc.byHour[hourBucket] = (acc.byHour[hourBucket] || 0) + count;
    }
    return acc;
  }, { total: 0, byStatus: {}, byDevice: {}, byHour: {} });
  if (!summaryFromRaw && summaryFromDevices.total > 0) {
    summaryFromDevices.byStatus[REQUEST_STATUSES.REPLIED] = summaryFromDevices.total;
  }
  const summary = summaryFromRaw || summaryFromDevices;

  res.json({
    devices,
    customers,
    summary,
    timeframe,
    start: since || null,
    end: Number.isFinite(until) ? until : null,
  });
});

app.get('/api/catalog-mappings', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);

  const { csvMappings, learnedMappings, manualMappings } = await buildEffectiveMappings();
  const settings = await settingsStore.getSettings();
  const catalogDevices = catalog.getAllCatalogDevices();
  const mergedMappings = [...csvMappings, ...manualMappings];
  const historicalCatalogDevices = catalog.getHistoricalDevices();
  const historicalSet = new Set(historicalCatalogDevices);
  catalogDevices.forEach((name) => historicalSet.delete(name));
  const removedFromCsv = Array.from(historicalSet).sort();
  const seenMap = new Map();

  learnedMappings.forEach((row) => {
    const normalizedName = String(row.normalizedName || '').trim();
    if (!normalizedName || catalogDevices.includes(normalizedName)) return;
    if (!seenMap.has(normalizedName)) {
      seenMap.set(normalizedName, { normalizedName, source: 'dictionary', aliases: new Set([String(row.alias || '').trim()]) });
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

  const activeProducts = Array.from(new Set(csvMappings.map((row) => row.normalizedName))).sort();
  const activeProductSet = new Set(activeProducts);

  const activeProductGroupMap = new Map();
  mergedMappings.forEach((row) => {
    if (!activeProductSet.has(row.normalizedName)) return;
    const bucket = activeProductGroupMap.get(row.normalizedName) || { product: row.normalizedName, aliases: new Set(), sources: new Set() };
    bucket.aliases.add(row.alias);
    bucket.sources.add(row.source);
    activeProductGroupMap.set(row.normalizedName, bucket);
  });

  const activeProductGroups = Array.from(activeProductGroupMap.values())
    .map((group) => ({
      product: group.product,
      aliases: Array.from(group.aliases).sort(),
      sources: Array.from(group.sources).sort(),
    }))
    .sort((a, b) => a.product.localeCompare(b.product));

  const inactiveCandidates = [];
  learnedMappings.forEach((row) => {
    if (activeProductSet.has(row.normalizedName)) return;
    inactiveCandidates.push({
      product: row.normalizedName,
      aliases: [row.alias],
      sources: [row.source],
    });
  });

  const previousActiveSnapshot = settings.lastActiveCsvProductMappings || {};
  Object.entries(previousActiveSnapshot).forEach(([product, aliases]) => {
    const normalizedProduct = catalog.normalizeDeviceName(product);
    if (!normalizedProduct || activeProductSet.has(normalizedProduct)) return;
    const safeAliases = Array.isArray(aliases) ? aliases : [];
    inactiveCandidates.push({
      product: normalizedProduct,
      aliases: safeAliases,
      sources: ['csv-history'],
    });
  });

  const mergedArchive = mergeArchiveProductMappings(settings.inactiveMappingArchive || {}, inactiveCandidates);
  const inactiveProductGroups = formatProductGroupsFromArchive(mergedArchive, activeProductSet);

  const nextActiveSnapshot = activeProductGroups.reduce((acc, group) => {
    acc[group.product] = group.aliases;
    return acc;
  }, {});

  const previousSnapshotJson = JSON.stringify(previousActiveSnapshot);
  const nextSnapshotJson = JSON.stringify(nextActiveSnapshot);
  const previousArchiveJson = JSON.stringify(settings.inactiveMappingArchive || {});
  const nextArchiveJson = JSON.stringify(mergedArchive);
  if (previousSnapshotJson !== nextSnapshotJson || previousArchiveJson !== nextArchiveJson) {
    await settingsStore.updateSettings({
      inactiveMappingArchive: mergedArchive,
      lastActiveCsvProductMappings: nextActiveSnapshot,
    });
  }

  res.json({
    csvMappings,
    learnedMappings,
    manualMappings,
    mergedMappings,
    catalogDevices,
    removedFromCsv,
    seenOutsideCatalog,
    activeProductGroups,
    inactiveProductGroups,
    lastLoadedAt: catalog.getLastLoadedAt(),
  });
});

app.post('/api/catalog-mappings/inactive/nuke', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  await settingsStore.updateSettings({ inactiveMappingArchive: {} });
  return res.json({ success: true });
});

app.post('/api/catalog-refresh', async (req, res) => {
  if (!isDashboardAuthorized(req)) return res.sendStatus(403);
  const loaded = await catalog.loadCatalog();
  if (!loaded.success) return res.status(400).json(loaded);
  await persistCatalogHistory({ firestoreDb: firestore, catalogService: catalog, loaded });
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
    
    let activeForbiddenNew = sanitizeLowercaseStringArray(settings.forbiddenNewPhrases);
    if (!activeForbiddenNew.length) activeForbiddenNew = ['esim', 'locked', 'idm', 'wifi only', 'panel', 'used'];
    
    let activeForbiddenUsed = sanitizeLowercaseStringArray(settings.forbiddenUsedPhrases);
    if (!activeForbiddenUsed.length) activeForbiddenUsed = ['esim', 'locked', 'idm', 'wifi only', 'panel', 'new'];
    
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
    const { effectiveMap } = await buildEffectiveMappings();

    const activeSupportedList = (category === 'used') ? activeUsedDevices : activeNewDevices;
    const activeForbiddenList = (category === 'used') ? activeForbiddenUsed : activeForbiddenNew;
    const resolvedByAi = foundDevice ? (effectiveMap.get(foundDevice) || foundDevice) : null;
    const normalizedUserMessage = catalog.normalizeDeviceName(userMessage);
    const resolvedByRawMessage = normalizedUserMessage ? (effectiveMap.get(normalizedUserMessage) || null) : null;
    const mappedDevice = resolvedByAi || resolvedByRawMessage || foundDevice;

    let finalResponse = null;

    let requestStatus = REQUEST_STATUSES.NO_MATCH;

    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      requestStatus = REQUEST_STATUSES.BLOCKED_FORBIDDEN;
      console.log(`🚫 Blocked by forbidden phrase: ${foundForbidden}`);
    } else if (mappedDevice && activeSupportedList.includes(mappedDevice)) {
      finalResponse = activeDynamicResponses[responseIndex % activeDynamicResponses.length];
      responseIndex++;
      requestStatus = finalResponse ? REQUEST_STATUSES.REPLIED : REQUEST_STATUSES.MATCHED_NO_REPLY;
      console.log(`✅ Match found: ${foundDevice}. Sending reply: ${finalResponse}`);
    } else {
      console.log(`🤷 No match or forbidden phrase found.`);
    }

    if (PERSISTED_REQUEST_STATUSES.has(requestStatus)) {
      setImmediate(async () => {
        try {
          await processor.saveRawRequest({
            senderId: req.body?.senderId || 'Unknown',
            senderMessage: userMessage,
            aiCategory: category,
            aiDeviceMatch: foundDevice,
            matchedDevice: mappedDevice,
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
      await persistCatalogHistory({ firestoreDb: firestore, catalogService: catalog, loaded });
      console.log(
        `📦 Catalog ready (${loaded.newCount} new, ${loaded.usedCount} used, ${loaded.arrangementCount} mapped aliases).`
      );
    } else {
      console.error(`❌ Catalog failed to load: ${loaded.error}`);
    }
  } catch (e) { console.error('Error during init:', e.message); }
})();

module.exports = app;
