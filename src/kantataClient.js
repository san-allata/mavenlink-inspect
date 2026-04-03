import { config } from "./config.js";

function buildUrl(endpoint, params = {}) {
  const url = new URL(`${config.apiBaseUrl}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiGet(token, endpoint, params = {}) {
  const res = await fetch(buildUrl(endpoint, params), {
    headers: { Authorization: `Bearer ${token}` }
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return payload;
}

export function extractResults(payload) {
  if (!payload || !Array.isArray(payload.results)) return [];

  return payload.results
    .map((r) => payload?.[r.key]?.[r.id])
    .filter(Boolean);
}

export async function apiGetAllPages(token, endpoint, params = {}) {
  const perPage = 200;
  let page = 1;
  let all = [];

  while (true) {
    const payload = await apiGet(token, endpoint, { ...params, page, per_page: perPage });
    const rows = extractResults(payload);
    all = all.concat(rows);

    if (rows.length < perPage) break;
    page += 1;

    if (page > 100) break;
  }

  return all;
}
