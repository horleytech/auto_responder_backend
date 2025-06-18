# Auto Responder Backend

This is a lightweight Node.js backend for an Android Auto Responder app. It uses OpenAI's ChatGPT to decide whether to respond to incoming messages based on specific keywords and prompts.

---

## 🚀 Features

- Connects to OpenAI's ChatGPT API
- Uses a custom prompt to filter valid responses
- Only replies with `"Available"` (or a custom response) if the AI detects availability
- Returns no response for irrelevant or invalid messages
- Configurable via `.env` file
- Optimized for real-time use

---

## 🧠 How It Works

1. The Android app sends a message (e.g. "Do you have iPhone 13?") to the backend.
2. The backend forwards this to ChatGPT using a system prompt.
3. If ChatGPT responds with `"available"` (or variation), it sends back a custom reply.
4. Otherwise, it returns nothing (`204 No Content`).

---

## 🔧 .env Configuration

Create a `.env` file in the root directory and add the following:

```env
OPENAI_CHATGPT=your-chatgpt-api-key
CUSTOM_RESPONSE=Available
TRIGGER_KEYWORD=available
PORT=3000
PROMPT_TEMPLATE=If the message contains a listed product, respond ONLY with "available". If not, say nothing.
