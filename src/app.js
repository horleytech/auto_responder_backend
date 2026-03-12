const express = require('express');
const cors = require('cors');
const path = require('path');
const { OpenAI } = require('openai');
const axios = require('axios');
require('dotenv').config();

const { firestore } = require('./services/firebaseService');
const settingsStore = require('./services/settingsStore');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIG ---
const API_KEY = process.env.API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_CHATGPT || process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- EXACT ORIGINAL CATALOG LOGIC ---
const GOOGLE_SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/1Jh7TXif0dsaAVgoExEOCmkACZHPPZqIsiW4hH8T5Pts/export?format=csv';
let SUPPORTED_NEW_DEVICES = [];
let SUPPORTED_USED_DEVICES = [];

function normalizeDeviceName(deviceType) {
  if (!deviceType) return null;
  return deviceType.toLowerCase().replace(/galaxy /gi, '').replace(/\s+/g, ' ').replace(/pro max/g, 'pro max').replace(/pro xl/g, 'pro xl').replace(/iphone /gi, 'iphone ').trim();
}
function isUsedCondition(condition) {
  if (!condition) return false;
  return condition.toLowerCase().includes('used') || condition.toLowerCase().includes('grade a') || condition.toLowerCase().includes('uk used');
}

async function loadCatalogFromGoogleSheets() {
  try {
    const response = await axios.get(GOOGLE_SHEETS_CSV_URL);
    const lines = response.data.split('\n').filter(line => line.trim() !== '');
    const rows = [];
    for (let line of lines) {
      rows.push(line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(cell => cell.replace(/^"(.*)"$/, '$1').trim()));
    }
    const headers = rows[0];
    const deviceIndex = headers.indexOf('Device Type'), conditionIndex = headers.indexOf('Condition'), priceIndex = headers.indexOf('Regular price');
    const newSet = new Set(), usedSet = new Set();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length <= Math.max(deviceIndex, conditionIndex, priceIndex)) continue;
      const deviceType = row[deviceIndex], condition = row[conditionIndex], price = row[priceIndex];
      if (!deviceType || !price || price.startsWith('#') || price === '') continue;

      const normalized = normalizeDeviceName(deviceType);
      if (!normalized) continue;
      isUsedCondition(condition) ? usedSet.add(normalized) : newSet.add(normalized);
    }
    SUPPORTED_NEW_DEVICES = Array.from(newSet);
    SUPPORTED_USED_DEVICES = Array.from(usedSet);
    console.log(`✅ Google Sheets Loaded: ${SUPPORTED_NEW_DEVICES.length} new, ${SUPPORTED_USED_DEVICES.length} used devices.`);
  } catch (err) { console.error('❌ Failed to load catalog:', err.message); }
}
loadCatalogFromGoogleSheets();

