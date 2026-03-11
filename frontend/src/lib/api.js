export async function fetchJsonSafe(url, options) {
  const response = await fetch(url, options);
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
