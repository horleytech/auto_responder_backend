const { MAX_REQUEST_LOG } = require('../config/env');

function normalizeRequestText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function createRequestStore(firestore) {
  const memoryLog = [];

  async function save(entry) {
    memoryLog.unshift(entry);
    if (memoryLog.length > MAX_REQUEST_LOG) memoryLog.length = MAX_REQUEST_LOG;

    if (!firestore) return;
    try {
      await firestore.collection('requests').doc(entry.id).set(entry);
    } catch (err) {
      console.error('⚠️ Failed to persist request to Firebase:', err.message);
    }
  }

  async function list() {
    if (!firestore) return memoryLog;
    try {
      const snapshot = await firestore.collection('requests').orderBy('time', 'desc').limit(MAX_REQUEST_LOG).get();
      return snapshot.docs.map((doc) => doc.data());
    } catch (err) {
      console.error('⚠️ Failed to read Firebase requests, fallback to memory:', err.message);
      return memoryLog;
    }
  }

  async function grouped(limit = 30) {
    const rows = await list();
    const map = new Map();

    for (const req of rows) {
      const key = normalizeRequestText(req.senderMessage);
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, {
          key,
          sampleMessage: req.senderMessage,
          count: 0,
          lastSeen: req.time,
        });
      }

      const current = map.get(key);
      current.count += 1;
      if (req.time > current.lastSeen) {
        current.lastSeen = req.time;
        current.sampleMessage = req.senderMessage;
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)))
      .slice(0, limit);
  }

  return { save, list, grouped };
}

module.exports = { createRequestStore };
