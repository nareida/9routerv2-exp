/**
 * Per-tier and per-key usage aggregation.
 *
 * GET /api/usage/by-group            → totals grouped by userGroup
 * GET /api/usage/by-group?by=key     → totals grouped by individual key
 *
 * Attribution depends on two columns added to usageHistory after the fact:
 *   userGroup — tier snapshot, resolved while the raw key was still in hand
 *   keyId     — key identity, so rows join to apiKeys even though the stored
 *               apiKey is masked and unjoinable
 *
 * Rows predating those columns stay NULL and are reported as
 * "(unattributed)" / unnamed rather than folded into a default, so the totals
 * always reconcile and never invent an attribution.
 */
import { getAdapter } from "../../../lib/db/driver.js";

type Row = Record<string, any>;

const UNATTRIBUTED = "(unattributed)";

function parseRange(query: Row) {
  const now = Date.now();
  const end = query.end ? new Date(query.end) : new Date(now);
  const start = query.start
    ? new Date(query.start)
    : new Date(now - 30 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * `bucket` is the grouping expression; `keyed` marks buckets that carry a
 * keyId rather than a tier symbol.
 */
function buildSql(bucket: string) {
  return `
    SELECT
      COALESCE(${bucket}, '${UNATTRIBUTED}')  AS bucket,
      COUNT(*)                                 AS requests,
      COALESCE(SUM(promptTokens), 0)          AS promptTokens,
      COALESCE(SUM(completionTokens), 0)      AS completionTokens,
      COALESCE(SUM(promptTokens + completionTokens), 0) AS totalTokens,
      COALESCE(ROUND(SUM(cost), 6), 0)        AS cost
    FROM usageHistory
    WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY COALESCE(${bucket}, '${UNATTRIBUTED}')
  `;
}

export async function GET(req, res) {
  const query = (req as Row).query || {};
  const range = parseRange(query);
  const by = query.by === "key" ? "key" : "group";
  // keyId is the join target; apiKey is the fallback for rows that predate it.
  const bucket = by === "key" ? "COALESCE(keyId, apiKey)" : "userGroup";

  try {
    const db = await getAdapter();
    const rows: Row[] = db.all(buildSql(bucket), [range.start, range.end]);

    if (by === "key") {
      const keys: Row[] = db.all(
        "SELECT id, name, userGroup, balance, unlimited, isActive FROM apiKeys"
      );
      const byId = new Map<string, Row>(keys.map((k) => [k.id, k]));
      for (const r of rows) {
        const k = byId.get(r.bucket);
        r.keyName = k?.name ?? null;
        r.userGroup = k?.userGroup ?? null;
        r.balance = k?.balance ?? null;
        r.unlimited = k ? !!k.unlimited : null;
        r.isActive = k ? !!k.isActive : null;
        r.resolved = !!k;
      }
    } else {
      const groups: Row[] = db.all(
        "SELECT symbol, name, ratio, apiRate, enable FROM userGroups"
      );
      const bySymbol = new Map<string, Row>(groups.map((g) => [g.symbol, g]));
      for (const r of rows) {
        const g = bySymbol.get(r.bucket);
        r.tierName = g?.name ?? null;
        r.ratio = g?.ratio ?? null;
        r.apiRate = g?.apiRate ?? null;
        r.enabled = g ? !!g.enable : null;
      }
    }

    rows.sort((a, b) => b.cost - a.cost);

    const totals = rows.reduce(
      (acc, r) => ({
        requests: acc.requests + r.requests,
        promptTokens: acc.promptTokens + r.promptTokens,
        completionTokens: acc.completionTokens + r.completionTokens,
        totalTokens: acc.totalTokens + r.totalTokens,
        cost: acc.cost + r.cost,
      }),
      { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 }
    );
    totals.cost = Number(totals.cost.toFixed(6));

    return res.json({
      by,
      range,
      rows,
      totals,
      unattributed: rows.find((r) => r.bucket === UNATTRIBUTED)?.requests ?? 0,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "aggregation failed" });
  }
}
