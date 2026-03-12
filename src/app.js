const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
require('dotenv').config();
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Configuration ────────────────────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_CHATGPT;

if (!API_KEY || !OPENAI_API_KEY) {
  console.error('❌ Missing API_KEY or OPENAI_CHATGPT in .env');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ─── Firebase Initialization ──────────────────────────────────────────────────
let db = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    db = admin.firestore();
    console.log('🔥 Firebase initialized successfully.');
  }
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
}

// ─── Bot Logic (Default Fallbacks) ────────────────────────────────────────────
let DYNAMIC_RESPONSES = [
  "Available", "Available chief", "Available big chief", "Available my Oga",
  "Big chief, this is available", "Available boss", "Available boss, we get am",
  "Available my guy", "My Oga, it's available"
];
let FORBIDDEN_NEW_PHRASES = ['esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box', 'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'UK', 'Air', 'Used'].map(p => p.toLowerCase());
let FORBIDDEN_USED_PHRASES = ['esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box', 'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'NEW'].map(p => p.toLowerCase());
let responseIndex = 0;

// Load live logic from Firebase if available
async function loadBotLogic() {
  if (!db) return;
  try {
    const doc = await db.collection('ar_settings').doc('botLogic').get();
    if (doc.exists) {
      const data = doc.data();
      if (data.dynamicResponses) DYNAMIC_RESPONSES = data.dynamicResponses;
      if (data.forbiddenNew) FORBIDDEN_NEW_PHRASES = data.forbiddenNew.map(p => p.toLowerCase());
      if (data.forbiddenUsed) FORBIDDEN_USED_PHRASES = data.forbiddenUsed.map(p => p.toLowerCase());
      console.log('✅ Live Bot Logic loaded from Firebase.');
    }
  } catch (error) {
    console.error('Failed to load bot logic:', error);
  }
}
loadBotLogic();

// ─── Google Sheets Catalog ───────────────────────────────────────────────────
const GOOGLE_SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/1Jh7TXif0dsaAVgoExEOCmkACZHPPZqIsiW4hH8T5Pts/export?format=csv';
let SUPPORTED_NEW_DEVICES = [];
let SUPPORTED_USED_DEVICES = [];

function normalizeDeviceName(deviceType) {
  if (!deviceType) return null;
  return deviceType.toLowerCase().replace(/galaxy /gi, '').replace(/\s+/g, ' ').replace(/pro max/g, 'pro max').replace(/iphone /gi, 'iphone ').trim();
}

function isUsedCondition(condition) {
  if (!condition) return false;
  return condition.toLowerCase().includes('used') || condition.toLowerCase().includes('grade a');
}

async function loadCatalogFromGoogleSheets() {
  try {
    const response = await axios.get(GOOGLE_SHEETS_CSV_URL);
    const lines = response.data.split('\n').filter(line => line.trim() !== '');
    const rows = lines.map(line => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(cell => cell.replace(/^"(.*)"$/, '$1').trim()));
    
    const headers = rows[0];
    const deviceIndex = headers.indexOf('Device Type');
    const conditionIndex = headers.indexOf('Condition');
    const priceIndex = headers.indexOf('Regular price');

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
    console.log(`✅ Catalog Loaded: ${SUPPORTED_NEW_DEVICES.length} new, ${SUPPORTED_USED_DEVICES.length} used devices.`);
  } catch (err) {
    console.error('❌ Failed to load catalog:', err.message);
  }
}
loadCatalogFromGoogleSheets();

// ─── API Endpoints (Bouncer) ────────────────────────────────────────────────
function isAuthorized(req, res, next) {
  const providedKey = req.headers['x-api-key'] || req.query.key;
  if (providedKey === API_KEY) return next();
  return res.sendStatus(403);
}

app.get('/api/requests', isAuthorized, async (req, res) => {
  if (!db) return res.json({ requests: [] });
  try {
    const snapshot = await db.collection('ar_raw_requests').orderBy('timestamp', 'desc').limit(50).get();
    res.json({ requests: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
  } catch (error) { res.status(500).json({ error: 'Failed to fetch logs' }); }
});

app.post('/api/settings', isAuthorized, async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firebase not connected' });
  try {
    await db.collection('ar_settings').doc('botLogic').set(req.body, { merge: true });
    await loadBotLogic(); 
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Failed to save settings' }); }
});

// ─── MAIN WEBHOOK (YOUR ORIGINAL LOGIC) ──────────────────────────────────────
app.post('/api/respond', isAuthorized, async (req, res) => {
  const userMessage = req.body.senderMessage;
  if (!userMessage) return res.status(400).json({ error: 'Missing senderMessage' });

  console.log(`\n📥 NEW MESSAGE: "${userMessage}"`);

  try {
    const prompt = `
You are a JSON-based entity extractor for an availability checker. Return JSON ONLY.
First, determine category: 'new' or 'used'. If message contains 'used', category is 'used'. Else 'new'.
List of NEW devices: ${SUPPORTED_NEW_DEVICES.join(', ')}
List of NEW forbidden phrases: ${FORBIDDEN_NEW_PHRASES.join(', ')}
List of USED devices: ${SUPPORTED_USED_DEVICES.join(', ')}
List of USED forbidden phrases: ${FORBIDDEN_USED_PHRASES.join(', ')}

Format: {"device": string | null, "forbidden": string | null, "category": "new" | "used"}
RULES: 
1. "device": Closest match from active device list. Must spell exactly as it appears in list.
2. "forbidden": First matching forbidden phrase.
3. Exception: 'esim' is not forbidden if 'physical' is also in the message.`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: userMessage }],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);
    const { category, device, forbidden } = aiResponse;
    const foundDevice = device ? device.toLowerCase() : null;
    const foundForbidden = forbidden ? forbidden.toLowerCase() : null;

    const activeSupportedList = (category === 'used') ? SUPPORTED_USED_DEVICES : SUPPORTED_NEW_DEVICES;
    const activeForbiddenList = (category === 'used') ? FORBIDDEN_USED_PHRASES : FORBIDDEN_NEW_PHRASES;

    let finalResponse = null;

    // YOUR EXACT ORIGINAL JUDGEMENT
    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      console.log(`🚫 Blocked by forbidden phrase: ${foundForbidden}`);
    } else if (foundDevice && activeSupportedList.includes(foundDevice)) {
      finalResponse = DYNAMIC_RESPONSES[responseIndex];
      responseIndex = (responseIndex + 1) % DYNAMIC_RESPONSES.length;
      console.log(`✅ Match found: ${foundDevice}. Sending reply: ${finalResponse}`);
    } else {
      console.log(`🤷 No match found.`);
    }

    // FIREBASE LOGGING FOR FRONTEND
    if (db) {
      db.collection('ar_raw_requests').add({
        senderMessage: userMessage,
        aiCategory: category,
        aiDeviceMatch: foundDevice,
        replied: !!finalResponse,
        timestamp: Date.now(),
        processed: false
      }).catch(err => console.error("Firebase error:", err));
    }

    if (finalResponse) {
      return res.json({ data: [{ message: finalResponse }] });
    } else {
      return res.sendStatus(204);
    }

  } catch (err) {
    console.error('💥 Webhook Error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
