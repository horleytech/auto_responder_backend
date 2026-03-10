# Auto Responder Backend (Organized) + Dashboard

This build keeps your core CSV-driven logic and adds a clean folder structure, Qwen support, Firebase persistence, and a dashboard that controls provider + CSV source.

## Folder Structure

- `src/config/` → environment config
- `src/services/` → Firebase, providers, catalog, request store, settings store
- `src/app.js` → API wiring
- `index.js` → runtime entrypoint (`app.listen`) + export for Vercel
- `public/css/` and `public/js/` → organized frontend assets
- `public/index.html` → dashboard shell

## Setup

```bash
cp .env.example .env
npm install
npm start
```

Dashboard: `http://localhost:3000/`

## Environment Variables

Required:

```env
API_KEY=your-secret-incoming-key
OPENAI_CHATGPT=your-openai-key
QWEN_API_KEY=your-qwen-key
```

Optional runtime:

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

Optional Firebase persistence:

```env
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

If Firebase is set, request records and settings (active provider + CSV URL) persist in Firestore. If not, memory fallback is used.

## API

- `POST /api/respond` (requires `x-api-key`)
- `GET /api/providers`
- `POST /api/providers` (requires `x-api-key`)
- `GET /api/catalog-source`
- `POST /api/catalog-source` (requires `x-api-key`)
- `POST /api/reload-catalog` (requires `x-api-key`)
- `GET /api/requests`
- `GET /api/grouped-requests`
- `GET /healthz`

## Dashboard

- Switch provider between ChatGPT and Qwen
- Enter and update CSV URL from UI
- Reload catalog from UI
- View all incoming requests
- View grouped/frequency requests
- Same-tab Home button to `https://scrapebot.horleytech.com/hub`


## Core Logic Guarantee

Your original responder logic is preserved:
- same forbidden phrase lists,
- same category detection flow from AI JSON,
- same judgment order (forbidden first, then supported device),
- same dynamic response rotation,
- same `204` behavior for forbidden/no-match.

Improvements only add organization, dashboard controls, provider switching (ChatGPT/Qwen), and optional Firebase persistence for records/settings.


## Vercel Runtime Error Fix

If Vercel shows:

`Function Runtimes must have a valid version, for example now-php@1.0.0.`

Use the pinned runtime in `vercel.json` (`@vercel/node@3.2.26`) and redeploy.
