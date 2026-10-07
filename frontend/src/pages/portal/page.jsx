import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Area,
  Bar,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";
import SegmentedControl from "@/shared/components/SegmentedControl";
import ProviderTopology from "@/pages/usage/components/ProviderTopology";
import { cn } from "@/shared/utils/cn";

/**
 * Public usage portal (`/portal`).
 *
 * A key owner pastes their own API key and sees only their own usage:
 * remaining quota, daily trend, per-model breakdown, allowed models, recent
 * requests. Laid out like the admin Usage page (KPI row + trend + tables) so
 * the two read as one product. No admin session involved.
 *
 * Feature and layout contract follow keirouter's KeyPortal (MIT,
 * https://github.com/mydisha/keirouter) — see LICENSE in the repo root for
 * lineage and third-party notices.
 */

const DAY_OPTIONS = [
  { value: 7, label: "7D" },
  { value: 14, label: "14D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
];

const C_INPUT = "#6366f1";
const C_OUTPUT = "#22c55e";
const C_COST = "#f59e0b";
const C_REQ = "#38bdf8";

export default function PortalPage() {
  const [params, setParams] = useState(
    () => new URLSearchParams(window.location.search)
  );
  const activeKey = params.get("key") || "";
  const [keyInput, setKeyInput] = useState(activeKey);
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!activeKey) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/v1/keys/me/usage?days=${days}`, {
          headers: { Authorization: `Bearer ${activeKey}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "Failed to load usage");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeKey, days]);

  const login = (e) => {
    e.preventDefault();
    const v = keyInput.trim();
    if (!v) return;
    const next = new URLSearchParams(window.location.search);
    next.set("key", v);
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${next.toString()}`
    );
    setParams(next);
  };

  const logout = () => {
    const next = new URLSearchParams();
    window.history.replaceState({}, "", window.location.pathname);
    setParams(next);
    setData(null);
    setKeyInput("");
    setError("");
  };

  if (!activeKey) {
    return (
      <div className="mx-auto mt-16 max-w-md">
        <Card className="p-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-text-main">
            Portal Akses
          </h1>
          <p className="mt-2 mb-6 text-sm text-text-muted">
            Masukkan API key untuk melihat usage &amp; sisa kuota key ini
            sendiri. Tanpa akses admin.
          </p>
          <form onSubmit={login} className="space-y-4 text-left">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-..."
              autoFocus
              className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text-main placeholder:text-text-muted focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              disabled={!keyInput.trim()}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              Lihat Dashboard
            </button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 min-h-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-main">
            Portal
          </h1>
          <p className="text-sm text-text-muted">
            Monitoring key{" "}
            <strong className="text-text-main">{data?.key_name || "…"}</strong>
            {data?.key_id && (
              <span className="ml-2 font-mono text-xs">ID: {data.key_id}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            options={DAY_OPTIONS}
            value={days}
            onChange={setDays}
            size="sm"
          />
          <button
            onClick={logout}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-2"
          >
            Keluar
          </button>
        </div>
      </div>

      {loading && !data && <p className="text-sm text-text-muted">Loading…</p>}
      {error && <Card className="min-w-0 p-4 text-sm text-danger">{error}</Card>}

      {data && (
        <>
          <OverviewKpis data={data} />

          {data.budgets?.length > 0 && !data.unlimited ? (
            data.budgets.map((b, i) => <BudgetBar key={i} b={b} />)
          ) : data.unlimited ? (
            <Card className="min-w-0 p-6 text-center">
              <span className="material-symbols-outlined text-[30px] text-primary">
                all_inclusive
              </span>
              <h3 className="mt-2 text-lg font-bold text-text-main">
                Unrestricted
              </h3>
              <p className="mt-1 text-sm text-text-muted">
                Key ini tanpa batas budget dan bisa dipakai tanpa limit.
              </p>
            </Card>
          ) : null}

          {data.current_period && (
            <div className="rounded-lg border border-border-subtle bg-surface-2 px-4 py-2.5 text-xs text-text-muted">
              Bulan ini:{" "}
              <strong className="text-text-main">
                {fmtN(data.current_period.total_requests)}
              </strong>{" "}
              request ·{" "}
              <strong className="text-text-main">
                {fmtK(
                  (data.current_period.prompt_tokens || 0) +
                    (data.current_period.completion_tokens || 0)
                )}
              </strong>{" "}
              tokens ·{" "}
              <strong className="text-text-main">
                ${Number(data.current_period.cost_usd || 0).toFixed(4)}
              </strong>{" "}
              spent
            </div>
          )}

          {data.providers?.length > 0 && (
            <Card className="min-w-0 p-5">
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-text-muted">
                Provider Graph
              </h3>
              {/* Same height as the admin Usage view (480px) so the elliptical
                  layout has the same breathing room and no node sits near the
                  edge. Pan (drag), pinch and the zoom/fit controls all come
                  from the shared ProviderTopology component. */}
              <div className="h-[480px] w-full">
                <ProviderTopology
                  providers={data.providers}
                  lastProvider={data.last_provider}
                />
              </div>
            </Card>
          )}

          {data.daily?.length > 0 && (
            <TrendCard daily={data.daily} days={days} />
          )}

          {data.models?.length > 0 && <ModelsCard models={data.models} />}

          {data.allowed_models?.length > 0 && (
            <Card className="min-w-0 p-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-muted">
                Model Diizinkan
              </h3>
              <div className="flex flex-wrap gap-2">
                {data.allowed_models.map((m) => (
                  <span
                    key={m}
                    className="rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-xs text-text-main"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {data.recent?.length > 0 && <RecentCard recent={data.recent} />}
        </>
      )}
    </div>
  );
}

/* ── KPI row — same card language as the admin Usage view ───────────────── */

function OverviewKpis({ data }) {
  const daily = data.daily || [];
  const t = useMemo(
    () => ({
      requests: agg(daily, "requests"),
      prompt: agg(daily, "prompt_tokens"),
      completion: agg(daily, "completion_tokens"),
      cost: agg(daily, "cost_usd"),
    }),
    [daily]
  );
  const active = activeDays(daily);
  const budget =
    !data.unlimited && data.budgets?.length ? data.budgets[0] : null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-sm font-semibold uppercase text-text-muted">
          Total Request
        </span>
        <span className="truncate text-2xl font-bold">{fmtN(t.requests)}</span>
        <span className="text-[10px] text-text-muted">{active} hari aktif</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-sm font-semibold uppercase text-text-muted">
          Input Tokens
        </span>
        <span className="truncate text-2xl font-bold text-primary">
          {fmtK(t.prompt)}
        </span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-sm font-semibold uppercase text-text-muted">
          Output Tokens
        </span>
        <span className="truncate text-2xl font-bold text-success">
          {fmtK(t.completion)}
        </span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-sm font-semibold uppercase text-text-muted">
          Estimasi Biaya
        </span>
        <span className="truncate text-2xl font-bold text-warning">
          ~${t.cost.toFixed(4)}
        </span>
        <span className="text-[10px] text-text-muted">
          {budget
            ? `${budget.usd_pct_used.toFixed(1)}% terpakai`
            : data.unlimited
              ? "tanpa batas"
              : "tanpa kuota"}
        </span>
      </Card>
    </div>
  );
}

OverviewKpis.propTypes = { data: PropTypes.object.isRequired };

/* ── Quota bar — mirrors the admin QuotaBar tones ───────────────────────── */

function BudgetBar({ b }) {
  // KeiRouter shows one row per configured limit: a token cap and a USD cap.
  // A zero/absent limit is simply not rendered, so an unlimited key shows the
  // "Unrestricted" panel instead of a bar pinned at 0%.
  const hasTokens = Number(b.limit_tokens || 0) > 0;
  const hasUsd = Number(b.limit_usd || 0) > 0;
  if (!hasTokens && !hasUsd) return null;

  const periodLabel = b.period === "total" ? "All-Time Limit" : `${b.period} Limit`;

  return (
    <Card className="min-w-0 p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium text-text-main">{periodLabel}</span>
        {b.alert && (
          <span className="rounded-full bg-danger px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Exceeded
          </span>
        )}
      </div>
      <div className="space-y-5">
        {hasTokens && (
          <LimitRow
            label="Tokens"
            used={b.tokens_used}
            limit={b.limit_tokens}
            pct={b.tokens_pct_used}
            remaining={b.tokens_remaining}
            format={fmtK}
          />
        )}
        {hasUsd && (
          <LimitRow
            label="Spend"
            used={b.spent_usd}
            limit={b.limit_usd}
            pct={b.usd_pct_used}
            remaining={b.usd_remaining}
            format={(v) => `$${Number(v || 0).toFixed(2)}`}
          />
        )}
      </div>
      {b.tier && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-text-muted">
          Tier <strong className="text-text-main">{b.tier.name}</strong>
          {b.tier.apiRate ? ` · ${b.tier.apiRate} req/min` : ""}
        </p>
      )}
    </Card>
  );
}

BudgetBar.propTypes = { b: PropTypes.object.isRequired };

function LimitRow({ label, used, limit, pct, remaining, format }) {
  const safePct = Math.min(Math.max(Number(pct || 0), 0), 100);
  const tone =
    safePct >= 90 ? "bg-danger" : safePct > 70 ? "bg-warning" : "bg-success";
  return (
    <div>
      <div className="mb-2 flex items-end justify-between">
        <span className="text-sm font-medium text-text-main">{label}</span>
        <span className="tabular-nums">
          <span className="text-lg font-bold text-text-main">
            {format(used)}
          </span>
          <span className="ml-1.5 text-sm text-text-muted">
            / {format(limit)}
          </span>
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full transition-all duration-1000", tone)}
          style={{ width: `${safePct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-text-muted">
        <span className="tabular-nums">{safePct.toFixed(1)}% used</span>
        <span className="tabular-nums">{format(remaining)} left</span>
      </div>
    </div>
  );
}

