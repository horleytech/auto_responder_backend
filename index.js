const express = require('express');
const { OpenAI } = require('openai');
require('dotenv').config();
const axios = require('axios');

const app = express();
app.use(express.json());

// ─── Configuration ────────────────────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_CHATGPT;

if (!API_KEY || !OPENAI_API_KEY) {
  console.error('❌ Missing API_KEY or OPENAI_CHATGPT in .env');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Dynamic response pool
const DYNAMIC_RESPONSES = [
  "Available", "Available chief", "Available big chief", "Available my Oga",
  "Big chief, this is available", "Available boss", "Available boss, we get am",
  "Available my guy", "My Oga, it's available", "Available boss, make i paste address",
  "Available sir!", "E dey o!", "Available my king!", "Oga at the top, it's available!",
  "Available don!", "My guy, e dey—available!", "Available, we get am",
  "Big boss, it’s available!", "Available legend", "Abeg Oga, it’s available!",
  "Available my brother"
];
let responseIndex = 0;

// ─── FORBIDDEN PHRASES (UNCHANGED FROM YOUR CODE) ─────────────────────────────
const FORBIDDEN_NEW_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'UK', 'Air', 'Used'
].map(p => p.toLowerCase());

const FORBIDDEN_USED_PHRASES = [
  'esim', 'locked', 'idm', 'wifi only', 'screen', 'Any iPhone lower than iPhone 16 series', 'lock', 'converted', 'lla', 'open box',
  'no face id', 'chip', '1tb', '1 terabyte', 'iPhone 8', 'iPhone 7', 'charging port', 'icloud', 'panel', 'NFID', 'NEW'
].map(p => p.toLowerCase());

// ─── GOOGLE DRIVE CSV URL ──────────────────────────────────────────────────────
const GOOGLE_SHEETS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1Jh7TXif0dsaAVgoExEOCmkACZHPPZqIsiW4hH8T5Pts/export?format=csv';

// In-memory device lists
let SUPPORTED_NEW_DEVICES = [];
let SUPPORTED_USED_DEVICES = [];

// ─── HELPERS TO PARSE DEVICE NAME FROM CSV ─────────────────────────────────────
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

// ─── LOAD CATALOG FROM GOOGLE SHEETS ───────────────────────────────────────────
async function loadCatalogFromGoogleSheets() {
  try {
    console.log('📥 Loading catalog from Google Sheets...');
    const response = await axios.get(GOOGLE_SHEETS_CSV_URL);
    const lines = response.data.split('\n').filter(line => line.trim() !== '');
    
    // Parse CSV manually (simple comma split, handles quotes)
    const rows = [];
    for (let line of lines) {
      const row = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(cell => 
        cell.replace(/^"(.*)"$/, '$1').trim()
      );
      rows.push(row);
    }

    const headers = rows[0];
    const deviceIndex = headers.indexOf('Device Type');
    const conditionIndex = headers.indexOf('Condition');
    const priceIndex = headers.indexOf('Regular price');

    const newSet = new Set();
    const usedSet = new Set();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length <= Math.max(deviceIndex, conditionIndex, priceIndex)) continue;

      const deviceType = row[deviceIndex];
      const condition = row[conditionIndex];
      const price = row[priceIndex];

      // Skip if no device, no price, or price is placeholder
      if (!deviceType || !price || price.startsWith('#') || price === '') continue;

      const normalized = normalizeDeviceName(deviceType);
      if (!normalized) continue;

      if (isUsedCondition(condition)) {
        usedSet.add(normalized);
      } else {
        newSet.add(normalized);
      }
    }

    SUPPORTED_NEW_DEVICES = Array.from(newSet);
    SUPPORTED_USED_DEVICES = Array.from(usedSet);

    console.log(`✅ Loaded: ${SUPPORTED_NEW_DEVICES.length} new, ${SUPPORTED_USED_DEVICES.length} used devices.`);
  } catch (err) {
    console.error('❌ Failed to load catalog:', err.message);
  }
}

// Load on startup
loadCatalogFromGoogleSheets();

// Add reload endpoint
app.post('/api/reload-catalog', async (req, res) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) return res.sendStatus(403);
  await loadCatalogFromGoogleSheets();
  res.json({ success: true });
});

// ─── DYNAMIC SYSTEM PROMPT (USES LIVE LISTS) ───────────────────────────────────
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

// ─── MAIN ENDPOINT (IDENTICAL TO YOUR ORIGINAL LOGIC) ──────────────────────────
app.post('/api/respond', async (req, res) => {
  const providedKey = req.headers['x-api-key'];
  if (!API_KEY || providedKey !== API_KEY) {
    return res.sendStatus(403);
  }

  const userMessage = req.body.senderMessage;
  if (!userMessage) {
    return res.status(400).json({ error: 'Missing senderMessage' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    let aiResponse;
    try {
      aiResponse = JSON.parse(completion.choices[0].message.content);
    } catch (parseErr) {
      return res.status(500).json({ error: 'AI response was not valid JSON' });
    }

    const category = aiResponse.category;
    const foundDevice = aiResponse.device ? aiResponse.device.toLowerCase() : null;
    const foundForbidden = aiResponse.forbidden ? aiResponse.forbidden.toLowerCase() : null;

    const activeSupportedList = (category === 'used') ? SUPPORTED_USED_DEVICES : SUPPORTED_NEW_DEVICES;
    const activeForbiddenList = (category === 'used') ? FORBIDDEN_USED_PHRASES : FORBIDDEN_NEW_PHRASES;

    // JUDGEMENT 1: CHECK FORBIDDEN
    if (foundForbidden && activeForbiddenList.includes(foundForbidden)) {
      return res.sendStatus(204);
    }

    // JUDGEMENT 2: CHECK SUPPORTED DEVICE
    if (foundDevice && activeSupportedList.includes(foundDevice)) {
      const dynamic = DYNAMIC_RESPONSES[responseIndex];
      responseIndex = (responseIndex + 1) % DYNAMIC_RESPONSES.length;
      return res.json({ data: [{ message: dynamic }] });
    }

    return res.sendStatus(204);

  } catch (err) {
    console.error('💥 Server error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
