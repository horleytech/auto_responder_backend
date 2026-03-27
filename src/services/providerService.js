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

  return {
    listProviders,
    setActiveProvider,
    getActiveProvider: () => activeProvider,
    runProvider,
  };
}

module.exports = { createProviderService };
