const express = require('express');
const { OpenAI } = require('openai');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.get('/favicon.ico', (req, res) => res.status(204).end());

const CHATGPT_API_KEY = process.env.OPENAI_CHATGPT || process.env.OPENAI_API_KEY || '';
const TRIGGER = process.env.TRIGGER_KEYWORD?.toLowerCase() || 'available';
const CUSTOM_RESPONSE = process.env.CUSTOM_RESPONSE || 'Available';
const SYSTEM_PROMPT = process.env.PROMPT_TEMPLATE || `If the message contains a listed product, respond ONLY with "${TRIGGER}". If not, say nothing.`;
const MAX_REQUEST_LOG = Number(process.env.MAX_REQUEST_LOG || 250);
const SETTINGS_DOC_PATH = 'app/settings';

let activeProvider = (process.env.DEFAULT_AI_PROVIDER || 'chatgpt').toLowerCase();
const memoryLog = [];

const clients = {
  chatgpt: new OpenAI({ apiKey: CHATGPT_API_KEY || 'missing-openai-key' }),
  qwen: new OpenAI({
    apiKey: process.env.QWEN_API_KEY || 'missing-qwen-key',
    baseURL: process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  }),
};

const models = {
  chatgpt: process.env.CHATGPT_MODEL || 'gpt-4o',
  qwen: process.env.QWEN_MODEL || 'qwen-plus',
};

function parseFirebaseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  } catch {
    return null;
  }
}

function initFirestore() {
  const serviceAccount = parseFirebaseServiceAccount();
  if (!serviceAccount) return null;

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
      });
    }
    return admin.firestore();
  } catch (err) {
    console.error('⚠️ Firebase init failed, using memory fallback:', err.message);
    return null;
  }
}

const firestore = initFirestore();

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\w]/g, '').trim();
}

function makeRequestKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function computeTopRequests(requests, limit = 10) {
  const map = new Map();

  for (const request of requests) {
    const key = request.requestKey || makeRequestKey(request.senderMessage);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        key,
        count: 0,
        sampleMessage: request.senderMessage || '',
        lastSeen: request.time || null,
      });
    }

    const current = map.get(key);
    current.count += 1;

    if (request.time && (!current.lastSeen || request.time > current.lastSeen)) {
      current.lastSeen = request.time;
      current.sampleMessage = request.senderMessage || current.sampleMessage;
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')))
    .slice(0, limit);
}

function hasProviderCredentials(provider) {
  return provider === 'chatgpt' ? Boolean(CHATGPT_API_KEY) : Boolean(process.env.QWEN_API_KEY);
}

async function getActiveProvider() {
  if (!firestore) return activeProvider;
  try {
    const doc = await firestore.doc(SETTINGS_DOC_PATH).get();
    if (!doc.exists) return activeProvider;
    const provider = String(doc.data()?.activeProvider || activeProvider).toLowerCase();
    return clients[provider] ? provider : activeProvider;
  } catch (err) {
    console.error('⚠️ Failed to read provider from Firebase, using runtime fallback:', err.message);
    return activeProvider;
  }
}

