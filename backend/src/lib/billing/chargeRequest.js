/**
 * Post-request billing. Charges the key's balance using the ACTUAL token
 * counts reported by the upstream, then deducts.
 *
 * Pre-flight (`quotaGuard.checkQuota`) only estimates; this is the real charge.
 * Both share `computeCharge` so estimate and settlement can't drift apart.
 *
 * Derived from One Hub (https://github.com/songquanpeng/one-hub),
 * Copyright 2023 The One Hub Authors, licensed under Apache-2.0.
 * Rewritten for 9router's key/balance model; see README "Credits"
 * for the full derivation list.
 */

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.model
 * @param {object} p.tokens    { prompt_tokens|input_tokens, completion_tokens|output_tokens }
 * @param {(model: string) => Promise<{input:number,output:number}>} p.loadPrice
 * @returns {Promise<{charged:number, balance:number, skipped:string|null}>}
 */
export async function chargeRequest({ apiKey, model, tokens, loadPrice }) {
  if (!apiKey) return { charged: 0, balance: 0, skipped: "no_api_key" };

  const inTok = Number(tokens?.prompt_tokens ?? tokens?.input_tokens ?? 0);
  const outTok = Number(tokens?.completion_tokens ?? tokens?.output_tokens ?? 0);
  if (inTok === 0 && outTok === 0) {
    return { charged: 0, balance: 0, skipped: "no_usage_reported" };
  }

  const { getAdapter } = await import("../db/driver.js");
  const { getGroupCache } = await import("./userGroupRepo.js");
  const { loadPricingForModel, computeCharge } = await import("./quotaGuard.js");

  const adapter = await getAdapter();
  const keyRow = await adapter.get(
    "SELECT id, userGroup, balance, unlimited FROM apiKeys WHERE key = ?",
    [apiKey],
  );
  if (!keyRow) return { charged: 0, balance: 0, skipped: "key_not_found" };

  // Unlimited keys are still metered for stats but never go negative.
  const group = (await getGroupCache()).get(keyRow.userGroup) || null;
  const groupRatio = Number(group?.ratio ?? 1);
  const price = await loadPrice(model);

  const charged = computeCharge({
    promptTokens: inTok,
    completionTokens: outTok,
    price,
    groupRatio,
  });
  if (charged <= 0) return { charged: 0, balance: Number(keyRow.balance ?? 0), skipped: "zero_cost" };

  if (keyRow.unlimited === 1 || keyRow.unlimited === true) {
    return { charged: 0, balance: Number(keyRow.balance ?? 0), skipped: "unlimited" };
  }

  // Guard against a negative balance if several requests settle concurrently.
  // lifetimeCharge accumulates in the same statement so promotion below reads
  // the post-charge total.
  await adapter.run(
    "UPDATE apiKeys SET balance = MAX(0, balance - ?), lifetimeCharge = COALESCE(lifetimeCharge, 0) + ? WHERE id = ?",
    [charged, charged, keyRow.id],
  );
  const after = await adapter.get(
    "SELECT balance, lifetimeCharge FROM apiKeys WHERE id = ?",
    [keyRow.id],
  );
  const newBalance = Number(after?.balance ?? 0);
  const lifetime = Number(after?.lifetimeCharge ?? 0);

  // Promotion is a function of lifetime spend, not of the current balance: a
  // key moves to the tier whose [min, max) window contains its lifetime total.
  // It is checked on every settle rather than only at zero, because a tier's
  // window can be crossed mid-balance.
  const moved = await tryPromoteKey(adapter, keyRow, lifetime);
  if (moved) return { charged, balance: newBalance, lifetimeCharge: lifetime, promotedTo: moved, skipped: null };

  return { charged, balance: newBalance, lifetimeCharge: lifetime, skipped: null };
}

/**
 * Move `keyRow` onto the promotion tier that matches its lifetime spend.
 * No-op when the key is already there, when no tier opts into promotion, or
 * when the matching tier is full.
 *
 * @returns {Promise<string|null>} the new tier symbol, or null if unchanged
 */
async function tryPromoteKey(adapter, keyRow, lifetimeCharge) {
  const { getGroupCache, pickPromotionGroup, checkGroupCapacity } = await import(
    "./userGroupRepo.js"
  );
  const groups = (await getGroupCache()).all();
  if (!groups.some((g) => g.promotion && g.enable)) return null;

  const target = pickPromotionGroup(groups, lifetimeCharge);
  if (!target) return null;
  if (target.symbol === keyRow.userGroup) return null;

  const capacity = await checkGroupCapacity(target.symbol);
  if (!capacity.ok) return null; // the matching tier is full — stay where we are

  await adapter.run("UPDATE apiKeys SET userGroup = ? WHERE id = ?", [target.symbol, keyRow.id]);
  console.warn(
    `[billing] promoted key ${String(keyRow.id).slice(0, 8)}: ` +
      `${keyRow.userGroup || "(none)"} -> ${target.symbol} ` +
      `(lifetimeCharge ${lifetimeCharge})`
  );
  return target.symbol;
}
