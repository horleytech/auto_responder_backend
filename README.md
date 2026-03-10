# Auto Responder Backend + Dashboard

This project is a Node.js service for market-message auto responses. It supports **ChatGPT and Qwen**, includes a built-in frontend dashboard, and can persist provider settings + request logs to **Firebase Firestore**.

## Features

- AI provider support:
  - ChatGPT (OpenAI)
  - Qwen (OpenAI-compatible API)
- `/api/respond` endpoint that checks messages against your prompt logic
- Configurable trigger keyword and custom response
- Request tracking for incoming messages
- Dashboard UI at `/` for:
  - Viewing incoming requests in an organized table
  - Switching default provider between ChatGPT and Qwen
  - Home button back to HorleyTech hub (same tab)
  - Built-in Dashboard Diagnostics checks for providers/requests endpoints
  - Viewing top requested items and request frequency
- Persistence modes:
  - Firebase Firestore (recommended for Vercel/serverless)
  - In-memory fallback (if Firebase is not configured)

## Environment Variables

> Never commit your real `.env` to git. Rotate keys immediately if they were ever committed.

Copy `.env.example` to `.env` in the project root and fill your real values.

```bash
cp .env.example .env
```

### Required

```env
OPENAI_CHATGPT=your-openai-api-key
# optional alias also supported:
# OPENAI_API_KEY=your-openai-api-key
QWEN_API_KEY=your-qwen-api-key
```

### Optional (safe defaults are already in code)

```env
# Server
PORT=3000

# AI Provider defaults
DEFAULT_AI_PROVIDER=chatgpt
CHATGPT_MODEL=gpt-4o
QWEN_MODEL=qwen-plus
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1

# Auto-response behavior
CUSTOM_RESPONSE=Available
TRIGGER_KEYWORD=available
# PROMPT_TEMPLATE is optional. Only set it if you want to override default prompt logic.
# PROMPT_TEMPLATE=If the message contains a listed product, respond ONLY with "available". If not, say nothing.

# Request history cap
MAX_REQUEST_LOG=250
```

### Firebase Firestore (recommended on Vercel)

```env
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

- `FIREBASE_SERVICE_ACCOUNT_JSON` must contain a full service account JSON object as a single-line string.
- If Firebase is not configured, the app still works using memory storage.

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

- `provider` is optional. If omitted, backend uses the saved active provider.

### `GET /api/requests`

Returns recent inbound requests and status (`matched`, `no_match`, `failed`).

### `GET /api/providers`

Lists providers and current active provider.

### `POST /api/providers`

Updates active provider.

```json
{
  "provider": "qwen"
}
```

### `GET /api/analytics`

Returns aggregated request-frequency data (top repeated request texts) for dashboard insights.

### `GET /healthz`

Returns service health and current persistence mode (`firebase` or `memory`).

## Dashboard Link for Horley Tech Scrapebot

Use your deployed Vercel URL root as the dashboard link:

`https://YOUR-VERCEL-DOMAIN/`

Dashboard includes a Home button that links to: `https://scrapebot.horleytech.com/hub`

Use this API webhook URL in Horley Tech Scrapebot for incoming requests:

`https://YOUR-VERCEL-DOMAIN/api/respond`

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import into Vercel.
3. In **Project Settings → General**:
   - **Root Directory** = `.`
   - **Framework Preset** = `Other`
   - Remove any custom build command like `vite build`
4. Set environment variables in Vercel.
5. Deploy.

### Fix for this error
`Build Failed: The specified Root Directory "frontend" does not exist.`

Set Root Directory to `.` and redeploy.

### Fix for this error
`sh: line 1: vite: command not found` / `Command "vite build" exited with 127`

This is a backend project (Express), not Vite. Set framework to `Other`, remove `vite build`, and redeploy.


## Troubleshooting

### Provider dropdown stuck on "Loading providers..."

This usually means Firestore reads are failing in production. The backend now falls back to in-memory provider state if Firebase read/write errors happen, so provider switching should still work while you fix Firebase IAM/rules.

### OpenAI `insufficient_quota` in logs

Your server is working, but the selected provider key has no quota/billing left.

- Switch to `qwen` from the dashboard (or `POST /api/providers`).
- Or top up/enable billing for your OpenAI project.
- You can verify active provider with `GET /api/providers`.

### VPS/PM2 update commands

