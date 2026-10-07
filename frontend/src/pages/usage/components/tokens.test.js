/**
 * Token-count formatting shared by the usage tables and the portal.
 *
 * The figure has to be short enough for the narrow In/Out column and identical
 * on every device: Intl's default grouping separator is locale-dependent, so a
 * raw Intl.NumberFormat rendered 237938 as "237,938" on one machine and
 * "237.938" on another, and a decimal point next to a thousands-scaled count
 * reads as corrupted data rather than as a token count.
 */
import { describe, it, expect } from "vitest";
import { fmt } from "./tokens.js";

describe("fmt (token counts)", () => {
  it("leaves small counts as plain integers", () => {
    expect(fmt(0)).toBe("0");
    expect(fmt(304)).toBe("304");
    expect(fmt(999)).toBe("999");
  });

  it("scales thousands with one decimal and no locale separator", () => {
    expect(fmt(1000)).toBe("1K");
    expect(fmt(1045)).toBe("1K");
    expect(fmt(2332)).toBe("2.3K");
    expect(fmt(237_938)).toBe("237.9K");
  });

  it("scales millions and billions", () => {
    expect(fmt(1_000_000)).toBe("1M");
    expect(fmt(1_673_000)).toBe("1.7M");
    expect(fmt(279_600_000)).toBe("279.6M");
    expect(fmt(2_000_000_000)).toBe("2B");
  });

  it("never emits a locale grouping separator", () => {
    // The regression: 237938 must never come out as "237.938" or "237,938".
    for (const n of [237_938, 1_234, 999_999, 1_048_576]) {
      expect(fmt(n)).not.toMatch(/[.,]\d{3}(?!\d*[KMB]?$)/);
      expect(fmt(n)).not.toContain(",");
    }
    expect(fmt(237_938)).toBe("237.9K");
  });

  it("handles null, undefined and non-numeric input", () => {
    expect(fmt(null)).toBe("0");
    expect(fmt(undefined)).toBe("0");
    expect(fmt("")).toBe("0");
    expect(fmt(NaN)).toBe("0");
    expect(fmt("232")).toBe("232");
  });

  it("keeps the sign on negative counts", () => {
    expect(fmt(-1500)).toBe("-1.5K");
    expect(fmt(-304)).toBe("-304");
  });
});