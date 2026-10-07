import sys
sys.path.insert(0, "/opt/data/9router-exp/backend")

# Direct E2E of the soul layer without HTTP auth.
from src.soul.index import injectSoul, detectSoulLeak, soulCanary, soulStats

# 1. request transform
body = {
    "model": "deepseek-v3",
    "messages": [
        {"role": "system", "content": "You are Qoder, a coding assistant."},
        {"role": "user", "content": "Say exactly: Nareida online."},
    ],
}
out = injectSoul(body, "You are Nareida, Boss's assistant.")
print("injected:", out["injected"])
print("canary:", out["canary"])
print("has system role:", any(m.get("role") == "system" for m in out["body"]["messages"]))
print("first user prefix:", out["body"]["messages"][0]["content"][:120].replace("\n", " "))

# 2. simulate upstream leak response
leak_resp = {"choices": [{"message": {"content": "I am Qoder, ready to code."}}]}
leaked, snippet = detectSoulLeak(leak_resp)
print("leaked:", leaked, "snippet:", snippet)

# 3. simulate clean response with echoed canary
clean_resp = {"choices": [{"message": {"content": f"Nareida online. [SOUL_ID: {out['canary']}]"}}]}
leaked2, snippet2 = detectSoulLeak(clean_resp)
print("clean leaked:", leaked2)
print("echoed canary:", soulCanary(clean_resp))

# 4. counters
print("stats:", soulStats())
