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

module.exports = {
  admin,
  firestore,
  FieldValue: admin.firestore ? admin.firestore.FieldValue : null,
};
