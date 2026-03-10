# Auto Responder Backend (ChatGPT + Qwen) + Dashboard

This version keeps only the essentials:
- Your CSV-based catalog matching logic
- Provider switching between ChatGPT and Qwen
- Request logging and grouped request frequency
- Dashboard controls for provider + CSV URL updates

## 1) Setup

```bash
cp .env.example .env
npm install
npm start
```

Dashboard: `http://localhost:3000/`

## 2) Environment Variables

Required:

```env
API_KEY=your-secret-incoming-key
OPENAI_CHATGPT=your-openai-key
QWEN_API_KEY=your-qwen-key
```

Optional:

```env
PORT=3000
DEFAULT_AI_PROVIDER=chatgpt
CHATGPT_MODEL=gpt-4o-mini
QWEN_MODEL=qwen-plus
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
MAX_REQUEST_LOG=300
CUSTOM_RESPONSE=Available
GOOGLE_SHEETS_CSV_URL=https://docs.google.com/.../export?format=csv
```

## 3) API

- `POST /api/respond` (requires header `x-api-key`)
- `GET /api/providers`
- `POST /api/providers` (requires `x-api-key`)
- `GET /api/catalog-source`
- `POST /api/catalog-source` (requires `x-api-key`, saves new CSV URL and reloads)
- `POST /api/reload-catalog` (requires `x-api-key`)
- `GET /api/requests`
- `GET /api/grouped-requests`
- `GET /healthz`

## 4) Dashboard behavior

The dashboard now includes:
- Provider switcher (ChatGPT/Qwen)
- API key input used for secure save/reload actions
- CSV URL input (patch your catalog source from UI)
- Full request log table
- Grouped request frequency table

## 5) Deploy notes (Vercel)

- Keep Root Directory as `.`
- Redeploy after each merge
- If `/api/*` returns 404, redeploy latest commit and test:

```bash
curl -i https://YOUR-DOMAIN/api/providers
curl -i https://YOUR-DOMAIN/api/requests
curl -i https://YOUR-DOMAIN/api/grouped-requests
```
