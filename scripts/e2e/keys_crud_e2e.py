"""E2E: key CRUD through the API, including tier assignment and balance.

This is the path the dashboard Keys page uses. It must work end-to-end without
touching SQLite directly — that was the original blocker.

Runs against the live exp instance (port 3003) only.
"""
import json
import sys
import urllib.error
import urllib.request
import http.cookiejar

BASE = "http://localhost:3003"
PASSWORD = "123456"
TIER = "keys-e2e"

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


failures = []
def check(cond, msg):
    if cond:
        print(f"  ok   {msg}")
    else:
        print(f"  FAIL {msg}")
        failures.append(msg)


print("== login ==")
st, _ = api("/api/auth/login", {"password": PASSWORD})
check(st == 200, f"login 200 (got {st})")

print("\n== tier exists ==")
st, body = api("/api/user-groups")
syms = [g["symbol"] for g in json.loads(body).get("groups", [])]
if TIER not in syms:
    st, body = api("/api/user-groups", {
        "symbol": TIER, "name": "Keys E2E", "ratio": 1, "allowIp": False,
        "channels": [], "models": ["*"],
    })
    check(st in (200, 201), f"create tier (got {st})")
else:
    print("  ok   reused tier")

print("\n== create key WITH tier + balance (the original blocker) ==")
st, body = api("/api/keys", {
    "name": "keys-e2e", "userGroup": TIER, "balance": 250000, "unlimited": False,
})
d = json.loads(body) if st else {}
if st != 201:
    print("  FAIL create:", st, body[:200])
    failures.append("create key")
    print("\n" + "=" * 46)
    print("FAILURES:", failures)
    sys.exit(1)

key_id = d.get("id")
key_val = d.get("key")
check(bool(key_id and key_val), "key id + value returned")

# The create response itself must carry the billing fields.
check(d.get("userGroup") == TIER, f"create response userGroup == {TIER} (got {d.get('userGroup')!r})")
check(abs(float(d.get("balance", 0)) - 250000) < 1e-6, f"create response balance == 250000 (got {d.get('balance')})")
check(d.get("unlimited") is False, f"create response unlimited is False (got {d.get('unlimited')!r})")

print("\n== GET /api/keys round-trips the fields ==")
st, body = api("/api/keys")
keys = json.loads(body).get("keys", [])
mine = next((k for k in keys if k.get("id") == key_id), None)
check(mine is not None, "created key appears in list")
if mine:
    check(mine.get("userGroup") == TIER, f"list userGroup == {TIER} (got {mine.get('userGroup')!r})")
    check(abs(float(mine.get("balance", 0)) - 250000) < 1e-6, f"list balance == 250000 (got {mine.get('balance')})")
    check("unlimited" in mine, "list includes unlimited field")
    check("isActive" in mine, "list includes isActive field")

print("\n== reject an unknown tier ==")
st, body = api("/api/keys", {"name": "bad-tier", "userGroup": "does-not-exist"})
check(st == 400, f"unknown tier rejected with 400 (got {st})")
check("Unknown tier" in body, f"error message mentions tier (got {body[:120]!r})")

print("\n== PUT /api/keys/[id] updates balance + tier ==")
st, body = api(f"/api/keys/{key_id}", {"id": key_id, "balance": 175000}, method="PUT")
check(st == 200, f"PUT balance 200 (got {st})")
st, body = api(f"/api/keys/{key_id}", {"id": key_id, "userGroup": TIER, "unlimited": True}, method="PUT")
check(st == 200, f"PUT unlimited 200 (got {st})")
st, body = api("/api/keys")
mine = next((k for k in json.loads(body).get("keys", []) if k.get("id") == key_id), None)
check(mine and mine.get("unlimited") is True, f"unlimited persisted (got {mine.get('unlimited') if mine else None!r})")
check(mine and abs(float(mine.get("balance", 0)) - 175000) < 1e-6, "balance persisted through two PUTs")

print("\n== PUT rejects an unknown tier ==")
st, body = api(f"/api/keys/{key_id}", {"id": key_id, "userGroup": "nope"}, method="PUT")
check(st == 400, f"PUT unknown tier 400 (got {st})")

print("\n== DELETE ==")
st, body = api(f"/api/keys/{key_id}", method="DELETE")
check(st == 200, f"DELETE 200 (got {st})")
st, body = api("/api/keys")
gone = all(k.get("id") != key_id for k in json.loads(body).get("keys", []))
check(gone, "key no longer listed")

print("\n== cleanup tier ==")
st, body = api("/api/user-groups")
syms = [g["symbol"] for g in json.loads(body).get("groups", [])]
if TIER in syms:
    dst, dbody = api("/api/user-groups", {"symbol": TIER}, method="DELETE")
    check(dst == 200, f"DELETE tier 200 (got {dst})")
    st, body = api("/api/user-groups")
    syms = [g["symbol"] for g in json.loads(body).get("groups", [])]
    check(TIER not in syms, "tier actually removed from list")
else:
    print("  ok   already gone")

print("\n" + "=" * 46)
if failures:
    print("FAILURES:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ALL KEY CRUD CHECKS PASSED")
