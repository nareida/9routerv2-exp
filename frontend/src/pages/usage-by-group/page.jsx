import { useState, useEffect, useCallback } from "react";
import { Card, Button, CardSkeleton } from "@/shared/components";

// Per-tier usage. Every number comes from GET /api/usage/by-group; the UI does
// no aggregation of its own.
//
//   (unattributed)  requests recorded before the userGroup column existed, or
//                   made with a key that no longer matches apiKeys. Kept as its
//                   own bucket so history is never silently folded into a tier.

const RANGES = [
  { key: "1", label: "24h", days: 1 },
  { key: "7", label: "7d", days: 7 },
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
];

const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString());

function fmtCost(n) {
  if (n == null) return "—";
  const v = Number(n);
  if (v === 0) return "0";
  if (v < 0.01) return v.toFixed(6);
  return v.toFixed(4);
}

export default function UsageByGroupPage() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
    const d = RANGES.find((r) => r.key === days)?.days ?? 30;
    const end = new Date();
    const start = new Date(end.getTime() - d * 24 * 60 * 60 * 1000);
    try {
      const qs = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
      const res = await fetch(`/api/usage/by-group?${qs}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body);
      setError("");
    } catch (e) {
      setError(e.message || "Could not load per-tier usage");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days]);

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

  const rows = (data?.rows || []).filter((r) => r.bucket !== "(unattributed)");
  const unattributed = (data?.rows || []).find((r) => r.bucket === "(unattributed)");
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Usage by Tier</h1>
          <p className="mt-1 text-sm text-text-muted">
            Token spend and cost attributed to each user tier. A tier&apos;s
            <code className="mx-1 rounded bg-surface-secondary px-1 py-0.5 text-xs">ratio</code>
            multiplies what a request deducts from that key&apos;s balance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-surface-secondary">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setDays(r.key)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  days === r.key
                    ? "bg-primary text-white"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button onClick={() => load(true)} loading={refreshing} icon="refresh">
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card>
          <div className="flex items-center gap-2 text-sm text-error">
            <span className="material-symbols-outlined text-lg">error</span>
            {error}
          </div>
        </Card>
      )}

      {t && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <p className="text-sm text-text-muted">Requests</p>
            <p className="mt-1 text-3xl font-semibold text-text-primary">{fmt(t.requests)}</p>
          </Card>
          <Card>
            <p className="text-sm text-text-muted">Prompt tokens</p>
            <p className="mt-1 text-3xl font-semibold text-text-primary">{fmt(t.promptTokens)}</p>
          </Card>
          <Card>
            <p className="text-sm text-text-muted">Completion tokens</p>
            <p className="mt-1 text-3xl font-semibold text-text-primary">{fmt(t.completionTokens)}</p>
          </Card>
          <Card>
            <p className="text-sm text-text-muted">Total cost</p>
            <p className="mt-1 text-3xl font-semibold text-text-primary">{fmtCost(t.cost)}</p>
          </Card>
        </div>
      )}

      <Card>
        <h2 className="font-medium text-text-primary">Tiers</h2>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">
            No attributed usage in this window. Requests made before tier tracking existed are
            counted as unattributed below.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-secondary text-left text-text-muted">
                  <th className="py-2 pr-4 font-medium">Tier</th>
                  <th className="py-2 pr-4 font-medium">Ratio</th>
                  <th className="py-2 pr-4 font-medium">Rate limit</th>
                  <th className="py-2 pr-4 text-right font-medium">Requests</th>
                  <th className="py-2 pr-4 text-right font-medium">Tokens</th>
                  <th className="py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.bucket} className="border-b border-surface-secondary/50">
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">
                          {r.tierName || r.bucket}
                        </span>
                        <code className="rounded bg-surface-secondary px-1.5 py-0.5 text-xs text-text-muted">
                          {r.bucket}
                        </code>
                        {r.enabled === false && (
                          <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-text-muted">
                            disabled
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4 font-mono text-text-muted">
                      {r.ratio ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-text-muted">
                      {r.apiRate ? `${r.apiRate}/min` : "—"}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">{fmt(r.requests)}</td>
                    <td className="py-2 pr-4 text-right font-mono">{fmt(r.totalTokens)}</td>
                    <td className="py-2 text-right font-mono">{fmtCost(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {unattributed && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-medium text-text-primary">Unattributed</h2>
              <p className="mt-1 text-sm text-text-muted">
                {fmt(unattributed.requests)} requests recorded before tier tracking existed.
                These are kept out of every tier rather than guessed at.
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-text-muted">{fmt(unattributed.totalTokens)} tokens</p>
              <p className="font-mono text-text-primary">{fmtCost(unattributed.cost)}</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
