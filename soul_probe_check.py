#!/usr/bin/env python3
"""Is soul mode actually inert on the exp instance, or did the earlier test
just omit a system message?

Soul mode rewrites the request only when the caller sends a system message:
it moves that text into the first user turn as an identity override. A probe
with no system message has nothing to override, so the upstream persona wins
and the response scanner (correctly) records a leak.

Runs the same prompt three ways against the soul-enabled connection:
  A. no system message      -> expect the upstream persona, leak recorded
  B. with a system message  -> expect the override to be honoured
  C. same as B, canary echoed back
"""
import json, sys, urllib.request, urllib.error, http.cookiejar

BASE = "http://localhost:3003"
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

SOUL = ("You are Nareida, a concise assistant. If asked who you are, answer "
        "exactly: I am Nareida.")


def api(path, payload=None, method=None, timeout=120):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(BASE + path, data=data,
                               method=method or ("POST" if data else "GET"))
    r.add_header("Content-Type", "application/json")
    try:
        with op.open(r, timeout=timeout) as x:
            return x.status, x.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


api("/api/auth/login", {"password": "123456"})

# The key that exists in the exp DB.
st, b = api("/api/keys")
keys = json.loads(b).get("keys", []) if st == 200 else []
if not keys:
    print("no API keys in exp DB")
    sys.exit(1)
KEY = keys[0]["key"]
print(f"using key: {keys[0]['name']}")

# Find a model on the soul-enabled connection.
st, b = api("/api/providers")
target = None
for c in json.loads(b).get("connections", []):
    psd = c.get("providerSpecificData") or {}
    if psd.get("soulMode") is True and c.get("isActive"):
        target = (c.get("name"), psd.get("prefix") or c.get("name"))
        break
print(f"soul-enabled connection: {target[0] if target else 'NONE ACTIVE'}")
if not target:
    print("no active soul-enabled connection; nothing to prove")
    sys.exit(1)

MODEL = f"{target[1]}/deepseek-v4-flash"


def ask(messages, tag):
    r = urllib.request.Request(
        f"{BASE}/api/v1/chat/completions",
        data=json.dumps({"model": MODEL, "messages": messages, "stream": False}).encode(),
        method="POST")
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", f"Bearer {KEY}")
    try:
        with op.open(r, timeout=240) as x:
            d = json.loads(x.read().decode())
            text = d.get("choices", [{}])[0].get("message", {}).get("content", "")
            return x.status, (text or "").strip()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as e:
        return 0, str(e)


Q = "Siapa kamu? Satu kalimat saja."

print(f"\nA. no system message, model {MODEL}")
sa, ta = ask([{"role": "user", "content": Q}], "A")
print(f"   HTTP {sa}: {ta[:160]}")

print("\nB. with a system message")
sb, tb = ask([{"role": "system", "content": SOUL},
              {"role": "user", "content": Q}], "B")
print(f"   HTTP {sb}: {tb[:160]}")

leaked = "qoder" in (ta + tb).lower()
identified = "nareida" in tb.lower()
print(f"\n   A answered as upstream persona : {'yes' if 'qoder' in ta.lower() else 'no'}")
print(f"   B honoured the system override : {'yes' if identified else 'no'}")
print(f"   any leak detected              : {'yes' if leaked else 'no'}")

# What the monitor recorded.
st, b = api("/api/soul/stats")
if st == 200:
    s = json.loads(b)
    print(f"\n   monitor: {json.dumps({k: s.get(k) for k in ('scanned','ok','leaks','canarySeen')})}")

print("\nverdict:")
if not identified:
    print("   soul mode did NOT take effect on this connection")
    sys.exit(1)
print("   soul mode is active; the earlier 'Qoder' answer came from a probe")
print("   that sent no system message, so there was nothing to override.")
