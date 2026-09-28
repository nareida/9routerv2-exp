"""E2E: user-tier quota enforcement on the live exp instance (port 3003).

Proves the full chain: tier CRUD -> key assigned to tier -> chat request
blocked by insufficient quota -> top up -> same request allowed.
"""
import json
import urllib.request
import urllib.error
import http.cookiejar

BASE = "http://localhost:3003"
PASSWORD = "123456"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def api(path, payload=None, method=None, timeout=60):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method or ("POST" if data else "GET"))
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


def chat(model, key, content="hi", timeout=120):
    req = urllib.request.Request(
        BASE + "/v1/chat/completions",
        data=json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 20,
        }).encode(),
        method="POST",
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {key}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


print("== login ==")
st, _ = api("/api/auth/login", {"password": PASSWORD})
print("  login:", st)

print("\n== cleanup old fixtures ==")
st, body = api("/api/user-groups")
for g in json.loads(body).get("groups", []):
    if g["symbol"].startswith("e2e"):
        api(f"/api/user-groups?symbol={g['symbol']}", method="DELETE")
st, body = api("/api/user-groups")
print("  remaining:", [g["symbol"] for g in json.loads(body).get("groups", [])])

print("\n== 1. create tiers ==")
st, body = api("/api/user-groups", {
    "symbol": "e2e-free", "name": "E2E Free", "ratio": 1, "apiRate": 0,
    "public": True, "promotion": False, "min": 0, "max": 0, "enable": True,
})
print("  create e2e-free:", st, body[:120])
st, body = api("/api/user-groups", {
    "symbol": "e2e-guard", "name": "E2E Guard", "ratio": 1, "apiRate": 0,
    "public": True, "promotion": False, "min": 0, "max": 0, "enable": True,
})
print("  create e2e-guard:", st, body[:120])

st, body = api("/api/user-groups", {
    "symbol": "e2e-free", "name": "dupe", "ratio": 1, "apiRate": 0,
    "public": True, "promotion": False, "min": 0, "max": 0, "enable": True,
})
print("  duplicate rejected:", st, "(expect 409)")

print("\n== 2. create key ==")
st, body = api("/api/keys", {"name": "tier-e2e"})
print("  key:", st)
key = json.loads(body).get("key") if st < 300 else None
if not key:
    print("FAIL: no key"); raise SystemExit(1)
print("  key value:", key[:7] + "***")

print("\n== 3. assign key to tier with 0 balance ==")
import sqlite3
db = sqlite3.connect("/opt/data/9router-exp/.data/db/data.sqlite")
db.execute('UPDATE apiKeys SET userGroup = ?, balance = 0, unlimited = 0 WHERE key = ?',
           ("e2e-guard", key))
db.commit()
row = db.execute("SELECT userGroup, balance, unlimited FROM apiKeys WHERE key = ?", (key,)).fetchone()
print("  key state:", row)
db.close()

print("\n== 4. request should be BLOCKED (balance 0) ==")
st, body = chat("my9model-fast", key)
print("  status:", st, "(expect 429)")
print("  body:", body[:200])

print("\n== 5. top up balance, request should PASS ==")
db = sqlite3.connect("/opt/data/9router-exp/.data/db/data.sqlite")
db.execute("UPDATE apiKeys SET balance = 1000000 WHERE key = ?", (key,))
db.commit()
db.close()
print("  balance -> 1000000")
st, body = chat("my9model-fast", key, "Reply: tier quota online")
print("  status:", st, "(expect 200)")
if st == 200:
    try:
        print("  reply:", json.loads(body)["choices"][0]["message"]["content"][:80])
    except Exception:
        print("  body:", body[:200])

print("\n== 6. unlimited key bypasses balance ==")
db = sqlite3.connect("/opt/data/9router-exp/.data/db/data.sqlite")
db.execute("UPDATE apiKeys SET balance = 0, unlimited = 1 WHERE key = ?", (key,))
db.commit()
db.close()
st, body = chat("my9model-fast", key, "Reply: unlimited ok")
print("  status:", st, "(expect 200)")

print("\n== 7. cleanup ==")
for s in ("e2e-free", "e2e-guard"):
    api(f"/api/user-groups?symbol={s}", method="DELETE")
st, body = api("/api/user-groups")
print("  final:", [g["symbol"] for g in json.loads(body).get("groups", [])])
