const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim();
const DASHBOARD_SESSION_KEY = 'dashboard_session_token';

function withBase(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_BASE}${url}`;
}

function isExpiredDashboardToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return true;
  const [expiresRaw] = raw.split('.');
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= Date.now();
}

export async function fetchJsonSafe(url, options = {}) {
  const rawToken = typeof window !== 'undefined' ? window.localStorage.getItem(DASHBOARD_SESSION_KEY) : '';
  const sessionToken = isExpiredDashboardToken(rawToken) ? '' : rawToken;
  if (rawToken && !sessionToken) saveDashboardToken('');
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

  const normalizedUrl = String(url || '');
  const isAuthRoute = normalizedUrl.includes('/api/login');
  if ((response.status === 401 || response.status === 403) && !isAuthRoute) {
    saveDashboardToken('');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dashboard-auth-expired', { detail: { status: response.status, url: normalizedUrl } }));
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
