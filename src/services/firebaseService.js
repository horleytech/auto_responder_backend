const admin = require('firebase-admin');

function parseServiceAccountFromEnv() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    return { serviceAccount: null, reason: 'missing' };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { serviceAccount: null, reason: 'invalid' };
    }

    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }

    if (!parsed.project_id && process.env.FIREBASE_PROJECT_ID) {
      parsed.project_id = process.env.FIREBASE_PROJECT_ID;
    }

    return { serviceAccount: parsed, reason: null };
  } catch {
    return { serviceAccount: null, reason: 'invalid' };
  }
}

function initFirestore() {
  try {
    const { serviceAccount, reason } = parseServiceAccountFromEnv();
    if (!serviceAccount) {
      if (reason === 'invalid') {
        console.error('❌ FIREBASE ERROR: FIREBASE_SERVICE_ACCOUNT_JSON is present but could not be parsed. Running in memory mode.');
      } else {
        console.error('❌ FIREBASE ERROR: FIREBASE_SERVICE_ACCOUNT_JSON is missing. Running in memory mode.');
      }
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
