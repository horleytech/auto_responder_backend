const express = require('express');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const TRIGGER = process.env.TRIGGER_KEYWORD?.toLowerCase() || 'available';
const CUSTOM_RESPONSE = process.env.CUSTOM_RESPONSE || 'Available';
const SYSTEM_PROMPT = process.env.PROMPT_TEMPLATE || `If the message contains a listed product, respond ONLY with "${TRIGGER}". If not, say nothing.`;
const MAX_REQUEST_LOG = Number(process.env.MAX_REQUEST_LOG || 250);

let activeProvider = (process.env.DEFAULT_AI_PROVIDER || 'chatgpt').toLowerCase();

const clients = {
  chatgpt: new OpenAI({
    apiKey: process.env.OPENAI_CHATGPT || 'missing-openai-key',
  }),
  qwen: new OpenAI({
    apiKey: process.env.QWEN_API_KEY || 'missing-qwen-key',
    baseURL: process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  }),
};

const models = {
  chatgpt: process.env.CHATGPT_MODEL || 'gpt-4o',
  qwen: process.env.QWEN_MODEL || 'qwen-plus',
};

const requestLog = [];

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\w]/g, '').trim();
}

function hasProviderCredentials(provider) {
  return provider === 'chatgpt'
    ? Boolean(process.env.OPENAI_CHATGPT)
    : Boolean(process.env.QWEN_API_KEY);
}

function saveRequest(entry) {
  requestLog.unshift(entry);
  if (requestLog.length > MAX_REQUEST_LOG) {
    requestLog.length = MAX_REQUEST_LOG;
  }
}

function listProviders() {
  return {
    activeProvider,
    providers: ['chatgpt', 'qwen'].map((name) => ({
      name,
      model: models[name],
      configured: hasProviderCredentials(name),
    })),
  };
}

async function runProviderCompletion(provider, userMessage) {
  if (!clients[provider]) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  if (!hasProviderCredentials(provider)) {
    throw new Error(`Missing credentials for provider: ${provider}`);
  }

  const completion = await clients[provider].chat.completions.create({
    model: models[provider],
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 10,
    temperature: 0,
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}

app.get('/api/providers', (req, res) => {
  return res.send(listProviders());
});

app.post('/api/providers', (req, res) => {
  const requestedProvider = String(req.body?.provider || '').toLowerCase().trim();

  if (!clients[requestedProvider]) {
    return res.status(400).send({
      error: 'Unsupported provider. Use "chatgpt" or "qwen".',
    });
  }

  activeProvider = requestedProvider;
  return res.send(listProviders());
});

app.get('/api/requests', (req, res) => {
  return res.send({
    count: requestLog.length,
    requests: requestLog,
  });
});

app.post('/api/respond', async (req, res) => {
  const userMessage = req.body?.senderMessage;
  const provider = String(req.body?.provider || activeProvider).toLowerCase();
  const requestEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    time: new Date().toISOString(),
    provider,
    senderMessage: userMessage || '',
    trigger: TRIGGER,
    status: 'received',
  };

  console.log('🔽 Incoming request body:', req.body);

  if (!userMessage) {
    requestEntry.status = 'failed';
    requestEntry.error = 'Missing senderMessage';
    saveRequest(requestEntry);
    console.warn('⚠️ Missing senderMessage in request.');
    return res.status(400).send({ error: 'Missing senderMessage' });
  }

  try {
    const reply = await runProviderCompletion(provider, userMessage);
    const normalized = normalize(reply);

    requestEntry.rawReply = reply;
    requestEntry.normalizedReply = normalized;

    console.log(`🧠 ${provider} raw reply:`, reply);
    console.log('🔍 Normalized reply:', normalized);

    if (normalized === TRIGGER) {
      requestEntry.status = 'matched';
      requestEntry.outboundResponse = CUSTOM_RESPONSE;
      saveRequest(requestEntry);
      console.log('✅ Match found. Sending response...');
      return res.send({
        data: [{ message: CUSTOM_RESPONSE }],
      });
    }

    requestEntry.status = 'no_match';
    saveRequest(requestEntry);
    console.log('⛔ No match. No response sent.');
    return res.status(204).send();
  } catch (err) {
    requestEntry.status = 'failed';
    requestEntry.error = err.message;
    saveRequest(requestEntry);
    console.error(`💥 ${provider} error:`, err.message);
    return res.status(500).send({ error: 'Server error', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Auto Responder backend running on port ${PORT}`);
});