If you deploy on your own Ubuntu server with PM2:

```bash
cd ~/auto_responder_backend
git status
# if you have local edits you want to discard:
git reset --hard
git pull origin main --rebase
npm install
pm2 restart auto-responder
pm2 logs auto-responder --lines 50
```

If `git pull` says you have unstaged changes and you want to keep them:

```bash
cd ~/auto_responder_backend
git stash
git pull origin main --rebase
git stash pop
```


### `git pull --rebase` fails with untracked `package-lock.json`

If you see:

```
error: The following untracked working tree files would be overwritten by merge:
        package-lock.json
```

It means your server has a local untracked `package-lock.json` but the remote now tracks that file.

Use this safe flow:

```bash
cd ~/auto_responder_backend
git stash -u
git pull origin main --rebase
git stash pop
```

If stash pop creates conflicts and you just want the repo version of lockfile:

```bash
cd ~/auto_responder_backend
git checkout --theirs package-lock.json
git add package-lock.json
```

If you do not need any local untracked files, you can also clean and pull:

```bash
cd ~/auto_responder_backend
git clean -fd
git pull origin main --rebase
```


### Vercel env vars vs PM2 `.env`

Vercel environment variables are only available inside Vercel deployments.
If you run this app on your own Ubuntu server with PM2, set variables in that server's `.env` (or PM2 ecosystem config) and restart with `--update-env`.

```bash
cd ~/auto_responder_backend
npm install
pm2 restart auto-responder --update-env
```

If PM2 logs still show `Cannot find module 'firebase-admin'`, clear old logs and check fresh output:

```bash
pm2 flush auto-responder
pm2 restart auto-responder --update-env
pm2 logs auto-responder --lines 100
```



### Why did a prompt appear in `.env`?

The app does **not** edit your `.env` file at runtime. If you see `PROMPT_TEMPLATE` in `.env`, it was manually added during setup or deployment edits. It is optional and can be removed to use built-in defaults.

### Quick `.env` checklist for PM2 server

Use this minimum set on your Ubuntu/PM2 host (not only in Vercel):

```env
OPENAI_CHATGPT=...
QWEN_API_KEY=...
CUSTOM_RESPONSE=Available
TRIGGER_KEYWORD=available
PORT=3000
```

Optional for Firebase persistence:

```env
FIREBASE_PROJECT_ID=...
FIREBASE_SERVICE_ACCOUNT_JSON={...single-line-json...}
```

### How to confirm Firebase is working

1. Open dashboard and check storage label shows `Storage: firebase`.
2. Or call:

```bash
curl -s http://127.0.0.1:3000/api/providers
curl -s http://127.0.0.1:3000/api/requests
```

If response shows `"persistence":"firebase"`, Firebase is active. If `"memory"`, it fell back to in-memory mode.



### `Unexpected token 'T' ... is not valid JSON` in dashboard

This means the dashboard asked `/api/providers` or `/api/requests` for JSON but received plain text/HTML instead (often a 404/error page like `The page could not be found`).

Check these quickly:

```bash
curl -i https://YOUR-DOMAIN/api/providers
curl -i https://YOUR-DOMAIN/api/requests
```

Both should return JSON. If they return HTML/text, your domain is pointing to a different app or the server route is not deployed yet.


### If provider switching still fails

Use the **Run Checks** button in the dashboard. It validates `/api/providers` and `/api/requests` and shows whether provider keys are configured or missing.

Also verify manually:

```bash
curl -s http://127.0.0.1:3000/api/providers
```

If `providers` is empty or endpoint does not return JSON, fix deployment routing first.


### Why dotenv prints `injecting env (6) from .env`

That line is informational from `dotenv`, not an error. It means your process loaded 6 keys from one `.env` file.

### `/api/*` returns 404 on Vercel

If dashboard HTML loads but `/api/providers`, `/api/requests`, or `/api/analytics` return 404, your deployment is likely serving static files but not attaching Express routes.

This repo now exports the Express app for Vercel runtime and only calls `app.listen` outside Vercel.
After pulling latest code, redeploy in Vercel and test:

```bash
curl -i https://YOUR-DOMAIN/api/providers
curl -i https://YOUR-DOMAIN/api/requests
curl -i https://YOUR-DOMAIN/api/analytics
```

All should return JSON (200/500), not 404 HTML.