async function setActiveProvider(provider) {
  activeProvider = provider;
  if (!firestore) return;
  try {
    await firestore.doc(SETTINGS_DOC_PATH).set({
      activeProvider: provider,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (err) {
    console.error('⚠️ Failed to save provider to Firebase, using runtime fallback:', err.message);
  }
}

async function saveRequest(entry) {
  memoryLog.unshift(entry);
  if (memoryLog.length > MAX_REQUEST_LOG) {
    memoryLog.length = MAX_REQUEST_LOG;
  }

  if (!firestore) return;
  try {
    await firestore.collection('requests').doc(entry.id).set(entry);
  } catch (err) {
    console.error('⚠️ Failed to write request log to Firebase, kept in memory:', err.message);
  }
}

async function fetchRecentRequests() {
  if (!firestore) return memoryLog;
  try {
    const snapshot = await firestore
      .collection('requests')
      .orderBy('time', 'desc')
      .limit(MAX_REQUEST_LOG)
      .get();

    return snapshot.docs.map((doc) => doc.data());
  } catch (err) {
    console.error('⚠️ Failed to fetch Firebase request logs, using memory fallback:', err.message);
    return memoryLog;
  }
}

function listProviders(currentProvider) {
  return {
    activeProvider: currentProvider,
    persistence: firestore ? 'firebase' : 'memory',
    providers: ['chatgpt', 'qwen'].map((name) => ({
      name,
      model: models[name],
      configured: hasProviderCredentials(name),
    })),
  };
}

async function runProviderCompletion(provider, userMessage) {
  if (!clients[provider]) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  if (!hasProviderCredentials(provider)) {
    throw new Error(`Missing credentials for provider: ${provider}`);
  }

  const completion = await clients[provider].chat.completions.create({
    model: models[provider],
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 10,
    temperature: 0,
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}

app.get('/api/providers', async (req, res) => {
  try {
    const currentProvider = await getActiveProvider();
    return res.send(listProviders(currentProvider));
  } catch (err) {
    return res.status(500).send({ error: 'Failed to load providers', details: err.message });
  }
});

app.post('/api/providers', async (req, res) => {
  try {
    const requestedProvider = String(req.body?.provider || '').toLowerCase().trim();

    if (!clients[requestedProvider]) {
      return res.status(400).send({ error: 'Unsupported provider. Use "chatgpt" or "qwen".' });
    }

    await setActiveProvider(requestedProvider);
    return res.send(listProviders(requestedProvider));
  } catch (err) {
    return res.status(500).send({ error: 'Failed to save provider', details: err.message });
  }
});

app.get('/api/requests', async (req, res) => {
  try {
    const requests = await fetchRecentRequests();
    return res.send({
      count: requests.length,
      requests,
      persistence: firestore ? 'firebase' : 'memory',
    });
  } catch (err) {
    return res.status(500).send({ error: 'Failed to fetch requests', details: err.message });
  }
});


app.get('/api/analytics', async (req, res) => {
  try {
    const requests = await fetchRecentRequests();
    const topRequests = computeTopRequests(requests);

    return res.send({
      persistence: firestore ? 'firebase' : 'memory',
      totalRequests: requests.length,
      uniqueRequests: topRequests.length,
      topRequests,
    });
  } catch (err) {
    return res.status(500).send({ error: 'Failed to fetch analytics', details: err.message });
  }
});

app.post('/api/respond', async (req, res) => {
  const userMessage = req.body?.senderMessage;
  const persistedProvider = await getActiveProvider();
  const provider = String(req.body?.provider || persistedProvider).toLowerCase();
  const requestEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    time: new Date().toISOString(),
    provider,
    senderMessage: userMessage || '',
    requestKey: makeRequestKey(userMessage),
    trigger: TRIGGER,
    status: 'received',
  };

  console.log('🔽 Incoming request body:', req.body);

  if (!userMessage) {
    requestEntry.status = 'failed';
    requestEntry.error = 'Missing senderMessage';
    await saveRequest(requestEntry);
    return res.status(400).send({ error: 'Missing senderMessage' });
  }

  try {
    const reply = await runProviderCompletion(provider, userMessage);
    const normalized = normalize(reply);

    requestEntry.rawReply = reply;
    requestEntry.normalizedReply = normalized;

    if (normalized === TRIGGER) {
      requestEntry.status = 'matched';
      requestEntry.outboundResponse = CUSTOM_RESPONSE;
      await saveRequest(requestEntry);
      return res.send({ data: [{ message: CUSTOM_RESPONSE }] });
    }

    requestEntry.status = 'no_match';
    await saveRequest(requestEntry);
    return res.status(204).send();
  } catch (err) {
    requestEntry.status = 'failed';
    requestEntry.error = err.message;
    await saveRequest(requestEntry);
    return res.status(500).send({ error: 'Server error', details: err.message });
  }
});

app.get('/healthz', (req, res) => {
  res.send({ ok: true, persistence: firestore ? 'firebase' : 'memory' });
});

const PORT = process.env.PORT || 3000;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Auto Responder backend running on port ${PORT}`);
  });
}

module.exports = app;
