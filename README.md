# Auto Responder Backend (Organized) + Dashboard

This build keeps your core CSV-driven logic and adds a clean folder structure, Qwen support, Firebase persistence, and a dashboard that controls provider + CSV source.

## Folder Structure

- `src/config/` → environment config
- `src/services/` → Firebase, providers, catalog, processor, settings store
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

## Production Deploy (after PR merge)

If GitHub shows **"This branch has not been deployed"**, that means merge happened but deployment did **not** run yet.

On the server, deploy manually:

```bash
cd /root/auto_responder_backend
git pull origin main
npm install
npm run build
pm2 restart auto-responder --update-env
```

Then verify the running backend/frontend version:

```bash
curl -s https://autoresponder.horleytech.com/api/version
curl -s https://autoresponder.horleytech.com/healthz
```

`/api/version` returns `buildTag` and currently served frontend bundle hashes so you can confirm the updated build is live.

Dashboard: `http://localhost:3000/`

## Environment Variables

Required:

```env
API_KEY=your-secret-incoming-key
DASHBOARD_PASSWORD=your-dashboard-password
OPENAI_CHATGPT=your-openai-key
# OPENAI_API_KEY=your-openai-key  # supported alias
QWEN_API_KEY=your-qwen-key
```

Optional runtime:

```env
PORT=3000
DEFAULT_AI_PROVIDER=chatgpt
CHATGPT_MODEL=gpt-4o-mini
QWEN_MODEL=qwen-plus
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
GOOGLE_SHEETS_CSV_URL=https://docs.google.com/.../export?format=csv
KEEP_PROCESSED_RAW=false
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

`CORS_ALLOWED_ORIGINS` also supports simple wildcards (for example, `https://*.horleytech.com`).

Optional Firebase persistence:

```env
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

If Firebase is set, request records and settings (active provider + CSV URL) persist in Firestore. If not, memory fallback is used.
By default, synced raw requests are deleted after successful midnight sync to keep Firestore lean. Set `KEEP_PROCESSED_RAW=true` if you prefer to retain processed rows with a `processed` flag.

## API

- `POST /api/respond` (requires `x-api-key`)
- `GET /api/providers`
- `POST /api/providers`
- `GET /api/catalog-source`
- `POST /api/catalog-source`
- `GET /api/requests`
- `POST /api/requests/clear`
- `GET /api/clean-analytics`
- `GET /healthz`

## Dashboard

- Switch provider between ChatGPT and Qwen
- Enter and update CSV URL from UI
- Reload catalog from UI
- View matched-request logs only (avoids blocked/unknown noise)
- View analytics with matched-device pie chart and hourly frequency chart
- Same-tab Home button to `https://scrapebot.horleytech.com/hub`


## Core Logic Guarantee

Your original responder logic is preserved:
- same forbidden phrase lists,
- same category detection flow from AI JSON,
- same judgment order (forbidden first, then supported device),
- same dynamic response rotation,
- same `204` behavior for forbidden/no-match.

Improvements only add organization, dashboard controls, provider switching (ChatGPT/Qwen), and optional Firebase persistence for records/settings.
