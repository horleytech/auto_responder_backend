const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function normalizeServiceAccountShape(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const nested = parsed.service_account || parsed.serviceAccount;
  const next = { ...(nested && typeof nested === 'object' ? nested : parsed) };
  if (typeof next.private_key === 'string') {
    next.private_key = next.private_key.replace(/\\n/g, '\n');
  }
  if (!next.project_id && process.env.FIREBASE_PROJECT_ID) {
    next.project_id = process.env.FIREBASE_PROJECT_ID;
  }
  if (!next.type) next.type = 'service_account';
  if (!next.project_id || !next.client_email || !next.private_key) return null;
  return next;
}

function decodeBase64(value) {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function safeJsonParse(candidate) {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function maybeReadJsonFile(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw) return '';
  const absolute = path.resolve(raw);
  try {
    if (!fs.existsSync(absolute)) return '';
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 1024 * 1024) return '';
    return fs.readFileSync(absolute, 'utf8');
  } catch {
    return '';
  }
}

function stripWrappingQuotes(value) {
  let next = String(value || '').trim();
  while (
    next.length >= 2
    && ((next.startsWith('"') && next.endsWith('"')) || (next.startsWith("'") && next.endsWith("'")))
  ) {
    next = next.slice(1, -1).trim();
  }
  return next;
}

function buildCandidates(raw) {
  const set = new Set();
  const queue = [String(raw || '').trim()];

  while (queue.length) {
    const current = String(queue.shift() || '').trim();
    if (!current || set.has(current)) continue;
    set.add(current);

    const unwrapped = stripWrappingQuotes(current);
    if (unwrapped && !set.has(unwrapped)) queue.push(unwrapped);

    const unescapedQuotes = current.replace(/\\"/g, '"');
    if (unescapedQuotes !== current && !set.has(unescapedQuotes)) queue.push(unescapedQuotes);

    const unescapedNewlines = current
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r');
    if (unescapedNewlines !== current && !set.has(unescapedNewlines)) queue.push(unescapedNewlines);

    if (/%7b|%7d|%22|%5c/i.test(current)) {
      try {
        const decodedUri = decodeURIComponent(current);
        if (decodedUri && decodedUri !== current && !set.has(decodedUri)) queue.push(decodedUri);
      } catch {
        // no-op
      }
    }

    if (/^[A-Za-z0-9+/=\s]+$/.test(current) && current.replace(/\s+/g, '').length % 4 === 0) {
      const decoded = decodeBase64(current.replace(/\s+/g, ''));
      if (decoded && decoded !== current && !set.has(decoded)) queue.push(decoded);
    }
  }

  return Array.from(set);
}

function parseServiceAccountFromEnv() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const normalizedRaw = raw.toLowerCase();
  const explicitlyEmpty = !raw
    || normalizedRaw === 'null'
    || normalizedRaw === 'undefined'
    || raw === '""'
    || raw === "''";
  if (explicitlyEmpty) {
    return { serviceAccount: null, reason: 'missing', hint: 'Set FIREBASE_SERVICE_ACCOUNT_JSON to valid JSON or base64-encoded JSON.' };
  }

  const candidates = buildCandidates(raw);
  const fileContents = maybeReadJsonFile(raw);
  if (fileContents) candidates.push(...buildCandidates(fileContents));

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (!parsed) continue;
    const direct = normalizeServiceAccountShape(parsed);
    if (direct) return { serviceAccount: direct, reason: null, hint: null };

    // Handles cases like JSON string of JSON (double-encoded payloads).
    if (typeof parsed === 'string') {
      const nestedParsed = safeJsonParse(parsed);
      const nested = normalizeServiceAccountShape(nestedParsed);
      if (nested) return { serviceAccount: nested, reason: null, hint: null };
    }
  }

  const envDerived = normalizeServiceAccountShape({
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID || '',
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || '',
    private_key: process.env.FIREBASE_PRIVATE_KEY || '',
    client_email: process.env.FIREBASE_CLIENT_EMAIL || '',
    client_id: process.env.FIREBASE_CLIENT_ID || '',
    auth_uri: process.env.FIREBASE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
    token_uri: process.env.FIREBASE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL || 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL || '',
  });
  if (envDerived) return { serviceAccount: envDerived, reason: null, hint: null };

  return {
    serviceAccount: null,
    reason: 'invalid',
    hint: 'Value is not valid JSON. Use raw JSON/base64/JSON file path, or set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.',
  };
}

function initFirestore() {
  try {
    const { serviceAccount, reason, hint } = parseServiceAccountFromEnv();
    if (!serviceAccount) {
      if (reason === 'invalid') {
        console.error('❌ FIREBASE ERROR: FIREBASE_SERVICE_ACCOUNT_JSON is present but could not be parsed. Running in memory mode.');
      } else {
        console.error('❌ FIREBASE ERROR: FIREBASE_SERVICE_ACCOUNT_JSON is missing. Running in memory mode.');
      }
      if (hint) console.error(`ℹ️ FIREBASE HINT: ${hint}`);
      return null;
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    const db = admin.firestore();
    console.log('🔥 Firebase Database connected successfully!');
    return db;
  } catch (err) {
    console.error('❌ Firebase Connection Error:', err.message);
    return null;
  }
}

const firestore = initFirestore();

// Save newly learned slang mappings so future requests skip model normalization.
async function saveToDictionary(slang, normalizedName, db = firestore) {
  const rawSlang = String(slang || '').trim();
  const finalName = String(normalizedName || '').trim();
  if (!db || !rawSlang || !finalName || finalName.toLowerCase() === 'null') return;

  try {
    // Firestore document IDs cannot contain forward slashes.
    const safeDocId = rawSlang.toLowerCase().replace(/\//g, '-').replace(/[^a-z0-9_-]+/g, '_');

    await db.collection('ar_dictionary').doc(safeDocId).set(
      {
        slang: rawSlang,
        normalizedName: finalName,
        autoLearned: true,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    console.log(`🧠 AUTO-LEARNED: Mapped "${rawSlang}" to "${finalName}"`);
  } catch (error) {
    console.error('❌ Failed to auto-save to dictionary:', error.message);
  }
}

module.exports = {
  admin,
  firestore,
  FieldValue: admin.firestore ? admin.firestore.FieldValue : null,
  saveToDictionary,
};
