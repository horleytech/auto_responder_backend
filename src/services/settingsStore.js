const { firestore } = require('./firebaseService');

function createSettingsStore(db) {
  const memory = {
    activeProvider: null,
    inventoryCsvUrl: null,
    arrangementCsvUrl: null,
    forbiddenNewPhrases: [],
    forbiddenUsedPhrases: [],
    dynamicResponses: [],
  };

  const docRef = db ? db.collection('ar_settings').doc('config') : null;

  async function getSettings() {
    if (!docRef) return { ...memory };
    try {
      const snap = await docRef.get();
      if (!snap.exists) return { ...memory };
      return { ...memory, ...snap.data() };
    } catch (err) {
      console.error('⚠️ Failed to read settings from Firebase:', err.message);
      return { ...memory };
    }
  }

  async function updateSettings(partial) {
    Object.assign(memory, partial || {});
    if (!docRef) return;
    try {
      await docRef.set({ ...(partial || {}), updatedAt: new Date().toISOString() }, { merge: true });
    } catch (err) {
      console.error('⚠️ Failed to save settings to Firebase:', err.message);
    }
  }

  return {
    getSettings,
    updateSettings,
    read: getSettings,
    write: updateSettings,
  };
}

const defaultSettingsStore = createSettingsStore(firestore);

module.exports = {
  ...defaultSettingsStore,
  createSettingsStore,
};
