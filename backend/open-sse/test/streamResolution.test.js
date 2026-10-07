import { describe, it, expect } from "vitest";
import { resolveStreamFlags } from "../utils/streamResolution.js";
import { FORMATS } from "../translator/formats.js";

// A client that omits `stream` asks for a single JSON response, not a stream.
// The old inline rule (`body.stream !== false`) defaulted to streaming, so any
// provider replying with a plain JSON body went down the SSE path, where no
// usage block is parsed — and post-request billing charged nothing.

const run = (args) => resolveStreamFlags({ sourceFormat: FORMATS.OPENAI, ...args });

describe("resolveStreamFlags", () => {
  it("defaults to non-streaming when the client omits the flag", () => {
    expect(run({ body: {}, provider: "clouvia" }).stream).toBe(false);
  });

  it("honours an explicit stream:true", () => {
    expect(run({ body: { stream: true }, provider: "clouvia" }).stream).toBe(true);
  });

  it("honours an explicit stream:false", () => {
    expect(run({ body: { stream: false }, provider: "clouvia" }).stream).toBe(false);
  });

  it("forces streaming for providers that require it", () => {
    for (const p of ["openai", "codex", "commandcode"]) {
      expect(run({ body: {}, provider: p }).stream).toBe(true);
      expect(run({ body: { stream: false }, provider: p }).stream).toBe(true);
    }
  });

  it("does not force streaming for other providers", () => {
    const r = run({ body: {}, provider: "clouvia" });
    expect(r.providerRequiresStreaming).toBe(false);
    expect(r.clientRequestedStreaming).toBe(false);
  });

  it("reports clientRequestedStreaming for explicit stream:true", () => {
    expect(run({ body: { stream: true }, provider: "clouvia" }).clientRequestedStreaming).toBe(true);
    expect(run({ body: { stream: false }, provider: "clouvia" }).clientRequestedStreaming).toBe(false);
  });

  it("treats native client formats as implicitly streaming", () => {
    for (const f of [FORMATS.ANTIGRAVITY, FORMATS.GEMINI, FORMATS.GEMINI_CLI]) {
      const r = resolveStreamFlags({ body: {}, provider: "clouvia", sourceFormat: f });
      expect(r.clientRequestedStreaming).toBe(true);
      expect(r.stream).toBe(false);
    }
  });
});
