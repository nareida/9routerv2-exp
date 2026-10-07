/**
 * Tier quota gate for the chat path.
 *
 * Returns null to let the request through, or a Response to short-circuit.
 * Feature-detects: with no userGroups rows configured, nothing is enforced —
 * so existing installs keep working exactly as before.
 *
 * Derived from One Hub (https://github.com/songquanpeng/one-hub),
 * Copyright 2023 The One Hub Authors, licensed under Apache-2.0.
 * Rewritten for 9router's key/balance model; see README "Credits"
 * for the full derivation list.
 */

import { getAdapter } from "../../lib/db/driver.js";
import { getGroupCache } from "../../lib/billing/userGroupRepo.js";
import { checkQuota, estimateCost, loadPricingForModel } from "../../lib/billing/quotaGuard.js";
import { modelAllowed } from "../../lib/db/repos/apiKeysRepo.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";

// rough prompt estimate; exact count only known after the upstream responds
function estimatePromptTokens(body) {
  const messages = body.messages || body.input || [];
  let chars = 0;
  for (const m of messages) {
    const c = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((p) => p.text || "").join("")
        : "";
    chars += String(c).length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Per-key model allow-list gate.
 *
 * Independent of the tier system: a key may be restricted to a few models even
 * when no userGroups rows exist, so this runs before enforceTierQuota and does
 * not share its "feature off" short-circuit. A missing or wildcard list allows
 * everything, which is how every key created before the column existed behaves.
 *
 * @returns {Promise<Response|null>} a 403 when the model is not permitted
 */
export async function enforceModelAllowlist(apiKey, modelStr) {
  if (!apiKey || !modelStr) return null;
  try {
    const adapter = await getAdapter();
    const row = await adapter.get("SELECT id, allowedModels FROM apiKeys WHERE key = ?", [apiKey]);
    if (!row) return null;
    if (modelAllowed(modelStr, row.allowedModels)) return null;

    log.warn("MODEL_ALLOWLIST", `key ${String(row.id).slice(0, 8)} may not use "${modelStr}"`);
    // 403 already carries type "permission_error"; the code is left as the
    // generic one so the client sees a permission failure, not a quota one.
    return errorResponse(
      HTTP_STATUS.FORBIDDEN,
      `model_not_allowed: this key is not permitted to use "${modelStr}"`,
    );
  } catch (e) {
    // Never block a request because the allow-list could not be read.
    log.warn("MODEL_ALLOWLIST", `allowlist check failed, allowing request: ${e?.message ?? e}`);
    return null;
  }
}

export async function enforceTierQuota(apiKey, body, modelStr) {
  let groups;
  try {
    groups = (await getGroupCache()).all();
  } catch {
    return null; // cache not ready / DB not migrated — never block on this
  }
  if (!groups.length) return null; // no tiers configured → feature off

  let keyRow;
  try {
    const adapter = await getAdapter();
    keyRow = await adapter.get("SELECT id, userGroup, balance, unlimited FROM apiKeys WHERE key = ?", [apiKey]);
  } catch {
    return null;
  }
  if (!keyRow) return null;

  const group = groups.find((g) => g.symbol === keyRow.userGroup) || null;
  const unlimited = keyRow.unlimited === 1 || keyRow.unlimited === true;
  const price = await loadPricingForModel(modelStr);
  const promptTokens = estimatePromptTokens(body);

  const result = await checkQuota({
    apiKeyId: keyRow.id,
    promptTokens,
    completionTokens: 0,
    price,
    group,
    unlimited,
  });

  if (!result.allowed) {
    const isRate = String(result.reason).startsWith("rate_limited");
    log.warn("QUOTA", `${isRate ? "rate" : "quota"} rejected for key ${String(keyRow.id).slice(0, 8)}: ${result.reason}`);
    return errorResponse(
      isRate ? HTTP_STATUS.TOO_MANY_REQUESTS ?? 429 : HTTP_STATUS.TOO_MANY_REQUESTS ?? 429,
      result.reason,
    );
  }
  return null;
}

export { estimateCost, estimatePromptTokens };
