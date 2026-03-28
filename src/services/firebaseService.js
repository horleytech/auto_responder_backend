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

function parseServiceAccountFromEnv() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    return { serviceAccount: null, reason: 'missing', hint: 'Set FIREBASE_SERVICE_ACCOUNT_JSON to valid JSON or base64-encoded JSON.' };
  }

  const candidates = [raw];
  const wrappedInQuotes = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"));
  if (wrappedInQuotes) candidates.push(raw.slice(1, -1));
  const decoded = decodeBase64(raw);
  if (decoded && decoded !== raw) candidates.push(decoded);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeServiceAccountShape(parsed);
      if (normalized) {
        return { serviceAccount: normalized, reason: null, hint: null };
      }
    } catch {
      // Keep trying fallback encodings.
    }
  }

  try {
    const parsed = JSON.parse(raw.replace(/\\"/g, '"'));
    const normalized = normalizeServiceAccountShape(parsed);
    if (normalized) {
      return { serviceAccount: normalized, reason: null, hint: null };
    }
  } catch {
    // no-op: fall through to invalid reason.
  }
  return {
    serviceAccount: null,
    reason: 'invalid',
    hint: 'Value is not valid JSON. Common fixes: remove surrounding quotes or use base64-encoded JSON.',
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
