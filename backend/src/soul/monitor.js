/**
 * monitor.js — Nareida layer: passive red-team on model responses.
 *
 * Wrap a parsed provider response and get back a compliance verdict:
 *   leaked  — model self-identified as an upstream persona (soul lost)
 *   canary  — SOUL_ID echoed back (override survived)
 *
 * Fail-open by design: a scanner failure must never break a chat request.
 */

import { detectSoulLeak, soulCanary, recordSoulStat } from "./index.js";

const stats = { scanned: 0, ok: 0, leaks: 0, canarySeen: 0, errors: 0 };

export function soulStats() {
  return { ...stats };
}

export function resetStats() {
  stats.scanned = 0;
  stats.ok = 0;
  stats.leaks = 0;
  stats.canarySeen = 0;
  stats.errors = 0;
}

/**
 * @param {object} resp parsed provider response
 * @param {{expectCanary?: boolean}} [opts]
 * @returns {{leaked: boolean, snippet: string, canary: string}}
 */
export function scanResponse(resp, opts = {}) {
  const expectCanary = !!opts.expectCanary;
  try {
    stats.scanned++;
    const { leaked, snippet } = detectSoulLeak(resp);
    const canary = expectCanary ? soulCanary(resp) : "";

    if (leaked) {
      stats.leaks++;
    } else if (!expectCanary || canary) {
      // Compliant: either no canary was expected, or the model echoed it.
      stats.ok++;
    }
    if (canary) stats.canarySeen++;

    recordSoulStat(canary, !leaked && (!expectCanary || canary));
    return { leaked, snippet, canary };
  } catch (err) {
    stats.errors++;
    return { leaked: false, snippet: "", canary: "" };
  }
}

/**
 * Shape a scan verdict for the usageHistory `meta` column, which is the only
 * durable soul record when observability is off (requestDetails is skipped).
 */
export function soulMeta(soul) {
  if (!soul) return null;
  return {
    soul_ok: !soul.leaked,
    soul_leak: soul.snippet || null,
    soul_canary: soul.canary || null,
  };
}
