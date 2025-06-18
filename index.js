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
  const { message } = req.body;
  if (!message) return res.status(400).send('Message is required');

  try {
    const gpt = await openai.chat.completions.create({
      model: 'gpt-4o', // use gpt-4o for cheaper and fast performance
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const reply = gpt.choices[0]?.message?.content?.trim() || '';
    const normalized = normalize(reply);

    if (normalized === TRIGGER) {
      return res.send(CUSTOM_RESPONSE);
    }

    return res.status(204).send(); // No content
  } catch (err) {
    console.error('OpenAI error:', err);
    res.status(500).send('Server error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Auto Responder backend running on port ${PORT}`);
});
