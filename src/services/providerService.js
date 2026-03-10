const { OpenAI } = require('openai');
const {
  OPENAI_API_KEY,
  QWEN_API_KEY,
  QWEN_BASE_URL,
  CHATGPT_MODEL,
  QWEN_MODEL,
  DEFAULT_AI_PROVIDER,
} = require('../config/env');

function createProviderService() {
  let activeProvider = DEFAULT_AI_PROVIDER;

  const clients = {
    chatgpt: OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null,
    qwen: QWEN_API_KEY ? new OpenAI({ apiKey: QWEN_API_KEY, baseURL: QWEN_BASE_URL }) : null,
  };

  function listProviders() {
    return {
      activeProvider,
      providers: [
        { name: 'chatgpt', model: CHATGPT_MODEL, configured: Boolean(clients.chatgpt) },
        { name: 'qwen', model: QWEN_MODEL, configured: Boolean(clients.qwen) },
      ],
    };
  }

  function setActiveProvider(provider) {
    activeProvider = provider;
  }

  async function runProvider(provider, systemPrompt, userMessage) {
    const client = clients[provider];
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
