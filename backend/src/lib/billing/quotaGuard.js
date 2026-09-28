/**
 * Quota guard — pre-flight check before a chat request runs.
 *
 * Port of one-hub's relay/relay_util/quota.go PreQuotaConsumption(), adapted
 * to 9router's flat key model: balance lives on apiKeys, tier ratio comes
 * from userGroups.
 *
 * Rate limit (apiRate per minute) is enforced with an in-memory sliding window
 * — same bucket the one-hub APILimiter provides.
 *
 * Derived from One Hub (https://github.com/songquanpeng/one-hub),
 * Copyright 2023 The One Hub Authors, licensed under Apache-2.0.
 * Rewritten for 9router's key/balance model; see README "Credits"
 * for the full derivation list.
 */

import { getAdapter } from "../db/driver.js";
import { computeCharge } from "./computeCharge.js";

export { computeCharge };
export const estimateCost = computeCharge;

const buckets = new Map(); // bucketKey -> [timestamps]

function windowCount(bucketKey) {
  const now = Date.now();
  const arr = buckets.get(bucketKey);
  if (!arr) return 0;
  const cutoff = now - 60_000;
  const kept = arr.filter((t) => t > cutoff);
  buckets.set(bucketKey, kept);
  return kept.length;
}

function touch(bucketKey) {
  const arr = buckets.get(bucketKey) || [];
  arr.push(Date.now());
  buckets.set(bucketKey, arr);
}

export function resetRateLimiters() {
  buckets.clear();
}

/**
 * @param {object} p
 * @param {string} p.apiKeyId
 * @param {number} p.promptTokens
 * @param {number} p.completionTokens
 * @param {object} p.price          { input, output }
 * @param {object} [p.group]        userGroup row (may be undefined)
 * @param {boolean} [p.unlimited]
 * @returns {Promise<{allowed:boolean, reason:string|null, cost:number}>}
 */
export async function checkQuota({
  apiKeyId,
  promptTokens,
  completionTokens,
  price,
  group = null,
  unlimited = false,
}) {
  const groupRatio = Number(group?.ratio ?? 1);
  const apiRate = Number(group?.apiRate ?? 0);
  const symbol = group?.symbol ?? "default";

  // 1. rate limit per tier
  if (apiRate > 0) {
    const key = `${symbol}:${apiKeyId}`;
    const count = windowCount(key);
    if (count >= apiRate) {
      return {
        allowed: false,
        cost: 0,
        reason: `rate_limited: group ${symbol} allows ${apiRate} req/min (window full)`,
      };
    }
  }

  // 2. cost estimate
  const cost = computeCharge({ promptTokens, completionTokens, price, groupRatio });
  if (cost <= 0) {
    if (apiRate > 0) touch(`${symbol}:${apiKeyId}`);
    return { allowed: true, cost: 0, reason: null };
  }

  // 3. balance check
  if (!unlimited) {
    const adapter = await getAdapter();
    const row = await adapter.get("SELECT balance FROM apiKeys WHERE id = ?", [apiKeyId]);
    const balance = Number(row?.balance ?? 0);
    if (balance < cost) {
      return {
        allowed: false,
        cost,
        reason: `insufficient_quota: balance ${balance} < estimated ${cost}`,
      };
    }
  }

  if (apiRate > 0) touch(`${symbol}:${apiKeyId}`);
  return { allowed: true, cost, reason: null };
}

/** Deduct after a successful request. Best-effort; never throws. */
export async function settleQuota({ apiKeyId, actualCost }) {
  if (!apiKeyId || actualCost <= 0) return;
  try {
    const adapter = await getAdapter();
    await adapter.run("UPDATE apiKeys SET balance = balance - ? WHERE id = ?", [actualCost, apiKeyId]);
  } catch (e) {
    console.warn("[quota] settle failed:", e.message);
  }
}

export async function keyBalance(apiKeyId) {
  const adapter = await getAdapter();
  const row = await adapter.get("SELECT balance FROM apiKeys WHERE id = ?", [apiKeyId]);
  return Number(row?.balance ?? 0);
}

/**
 * Resolve per-token pricing for a model id from the `pricing` kv scope.
 * Falls back to 1 in / 2 out so billing never silently charges zero.
 * Moved here from tierQuota.js so chargeRequest can reuse it.
 */
export async function loadPricingForModel(modelStr) {
  const DEFAULT_PRICE = { input: 1, output: 2 };
  try {
    const adapter = await getAdapter();
    const rows = await adapter.all("SELECT value FROM kv WHERE scope = 'pricing'");
    const provider = modelStr.includes("/") ? modelStr.split("/")[0] : "";
    if (!provider) return DEFAULT_PRICE;
    for (const r of rows) {
      let parsed;
      try { parsed = JSON.parse(r.value); } catch { continue; }
      const models = parsed?.[provider];
      if (!models) continue;
      const p = models[modelStr.slice(provider.length + 1)];
      if (p) return { input: Number(p.input ?? 1), output: Number(p.output ?? 2) };
    }
  } catch { /* fall through to default */ }
  return DEFAULT_PRICE;
}
