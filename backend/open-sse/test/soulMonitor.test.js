import { describe, it, expect, beforeEach } from "vitest";
import { scanResponse, resetStats, soulStats } from "../../src/soul/monitor.js";

beforeEach(() => resetStats());

describe("soul monitor — leak detection", () => {
  it("flags an upstream identity claim and records it", () => {
    const resp = { choices: [{ message: { content: "I am Qoder." } }] };
    const r = scanResponse(resp);
    expect(r.leaked).toBe(true);
    expect(soulStats().leaks).toBe(1);
    expect(soulStats().scanned).toBe(1);
  });

  it("keeps a clean response unmarked", () => {
    const resp = { choices: [{ message: { content: "Halo Boss, siap." } }] };
    const r = scanResponse(resp);
    expect(r.leaked).toBe(false);
    expect(soulStats().ok).toBe(1);
  });

  it("detects canary echo and marks the request compliant", () => {
    const resp = { choices: [{ message: { content: "ok [SOUL_ID: deadbeef]" } }] };
    const r = scanResponse(resp, { expectCanary: true });
    expect(r.canary).toBe("deadbeef");
    expect(soulStats().canarySeen).toBe(1);
    expect(soulStats().ok).toBe(1);
  });

  it("treats a missing canary as non-compliant, not as a leak", () => {
    const resp = { choices: [{ message: { content: "halo" } }] };
    const r = scanResponse(resp, { expectCanary: true });
    expect(r.leaked).toBe(false);
    expect(r.canary).toBe("");
    expect(soulStats().ok).toBe(0);
  });

  it("ignores malformed input without throwing", () => {
    expect(scanResponse(null).leaked).toBe(false);
    expect(scanResponse({}).leaked).toBe(false);
    expect(scanResponse({ choices: [] }).leaked).toBe(false);
    expect(scanResponse({ choices: [{ message: { content: 42 } }] }).leaked).toBe(false);
  });

  it("is fail-open on scanner error", () => {
    const circular = { choices: [{ message: { content: "hi" } }] };
    circular.self = circular;
    expect(() => scanResponse(circular)).not.toThrow();
    expect(scanResponse(circular).leaked).toBe(false);
  });
});