LimitRow.propTypes = {
  label: PropTypes.string.isRequired,
  used: PropTypes.number,
  limit: PropTypes.number,
  pct: PropTypes.number,
  remaining: PropTypes.number,
  format: PropTypes.func.isRequired,
};

/* ── Trend chart — token/cost/request toggles like the admin chart ──────── */

function TrendCard({ daily, days }) {
  const [metric, setMetric] = useState("tokens");
  const chartData = useMemo(
    () => daily.map((d) => ({ ...d, label: d.date.slice(5) })),
    [daily]
  );

  return (
    <Card className="min-w-0 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted">
          Tren {days} Hari
        </h3>
        <SegmentedControl
          options={[
            { value: "tokens", label: "Tokens" },
            { value: "cost", label: "Cost" },
            { value: "requests", label: "Requests" },
          ]}
          value={metric}
          onChange={setMetric}
          size="sm"
        />
      </div>
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 6, right: 8, left: -14, bottom: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="4 4" strokeOpacity={0.15} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="l"
              tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={metric === "cost" ? (v) => `$${v}` : fmtK}
              width={54}
            />
            <YAxis
              yAxisId="r"
              orientation="right"
              tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <Tooltip content={<PortalTooltip />} />
            {metric === "tokens" && (
              <>
                <Bar
                  yAxisId="l"
                  dataKey="prompt_tokens"
                  name="Input"
                  fill={C_INPUT}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={26}
                />
                <Bar
                  yAxisId="l"
                  dataKey="completion_tokens"
                  name="Output"
                  fill={C_OUTPUT}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={26}
                />
                <Line
                  yAxisId="r"
                  type="monotone"
                  dataKey="requests"
                  name="Requests"
                  stroke={C_REQ}
                  strokeWidth={2}
                  dot={false}
                />
              </>
            )}
            {metric === "cost" && (
              <>
                <Area
                  yAxisId="l"
                  type="monotone"
                  dataKey="cost_usd"
                  name="Cost"
                  stroke={C_COST}
                  strokeWidth={2.5}
                  fill={C_COST}
                  fillOpacity={0.15}
                />
                <Line
                  yAxisId="r"
                  type="monotone"
                  dataKey="requests"
                  name="Requests"
                  stroke={C_REQ}
                  strokeWidth={2}
                  dot={false}
                />
              </>
            )}
            {metric === "requests" && (
              <Bar
                yAxisId="l"
                dataKey="requests"
                name="Requests"
                fill={C_REQ}
                radius={[3, 3, 0, 0]}
                maxBarSize={26}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

TrendCard.propTypes = {
  daily: PropTypes.array.isRequired,
  days: PropTypes.number,
};

/* ── Per-model breakdown — share bars like the admin model table ────────── */

function ModelsCard({ models }) {
  const totals = useMemo(
    () =>
      models.reduce(
        (a, m) => ({ r: a.r + m.total_requests, c: a.c + m.cost_usd }),
        { r: 0, c: 0 }
      ),
    [models]
  );
  return (
    <Card className="min-w-0 p-5">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-text-muted">
        Per Model
      </h3>
      <div className="space-y-3">
        {models.map((m) => {
          const share = totals.r ? (m.total_requests / totals.r) * 100 : 0;
          return (
            <div key={m.model} className="flex items-center gap-3 text-sm">
              <span className="w-40 truncate font-medium text-text-main">
                {m.model}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(share, 2)}%` }}
                />
              </div>
              <span className="w-14 text-right tabular-nums text-text-muted">
                {fmtN(m.total_requests)}
              </span>
              <span className="w-20 text-right tabular-nums text-text-muted">
                ${m.cost_usd.toFixed(4)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

ModelsCard.propTypes = { models: PropTypes.array.isRequired };

/* ── Recent requests — same columns as the admin request log ────────────── */

function RecentCard({ recent }) {
  return (
    <Card className="min-w-0 overflow-hidden p-0">
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[320px] text-sm">
          <thead className="border-b border-border bg-surface-2">
            <tr className="text-[11px] uppercase tracking-wide text-text-muted">
              <th className="px-3 py-2.5 text-left font-semibold">Model</th>
              <th className="px-3 py-2.5 text-right font-semibold">In</th>
              <th className="px-3 py-2.5 text-right font-semibold">Out</th>
              <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
              <th className="hidden px-3 py-2.5 text-right font-semibold sm:table-cell">Waktu</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recent.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs font-medium text-text-main">
                      {r.model}
                    </span>
                    {r.status === "error" && (
                      <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-danger">
                        error
                      </span>
                    )}
                  </div>
                  {r.provider_name && (
                    <div className="max-w-[180px] truncate text-[10px] text-text-muted">
                      {r.provider_name}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-primary">
                  {fmtK(r.prompt_tokens)}
                  <span className="ml-0.5 opacity-60">↑</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-success">
                  {fmtK(r.completion_tokens)}
                  <span className="ml-0.5 opacity-60">↓</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-text-muted">
                  ${Number(r.cost_usd || 0).toFixed(4)}
                </td>
                <td className="hidden px-3 py-2.5 text-right text-xs text-text-muted sm:table-cell">
                  {relTime(r.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

RecentCard.propTypes = { recent: PropTypes.array.isRequired };

function PortalTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1 text-text-muted">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: p.color || p.fill }}
          />
          <span className="text-text-muted">{p.name}</span>
          <span className="ml-auto font-semibold tabular-nums text-text-main">
            {p.dataKey === "cost_usd" || p.name === "Cost"
              ? `$${Number(p.value).toFixed(4)}`
              : fmtK(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

PortalTooltip.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array,
  label: PropTypes.string,
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

function agg(rows, field) {
  return (rows || []).reduce((a, d) => a + Number(d[field] || 0), 0);
}

function activeDays(rows) {
  return (rows || []).filter((d) => d.requests > 0).length;
}

function fmtK(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

function fmtN(n) {
  return Math.round(Number(n || 0)).toLocaleString("id-ID");
}

/** "5h ago" / "13m ago" — matches the admin request log's column. */
function relTime(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}