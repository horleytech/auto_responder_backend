const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

function parseServiceAccountFromEnv() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;

  const candidates = [raw];
  try {
    candidates.push(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    // Ignore invalid base64 candidate.
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.private_key === 'string') {
          parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
        if (!parsed.project_id && process.env.FIREBASE_PROJECT_ID) {
          parsed.project_id = process.env.FIREBASE_PROJECT_ID;
        }
        return parsed;
      }
    } catch {
      // Try next parse strategy.
    }
  }

  console.error('❌ FIREBASE ERROR: FIREBASE_SERVICE_ACCOUNT_JSON is present but could not be parsed.');
  return null;
}

function initFirestore() {
  try {
    let serviceAccount = parseServiceAccountFromEnv();

    if (!serviceAccount) {
      // Fall back to firebase.json file in the root folder.
      const keyPath = path.join(__dirname, '../../firebase.json');

      if (!fs.existsSync(keyPath)) {
        console.error('❌ FIREBASE ERROR: No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT_JSON or provide firebase.json.');
        return null;
      }

      serviceAccount = require(keyPath);
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
