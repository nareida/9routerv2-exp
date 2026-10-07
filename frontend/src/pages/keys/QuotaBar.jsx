import { cn } from "@/shared/utils/cn";

// Remaining-quota bar for a key.
//
// The percentage is of the credit the key has ever been given, not of the
// balance alone: a key topped up to 1,000,000 that has spent 900,000 is at 10%
// and should look like it does, whereas "0 balance" alone would render as an
// empty bar for every key regardless of history.
//
// `usageHistory` is not the source for this. Charges are applied to
// apiKeys.balance / lifetimeCharge and are not written to usageHistory, so a
// chart built from that table would show a flat line. These two counters are
// the numbers the quota gate itself uses, so the bar cannot disagree with what
// actually blocks a request.

const TONE = {
  healthy: { bar: "bg-success", text: "text-success", label: "healthy" },
  low: { bar: "bg-warning", text: "text-warning", label: "running low" },
  critical: { bar: "bg-danger", text: "text-danger", label: "almost out" },
  empty: { bar: "bg-danger", text: "text-danger", label: "empty" },
};

/**
 * @param {object} props
 * @param {number} props.balance       credit left
 * @param {number} props.lifetimeCharge total charged so far, across tiers
 * @param {boolean} [props.unlimited]   unlimited keys are never at risk
 * @param {boolean} [props.compact]     hide the caption, bar only
 */
export default function QuotaBar({ balance, lifetimeCharge, unlimited, compact }) {
  if (unlimited) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-full rounded-full bg-primary/40" />
        </div>
        {!compact && <span className="text-xs text-text-muted">unlimited</span>}
      </div>
    );
  }

  const left = Number(balance) || 0;
  const spent = Number(lifetimeCharge) || 0;
  // Only credit that actually passed through this key counts. A key that was
  // created at zero and has been topped up shows 100% until it spends something,
  // which is the honest reading rather than a divide-by-zero.
  const granted = left + spent;
  const remaining = granted > 0 ? (left / granted) * 100 : 100;

  const tone =
    left <= 0 ? TONE.empty : remaining <= 10 ? TONE.critical : remaining <= 30 ? TONE.low : TONE.healthy;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuenow={Math.round(remaining)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn("h-full rounded-full transition-all", tone.bar)}
            style={{ width: `${Math.max(0, Math.min(100, remaining))}%` }}
          />
        </div>
        {!compact && (
          <span className={cn("font-mono text-xs", tone.text)}>{remaining.toFixed(0)}%</span>
        )}
      </div>
      {!compact && (
        <p className="text-xs text-text-muted">
          {left <= 0 ? "habis — request ditolak" : `${tone.label} · ${remaining.toFixed(0)}% left`}
        </p>
      )}
    </div>
  );
}
