import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

/**
 * SQLite has no boolean type; it stores 0/1. Convert once, here, so every
 * caller sees a real boolean instead of having to remember which layer is
 * coercing.
 */
function toBool(v) {
  return v === 1 || v === true;
}

/**
 * Model allow-list for a key.
 *
 * Stored as a JSON array of patterns. An empty list, a missing value or a
 * list containing "*" all mean "no restriction", which is what every key
 * created before this column existed gets.
 */
export function parseAllowedModels(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== "string" || !raw.trim()) return ["*"];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ["*"];
    const list = parsed.map(String).filter(Boolean);
    return list.length ? list : ["*"];
  } catch {
    // A bare string like "gpt-4o" is accepted rather than silently becoming
    // "allow everything", so a hand-edited row cannot quietly widen access.
    return [raw.trim()];
  }
}

function serializeAllowedModels(list) {
  const arr = Array.isArray(list) ? list.map(String).filter(Boolean) : [];
  return JSON.stringify(arr.length ? arr : ["*"]);
}

/**
 * Whether `model` is permitted by `allowed`.
 *
 * Matching is on the full model id as the client sent it, and also on the id
 * with any provider prefix stripped, so a key configured with "deepseek-v4-flash"
 * still matches a request for "dahono/deepseek-v4-flash".
 */
export function modelAllowed(model, allowed) {
  const list = parseAllowedModels(allowed);
  if (list.includes("*")) return true;
  if (!model) return false;

  const id = String(model);
  // Candidate forms of an id: the full string, and the id with each leading
  // "provider/" segment peeled off. A router that concatenates a prefix onto
  // an already-qualified id produces "provider/provider/model", so peeling has
  // to repeat rather than run once. Patterns go through the same reduction so
  // a fully-qualified pattern still matches a bare request, and vice versa.
  const candidates = new Set([id]);
  let rest = id;
  while (rest.includes("/")) {
    rest = rest.slice(rest.indexOf("/") + 1);
    if (rest) candidates.add(rest);
  }

  return list.some((pattern) => {
    const p = String(pattern);
    if (candidates.has(p)) return true;
    if (p.endsWith("*")) {
      const stem = p.slice(0, -1);
      return [...candidates].some((c) => c.startsWith(stem));
    }
    // Qualified pattern, bare request.
    if (p.includes("/")) {
      const tail = p.slice(p.indexOf("/") + 1);
      if (tail && candidates.has(tail)) return true;
      if (tail.endsWith("*")) {
        const stem = tail.slice(0, -1);
        return [...candidates].some((c) => c.startsWith(stem));
      }
    }
    return false;
  });
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: toBool(row.isActive),
    createdAt: row.createdAt,
    // Billing/tier fields. These are part of the key's identity for quota
    // purposes, so they must survive every read.
    balance: Number(row.balance ?? 0),
    userGroup: row.userGroup ?? null,
    unlimited: toBool(row.unlimited),
    // Running total of charges; promotion windows are measured against it.
    lifetimeCharge: Number(row.lifetimeCharge ?? 0),
    // Model patterns this key may call. ["*"] means unrestricted.
    allowedModels: parseAllowedModels(row.allowedModels),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function getApiKeyByValue(key) {
  if (!key || typeof key !== "string") return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, opts = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("../../../shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    balance: Number(opts.balance ?? 0),
    userGroup: opts.userGroup ?? null,
    unlimited: toBool(opts.unlimited),
    // Model allow-list; defaults to unrestricted so a key created without it
    // behaves exactly as it did before the column existed.
    allowedModels: parseAllowedModels(opts.allowedModels),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, balance, userGroup, unlimited, allowedModels)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt,
      apiKey.balance, apiKey.userGroup, apiKey.unlimited ? 1 : 0,
      serializeAllowedModels(apiKey.allowedModels),
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?,
                         balance = ?, userGroup = ?, unlimited = ?, allowedModels = ?
       WHERE id = ?`,
      [
        merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0,
        Number(merged.balance ?? 0), merged.userGroup ?? null,
        merged.unlimited ? 1 : 0,
        serializeAllowedModels(merged.allowedModels),
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return toBool(row.isActive);
}
