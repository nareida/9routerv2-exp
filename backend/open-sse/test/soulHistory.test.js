import { describe, it, expect, beforeEach } from "vitest";
import { aggregateSoulStats, getPersistedSoulStats } from "../../src/soul/history.js";
import { resetStats, soulStats } from "../../src/soul/monitor.js";

beforeEach(() => resetStats());

const rec = (id, soul, ts) => ({
  id,
  timestamp: ts || "2026-09-25T10:00:00.000Z",
  provider: "openai-compatible-clouvia",
  model: "deepseek-v3",
  status: "success",
  data: JSON.stringify({ response: soul || {} }),
});

describe("soul history — aggregateSoulStats", () => {
  it("returns zeros for no records", () => {
    expect(aggregateSoulStats([])).toEqual({ scanned: 0, ok: 0, leaks: 0, canarySeen: 0 });
  });

  it("counts compliant, leaked and canary-seen records", () => {
    const out = aggregateSoulStats([
      rec("1", { soul_ok: true, soul_canary: "ab12cd34" }),
      rec("2", { soul_ok: false, soul_leak: "I am Qoder" }),
      rec("3", { soul_ok: true }),
    ]);
    expect(out.scanned).toBe(3);
    expect(out.ok).toBe(2);
    expect(out.leaks).toBe(1);
    expect(out.canarySeen).toBe(1);
  });

  it("ignores records that never carried soul fields", () => {
    const out = aggregateSoulStats([rec("1"), rec("2", { soul_ok: true })]);
    expect(out.scanned).toBe(1);
    expect(out.ok).toBe(1);
  });

  it("survives a record with malformed JSON", () => {
    const bad = { id: "x", status: "success", data: "{not json" };
    expect(aggregateSoulStats([bad, rec("2", { soul_ok: true })])).toEqual({
      scanned: 1, ok: 1, leaks: 0, canarySeen: 0,
    });
  });
});

describe("soul history — getPersistedSoulStats", () => {
  // usageRows is injected so the assertion does not depend on whatever traffic
  // the live exp DB happens to contain.
  it("merges in-memory counters with the DB total", async () => {
    soulStats(); // baseline
    const injected = [rec("1", { soul_ok: true, soul_canary: "deadbeef" })];
    const persisted = aggregateSoulStats(injected);
    const merged = await getPersistedSoulStats({
      usageRows: injected,
      getRecords: () => Promise.resolve({ details: injected }),
    });
    expect(merged.scanned).toBeGreaterThanOrEqual(1);
    expect(merged.persisted).toEqual(persisted);
  });

  it("fails open to in-memory when the DB read throws", async () => {
    const boom = () => Promise.reject(new Error("db down"));
    const merged = await getPersistedSoulStats({ getRecords: boom });
    expect(merged.persisted).toBeNull();
    expect(typeof merged.scanned).toBe("number");
  });
});