// --- EXACT ORIGINAL BOT LOGIC ---
let responseIndex = 0;
let DYNAMIC_RESPONSES = [ "Available", "Available chief", "Available big chief", "Available my Oga", "Big chief, this is available", "Available boss", "Available boss, we get am", "Available my guy", "My Oga, it's available", "Available boss, make i paste address", "Available sir!", "E dey o!", "Available my king!", "Oga at the top, it's available!", "Available don!", "My guy, e dey—available!", "Available, we get am", "Big boss, it’s available!", "Available legend", "Abeg Oga, it’s available!", "Available my brother" ];
let FORBIDDEN_NEW_PHRASES = ['esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box', 'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'UK', 'Air', 'Used'].map(p => p.toLowerCase());
let FORBIDDEN_USED_PHRASES = ['esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box', 'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'NEW'].map(p => p.toLowerCase());

async function refreshSettings() {
   const settings = await settingsStore.getSettings();
   if (settings.dynamicResponses?.length) DYNAMIC_RESPONSES = settings.dynamicResponses;
   if (settings.forbiddenNewPhrases?.length) FORBIDDEN_NEW_PHRASES = settings.forbiddenNewPhrases.map(p => p.toLowerCase());
   if (settings.forbiddenUsedPhrases?.length) FORBIDDEN_USED_PHRASES = settings.forbiddenUsedPhrases.map(p => p.toLowerCase());
}
refreshSettings();

// --- STRICT AUTHORIZATION ---
function isAuthorized(req) {
  const incoming = String(req.headers['x-api-key'] || req.query.key || '').trim();
  return incoming === String(API_KEY).trim();
}

// ─── THE LOUD WEBHOOK ────────────────────────────────────────────────────────
app.post('/api/respond', async (req, res) => {
  console.log(`\n🔔 [WEBHOOK ATTACK] Request hit the server!`);
  console.log(`🔑 Key Provided:`, req.headers['x-api-key'] || req.query.key || 'NONE');

  if (!isAuthorized(req)) {
    console.log(`🚫 [BLOCKED] Unauthorized Request. Server expects: ${API_KEY}`);
    return res.sendStatus(403);
  }

  const userMessage = req.body?.senderMessage;
  if (!userMessage) {
    console.log(`⚠️ [BLOCKED] Missing 'senderMessage' in body.`);
    return res.status(400).json({ error: 'Missing senderMessage' });
  }

  console.log(`📥 INCOMING MESSAGE: "${userMessage}"`);

  try {
    await refreshSettings(); // Ensure we have latest Dashboard logic
    const prompt = `You are a JSON-based entity extractor for an availability checker.
Your SOLE purpose is to analyze the user's message and return a JSON object.
Do not add any other text, conversation, or explanations.

First, determine the category: 'new' or 'used'. If the message contains 'used', the category is 'used'. Otherwise, default to 'new'.

Based on the category, use the appropriate lists:
List of NEW devices: ${SUPPORTED_NEW_DEVICES.join(', ')}
List of NEW forbidden phrases: ${FORBIDDEN_NEW_PHRASES.join(', ')}

List of USED devices: ${SUPPORTED_USED_DEVICES.join(', ')}
List of USED forbidden phrases: ${FORBIDDEN_USED_PHRASES.join(', ')}

Return JSON in this exact format: {"device": string | null, "forbidden": string | null, "category": "new" | "used"}

RULES:
1. "device": Find the *first* item from the active device list that is the *closest match*. Spell exactly as it appears in list.
2. "forbidden": Find the *first* matching forbidden phrase from active list. Spell exactly as it appears in list. If none, null.
3. "category": category detected ('new' or 'used').
4. **PRIORITY:** Find both if they exist.
5. ***"esim" EXCEPTION:*** 'esim' is only forbidden if message does *not* mention "physical".`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: userMessage }],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);
    const category = aiResponse.category;
    const foundDevice = aiResponse.device ? aiResponse.device.toLowerCase() : null;
    const foundForbidden = aiResponse.forbidden ? aiResponse.forbidden.toLowerCase() : null;

    const activeSupportedList = (category === 'used') ? SUPPORTED_USED_DEVICES : SUPPORTED_NEW_DEVICES;
    const activeForbiddenList = (category === 'used') ? FORBIDDEN_USED_PHRASES : FORBIDDEN_NEW_PHRASES;

    let finalResponse = null;

    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      console.log(`🚫 Blocked by forbidden phrase: ${foundForbidden}`);
    } else if (foundDevice && activeSupportedList.includes(foundDevice)) {
      finalResponse = DYNAMIC_RESPONSES[responseIndex % DYNAMIC_RESPONSES.length];
      responseIndex++;
      console.log(`✅ Match found: ${foundDevice}. Sending reply: ${finalResponse}`);
    } else {
      console.log(`🤷 No match or forbidden phrase found.`);
    }

    // FIREBASE LOGGING
    if (firestore) {
      firestore.collection('ar_raw_requests').add({
        senderMessage: userMessage,
        aiCategory: category,
        aiDeviceMatch: foundDevice,
        replied: !!finalResponse,
        timestamp: Date.now(),
        processed: false
      }).catch(err => console.error("Firebase log error:", err));
    }

    if (finalResponse) return res.json({ data: [{ message: finalResponse }] });
    return res.sendStatus(204);

  } catch (err) {
    console.error('💥 Webhook Server error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─── DASHBOARD ENDPOINTS ─────────────────────────────────────────────────────
app.get('/api/bot-logic', async (req, res) => {
  const settings = await settingsStore.getSettings();
  res.json({
    forbiddenNewPhrases: settings.forbiddenNewPhrases || FORBIDDEN_NEW_PHRASES,
    forbiddenUsedPhrases: settings.forbiddenUsedPhrases || FORBIDDEN_USED_PHRASES,
    dynamicResponses: settings.dynamicResponses || DYNAMIC_RESPONSES,
  });
});

app.post('/api/bot-logic', async (req, res) => {
  if (!isAuthorized(req)) return res.sendStatus(403);
  await settingsStore.updateSettings(req.body);
  await refreshSettings();
  return res.json({ success: true });
});

app.get('/api/requests', async (req, res) => {
  if (!firestore) return res.json({ requests: [] });
  try {
    const snap = await firestore.collection('ar_raw_requests').orderBy('timestamp', 'desc').limit(50).get();
    res.json({ requests: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
  } catch(e) { res.json({ requests: [] }); }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;
