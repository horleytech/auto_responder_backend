const { normalizeDeviceName } = require('./catalogService');
const { saveToDictionary } = require('./firebaseService');

function toMillis(input) {
  if (!input) return Date.now();
  if (typeof input === 'number') return input;
  return new Date(input).getTime();
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createProcessor({ firestore, catalog, providerService, settingsStore, FieldValue }) {
  const memoryRaw = [];
  const memoryDictionary = new Map();
  const memoryAnalytics = new Map();
  const memoryCustomers = new Map();

  async function getSettings() {
    return settingsStore.read();
  }

  async function saveRawRequest(payload) {
    const nextPayload = {
      processed: false,
      ...payload,
      processedAt: null,
    };
    if (!firestore) {
      memoryRaw.push({ id: `${Date.now()}`, ...nextPayload });
      return;
    }
    await firestore.collection('ar_raw_requests').add(nextPayload);
  }

  async function listUnprocessedRaw() {
    if (!firestore) return memoryRaw.filter((row) => !row.processed);
    const snap = await firestore.collection('ar_raw_requests').where('processed', '==', false).limit(500).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async function getDictionaryMap() {
    const dict = new Map(memoryDictionary);
    if (!firestore) return dict;
    try {
      const snap = await firestore.collection('ar_dictionary').get();
      snap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const slang = normalizeDeviceName(data.slang || doc.id);
        const normalizedName = String(data.normalizedName || '').trim();
        if (slang && normalizedName) dict.set(slang, normalizedName);
      });
    } catch (err) {
      console.error('⚠️ Failed to read dictionary from Firebase:', err.message);
    }
    return dict;
  }

  async function resolveNormalizedName(raw, dictionary, provider, overrides) {
    const senderMessage = String(raw.senderMessage || '');
    const normalizedMessage = normalizeDeviceName(senderMessage);
    if (normalizedMessage && dictionary.has(normalizedMessage)) {
      return dictionary.get(normalizedMessage);
    }

    const arrangementRows = Object.entries(catalog.getArrangementMap())
      .map(([slang, canonical]) => `${slang} => ${canonical}`)
      .slice(0, 100)
      .join('\n');

    const prompt = `You are a normalization assistant. Return JSON only: {"normalizedName": string|null}.\nMatch the user text to the best exact catalog item using this arrangement map:\n${arrangementRows}`;

    try {
      const rawResult = await providerService.runProvider(provider, prompt, senderMessage, overrides);
      const parsed = JSON.parse(rawResult || '{}');
      const finalName = String(parsed.normalizedName || '').trim();
      if (!finalName || finalName.toLowerCase() === 'null') return null;

      if (normalizedMessage) dictionary.set(normalizedMessage, finalName);
      await saveToDictionary(senderMessage, finalName, firestore);
      return finalName;
    } catch {
      return null;
    }
  }

  async function incrementAnalytics({ deviceName, category, timestamp }) {
    const key = `${String(deviceName)}::${String(category)}`;
    if (!firestore) {
      const row = memoryAnalytics.get(key) || { deviceName, category, requestCount: 0, updatedAt: Date.now(), events: [] };
      row.requestCount += 1;
      row.updatedAt = Date.now();
      row.events.push(toMillis(timestamp));
      memoryAnalytics.set(key, row);
      return;
    }

    const docId = normalizeDeviceName(key).replace(/[^a-z0-9]+/g, '_');
    await firestore.collection('ar_analytics').doc(docId).set(
      {
        deviceName,
        category,
        requestCount: FieldValue.increment(1),
        updatedAt: Date.now(),
        lastRequestAt: toMillis(timestamp),
      },
      { merge: true }
    );
  }

  async function incrementCustomer({ senderId }) {
    if (!firestore) {
      const row = memoryCustomers.get(senderId) || { senderId, totalRequests: 0, lastActive: Date.now() };
      row.totalRequests += 1;
      row.lastActive = Date.now();
      memoryCustomers.set(senderId, row);
      return;
    }

    await firestore.collection('ar_customers').doc(String(senderId)).set(
      {
        senderId: String(senderId),
        totalRequests: FieldValue.increment(1),
        lastActive: Date.now(),
      },
      { merge: true }
    );
  }

  async function markRawProcessed(rawId) {
    const keepProcessedRaw = String(process.env.KEEP_PROCESSED_RAW || '').toLowerCase() === 'true';
    if (!firestore) {
      const index = memoryRaw.findIndex((x) => x.id === rawId);
      if (index < 0) return;
      if (keepProcessedRaw) {
        memoryRaw[index].processed = true;
        memoryRaw[index].processedAt = Date.now();
      } else {
        memoryRaw.splice(index, 1);
      }
      return;
    }
    const docRef = firestore.collection('ar_raw_requests').doc(rawId);
    if (keepProcessedRaw) {
      await docRef.set({ processed: true, processedAt: Date.now() }, { merge: true });
      return;
    }
    await docRef.delete();
  }

  async function sync({ provider, overrides = {} }) {
    const rows = await listUnprocessedRaw();
    const dictionary = await getDictionaryMap();
    let processedCount = 0;
    const rowDelayMs = Number(process.env.SYNC_ROW_DELAY_MS || 750);
    console.log(`🌙 [MIDNIGHT WORKER] Starting sync for ${rows.length} unprocessed requests...`);

    for (const row of rows) {
      try {
        const deviceName = await resolveNormalizedName(row, dictionary, provider, overrides);
        if (deviceName) {
          await incrementAnalytics({
            deviceName,
            category: row.aiCategory || 'new',
            timestamp: row.timestamp,
          });
        }

        await incrementCustomer({ senderId: row.senderId || 'Unknown' });
        await markRawProcessed(row.id);
        processedCount += 1;
      } catch (rowError) {
        console.error(`❌ Sync failed for row ${row.id}:`, rowError.message);
      }
      if (rowDelayMs > 0) await sleep(rowDelayMs);
    }

    console.log(`✅ [MIDNIGHT WORKER] Successfully synced ${processedCount} requests.`);
    return { processedCount };
  }

  async function listDictionary() {
    if (!firestore) return Array.from(memoryDictionary.entries()).map(([slang, normalizedName]) => ({ id: slang, slang, normalizedName }));
    try {
      const snap = await firestore.collection('ar_dictionary').orderBy('slang').get();
      const firestoreRows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      firestoreRows.forEach((row) => {
        const key = normalizeDeviceName(row.slang);
        if (key && row.normalizedName) memoryDictionary.set(key, row.normalizedName);
      });
      return firestoreRows;
    } catch (err) {
      console.error('⚠️ Failed to list dictionary from Firebase:', err.message);
      return Array.from(memoryDictionary.entries()).map(([slang, normalizedName]) => ({ id: slang, slang, normalizedName }));
    }
  }

  async function upsertDictionary(entry) {
    const slang = String(entry.slang || '').trim();
    const normalizedName = String(entry.normalizedName || '').trim();
    if (!slang || !normalizedName) throw new Error('slang and normalizedName are required');
    const normalizedSlang = normalizeDeviceName(slang);
    memoryDictionary.set(normalizedSlang, normalizedName);

    if (!firestore) {
      return;
    }

    const id = normalizedSlang.replace(/[^a-z0-9]+/g, '_');
    try {
      await firestore.collection('ar_dictionary').doc(id).set({ slang, normalizedName, updatedAt: Date.now() }, { merge: true });
    } catch (err) {
      console.error('⚠️ Failed to save dictionary mapping to Firebase:', err.message);
      throw new Error('Saved locally, but Firebase save failed. Check Firebase credentials/permissions.');
    }
  }

  async function deleteDictionary(id) {
    const normalizedId = normalizeDeviceName(id);
    if (normalizedId) memoryDictionary.delete(normalizedId);
    if (!firestore) return;
    try {
      const existing = await firestore.collection('ar_dictionary').doc(id).get();
      if (existing.exists) {
        const existingSlang = normalizeDeviceName(existing.data()?.slang);
        if (existingSlang) memoryDictionary.delete(existingSlang);
      }
      await firestore.collection('ar_dictionary').doc(id).delete();
    } catch (err) {
      console.error('⚠️ Failed to delete dictionary mapping from Firebase:', err.message);
      throw new Error('Removed locally, but Firebase delete failed. Check Firebase credentials/permissions.');
    }
  }

  return {
    getSettings,
    getDictionaryMap,
    saveRawRequest,
    sync,
    listDictionary,
    upsertDictionary,
    deleteDictionary,
  };
}

module.exports = { createProcessor };
