// Derived from One Hub (https://github.com/songquanpeng/one-hub),
// Copyright 2023 The One Hub Authors, licensed under Apache-2.0.
// Rewritten for 9router's key/balance model; see README "Credits" for the
// full derivation list.

import { describe, it, expect, beforeEach } from "vitest";

// vitest.config.js points DATA_DIR at a throwaway directory. This suite's
// beforeEach wipes every tier, so it must never see the live data dir.

async function loadRepo() {
  const mod = await import("./userGroupRepo.js");
  return mod;
}

describe("userGroupRepo", () => {
  let repo;

  beforeEach(async () => {
    repo = await loadRepo();
    await repo.refreshCache();
    const existing = await repo.listUserGroups();
    for (const g of existing) await repo.deleteUserGroup(g.symbol);
    await repo.refreshCache();
  });

  it("creates a group and exposes it through cache", async () => {
    const g = await repo.createUserGroup({ symbol: "pro", name: "Pro", ratio: 2, apiRate: 120, public: true, promotion: false, min: 0, max: 0, enable: true });
    expect(g.symbol).toBe("pro");
    const cache = await repo.getGroupCache();
    expect(cache.get("pro")?.name).toBe("Pro");
    expect(cache.get("pro")?.ratio).toBe(2);
    expect(cache.publicGroups()).toContain("pro");
  });

  it("updates and refreshes cache", async () => {
    await repo.createUserGroup({ symbol: "elite", name: "Elite", ratio: 1, apiRate: 60, public: false, promotion: false, min: 0, max: 0, enable: true });
    await repo.updateUserGroup("elite", { ratio: 3, enable: false });
    const cache = await repo.getGroupCache();
    expect(cache.get("elite")?.ratio).toBe(3);
    expect(cache.get("elite")?.enable).toBe(false);
    expect(cache.publicGroups()).not.toContain("elite");
  });

  it("pickGroup prefers tokenGroup then userGroup", async () => {
    await repo.createUserGroup({ symbol: "tok", name: "Token", ratio: 1, apiRate: 0, public: false, promotion: false, min: 0, max: 0, enable: true });
    await repo.createUserGroup({ symbol: "usr", name: "User", ratio: 1, apiRate: 0, public: false, promotion: false, min: 0, max: 0, enable: true });
    expect(repo.pickGroup("tok", "usr")?.symbol).toBe("tok");
    expect(repo.pickGroup("", "usr")?.symbol).toBe("usr");
    expect(repo.pickGroup("", "")).toBeNull();
  });
});
