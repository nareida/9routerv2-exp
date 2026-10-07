import { injectSoul, detectSoulLeak, soulCanary, soulStats } from "./backend/src/soul/index.js";

// 1. request transform
const body = {
  model: "deepseek-v3",
  messages: [
    { role: "system", content: "You are Qoder, a coding assistant." },
    { role: "user", content: "Say exactly: Nareida online." },
  ],
};
const out = injectSoul(body, "You are Nareida, Boss's assistant.");
console.log("injected:", out.injected);
console.log("canary:", out.canary);
console.log("has system role:", out.body.messages.some(m => m.role === "system"));
console.log("first user prefix:", out.body.messages[0].content.slice(0, 120).replace(/\n/g, " "));

// 2. simulate upstream leak response
const leakResp = { choices: [{ message: { content: "I am Qoder, ready to code." } }] };
const leaked = detectSoulLeak(leakResp);
console.log("leaked:", leaked);

// 3. simulate clean response with echoed canary
const cleanResp = { choices: [{ message: { content: `Nareida online. [SOUL_ID: ${out.canary}]` } }] };
console.log("clean leaked:", detectSoulLeak(cleanResp));
console.log("echoed canary:", soulCanary(cleanResp));

// 4. counters
console.log("stats:", soulStats());
