const express = require('express');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_CHATGPT,
}));

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
    const gpt = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        { role: 'user', content: message },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const reply = gpt.data.choices[0]?.message?.content?.trim() || '';
    const normalized = normalize(reply);

    if (normalized === TRIGGER) {
      return res.send(CUSTOM_RESPONSE);
    }

    return res.status(204).send(); // No content
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Auto Responder backend running on port ${PORT}`);
});
