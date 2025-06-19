const express = require('express');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_CHATGPT,
});

const TRIGGER = process.env.TRIGGER_KEYWORD?.toLowerCase() || 'available';
const CUSTOM_RESPONSE = process.env.CUSTOM_RESPONSE || 'Available';
const SYSTEM_PROMPT = process.env.PROMPT_TEMPLATE || `If the message contains a listed product, respond ONLY with "${TRIGGER}". If not, say nothing.`;

function normalize(text) {
  return text.toLowerCase().replace(/[^\w]/g, '').trim();
}

app.post('/api/respond', async (req, res) => {
  console.log("🔽 Incoming request body:", req.body); // Debug log

  const userMessage = req.body?.senderMessage;
  if (!userMessage) {
    console.warn("⚠️ Missing senderMessage in request.");
    return res.status(400).send({ error: 'Missing senderMessage' });
  }

  try {
    const gpt = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const reply = gpt.choices[0]?.message?.content?.trim() || '';
    const normalized = normalize(reply);

    console.log("🧠 GPT raw reply:", reply);
    console.log("🔍 Normalized reply:", normalized);

    if (normalized === TRIGGER) {
      console.log("✅ Match found. Sending response...");
      return res.send({
        data: [
          { message: CUSTOM_RESPONSE }
        ]
      });
    }

    console.log("⛔ No match. No response sent.");
    return res.status(204).send(); // No reply
  } catch (err) {
    console.error('💥 OpenAI error:', err);
    return res.status(500).send({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Auto Responder backend running on port ${PORT}`);
});
