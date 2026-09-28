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
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, balance, userGroup, unlimited)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt,
      apiKey.balance, apiKey.userGroup, apiKey.unlimited ? 1 : 0,
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
                         balance = ?, userGroup = ?, unlimited = ?
       WHERE id = ?`,
      [
        merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0,
        Number(merged.balance ?? 0), merged.userGroup ?? null,
        merged.unlimited ? 1 : 0,
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
