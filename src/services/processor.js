const { normalizeDeviceName } = require('./catalogService');

function toMillis(input) {
  if (!input) return Date.now();
  if (typeof input === 'number') return input;
  return new Date(input).getTime();
}

function createProcessor({ firestore, catalog, providerService, settingsStore, FieldValue }) {
  const memoryRaw = [];
  const memoryDictionary = new Map();
  const memoryAnalytics = new Map();
  const memoryCustomers = new Map();

  async function getSettings() {
    return settingsStore.read();
  }

  async function saveRawRequest(payload) {
    if (!firestore) {
      memoryRaw.push({ id: `${Date.now()}`, ...payload });
      return;
    }
    await firestore.collection('ar_raw_requests').add(payload);
  }

  async function listUnprocessedRaw() {
    if (!firestore) return memoryRaw.filter((row) => !row.processed);
    const snap = await firestore.collection('ar_raw_requests').where('processed', '==', false).limit(500).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async function getDictionaryMap() {
    if (!firestore) return new Map(memoryDictionary);
    const snap = await firestore.collection('ar_dictionary').get();
    const dict = new Map();
    snap.docs.forEach((doc) => {
      const data = doc.data();
      const slang = normalizeDeviceName(data.slang);
      if (slang && data.normalizedName) dict.set(slang, data.normalizedName);
    });
    return dict;
  }

  async function resolveNormalizedName(raw, dictionary, provider, overrides) {
    const normalizedMessage = normalizeDeviceName(raw.senderMessage);
    if (normalizedMessage && dictionary.has(normalizedMessage)) {
      return dictionary.get(normalizedMessage);
    }

    const arrangementRows = Object.entries(catalog.getArrangementMap())
      .map(([slang, canonical]) => `${slang} => ${canonical}`)
      .slice(0, 500)
      .join('\n');

    const prompt = `You are a normalization assistant. Return JSON only: {"normalizedName": string|null}.\nMatch the user text to the best exact catalog item using this arrangement map:\n${arrangementRows}`;

    try {
      const rawResult = await providerService.runProvider(provider, prompt, String(raw.senderMessage || ''), overrides);
      const parsed = JSON.parse(rawResult || '{}');
      return parsed.normalizedName || null;
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
    if (!firestore) {
      const row = memoryRaw.find((x) => x.id === rawId);
      if (row) row.processed = true;
      return;
    }
    await firestore.collection('ar_raw_requests').doc(rawId).set({ processed: true, processedAt: Date.now() }, { merge: true });
  }

  async function sync({ provider, overrides = {} }) {
    const rows = await listUnprocessedRaw();
    const dictionary = await getDictionaryMap();
    let processedCount = 0;

    for (const row of rows) {
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
    }

    return { processedCount };
  }

  async function listDictionary() {
    if (!firestore) return Array.from(memoryDictionary.entries()).map(([slang, normalizedName]) => ({ id: slang, slang, normalizedName }));
    const snap = await firestore.collection('ar_dictionary').orderBy('slang').get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async function upsertDictionary(entry) {
    const slang = String(entry.slang || '').trim();
    const normalizedName = String(entry.normalizedName || '').trim();
    if (!slang || !normalizedName) throw new Error('slang and normalizedName are required');

    if (!firestore) {
      memoryDictionary.set(normalizeDeviceName(slang), normalizedName);
      return;
    }

    const id = normalizeDeviceName(slang).replace(/[^a-z0-9]+/g, '_');
    await firestore.collection('ar_dictionary').doc(id).set({ slang, normalizedName, updatedAt: Date.now() }, { merge: true });
  }

  async function deleteDictionary(id) {
    if (!firestore) {
      memoryDictionary.delete(id);
      return;
    }
    await firestore.collection('ar_dictionary').doc(id).delete();
  }

  return {
    getSettings,
    saveRawRequest,
    sync,
    listDictionary,
    upsertDictionary,
    deleteDictionary,
  };
}

module.exports = { createProcessor };
