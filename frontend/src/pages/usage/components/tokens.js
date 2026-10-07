/**
 * Token formatting for the usage tables.
 *
 * Extracted from UsageTable.jsx so the format is testable and so the portal can
 * share exactly the same rule. Full-precision numbers overflow the narrow
 * In/Out column, and Intl's locale-dependent grouping separators (1,234 vs
 * 1.234) made the same figure read differently on different devices, so the
 * suffix is built by hand.
 */
export const fmt = (n) => {
  const v = Number(n || 0);
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(v));
};