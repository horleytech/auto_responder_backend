const { OpenAI } = require('openai');
const {
  OPENAI_API_KEY,
  QWEN_API_KEY,
  QWEN_BASE_URL,
  CHATGPT_MODEL,
  QWEN_MODEL,
  DEFAULT_AI_PROVIDER,
} = require('../config/env');

function resolveKeys(overrides = {}) {
  const envOpenAi = process.env.OPENAI_API_KEY || process.env.OPENAI_CHATGPT || OPENAI_API_KEY;
  const envQwen = process.env.QWEN_API_KEY || QWEN_API_KEY;

  return {
    openAiKey: String(overrides.openAiKey || '').trim() || envOpenAi,
    qwenKey: String(overrides.qwenKey || '').trim() || envQwen,
  };
}

function createProviderService() {
  let activeProvider = DEFAULT_AI_PROVIDER;

  function getClient(provider, overrides = {}) {
    const { openAiKey, qwenKey } = resolveKeys(overrides);

    if (provider === 'chatgpt') {
      return openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;
    }

    if (provider === 'qwen') {
      return qwenKey ? new OpenAI({ apiKey: qwenKey, baseURL: QWEN_BASE_URL }) : null;
    }

    return null;
  }

  function listProviders() {
    return {
      activeProvider,
      providers: [
        { name: 'chatgpt', model: CHATGPT_MODEL, configured: Boolean(resolveKeys().openAiKey) },
        { name: 'qwen', model: QWEN_MODEL, configured: Boolean(resolveKeys().qwenKey) },
      ],
      envKeysLoaded: {
        OPENAI_API_KEY: Boolean(resolveKeys().openAiKey),
        QWEN_API_KEY: Boolean(resolveKeys().qwenKey),
      },
    };
  }

  function setActiveProvider(provider) {
    activeProvider = provider;
  }

  async function runProvider(provider, systemPrompt, userMessage, overrides = {}) {
    const client = getClient(provider, overrides);
    if (!client) throw new Error(`Provider not configured: ${provider}`);

    const model = provider === 'qwen' ? QWEN_MODEL : CHATGPT_MODEL;
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    return completion.choices?.[0]?.message?.content || '{}';
  }

  async function runJson(provider, systemPrompt, userMessage, overrides = {}) {
    const raw = await runProvider(provider, systemPrompt, userMessage, overrides);
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('AI response was not valid JSON');
    }
  }

  function buildGatekeeperPrompt(newForbidden, usedForbidden) {
    return `
You are the Gatekeeper for an inventory checker.
Analyze the user message and return ONLY a JSON object.

Return format:
{
  "category": "new" | "used",
  "intentItem": string | null,
  "forbidden": string | null,
  "isApproved": boolean,
  "reason": string
}

Rules:
1) Category is "used" if user explicitly indicates used/uk used/second hand; otherwise "new".
2) Forbidden list for NEW: ${newForbidden.join(', ')}
3) Forbidden list for USED: ${usedForbidden.join(', ')}
4) "esim" is forbidden ONLY when "physical" or "physical sim" is absent.
5) intentItem should be the primary requested device phrase as written by user.
6) If forbidden is detected, isApproved must be false.
7) Return strict JSON only.
`.trim();
  }

  async function runTwoLayerCheck({ provider, userMessage, newForbidden, usedForbidden, catalog, gatekeeperPrompt, overrides = {} }) {
    const prompt = gatekeeperPrompt || buildGatekeeperPrompt(newForbidden, usedForbidden);
    const gatekeeper = await runJson(provider, prompt, userMessage, overrides);

    if (!gatekeeper.intentItem || !gatekeeper.isApproved) {
      return {
        gatekeeper,
        matchmaker: { mappedItem: null, inInventory: false, matchedDevice: null },
      };
    }

    const category = gatekeeper.category === 'used' ? 'used' : 'new';
    const mappedItem = catalog.mapArrangement(gatekeeper.intentItem);
    const inventoryPool = category === 'used' ? catalog.getUsedDevices() : catalog.getNewDevices();
    const matchedDevice = inventoryPool.find((device) => device === mappedItem) || null;

    return {
      gatekeeper,
      matchmaker: {
        mappedItem,
        inInventory: Boolean(matchedDevice),
        matchedDevice,
      },
    };
  }

  return {
    listProviders,
    setActiveProvider,
    getActiveProvider: () => activeProvider,
    runProvider,
    runTwoLayerCheck,
  };
}

module.exports = { createProviderService };
