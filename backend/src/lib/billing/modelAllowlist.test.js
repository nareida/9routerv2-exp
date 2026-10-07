import { describe, it, expect } from "vitest";
import { modelAllowed, parseAllowedModels } from "../db/repos/apiKeysRepo.js";

describe("parseAllowedModels", () => {
  it("treats a missing or empty value as unrestricted", () => {
    expect(parseAllowedModels(null)).toEqual(["*"]);
    expect(parseAllowedModels(undefined)).toEqual(["*"]);
    expect(parseAllowedModels("")).toEqual(["*"]);
    expect(parseAllowedModels("[]")).toEqual(["*"]);
    expect(parseAllowedModels("   ")).toEqual(["*"]);
  });

  it("parses a stored JSON array", () => {
    expect(parseAllowedModels('["gpt-4o","claude-sonnet-4"]')).toEqual([
      "gpt-4o",
      "claude-sonnet-4",
    ]);
  });

  it("keeps a hand-written bare string as a single pattern", () => {
    // A malformed row must not silently widen to "allow everything".
    expect(parseAllowedModels("gpt-4o")).toEqual(["gpt-4o"]);
  });

  it("accepts an array as-is", () => {
    expect(parseAllowedModels(["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("modelAllowed", () => {
  it("allows everything for the wildcard list", () => {
    expect(modelAllowed("gpt-4o", ["*"])).toBe(true);
    expect(modelAllowed("anything/at-all", ["*"])).toBe(true);
    expect(modelAllowed(null, ["*"])).toBe(true);
  });

  it("matches an exact id", () => {
    expect(modelAllowed("gpt-4o", ["gpt-4o", "claude-sonnet-4"])).toBe(true);
    expect(modelAllowed("gpt-4o-mini", ["gpt-4o", "claude-sonnet-4"])).toBe(false);
  });

  it("matches a provider-qualified id against a bare pattern", () => {
    // Keys are usually configured with the short id, but requests arrive
    // qualified. Both directions must work.
    expect(modelAllowed("dahono/deepseek-v4-flash", ["deepseek-v4-flash"])).toBe(true);
    expect(modelAllowed("deepseek-v4-flash", ["dahono/deepseek-v4-flash"])).toBe(true);
  });

  it("matches a prefix wildcard", () => {
    expect(modelAllowed("gpt-4o", ["gpt-4*"])).toBe(true);
    expect(modelAllowed("gpt-4o-mini", ["gpt-4*"])).toBe(true);
    expect(modelAllowed("o1-pro", ["gpt-4*"])).toBe(false);
    expect(modelAllowed("dahono/gpt-4o", ["gpt-4*"])).toBe(true);
  });

  it("refuses a model outside the list", () => {
    expect(modelAllowed("glm-5.2", ["deepseek-v4-flash"])).toBe(false);
  });

  it("refuses an empty request against a restricted list", () => {
    expect(modelAllowed("", ["gpt-4o"])).toBe(false);
    expect(modelAllowed(null, ["gpt-4o"])).toBe(false);
  });

  it("refuses a double-prefixed id that a naive concat could produce", () => {
    // The bug that motivated canonical ids: "dahono/dahono/model".
    expect(modelAllowed("dahono/dahono/deepseek-v4-flash", ["deepseek-v4-flash"])).toBe(true);
  });
});
