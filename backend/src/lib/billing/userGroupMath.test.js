// Derived from One Hub (https://github.com/songquanpeng/one-hub),
// Copyright 2023 The One Hub Authors, licensed under Apache-2.0.
// Rewritten for 9router's key/balance model; see README "Credits" for the
// full derivation list.

import { describe, it, expect } from "vitest";
import { pickPromotionGroup } from "./userGroupRepo.js";

// ── Tier ratio + quota arithmetic ───────────────────────────────────────────
// Pure logic, no DB. Mirrors one-hub's model/user_group.go +
// relay/relay_util/quota.go, minus recharge/payment.
//
// pickPromotionGroup is imported from the production module rather than
// re-declared here. An earlier version of this file carried its own copy, which
// let the tested meaning of min/max drift away from what the server actually
// used — the copy still passed while the server read max as a key count.

function computeCost({ promptTokens, completionTokens, price, groupRatio }) {
  const inputRatio = price.input * groupRatio;
  const outputRatio = price.output * groupRatio;
  return Math.round(promptTokens * inputRatio + completionTokens * outputRatio);
}

function checkQuota({ balance, estimatedCost, unlimited }) {
  if (unlimited) return { allowed: true, reason: null };
  if (balance < estimatedCost) {
    return {
      allowed: false,
      reason: `insufficient_quota: balance ${balance} < estimated ${estimatedCost}`,
    };
  }
  return { allowed: true, reason: null };
}

describe("userGroups — tier ratio", () => {
  it("applies groupRatio to both input and output price", () => {
    const cost = computeCost({
      promptTokens: 1000, completionTokens: 500,
      price: { input: 2, output: 4 }, groupRatio: 0.5,
    });
    // 1000*2*0.5 + 500*4*0.5 = 1000 + 1000 = 2000
    expect(cost).toBe(2000);
  });

  it("a higher ratio costs more than a lower ratio for identical usage", () => {
    const args = { promptTokens: 2000, completionTokens: 1000, price: { input: 1, output: 3 } };
    const cheap = computeCost({ ...args, groupRatio: 0.1 });
    const pricey = computeCost({ ...args, groupRatio: 2.0 });
    expect(pricey).toBeGreaterThan(cheap);
  });

  it("ratio 1.0 leaves price untouched", () => {
    const cost = computeCost({
      promptTokens: 100, completionTokens: 0,
      price: { input: 3, output: 5 }, groupRatio: 1,
    });
    expect(cost).toBe(300);
  });
});

describe("userGroups — quota enforcement", () => {
  it("rejects when balance is below the estimate", () => {
    const r = checkQuota({ balance: 100, estimatedCost: 500, unlimited: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/insufficient_quota/);
  });

  it("allows when balance covers the estimate", () => {
    expect(checkQuota({ balance: 500, estimatedCost: 500, unlimited: false }).allowed).toBe(true);
  });

  it("unlimited token bypasses the balance check", () => {
    expect(checkQuota({ balance: 0, estimatedCost: 999999, unlimited: true }).allowed).toBe(true);
  });
});

describe("userGroups — promotion auto-upgrade", () => {
  const groups = [
    { symbol: "free", min: 0, max: 100, promotion: true, enable: true },
    { symbol: "pro", min: 100, max: 1000, promotion: true, enable: true },
    { symbol: "elite", min: 1000, max: 0, promotion: true, enable: true },
  ];

  it("picks the tier whose range contains the cumulative amount", () => {
    expect(pickPromotionGroup(groups, 50)?.symbol).toBe("free");
    expect(pickPromotionGroup(groups, 500)?.symbol).toBe("pro");
    expect(pickPromotionGroup(groups, 5000)?.symbol).toBe("elite");
  });

  it("max 0 means open-ended top tier", () => {
    expect(pickPromotionGroup(groups, 1_000_000)?.symbol).toBe("elite");
  });

  it("skips disabled and non-promotion groups", () => {
    const mixed = [
      { symbol: "off", min: 0, max: 0, promotion: true, enable: false },
      { symbol: "manual", min: 0, max: 0, promotion: false, enable: true },
    ];
    expect(pickPromotionGroup(mixed, 9999)).toBeNull();
  });

  it("prefers the higher min when windows overlap", () => {
    const overlap = [
      { symbol: "low", min: 0, max: 500, promotion: true, enable: true },
      { symbol: "high", min: 100, max: 0, promotion: true, enable: true },
    ];
    expect(pickPromotionGroup(overlap, 200)?.symbol).toBe("high");
  });

  it("is a half-open window: max is exclusive, min is inclusive", () => {
    const g = [{ symbol: "band", min: 10, max: 20, promotion: true, enable: true }];
    expect(pickPromotionGroup(g, 9)).toBeNull();
    expect(pickPromotionGroup(g, 10)?.symbol).toBe("band");
    expect(pickPromotionGroup(g, 19)?.symbol).toBe("band");
    expect(pickPromotionGroup(g, 20)).toBeNull();
  });

  it("ignores maxKeys — that is a key-count cap, not a spend window", () => {
    const g = [{ symbol: "capped", min: 0, max: 100, maxKeys: 3, promotion: true, enable: true }];
    expect(pickPromotionGroup(g, 50)?.symbol).toBe("capped");
  });
});
