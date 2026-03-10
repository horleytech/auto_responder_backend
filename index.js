const express = require('express');
const { OpenAI } = require('openai');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

const API_KEY = process.env.API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_CHATGPT || process.env.OPENAI_API_KEY || '';
const QWEN_API_KEY = process.env.QWEN_API_KEY || '';
const QWEN_BASE_URL = process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

const CHATGPT_MODEL = process.env.CHATGPT_MODEL || 'gpt-4o-mini';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-plus';
const MAX_REQUEST_LOG = Number(process.env.MAX_REQUEST_LOG || 300);
const CUSTOM_RESPONSE = process.env.CUSTOM_RESPONSE || 'Available';

let activeProvider = (process.env.DEFAULT_AI_PROVIDER || 'chatgpt').toLowerCase();
let csvUrl =
  process.env.GOOGLE_SHEETS_CSV_URL ||
  'https://docs.google.com/spreadsheets/d/1Jh7TXif0dsaAVgoExEOCmkACZHPPZqIsiW4hH8T5Pts/export?format=csv';

if (!API_KEY) {
  console.error('❌ Missing API_KEY in environment');
  process.exit(1);
}

const clients = {
  chatgpt: OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null,
  qwen: QWEN_API_KEY
    ? new OpenAI({
        apiKey: QWEN_API_KEY,
        baseURL: QWEN_BASE_URL,
      })
    : null,
};

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

const FORBIDDEN_NEW_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'UK', 'Air', 'Used',
].map((p) => p.toLowerCase());

const FORBIDDEN_USED_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'NEW',
].map((p) => p.toLowerCase());

let SUPPORTED_NEW_DEVICES = [];
let SUPPORTED_USED_DEVICES = [];
const requestLog = [];

function normalizeDeviceName(deviceType) {
  if (!deviceType) return null;
  return deviceType
    .toLowerCase()
    .replace(/galaxy /gi, '')
    .replace(/\s+/g, ' ')
    .replace(/pro max/g, 'pro max')
    .replace(/pro xl/g, 'pro xl')
    .replace(/iphone /gi, 'iphone ')
    .trim();
}

function isUsedCondition(condition) {
  if (!condition) return false;
  const lower = condition.toLowerCase();
  return lower.includes('used') || lower.includes('grade a') || lower.includes('uk used');
}

function normalizeRequestText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isAuthorized(req) {
  return req.headers['x-api-key'] === API_KEY;
}

function listProviders() {
  return {
    activeProvider,
    providers: [
      { name: 'chatgpt', model: CHATGPT_MODEL, configured: Boolean(clients.chatgpt) },
      { name: 'qwen', model: QWEN_MODEL, configured: Boolean(clients.qwen) },
    ],
  };
}

