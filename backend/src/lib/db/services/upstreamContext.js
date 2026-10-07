/**
 * Upstream context-window metadata service.
 *
 * Fetches each upstream provider's /models catalog ONCE (TTL-cached in the kv
 * table so it survives restarts) and exposes per-model context windows.
 *
 * Data sources:
 *  - openrouter:  https://openrouter.ai/api/v1/models        → context_length (public, no key)
 *  - groq:        https://api.groq.com/openai/v1/models      → context_window  (needs key)
 *  - custom nodes (openai-compatible): {baseUrl}/models      → context_length / context_window (needs node key)
 *
 * Resolution for a 9router model id like "openrouter/x/y", "groq/a/b",
 * "clouvia/m": strip the FIRST prefix segment (the 9router alias) and look the
 * rest up in that alias's catalog. Clouvia/dahono ids are "clouvia/<model>" so
 * the remainder is the bare upstream id.
 *
 * Combos: a combo's window = MAX of its member models' windows, computed live
 * in models/route.ts (not cached, since combo membership changes).
 */

import { getAdapter, getAdapterSync } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getProviderNodes } from "../repos/nodesRepo.js";
import { getProviderConnections } from "../repos/connectionsRepo.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — context windows rarely change
const KV_SCOPE = "upstreamModelContext";
const FETCH_TIMEOUT_MS = 8000;

// In-memory memo of the kv row so repeated /v1/models hits don't re-parse JSON.
let _memoryCache = null; // { alias: { modelId: ctx } }
let _memoryCacheAt = 0;

function readKv() {
  try {
    const db = getAdapterSync();
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = 'catalog'`, [KV_SCOPE]);
    if (!row) return null;
    const parsed = parseJson(row.value, null);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null; // adapter not initialized yet — caller will refresh async
  }
}

async function writeKv(catalog) {
  const db = await getAdapter();
  const payload = stringifyJson({ at: Date.now(), catalog });
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, 'catalog', ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [KV_SCOPE, payload]
  );
}

function extractContextWindow(model) {
  if (!model || typeof model !== "object") return null;
  const candidates = [
    model.context_length,
    model.context_window,
    model.contextLength,
    model.contextWindow,
    model.max_model_len,
    model.max_context_length,
  ];
  for (const c of candidates) {
    const n = typeof c === "string" ? parseInt(c, 10) : c;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", ...headers },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Build catalog entries for one upstream. Returns { alias: { modelId: ctx } }.
async function buildOpenRouterCatalog() {
  const json = await fetchJson("https://openrouter.ai/api/v1/models");
  const list = json?.data;
  if (!Array.isArray(list)) return null;
  const out = {};
  for (const m of list) {
    const ctx = extractContextWindow(m);
    if (ctx && m.id) out[m.id] = ctx;
  }
  return Object.keys(out).length ? out : null;
}

async function buildGroqCatalog(apiKey) {
  if (!apiKey) return null;
  const json = await fetchJson("https://api.groq.com/openai/v1/models", {
    Authorization: `Bearer ${apiKey}`,
  });
  const list = json?.data;
  if (!Array.isArray(list)) return null;
  const out = {};
  for (const m of list) {
    const ctx = extractContextWindow(m);
    if (ctx && m.id) out[m.id] = ctx;
  }
  return Object.keys(out).length ? out : null;
}

async function buildNodeCatalog(node) {
  if (!node?.baseUrl || !node?.apiKey) return null;
  const base = String(node.baseUrl).trim().replace(/\/$/, "");
  const json = await fetchJson(`${base}/models`, { Authorization: `Bearer ${node.apiKey}` });
  const list = json?.data || json?.models;
  if (!Array.isArray(list)) return null;
  const out = {};
  for (const m of list) {
    const ctx = extractContextWindow(m);
    const id = m?.id || m?.name || m?.model;
    if (ctx && id) out[id] = ctx;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Collect all upstream catalogs. Best-effort per source: a failing source is
 * skipped (its models just get no window) instead of failing the whole refresh.
 */
async function refreshCatalog() {
  const catalog = {};

  // 1. OpenRouter (public)
  try {
    const or = await buildOpenRouterCatalog();
    if (or) catalog.openrouter = or;
  } catch { /* skip */ }

  // 2. Groq (key from first active connection)
  try {
    const conns = await getProviderConnections({ provider: "groq", isActive: true });
    const key = conns?.[0]?.apiKey;
    const g = await buildGroqCatalog(key);
    if (g) catalog.groq = g;
  } catch { /* skip */ }

  // 3. Custom openai-compatible nodes (clouvia, dahono, ...)
  try {
    const nodes = await getProviderNodes({ type: "openai-compatible" });
    for (const node of nodes) {
      if (node.isActive === false) continue;
      const prefix = node.prefix || node.name;
      if (!prefix) continue;
      // Node key lives on its connections; take any active one.
      let apiKey = node.apiKey;
      if (!apiKey) {
        const conns = await getProviderConnections({ isActive: true });
        const conn = conns.find((c) => c.provider === node.id);
        apiKey = conn?.apiKey;
      }
      const built = await buildNodeCatalog({ ...node, apiKey });
      if (built) catalog[prefix] = built;
    }
  } catch { /* skip */ }

  if (Object.keys(catalog).length === 0) return null;
  await writeKv(catalog);
  _memoryCache = catalog;
  _memoryCacheAt = Date.now();
  return catalog;
}

async function getCatalog(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _memoryCache && now - _memoryCacheAt < CACHE_TTL_MS) {
    return _memoryCache;
  }
  const stored = readKv();
  if (!forceRefresh && stored?.at && now - stored.at < CACHE_TTL_MS && stored.catalog) {
    _memoryCache = stored.catalog;
    _memoryCacheAt = stored.at;
    return stored.catalog;
  }
  const refreshed = await refreshCatalog();
  if (refreshed) return refreshed;
  // Refresh failed — serve stale rather than nothing.
  if (stored?.catalog) {
    _memoryCache = stored.catalog;
    _memoryCacheAt = stored.at || now;
    return stored.catalog;
  }
  return {};
}

/**
 * Context window for a 9router model id ("alias/upstream/id").
 * Returns number | null (null = unknown, caller omits the field).
 */
export async function getContextWindow(modelId) {
  if (!modelId || typeof modelId !== "string" || !modelId.includes("/")) return null;
  const catalog = await getCatalog();
  if (!catalog || Object.keys(catalog).length === 0) return null;

  const slash = modelId.indexOf("/");
  const alias = modelId.slice(0, slash);
  const rest = modelId.slice(slash + 1);

  const source = catalog[alias];
  if (!source) return null;

  // Exact match first; then suffix match (dahono ids are "dahono/dahono/x" —
  // after alias strip the upstream id may still carry its own "dahono/" prefix).
  if (source[rest] !== undefined) return source[rest];
  const suffix = Object.keys(source).find((k) => k === rest || k.endsWith(`/${rest}`) || rest.endsWith(`/${k}`));
  return suffix ? source[suffix] : null;
}

/** Force a refresh (e.g. after provider/node settings change). */
export async function invalidateContextCatalog() {
  _memoryCache = null;
  _memoryCacheAt = 0;
  try {
    const db = await getAdapter();
    db.run(`DELETE FROM kv WHERE scope = ?`, [KV_SCOPE]);
  } catch { /* best-effort */ }
}
