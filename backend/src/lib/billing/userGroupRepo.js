/**
 * In-memory user-group cache + CRUD for the new tier system.
 *
 * Port of one-hub's `model/user_group.go` + `GlobalUserGroupRatio`.
 * State is rebuilt on every CRUD; restart wipes it.
 *
 * Derived from One Hub (https://github.com/songquanpeng/one-hub),
 * Copyright 2023 The One Hub Authors, licensed under Apache-2.0.
 * Rewritten for 9router's key/balance model; see README "Credits"
 * for the full derivation list.
 */

import { getAdapter } from "../db/driver.js";

const DEFAULT_GROUP = "free";

class UserGroupCache {
  constructor() {
    this._map = new Map(); // symbol -> UserGroup
    this._public = new Set();
  }

  replaceAll(rows) {
    this._map = new Map();
    this._public = new Set();
    for (const r of rows) {
      // SQLite has no booleans: better-sqlite3 gives 0/1, sql.js may give true/false.
      // Coerce both, otherwise `0 !== false` would read a disabled group as enabled.
      const asBool = (v, dflt) => {
        if (v === null || v === undefined) return dflt;
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0;
        if (typeof v === "string") return v !== "" && v !== "0" && v.toLowerCase() !== "false";
        return Boolean(v);
      };
      const asNum = (v, dflt) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : dflt;
      };
      const row = {
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        ratio: asNum(r.ratio, 1),
        apiRate: asNum(r.apiRate, 600),
        public: asBool(r.public, false),
        promotion: asBool(r.promotion, false),
        // Consumption window, compared against apiKeys.lifetimeCharge.
        min: asNum(r.min, 0),
        max: asNum(r.max, 0),
        // Key-count cap. Distinct from min/max above, which are a spend range.
        maxKeys: asNum(r.maxKeys, 0),
        enable: asBool(r.enable, true),
      };
      this._map.set(row.symbol, row);
      if (row.public && row.enable) this._public.add(row.symbol);
    }
  }

  get(symbol) {
    if (symbol == null) return undefined;
    return this._map.get(symbol);
  }

  publicGroups() {
    return [...this._public];
  }

  all() {
    return [...this._map.values()];
  }

  size() {
    return this._map.size;
  }
}

let cache = new UserGroupCache();

async function loadFromDb(adapter) {
  const rows = await adapter.all("SELECT * FROM userGroups ORDER BY id ASC");
  cache.replaceAll(rows);
}

async function ensureLoaded() {
  if (cache.size() === 0) {
    const adapter = await getAdapter();
    await loadFromDb(adapter);
  }
}

export async function getGroupCache() {
  await ensureLoaded();
  return cache;
}

export async function refreshCache() {
  const adapter = await getAdapter();
  await loadFromDb(adapter);
}

export async function createUserGroup(row) {
  const adapter = await getAdapter();
  const now = new Date().toISOString();
  await adapter.run(
    "INSERT INTO userGroups (symbol, name, ratio, apiRate, public, promotion, min, max, maxKeys, enable, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [row.symbol, row.name, row.ratio, row.apiRate, row.public ? 1 : 0, row.promotion ? 1 : 0, row.min, row.max, row.maxKeys ?? 0, row.enable ? 1 : 0, now, now],
  );
  await refreshCache();
  return { ...row };
}

export async function updateUserGroup(symbol, patch) {
  const adapter = await getAdapter();
  const existing = await adapter.get("SELECT * FROM userGroups WHERE symbol = ?", [symbol]);
  if (!existing) return null;
  const now = new Date().toISOString();
  const merged = {
    name: patch.name ?? existing.name,
    ratio: patch.ratio ?? existing.ratio,
    apiRate: patch.apiRate ?? existing.apiRate,
    public: patch.public ?? existing.public,
    promotion: patch.promotion ?? existing.promotion,
    min: patch.min ?? existing.min,
    max: patch.max ?? existing.max,
    maxKeys: patch.maxKeys ?? existing.maxKeys ?? 0,
    enable: patch.enable ?? existing.enable,
  };
  await adapter.run(
    "UPDATE userGroups SET name=?, ratio=?, apiRate=?, public=?, promotion=?, min=?, max=?, maxKeys=?, enable=?, updatedAt=? WHERE symbol=?",
    [merged.name, merged.ratio, merged.apiRate, merged.public ? 1 : 0, merged.promotion ? 1 : 0, merged.min, merged.max, merged.maxKeys, merged.enable ? 1 : 0, now, symbol],
  );
  await refreshCache();
  return { symbol, ...merged };
}

