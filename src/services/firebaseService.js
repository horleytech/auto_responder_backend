const admin = require('firebase-admin');
const { FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_PROJECT_ID } = require('../config/env');

function parseServiceAccount() {
  if (!FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  try {
    const parsed = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return parsed;
  } catch {
    return null;
  }
}

function initFirestore() {
  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) return null;

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID || serviceAccount.project_id,
      });
    }
    return admin.firestore();
  } catch (err) {
    console.error('⚠️ Firebase init failed, using memory fallback:', err.message);
    return null;
  }
}

module.exports = {
  admin,
  firestore: initFirestore(),
  FieldValue: admin.firestore.FieldValue,
};
