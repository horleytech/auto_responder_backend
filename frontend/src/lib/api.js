const API_BASE = '';

function withBase(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_BASE}${url}`;
}

export async function fetchJsonSafe(url, options = {}) {
  // Grab the API key stored by the Settings Page
  const apiKey = localStorage.getItem('API_KEY') || import.meta.env.VITE_API_KEY || '';
  
  const finalOptions = {
    ...options,
    headers: {
      ...options.headers,
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
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

  if (!response.ok && response.status === 403) {
    console.error('API Error: 403 Forbidden. Is your API Key set in the Settings tab?');
  }

  return { response, data };
}
