// Derived from One Hub (https://github.com/songquanpeng/one-hub),
// Copyright 2023 The One Hub Authors, licensed under Apache-2.0.
// Rewritten for 9router's key/balance model; see README "Credits" for the
// full derivation list.

import { describe, it, expect } from "vitest";

// Pure cost arithmetic shared by pre-flight estimate and post-request settle.
// Mirrors one-hub's relay/relay_util/quota.go: inputRatio/outputRatio
// = price * groupRatio, applied to actual token counts.
export function computeCharge({ promptTokens, completionTokens, price, groupRatio = 1 }) {
  const ratio = Number(groupRatio);
  const inputRatio = Number(price?.input ?? 1) * ratio;
  const outputRatio = Number(price?.output ?? 2) * ratio;
  return Math.round(promptTokens * inputRatio + completionTokens * outputRatio);
}

describe("computeCharge — post-request billing", () => {
  it("charges prompt and completion at their own prices", () => {
    expect(computeCharge({
      promptTokens: 1000, completionTokens: 1000,
      price: { input: 2, output: 4 },
    })).toBe(6000); // 1000*2 + 1000*4
  });

  it("scales both sides by the group ratio", () => {
    const base = { promptTokens: 1000, completionTokens: 1000, price: { input: 2, output: 4 } };
    expect(computeCharge({ ...base, groupRatio: 0.5 })).toBe(3000);
    expect(computeCharge({ ...base, groupRatio: 2 })).toBe(12000);
    expect(computeCharge({ ...base, groupRatio: 1 })).toBe(6000);
  });

  it("defaults a missing ratio to 1 so legacy keys bill unchanged", () => {
    expect(computeCharge({
      promptTokens: 500, completionTokens: 250, price: { input: 1, output: 3 },
    })).toBe(1250); // 500*1 + 250*3
  });

  it("missing price falls back to 1 in / 2 out", () => {
    expect(computeCharge({ promptTokens: 100, completionTokens: 100, price: null })).toBe(300);
    expect(computeCharge({ promptTokens: 100, completionTokens: 100 })).toBe(300);
  });

  it("zero usage costs nothing", () => {
    expect(computeCharge({
      promptTokens: 0, completionTokens: 0, price: { input: 5, output: 5 },
    })).toBe(0);
  });

  it("rounds fractional results to a whole unit", () => {
    expect(computeCharge({
      promptTokens: 3, completionTokens: 1, price: { input: 0.33, output: 0.66 },
    })).toBe(2); // 0.99 + 0.66 = 1.65 -> 2
  });

  it("matches the pre-flight estimate shape", () => {
    const args = { promptTokens: 2000, completionTokens: 500, price: { input: 1, output: 3 }, groupRatio: 1.5 };
    // 2000*1*1.5 + 500*3*1.5 = 3000 + 2250 = 5250
    expect(computeCharge(args)).toBe(5250);
  });
});
