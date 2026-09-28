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
