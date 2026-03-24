const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim();
const DASHBOARD_SESSION_KEY = 'dashboard_session_token';

function withBase(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_BASE}${url}`;
}

export async function fetchJsonSafe(url, options = {}) {
  const sessionToken = typeof window !== 'undefined' ? window.localStorage.getItem(DASHBOARD_SESSION_KEY) : '';
  const finalOptions = {
    ...options,
    credentials: 'include',
    headers: {
      ...options.headers,
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    }
  };

  const response = await fetch(withBase(url), finalOptions);
  const raw = await response.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }

  return { response, data };
}

export function saveDashboardToken(token) {
  if (typeof window === 'undefined') return;
  if (!token) {
    window.localStorage.removeItem(DASHBOARD_SESSION_KEY);
    return;
  }
  window.localStorage.setItem(DASHBOARD_SESSION_KEY, token);
}
