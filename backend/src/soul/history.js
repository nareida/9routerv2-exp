/**
 * Soul compliance stats.
 *
 * Two sources are merged because they are written by different code paths:
 *   - requestDetails: rich per-request records, but only persisted when
 *     observability is enabled (settings.enableObservability), so it is often
 *     empty.
 *   - usageHistory: always written for every billed request, but its `meta`
 *     column is the durable home for the soul scan verdict.
 *
 * Aggregation is fail-open: malformed JSON or DB errors must never break a
 * request, so every read is wrapped and degrades to zero.
 */

import { soulStats } from "./monitor.js";

const EMPTY = { scanned: 0, ok: 0, leaks: 0, canarySeen: 0 };

function safeParse(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Pull the soul verdict out of a record in whichever shape it was stored.
 * Detail records nest it under response.*; usage rows use meta.soul_*. Both are
 * accepted so stats work regardless of which writer produced the row.
 */
function verdictOf(data) {
  if (!data || typeof data !== "object") return null;

  const meta = data.meta ?? data.soul;
  if (meta) {
    const parsed = safeParse(meta);
    if (parsed && typeof parsed === "object" && typeof parsed.soul_ok === "boolean") {
      return { ok: parsed.soul_ok, leak: parsed.soul_leak ?? null, canary: parsed.soul_canary ?? null };
    }
  }

  const resp = data.response;
  if (resp && typeof resp === "object") {
    const r = safeParse(resp);
    if (r && typeof r === "object" && typeof r.soul_ok === "boolean") {
      return { ok: r.soul_ok, leak: r.soul_leak ?? null, canary: r.soul_canary ?? null };
    }
  }

  return null;
}

function accumulate(rec, out) {
  const verdict = verdictOf(rec);
  if (!verdict) return;
  out.scanned++;
  if (verdict.ok) out.ok++;
  else out.leaks++;
  if (verdict.canary) out.canarySeen++;
}

function aggregateSoulStats(records = []) {
  const out = { ...EMPTY };
  for (const rec of records) {
    const data = typeof rec?.data === "string" ? safeParse(rec.data) : rec?.data ?? rec;
    if (data) accumulate(data, out);
  }
  return out;
}

function sumStats(into, from) {
  if (!from) return into;
  into.scanned += from.scanned || 0;
  into.ok += from.ok || 0;
  into.leaks += from.leaks || 0;
  into.canarySeen += from.canarySeen || 0;
  return into;
}

function mergeStats(a, b) {
  return {
    scanned: (a?.scanned || 0) + (b?.scanned || 0),
    ok: (a?.ok || 0) + (b?.ok || 0),
    leaks: (a?.leaks || 0) + (b?.leaks || 0),
    canarySeen: (a?.canarySeen || 0) + (b?.canarySeen || 0),
  };
}

async function readUsageHistory() {
  try {
    const { getAdapter } = await import("../lib/db/driver.js");
    const db = await getAdapter();
    const rows = db.all(
      `SELECT meta FROM usageHistory WHERE meta IS NOT NULL AND meta != '{}' ORDER BY id DESC LIMIT 500`
    );
    return rows.map((r) => r.meta);
  } catch {
    return [];
  }
}

async function readRequestDetails() {
  try {
    const { getRequestDetails } = await import("../lib/db/repos/requestDetailsRepo.js");
    const { details = [] } = await getRequestDetails({ pageSize: 200 });
    return details;
  } catch {
    return [];
  }
}

/**
 * @returns {{persisted: object|null, scanned, ok, leaks, canarySeen, errors}}
 */
export async function getPersistedSoulStats(opts = {}) {
  const mem = soulStats();
  const getRecords = typeof opts === "function" ? opts : opts.getRecords;
  try {
    // opts.usageRows lets a caller (and the tests) supply the usageHistory side
    // instead of hitting the real DB, which would make assertions depend on
    // whatever traffic the live instance happens to have.
    const usageRows = opts.usageRows ?? (await readUsageHistory());
    const details = getRecords
      ? (await getRecords({ pageSize: 200 }))?.details || []
      : await readRequestDetails();

    const usage = aggregateSoulStats(usageRows.map((raw) => ({ meta: safeParse(raw) })));
    const detailStats = aggregateSoulStats(details);
    const persisted = mergeStats(usage, detailStats);

    const total = mergeStats(mem, persisted);
    return { persisted, ...total };
  } catch {
    return { persisted: null, ...mem };
  }
}

export { aggregateSoulStats, safeParse, verdictOf, mergeStats, sumStats, EMPTY };
