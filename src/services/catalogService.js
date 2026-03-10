const axios = require('axios');

function normalizeDeviceName(deviceType) {
  if (!deviceType) return null;
  return deviceType
    .toLowerCase()
    .replace(/galaxy /gi, '')
    .replace(/\s+/g, ' ')
    .replace(/pro max/g, 'pro max')
    .replace(/pro xl/g, 'pro xl')
    .replace(/iphone /gi, 'iphone ')
    .trim();
}

function isUsedCondition(condition) {
  if (!condition) return false;
  const lower = condition.toLowerCase();
  return lower.includes('used') || lower.includes('grade a') || lower.includes('uk used');
}

function createCatalogService(initialCsvUrl) {
  let csvUrl = initialCsvUrl;
  let supportedNewDevices = [];
  let supportedUsedDevices = [];

  async function loadCatalog() {
    try {
      console.log(`📥 Loading catalog from: ${csvUrl}`);
      const response = await axios.get(csvUrl);
      const lines = String(response.data).split('\n').filter((line) => line.trim() !== '');

      const rows = lines.map((line) =>
        line
          .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
          .map((cell) => cell.replace(/^"(.*)"$/, '$1').trim())
      );

      const headers = rows[0] || [];
      const deviceIndex = headers.indexOf('Device Type');
      const conditionIndex = headers.indexOf('Condition');
      const priceIndex = headers.indexOf('Regular price');

      if (deviceIndex < 0 || conditionIndex < 0 || priceIndex < 0) {
        throw new Error('CSV missing required headers: Device Type, Condition, Regular price');
      }

      const newSet = new Set();
      const usedSet = new Set();

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length <= Math.max(deviceIndex, conditionIndex, priceIndex)) continue;

        const deviceType = row[deviceIndex];
        const condition = row[conditionIndex];
        const price = row[priceIndex];

        if (!deviceType || !price || price.startsWith('#') || price === '') continue;

        const normalized = normalizeDeviceName(deviceType);
        if (!normalized) continue;

        if (isUsedCondition(condition)) usedSet.add(normalized);
        else newSet.add(normalized);
      }

      supportedNewDevices = Array.from(newSet);
      supportedUsedDevices = Array.from(usedSet);

      console.log(`✅ Loaded: ${supportedNewDevices.length} new, ${supportedUsedDevices.length} used devices.`);
      return { success: true, newCount: supportedNewDevices.length, usedCount: supportedUsedDevices.length };
    } catch (err) {
      console.error('❌ Failed to load catalog:', err.message);
      return { success: false, error: err.message };
    }
  }

  return {
    getCsvUrl: () => csvUrl,
    setCsvUrl: (nextUrl) => {
      csvUrl = nextUrl;
    },
    getNewDevices: () => supportedNewDevices,
    getUsedDevices: () => supportedUsedDevices,
    loadCatalog,
  };
}

module.exports = { createCatalogService };
