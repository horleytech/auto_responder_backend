require('dotenv').config();

module.exports = {
  API_KEY: process.env.API_KEY || '',
  DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD || '',
  OPENAI_API_KEY: process.env.OPENAI_CHATGPT || process.env.OPENAI_API_KEY || '',
  QWEN_API_KEY: process.env.QWEN_API_KEY || '',
  QWEN_BASE_URL: process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  CHATGPT_MODEL: process.env.CHATGPT_MODEL || 'gpt-4o-mini',
  QWEN_MODEL: process.env.QWEN_MODEL || 'qwen-plus',
  DEFAULT_AI_PROVIDER: (process.env.DEFAULT_AI_PROVIDER || 'chatgpt').toLowerCase(),
  GOOGLE_SHEETS_CSV_URL:
    process.env.GOOGLE_SHEETS_CSV_URL ||
    'https://docs.google.com/spreadsheets/d/1Jh7TXif0dsaAVgoExEOCmkACZHPPZqIsiW4hH8T5Pts/export?format=csv',
  ARRANGEMENT_MAP_CSV_URL: process.env.ARRANGEMENT_MAP_CSV_URL || process.env.GOOGLE_SHEETS_CSV_URL || '',
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',
  FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
  CORS_ALLOWED_ORIGINS: String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  PORT: process.env.PORT || 3000,
  IS_VERCEL: Boolean(process.env.VERCEL),
};
