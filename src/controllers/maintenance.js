const express = require('express');

function createMaintenanceRouter({ firestore, processor, settingsStore, isDashboardAuthorized, catalog }) {
  const router = express.Router();

  function guard(req, res, next) {
    if (!isDashboardAuthorized(req)) return res.sendStatus(403);
    return next();
  }

  router.post('/sync', guard, async (req, res) => {
    try {
      const catalogLoad = catalog ? await catalog.loadCatalog() : { success: true };
      if (!catalogLoad.success) {
        return res.status(400).json({ error: `Catalog refresh failed before sync: ${catalogLoad.error}` });
      }
      const settings = await settingsStore.read();
      const provider = settings.activeProvider || 'chatgpt';
      const result = await processor.sync({
        provider,
        overrides: {
          openAiKey: req.body?.OPENAI_API_KEY,
          qwenKey: req.body?.QWEN_API_KEY,
        },
      });
      return res.json({ success: true, catalog: catalogLoad, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/nuke', guard, async (req, res) => {
    try {
      if (firestore) {
        const raw = await firestore.collection('ar_raw_requests').get();
        await Promise.all(raw.docs.map((d) => d.ref.delete()));

        const analytics = await firestore.collection('ar_analytics').get();
        await Promise.all(analytics.docs.map((d) => d.ref.set({ requestCount: 0, resetAt: Date.now() }, { merge: true })));
      }
      return res.json({ success: true, message: 'Nuke completed' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/backup', guard, async (req, res) => {
    try {
      const payload = { dictionary: [], settings: {}, analytics: [], createdAt: Date.now() };

      if (firestore) {
        const [dictSnap, settingsSnap, analyticsSnap] = await Promise.all([
          firestore.collection('ar_dictionary').get(),
          firestore.collection('ar_settings').get(),
          firestore.collection('ar_analytics').get(),
        ]);

        payload.dictionary = dictSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        payload.settings = settingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        payload.analytics = analyticsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        await firestore.collection('ar_backups').add({
          timestamp: Date.now(),
          payload: JSON.stringify(payload),
        });
      }

      return res.json({ success: true, backupSize: JSON.stringify(payload).length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createMaintenanceRouter };