export async function deleteUserGroup(symbol) {
  const adapter = await getAdapter();
  await adapter.run("DELETE FROM userGroups WHERE symbol=?", [symbol]);
  await refreshCache();
}

export async function listUserGroups(filter = {}) {
  const adapter = await getAdapter();
  let q = "SELECT * FROM userGroups WHERE 1=1";
  const args = [];
  if (filter.enable != null) {
    q += " AND enable=?"; args.push(filter.enable ? 1 : 0);
  }
  q += " ORDER BY id ASC";
  return adapter.all(q, args);
}

export async function getGroupBySymbol(symbol) {
  return cache.get(symbol);
}

export function pickGroup(tokenGroup, userGroup) {
  if (tokenGroup) return cache.get(tokenGroup) || null;
  return cache.get(userGroup) || null;
}

/**
 * How many keys a tier currently holds. Counts only active keys: a disabled
 * key does not consume a slot, otherwise disabling a key to work around the
 * cap would permanently occupy one.
 */
export async function countKeysInGroup(symbol) {
  if (!symbol) return 0;
  const adapter = await getAdapter();
  const row = await adapter.get(
    "SELECT COUNT(*) AS c FROM apiKeys WHERE userGroup = ? AND isActive = 1",
    [symbol],
  );
  return Number(row?.c ?? 0);
}

/**
 * Check whether `symbol` can take one more key, honouring maxKeys.
 *
 * maxKeys = 0 means no ceiling. This is deliberately NOT userGroups.max,
 * which is a consumption window (see pickPromotionGroup).
 *
 * @returns {Promise<{ok: boolean, reason?: string, count?: number, maxKeys?: number}>}
 */
export async function checkGroupCapacity(symbol, { excludeKeyId = null } = {}) {
  if (!symbol) return { ok: true };
  const group = cache.get(symbol);
  if (!group) return { ok: true }; // unknown tier — validation happens elsewhere

  const adapter = await getAdapter();
  const row = excludeKeyId
    ? await adapter.get(
        "SELECT COUNT(*) AS c FROM apiKeys WHERE userGroup = ? AND isActive = 1 AND id != ?",
        [symbol, excludeKeyId],
      )
    : await adapter.get(
        "SELECT COUNT(*) AS c FROM apiKeys WHERE userGroup = ? AND isActive = 1",
        [symbol],
      );
  const count = Number(row?.c ?? 0);
  const maxKeys = Number(group.maxKeys ?? 0);

  if (maxKeys > 0 && count >= maxKeys) {
    return {
      ok: false,
      reason: `tier ${symbol} is full (${count}/${maxKeys} keys)`,
      count,
      maxKeys,
    };
  }
  return { ok: true, count, maxKeys };
}

/**
 * Choose the promotion tier that covers a given lifetime spend.
 *
 * A tier applies while  min <= lifetimeCharge < max  (max 0 = open ended).
 * Where ranges overlap the higher `min` wins, so a key always lands on the
 * most specific tier that contains it.
 *
 * This is the production counterpart of the logic sketched in
 * userGroupMath.test.js; the test now imports this instead of a copy.
 *
 * @param {Array} groups
 * @param {number} lifetimeCharge
 * @returns {object|null}
 */
export function pickPromotionGroup(groups, lifetimeCharge) {
  let target = null;
  for (const g of groups) {
    if (!g.promotion || !g.enable) continue;
    const min = Number(g.min ?? 0);
    const max = Number(g.max ?? 0);
    if (lifetimeCharge >= min && (max === 0 || lifetimeCharge < max)) {
      if (target === null || min > Number(target.min ?? 0)) target = g;
    }
  }
  return target;
}

/**
 * The promotion ladder: every promotion-enabled tier, ordered by its window
 * floor, so "next" always means "has spent more".
 */
export function promotionLadder() {
  return cache
    .all()
    .filter((g) => g.promotion && g.enable)
    .sort((a, b) => Number(a.min ?? 0) - Number(b.min ?? 0));
}