function getSystemPrompt() {
  return `
You are a JSON-based entity extractor for an availability checker.
Your SOLE purpose is to analyze the user's message and return a JSON object.
Do not add any other text, conversation, or explanations.

First, determine the category: 'new' or 'used'. If the message contains 'used', the category is 'used'. Otherwise, default to 'new'.

Based on the category, use the appropriate lists:

List of NEW devices: ${SUPPORTED_NEW_DEVICES.join(', ')}
List of NEW forbidden phrases: ${FORBIDDEN_NEW_PHRASES.join(', ')}

List of USED devices: ${SUPPORTED_USED_DEVICES.join(', ')}
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

async function loadCatalogFromGoogleSheets() {
  try {
    console.log(`📥 Loading catalog from: ${csvUrl}`);
    const response = await axios.get(csvUrl);
    const lines = String(response.data)
      .split('\n')
      .filter((line) => line.trim() !== '');

    const rows = [];
    for (const line of lines) {
      const row = line
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((cell) => cell.replace(/^"(.*)"$/, '$1').trim());
      rows.push(row);
    }

    const headers = rows[0] || [];
    const deviceIndex = headers.indexOf('Device Type');
    const conditionIndex = headers.indexOf('Condition');
    const priceIndex = headers.indexOf('Regular price');

    if (deviceIndex < 0 || conditionIndex < 0 || priceIndex < 0) {
      throw new Error('CSV missing required headers: Device Type, Condition, Regular price');
    }

    const newSet = new Set();
    const usedSet = new Set();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length <= Math.max(deviceIndex, conditionIndex, priceIndex)) continue;

      const deviceType = row[deviceIndex];
      const condition = row[conditionIndex];
      const price = row[priceIndex];

      if (!deviceType || !price || price.startsWith('#') || price === '') continue;

      const normalized = normalizeDeviceName(deviceType);
      if (!normalized) continue;

      if (isUsedCondition(condition)) usedSet.add(normalized);
      else newSet.add(normalized);
    }

    SUPPORTED_NEW_DEVICES = Array.from(newSet);
    SUPPORTED_USED_DEVICES = Array.from(usedSet);

    console.log(`✅ Loaded: ${SUPPORTED_NEW_DEVICES.length} new, ${SUPPORTED_USED_DEVICES.length} used devices.`);
    return { success: true, newCount: SUPPORTED_NEW_DEVICES.length, usedCount: SUPPORTED_USED_DEVICES.length };
  } catch (err) {
    console.error('❌ Failed to load catalog:', err.message);
    return { success: false, error: err.message };
  }
}

function logRequest(entry) {
  requestLog.unshift(entry);
  if (requestLog.length > MAX_REQUEST_LOG) requestLog.length = MAX_REQUEST_LOG;
}

function groupedRequests(limit = 20) {
  const map = new Map();
  for (const req of requestLog) {
    const key = normalizeRequestText(req.senderMessage);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        key,
        sampleMessage: req.senderMessage,
        count: 0,
        lastSeen: req.time,
      });
    }
    const row = map.get(key);
    row.count += 1;
    if (req.time > row.lastSeen) {
      row.lastSeen = req.time;
      row.sampleMessage = req.senderMessage;
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)))
    .slice(0, limit);
}

async function runProvider(provider, userMessage) {
  const client = clients[provider];
  if (!client) throw new Error(`Provider not configured: ${provider}`);

  const model = provider === 'qwen' ? QWEN_MODEL : CHATGPT_MODEL;
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  });

  return completion.choices?.[0]?.message?.content || '{}';
}

app.get('/api/providers', (req, res) => {
  return res.json(listProviders());
});

app.post('/api/providers', (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  const provider = String(req.body?.provider || '').toLowerCase().trim();
  if (!['chatgpt', 'qwen'].includes(provider)) {
    return res.status(400).json({ error: 'Unsupported provider. Use chatgpt or qwen.' });
  }
  activeProvider = provider;
  return res.json(listProviders());
});

app.get('/api/catalog-source', (req, res) => {
  res.json({ csvUrl, newCount: SUPPORTED_NEW_DEVICES.length, usedCount: SUPPORTED_USED_DEVICES.length });
});

app.post('/api/catalog-source', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  const nextUrl = String(req.body?.csvUrl || '').trim();
  if (!nextUrl) return res.status(400).json({ error: 'Missing csvUrl' });

  csvUrl = nextUrl;
  const result = await loadCatalogFromGoogleSheets();
  if (!result.success) return res.status(400).json(result);
  return res.json({ csvUrl, ...result });
});

app.post('/api/reload-catalog', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  const result = await loadCatalogFromGoogleSheets();
  if (!result.success) return res.status(500).json(result);
  return res.json(result);
});

app.get('/api/requests', (req, res) => {
  res.json({ count: requestLog.length, requests: requestLog });
});

app.get('/api/grouped-requests', (req, res) => {
  res.json({ count: requestLog.length, grouped: groupedRequests(30) });
});

app.post('/api/respond', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);

  const userMessage = req.body?.senderMessage;
  if (!userMessage) return res.status(400).json({ error: 'Missing senderMessage' });

  const provider = String(req.body?.provider || activeProvider).toLowerCase();
  const requestEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    time: new Date().toISOString(),
    provider,
    senderMessage: userMessage,
    status: 'received',
  };

  try {
    const raw = await runProvider(provider, userMessage);
    let aiResponse;
    try {
      aiResponse = JSON.parse(raw);
    } catch {
      requestEntry.status = 'failed';
      requestEntry.error = 'AI response was not valid JSON';
      requestEntry.rawReply = raw;
      logRequest(requestEntry);
      return res.status(500).json({ error: 'AI response was not valid JSON' });
    }

    const category = aiResponse.category;
    const foundDevice = aiResponse.device ? String(aiResponse.device).toLowerCase() : null;
    const foundForbidden = aiResponse.forbidden ? String(aiResponse.forbidden).toLowerCase() : null;

    const activeSupportedList = category === 'used' ? SUPPORTED_USED_DEVICES : SUPPORTED_NEW_DEVICES;
    const activeForbiddenList = category === 'used' ? FORBIDDEN_USED_PHRASES : FORBIDDEN_NEW_PHRASES;

    requestEntry.rawReply = aiResponse;

    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      requestEntry.status = 'blocked_forbidden';
      requestEntry.matchedForbidden = foundForbidden;
      logRequest(requestEntry);
      return res.sendStatus(204);
    }

    if (foundDevice && activeSupportedList.includes(foundDevice)) {
      const dynamic = DYNAMIC_RESPONSES[responseIndex];
      responseIndex = (responseIndex + 1) % DYNAMIC_RESPONSES.length;
      requestEntry.status = 'matched';
      requestEntry.matchedDevice = foundDevice;
      requestEntry.outboundResponse = dynamic || CUSTOM_RESPONSE;
      logRequest(requestEntry);
      return res.json({ data: [{ message: dynamic || CUSTOM_RESPONSE }] });
    }

    requestEntry.status = 'no_match';
    logRequest(requestEntry);
    return res.sendStatus(204);
  } catch (err) {
    requestEntry.status = 'failed';
    requestEntry.error = err.message;
    logRequest(requestEntry);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true, provider: activeProvider, csvUrl, newCount: SUPPORTED_NEW_DEVICES.length, usedCount: SUPPORTED_USED_DEVICES.length });
});

loadCatalogFromGoogleSheets();

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

module.exports = app;
