const admin = require('firebase-admin');

function normalizeServiceAccountShape(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const next = { ...parsed };
  if (typeof next.private_key === 'string') {
    next.private_key = next.private_key.replace(/\\n/g, '\n');
  }
  if (!next.project_id && process.env.FIREBASE_PROJECT_ID) {
    next.project_id = process.env.FIREBASE_PROJECT_ID;
  }
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

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    const normalized = normalizeServiceAccountShape(parsed);
    if (normalized) return { serviceAccount: normalized, reason: null, hint: null };
  }

  return {
    serviceAccount: null,
    reason: 'invalid',
    hint: 'Value is not valid JSON. Common fixes: run pm2 restart all --update-env, remove surrounding quotes, or use base64-encoded JSON.',
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
