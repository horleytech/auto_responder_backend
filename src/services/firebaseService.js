const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

function initFirestore() {
  try {
    // Look for the firebase.json file in the root folder
    const keyPath = path.join(__dirname, '../../firebase.json');
    
    if (!fs.existsSync(keyPath)) {
      console.error('❌ FIREBASE ERROR: firebase.json file not found in the root directory!');
      return null;
    }

    // Require automatically parses the JSON perfectly without crashing
    const serviceAccount = require(keyPath);

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
