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
      await firestore.collection('ar_requests').doc(entry.id).set(entry);
      if (entry.senderId) {
        await firestore.collection('ar_customers').doc(String(entry.senderId)).set(
          {
            senderId: String(entry.senderId),
            lastSeen: entry.time,
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.error('⚠️ Failed to persist request to Firebase:', err.message);
    }
  }

  async function list() {
    if (!firestore) return memoryLog;
    try {
      const snapshot = await firestore.collection('ar_requests').orderBy('time', 'desc').limit(MAX_REQUEST_LOG).get();
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

  async function analytics(timeframeDays) {
    const rows = await list();
    const since = timeframeDays ? Date.now() - timeframeDays * 24 * 60 * 60 * 1000 : null;
    const filtered = since ? rows.filter((row) => new Date(row.time).getTime() >= since) : rows;

    const topCustomers = new Map();
    const topDevices = new Map();
    let blockedRequests = 0;

    for (const row of filtered) {
      const senderId = row.senderId || 'unknown';
      topCustomers.set(senderId, (topCustomers.get(senderId) || 0) + 1);

      if (row.matchedDevice) {
        topDevices.set(row.matchedDevice, (topDevices.get(row.matchedDevice) || 0) + 1);
      }

      if (row.status === 'blocked_forbidden') blockedRequests += 1;
    }

    const sortMap = (map) => Array.from(map.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);

    return {
      totalRequests: filtered.length,
      blockedRequests,
      topCustomers: sortMap(topCustomers).slice(0, 10),
      mostRequestedDevices: sortMap(topDevices).slice(0, 10),
    };
  }

  return { save, list, grouped, analytics };
}

module.exports = { createRequestStore };
