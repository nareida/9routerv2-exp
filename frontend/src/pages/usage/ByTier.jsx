import { useState, useEffect, useCallback } from "react";
import { Card, Button, CardSkeleton, SegmentedControl } from "@/shared/components";

// Per-tier usage, straight from GET /api/usage/by-group.
// Nothing is computed here that the backend does not already return.
//
// Only requests written after the userGroup column existed can be attributed.
// Everything older is reported by the backend under "(unattributed)" and is
// shown as-is rather than folded into a tier.

const PERIODS = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
];

const UNATTRIBUTED = "(unattributed)";

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function fmtCost(n) {
  const v = Number(n) || 0;
  if (v === 0) return "0";
  if (v < 0.01) return v.toFixed(6);
  return v.toFixed(4);
}

export default function UsageByTier() {
  const [by, setBy] = useState("group");
  const [days, setDays] = useState("30");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - Number(days) * 24 * 60 * 60 * 1000);
      const qs = new URLSearchParams({
        by,
        start: start.toISOString(),
        end: end.toISOString(),
      });
      const res = await fetch(`/api/usage/by-group?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
      setError("");
    } catch (e) {
      setError(e.message || "Could not load per-tier usage");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [by, days]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const maxCost = rows.reduce((m, r) => Math.max(m, Number(r.cost) || 0), 0);
  const attributed = rows.filter((r) => r.bucket !== UNATTRIBUTED);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            options={[
              { value: "group", label: "By Tier" },
              { value: "key", label: "By Key" },
            ]}
            value={by}
            onChange={setBy}
          />
          <SegmentedControl
            options={PERIODS}
            value={days}
            onChange={setDays}
          />
        </div>
        <Button onClick={() => load(true)} loading={refreshing} icon="refresh">
          Refresh
        </Button>
      </div>

      {error && (
        <Card>
          <div className="flex items-center gap-2 text-sm text-error">
            <span className="material-symbols-outlined text-lg">error</span>
            {error}
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Requests", value: totals.requests, icon: "swap_horiz" },
          { label: "Total Tokens", value: fmtTokens(totals.totalTokens), icon: "token" },
          { label: "Cost (internal)", value: fmtCost(totals.cost), icon: "payments" },
          {
            label: by === "group" ? "Tiers Used" : "Keys Used",
            value: attributed.length,
            icon: by === "group" ? "group" : "key",
          },
        ].map((t) => (
          <Card key={t.label}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-muted">{t.label}</p>
                <p className="mt-1 text-2xl font-semibold text-text-primary">{t.value}</p>
              </div>
              <span className="material-symbols-outlined text-xl text-text-muted">{t.icon}</span>
            </div>
          </Card>
        ))}
      </div>

      {data?.unattributed > 0 && (
        <Card>
          <div className="flex items-start gap-2 text-sm text-text-muted">
            <span className="material-symbols-outlined text-lg">info</span>
            <span>
              <strong className="text-text-primary">{data.unattributed} request(s)</strong> cannot
              be attributed to a tier. Usage history only started recording the tier after that
              column was added, and stored API keys are masked, so older rows cannot be matched
              back to a key.
            </span>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="font-medium text-text-primary">
          {by === "group" ? "Usage per tier" : "Usage per key"}
        </h2>

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">No usage recorded in this period.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-secondary text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="py-2 pr-3">{by === "group" ? "Tier" : "Key"}</th>
                  <th className="py-2 pr-3 text-right">Requests</th>
                  <th className="py-2 pr-3 text-right">In</th>
                  <th className="py-2 pr-3 text-right">Out</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-3 text-right">Cost</th>
                  <th className="py-2 w-32">Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isUn = r.bucket === UNATTRIBUTED;
                  const share = maxCost > 0 ? ((Number(r.cost) || 0) / maxCost) * 100 : 0;
                  return (
                    <tr key={r.bucket} className="border-b border-surface-secondary/60">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <span className={isUn ? "text-text-muted" : "text-text-primary"}>
                            {by === "group" ? r.tierName || r.bucket : r.keyName || r.bucket}
                          </span>
                          {by === "group" && r.bucket !== UNATTRIBUTED && (
                            <code className="rounded bg-surface-secondary px-1.5 py-0.5 text-xs text-text-muted">
                              {r.bucket}
                            </code>
                          )}
                          {by === "group" && r.enabled === false && (
                            <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-text-muted">
                              disabled
                            </span>
                          )}
                          {by === "key" && r.unlimited === true && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                              unlimited
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">{r.requests}</td>
                      <td className="py-2 pr-3 text-right font-mono text-text-muted">
                        {fmtTokens(r.promptTokens)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-text-muted">
                        {fmtTokens(r.completionTokens)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">{fmtTokens(r.totalTokens)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{fmtCost(r.cost)}</td>
                      <td className="py-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary">
                          <div
                            className={`h-full rounded-full ${isUn ? "bg-text-muted" : "bg-primary"}`}
                            style={{ width: `${Math.max(share, share > 0 ? 2 : 0)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {by === "group" && (
        <Card>
          <h2 className="font-medium text-text-primary">How attribution works</h2>
          <ul className="mt-3 space-y-2 text-sm text-text-muted">
            <li>
              The tier is resolved at write time, when the raw API key is still available, and
              snapshotted onto the usage row. Stored keys are masked afterwards, so this cannot be
              reconstructed later.
            </li>
            <li>
              <strong className="text-text-primary">Cost</strong> here is the internal charge
              (upstream price × tier ratio), not what is paid to the provider.
            </li>
            <li>
              Rows with no tier stay in <em>(unattributed)</em> rather than being assigned to a
              default, so totals always reconcile.
            </li>
          </ul>
        </Card>
      )}
    </div>
  );
}
