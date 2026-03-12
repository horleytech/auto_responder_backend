const admin = require('firebase-admin');
require('dotenv').config(); // Force it to read .env directly

function initFirestore() {
  // 1. Grab the JSON string from either variable name
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (!rawJson) {
    console.error('❌ FIREBASE ERROR: Missing Firebase JSON in .env file!');
    return null;
  }

  try {
    // 2. Parse the JSON
    const serviceAccount = JSON.parse(rawJson);
    
    // 3. Fix newline characters in the private key (Crucial for dotenv)
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    // 4. Initialize Firebase
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    
    const db = admin.firestore();
    console.log('🔥 Firebase Database connected successfully!');
    return db;

  } catch (err) {
    console.error('❌ Firebase JSON Parsing Error. Your .env file is formatted wrong:', err.message);
    return null;
  }
}

const firestore = initFirestore();

module.exports = {
  admin,
  firestore,
  FieldValue: admin.firestore ? admin.firestore.FieldValue : null,
};
