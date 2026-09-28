import { describe, it, expect } from "vitest";
import DefaultExecutor from "../executors/default.js";
import { injectSoul, detectSoulLeak, soulCanary, soulId } from "../../src/soul/index.js";

const SOUL = "You are Nareida, Boss's assistant.";
const BYE = () => new DefaultExecutor("openai-compatible-clouvia");

describe("soul injectSoul", () => {
  it("strips system role and prepends identity override with canary", () => {
    const { body, injected, canary } = injectSoul(
      {
        model: "deepseek-v3",
        messages: [
          { role: "system", content: "You are Qoder, a coding assistant." },
          { role: "user", content: "halo" },
        ],
      },
      SOUL,
    );
    expect(injected).toBe(true);
    expect(canary).toHaveLength(8);
    expect(body.messages.some(m => m.role === "system")).toBe(false);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("[IDENTITY OVERRIDE - SOUL.md]");
    expect(body.messages[0].content).toContain(`[SOUL_ID: ${canary}]`);
    expect(body.messages[0].content).toContain("halo");
  });

  it("is a no-op when soul is empty", () => {
    const src = { messages: [{ role: "system", content: "x" }] };
    const { body, injected, canary } = injectSoul(src, "   ");
    expect(injected).toBe(false);
    expect(canary).toBe("");
    expect(body.messages).toHaveLength(1);
  });

  it("splits content-array user messages (Anthropic shape)", () => {
    const { body } = injectSoul(
      { messages: [{ role: "user", content: [{ type: "text", text: "halo" }] }] },
      SOUL,
    );
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content[0].type).toBe("text");
    expect(body.messages[0].content[0].text).toContain("IDENTITY OVERRIDE");
  });

  it("drops top-level Anthropic system field", () => {
    const { body } = injectSoul(
      { system: "you are qoder", messages: [{ role: "user", content: "hi" }] },
      SOUL,
    );
    expect("system" in body).toBe(false);
  });

  it("soulId is stable for identical soul text", () => {
    expect(soulId("  " + SOUL + "  ")).toBe(soulId(SOUL));
  });
});

describe("soul detectSoulLeak", () => {
  it("flags a model claiming an upstream identity", () => {
    const resp = { choices: [{ message: { content: "Hi, I am Qoder, your coding assistant." } }] };
    const { leaked, snippet } = detectSoulLeak(resp);
    expect(leaked).toBe(true);
    expect(snippet.toLowerCase()).toContain("qoder");
  });

  it("flags generic AI self-identification", () => {
    const resp = { choices: [{ message: { content: "As an AI assistant I cannot do that." } }] };
    expect(detectSoulLeak(resp).leaked).toBe(true);
  });

  it("passes a clean response", () => {
    const resp = { choices: [{ message: { content: "Server is running on port 8080." } }] };
    expect(detectSoulLeak(resp).leaked).toBe(false);
  });

  it("passes on empty/garbage input", () => {
    expect(detectSoulLeak(null).leaked).toBe(false);
    expect(detectSoulLeak({}).leaked).toBe(false);
  });
});

describe("soul canary extraction", () => {
  it("reads back an echoed SOUL_ID", () => {
    const resp = { choices: [{ message: { content: "ok [SOUL_ID: ab12cd34] done" } }] };
    expect(soulCanary(resp)).toBe("ab12cd34");
  });

  it("returns empty when canary absent", () => {
    const resp = { choices: [{ message: { content: "plain answer" } }] };
    expect(soulCanary(resp)).toBe("");
  });
});

describe("DefaultExecutor soul mode wiring", () => {
  it("embeds the SOUL_ID canary in the identity override block", () => {
    const ex = BYE();
    const out = ex.transformRequest(
      "deepseek-v3",
      {
        messages: [
          { role: "system", content: SOUL },
          { role: "user", content: "halo" },
        ],
      },
      false,
      { providerSpecificData: { soulMode: true } },
    );
    expect(out.messages.some(m => m.role === "system")).toBe(false);
    const first = out.messages.find(m => m.role === "user");
    expect(typeof first.content).toBe("string");
    expect(first.content).toMatch(/\[SOUL_ID: [a-f0-9]{8}\]/);
  });

  it("leaves the request alone when soulMode is off", () => {
    const ex = BYE();
    const out = ex.transformRequest(
      "deepseek-v3",
      { messages: [{ role: "system", content: SOUL }, { role: "user", content: "halo" }] },
      false,
      { providerSpecificData: {} },
    );
    expect(out.messages[0].role).toBe("system");
  });
});
