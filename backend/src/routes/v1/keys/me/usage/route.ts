/**
 * Self-service usage portal for an API key.
 *
 * GET /api/v1/keys/me/usage?days=30
 * Auth: Authorization: Bearer <apiKey>  (the key's own value, not admin session)
 *
 * Returns everything the owner of one key needs to track themselves:
 * quota remaining, spend/tokens over time, per-model breakdown, and the
 * key's allowed-model list. No admin session required.
 *
 * Shape follows keirouter's portal contract (MIT, https://github.com/mydisha/keirouter)
 * — see LICENSE in the repo root for lineage and third-party notices.
 */
import { getAdapter } from "../../../../../lib/db/driver.js";
import { parseAllowedModels } from "../../../../../lib/db/repos/apiKeysRepo.js";

export const dynamic = "force-dynamic";

function authedKeyId(req) {
  const raw =
    req.headers?.authorization ?? req.headers?.get?.("Authorization") ?? "";
  const value = raw.replace(/^Bearer\s+/i, "").trim();
  if (!value) return null;
  return value;
}

function since(days) {
  const d = Math.max(1, Math.min(365, Number(days) || 30));
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Resolve the provider slugs seen in a usage window to graph nodes.
 *
 * usageHistory.provider stores the provider slug (e.g. "openrouter",
 * "openai-compatible-chat-<uuid>"), so the portal joins back to
 * providerConnections on that slug to pick up the human label ("free",
 * "KiosAPI:feee"). Slugs with no matching connection still get a node so the
 * graph never silently drops traffic — they just fall back to the slug.
 */
function usedConnections(rows: any[], db?: any) {
  const seen = new Map<string, { id: string; provider: string; name: string }>();
  for (const r of rows) {
    const slug = String(r.provider || "");
    if (!slug || seen.has(slug)) continue;
    let name = "";
    try {
      const conn = db?.get(
        "SELECT provider, name FROM providerConnections WHERE provider = ? LIMIT 1",
        [slug]
      );
      if (conn) name = String(conn.name || "");
    } catch {
      // connection table unavailable — fall through with the raw slug
    }
    seen.set(slug, { id: slug, provider: slug, name });
  }
  return [...seen.values()];
}

export async function GET_handler(req, res) {
  try {
    const keyValue = authedKeyId(req);
    if (!keyValue) return res.status(401).json({ error: "Missing API key" });

    const db = await getAdapter();
    const keyRow = db.get(
      "SELECT * FROM apiKeys WHERE key = ?",
      [keyValue]
    );
    if (!keyRow) return res.status(401).json({ error: "Invalid API key" });

    const days = Math.max(1, Math.min(365, Number(new URL("http://x" + req.originalUrl).searchParams.get("days")) || 30));
    const sinceIso = since(days);

    // ── quota / budget ──────────────────────────────────────────────────────
    // KeiRouter's portal reports two independent budgets per key: a token cap
    // and a USD cap, each on a reset period. 9router's key model has no token
    // cap, so limit_tokens is 0 ("no token cap") and the USD figures come from
    // the key's balance: totalAllocated is what the key was ever funded with,
    // lifetimeCharge is what it has consumed, balance is what is left.
    const unlimited = Number(keyRow.unlimited) === 1;
    const balance = Number(keyRow.balance || 0);
    const lifetime = Number(keyRow.lifetimeCharge || 0);
    const totalAllocated = Number((balance + lifetime).toFixed(6));
    const spentUsd = lifetime;
    const usdRemaining = Number(Math.max(0, balance).toFixed(6));
    const usdPctUsed =
      unlimited || totalAllocated <= 0
        ? 0
        : Number(((spentUsd / totalAllocated) * 100).toFixed(6));

    const tierRow = keyRow.userGroup
      ? db.get("SELECT * FROM userGroups WHERE symbol = ?", [String(keyRow.userGroup)])
      : null;

    const budgets = unlimited
      ? []
      : [
          {
            period: "total",
            limit_tokens: 0,
            tokens_used: 0,
            tokens_remaining: 0,
            tokens_pct_used: 0,
            limit_usd: totalAllocated,
            spent_usd: Number(spentUsd.toFixed(6)),
            usd_remaining: usdRemaining,
            usd_pct_used: usdPctUsed,
            alert: usdPctUsed >= 90,
            tier: tierRow
              ? { symbol: tierRow.symbol, name: tierRow.name, apiRate: tierRow.apiRate }
              : null,
          },
        ];

    // ── daily series ────────────────────────────────────────────────────────
    const rows: any[] = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost
         FROM usageHistory
        WHERE keyId = ? AND timestamp >= ?`,
      [keyRow.id, sinceIso]
    );

    const byDate = new Map();
    const models = new Map();
    const recent = [];

    for (const r of rows) {
      const date = String(r.timestamp).slice(0, 10);
      const d = byDate.get(date) || { date, requests: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };
      d.requests += 1;
      d.prompt_tokens += Number(r.promptTokens || 0);
      d.completion_tokens += Number(r.completionTokens || 0);
      d.cost_usd += Number(r.cost || 0);
      byDate.set(date, d);
    }

    // per-model + recent need provider/model columns — re-query with them
    const fullRows: any[] = db.all(
      `SELECT id, timestamp, provider, model, promptTokens, completionTokens, cost, status
         FROM usageHistory
        WHERE keyId = ? AND timestamp >= ?
        ORDER BY timestamp DESC`,
      [keyRow.id, sinceIso]
    );

    // Short labels for the request log: the raw provider column is a slug that
    // can be a 48-char UUID for OpenAI-compatible connections, which wraps to
    // four lines on a phone. Prefer the connection's own name, else the slug.
    const connLabel = new Map<string, string>();
    for (const c of usedConnections(fullRows, db)) {
      connLabel.set(c.provider, c.name || c.provider);
    }
    const shortLabel = (slug: string) => {
      const label = connLabel.get(String(slug || "")) || String(slug || "");
      if (label.length <= 22) return label;
      return `${label.slice(0, 20)}…`;
    };

    for (const r of fullRows) {
      const k = r.model || "(unknown)";
      const m = models.get(k) || { model: k, provider: r.provider || "", provider_name: shortLabel(r.provider), total_requests: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };
      m.total_requests += 1;
      m.prompt_tokens += Number(r.promptTokens || 0);
      m.completion_tokens += Number(r.completionTokens || 0);
      m.cost_usd += Number(r.cost || 0);
      models.set(k, m);

      if (recent.length < 50) {
        recent.push({
          id: r.id,
          model: k,
          provider: r.provider || "",
          provider_name: shortLabel(r.provider),
          prompt_tokens: Number(r.promptTokens || 0),
          completion_tokens: Number(r.completionTokens || 0),
          cost_usd: Number(r.cost || 0),
          latency_ms: 0,
          cache_hit: false,
          status: r.status || "ok",
          created_at: r.timestamp,
        });
      }
    }

    const daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    // ── calendar-month-to-date ──────────────────────────────────────────────
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodAgg: any = db.get(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(promptTokens), 0)     AS pt,
              COALESCE(SUM(completionTokens), 0) AS ct,
              COALESCE(SUM(cost), 0)             AS c
         FROM usageHistory WHERE keyId = ? AND timestamp >= ?`,
      [keyRow.id, periodStart]
    );

    return res.json({
      key_id: keyRow.id,
      key_name: keyRow.name || "(unnamed)",
      days,
      unlimited,
      // Nodes for the topology graph: only the connections this key actually
      // routed through in the window, so the portal never reveals providers
      // the key holder cannot see. last_provider powers the "recently used"
      // highlight. Live in-flight requests are deliberately not included:
      // the pending tracker is global and has no key attribution, so showing
      // it here would leak other keys' traffic.
      providers: usedConnections(fullRows, db),
      last_provider: fullRows[0]?.provider || "",
      current_period: {
        total_requests: Number(periodAgg?.n || 0),
        prompt_tokens: Number(periodAgg?.pt || 0),
        completion_tokens: Number(periodAgg?.ct || 0),
        cost_usd: Number(periodAgg?.c || 0),
      },
      budgets,
      daily,
      models: [...models.values()].sort((a, b) => b.total_requests - a.total_requests),
      allowed_models: parseAllowedModels(keyRow.allowedModels),
      recent,
    });
  } catch (err) {
    console.error("[PORTAL] usage failed:", err);
    return res.status(500).json({ error: "Failed to load usage" });
  }
}
