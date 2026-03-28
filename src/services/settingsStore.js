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
  const botLogicRef = db ? db.collection('ar_settings').doc('botLogic') : null;

  async function getSettings() {
    if (!docRef) return { ...memory };
    try {
      const [configSnap, botLogicSnap] = await Promise.all([
        docRef.get(),
        botLogicRef ? botLogicRef.get() : Promise.resolve(null),
      ]);
      const configData = configSnap?.exists ? configSnap.data() : {};
      const botLogicData = botLogicSnap?.exists ? botLogicSnap.data() : {};
      return { ...memory, ...botLogicData, ...configData };
    } catch (err) {
      console.error('⚠️ Failed to read settings from Firebase:', err.message);
      return { ...memory };
    }
  }

  async function updateSettings(partial) {
    const next = { ...(partial || {}) };
    delete next.apiKey;
    Object.assign(memory, next);
    if (!docRef) return;
    try {
      await docRef.set({ ...next, updatedAt: new Date().toISOString() }, { merge: true });
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
