function createSettingsStore(firestore) {
  const memory = {
    activeProvider: null,
    inventoryCsvUrl: null,
    arrangementCsvUrl: null,
  };

  const docRef = firestore ? firestore.collection('ar_settings').doc('config') : null;

  async function read() {
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

  async function write(partial) {
    Object.assign(memory, partial);
    if (!docRef) return;
    try {
      await docRef.set({ ...partial, updatedAt: new Date().toISOString() }, { merge: true });
    } catch (err) {
      console.error('⚠️ Failed to save settings to Firebase:', err.message);
    }
  }

  return { read, write };
}

module.exports = { createSettingsStore };
