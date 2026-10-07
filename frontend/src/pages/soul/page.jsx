import { useState, useEffect, useCallback } from "react";
import { Card, Button, CardSkeleton } from "@/shared/components";

// Nareida layer — passive red-team monitor.
// Every number here comes from the backend; the UI never counts anything itself.
//   scanned     responses that were scanned
//   ok          responses with no persona leak
//   leaks       responses where the provider's own identity leaked through
//   canarySeen  responses that echoed the injected canary token
// A high canarySeen with zero leaks means the identity override is being
// applied and the provider is not asserting a competing persona.

const TILES = [
  { key: "scanned", label: "Scanned", icon: "radar", tone: "text-text-primary" },
  { key: "ok", label: "Compliant", icon: "verified", tone: "text-success" },
  { key: "leaks", label: "Leaks", icon: "report", tone: "text-error" },
  { key: "canarySeen", label: "Canary Echoed", icon: "key", tone: "text-primary" },
];

export default function SoulPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/soul/stats");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setStats(data);
      setError("");
    } catch (e) {
      setError(e.message || "Could not reach the soul stats endpoint");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 15000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const scanned = stats?.scanned ?? 0;
  const ok = stats?.ok ?? 0;
  const leaks = stats?.leaks ?? 0;
  const canarySeen = stats?.canarySeen ?? 0;
  const compliance = scanned > 0 ? Math.round((ok / scanned) * 100) : null;
  const errors = stats?.errors ?? 0;
  const persisted = stats?.persisted;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Soul Monitor</h1>
          <p className="mt-1 text-sm text-text-muted">
            Passive red-team check on every routed response. Fails open — it never alters
            or blocks a request, it only records what came back.
          </p>
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
        {TILES.map((t) => (
          <Card key={t.key}>
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-sm text-text-muted">{t.label}</p>
                <p className={`mt-1 text-3xl font-semibold ${t.tone}`}>{stats?.[t.key] ?? 0}</p>
              </div>
              <span className="material-symbols-outlined text-2xl text-text-muted">{t.icon}</span>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-text-primary">Compliance rate</h2>
            <p className="mt-1 text-sm text-text-muted">
              {compliance === null
                ? "No responses scanned yet."
                : `${ok} of ${scanned} responses kept the Nareida identity intact.`}
            </p>
          </div>
          <span className="text-4xl font-semibold text-text-primary">
            {compliance === null ? "—" : `${compliance}%`}
          </span>
        </div>
        {leaks > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-error/10 p-3 text-sm text-error">
            <span className="material-symbols-outlined text-lg">warning</span>
            <span>
              {leaks} response{leaks === 1 ? "" : "s"} leaked a competing identity. Check the
              console log for the offending provider and model.
            </span>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-medium text-text-primary">Source breakdown</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-text-muted">Persisted (usageHistory + requestDetails)</dt>
            <dd className="font-mono text-text-primary">
              {persisted ? `${persisted.scanned} scanned` : "unavailable"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-muted">In-memory (this process)</dt>
            <dd className="font-mono text-text-primary">
              {Math.max(0, scanned - (persisted?.scanned ?? 0))} scanned
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-muted">Scan errors (fail-open count)</dt>
            <dd className="font-mono text-text-primary">{errors}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="font-medium text-text-primary">How this works</h2>
        <ul className="mt-3 space-y-2 text-sm text-text-muted">
          <li>
            <strong className="text-text-primary">Canary token.</strong> A short random marker is
            appended to the identity override. If the model echoes it back, the override reached
            the provider intact.
          </li>
          <li>
            <strong className="text-text-primary">Leak scanner.</strong> The response is checked for
            competing identity claims. A hit increments <em>Leaks</em> and logs a snippet to the
            console — it does not modify the response.
          </li>
          <li>
            <strong className="text-text-primary">Per-node toggle.</strong> Soul Mode is switched on
            individually from a provider node&apos;s edit dialog. This page is the aggregate view.
          </li>
        </ul>
      </Card>
    </div>
  );
}
