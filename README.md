# Auto Responder Backend + Dashboard

This project is a Node.js service for market-message auto responses. It now supports **ChatGPT and Qwen**, plus a built-in frontend dashboard to monitor inbound requests and switch the default AI provider.

## Features

- AI provider support:
  - ChatGPT (OpenAI)
  - Qwen (OpenAI-compatible API)
- `/api/respond` endpoint that checks messages against your prompt logic
- Configurable trigger keyword and custom response
- In-memory request tracking for all incoming requests
- Dashboard UI at `/` for:
  - Viewing incoming requests in an organized table
  - Switching default provider between ChatGPT and Qwen
- Ready to deploy to Vercel (including your Horley Tech Scrapebot Vercel setup)

## Environment Variables

Create a `.env` file in the project root:

```env
# Server
PORT=3000

# AI Provider defaults
DEFAULT_AI_PROVIDER=chatgpt
CHATGPT_MODEL=gpt-4o
QWEN_MODEL=qwen-plus
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1

# API keys
OPENAI_CHATGPT=your-openai-api-key
QWEN_API_KEY=your-qwen-api-key

# Auto-response behavior
CUSTOM_RESPONSE=Available
TRIGGER_KEYWORD=available
PROMPT_TEMPLATE=If the message contains a listed product, respond ONLY with "available". If not, say nothing.

# Request history cap
MAX_REQUEST_LOG=250
```

## Run Locally

```bash
npm install
npm start
```

- API base URL: `http://localhost:3000`
- Dashboard: `http://localhost:3000/`

## API Endpoints

### `POST /api/respond`

Checks a message and decides whether to return your custom response.

Request body:

```json
{
  "senderMessage": "Do you have iPhone 13?",
  "provider": "chatgpt"
}
```

- `provider` is optional. If omitted, the backend uses the active default provider.

Possible responses:

- `200` with reply payload when trigger matches
- `204` when no match
- `400` for invalid input
- `500` for provider/API issues

### `GET /api/requests`

Returns recent inbound requests and their processing status:
- `matched`
- `no_match`
- `failed`

### `GET /api/providers`

Lists provider configuration and current active provider.

### `POST /api/providers`

Updates active provider.

Request body:

```json
{
  "provider": "qwen"
}
```

## Frontend Dashboard

Open `/` to:
1. Select default AI provider (ChatGPT or Qwen)
2. View all incoming requests
3. Inspect status, source message, provider, and errors

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import the project into Vercel (same workflow as Horley Tech Scrapebot).
3. Set all required environment variables in Vercel Project Settings.
4. Deploy.

If your Android app or market webhook is already pointed to a Vercel URL, update it to this deployment URL and use `/api/respond`.
