"""E2E: the tier apiRate actually blocks requests.

checkQuota keeps an in-memory sliding window per (tier, keyId). This proves the
window is enforced end-to-end through real HTTP requests, and that a key on a
tier with no cap is unaffected.

A low cap is used on purpose so the test does not have to fire hundreds of
requests: the behaviour under test is the window, not the specific number.

Runs against the live exp instance (port 3003) only.
"""
import json
import sys
import time
import urllib.error
import urllib.request
import http.cookiejar

BASE = "http://localhost:3003"
PASSWORD = "123456"
MODEL = "my9model-fast"
RATE_TIER = "rate-e2e"
NOCAP_TIER = "nocap-e2e"
# Guard: this script creates and rewrites tiers; a typo in a symbol would
# clobber live config, so refuse anything that is not a test tier.
for _t in (RATE_TIER, NOCAP_TIER):
    if not _t.endswith("-e2e"):
        raise SystemExit(f"refusing to touch non-test tier: {_t!r}")
CAP = 3

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


def chat(key, timeout=120):
    req = urllib.request.Request(
        BASE + "/v1/chat/completions",
        data=json.dumps({
            "model": MODEL,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 5,
        }).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read()
            return r.status
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:160]
    except Exception as e:
        return 0, str(e)[:160]


failures = []
def check(cond, msg):
    print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
    if not cond:
        failures.append(msg)


print("== login ==")
st, _ = api("/api/auth/login", {"password": PASSWORD})
check(st == 200, f"login (got {st})")

print(f"\n== create tier with apiRate={CAP}/min ==")
st, body = api("/api/user-groups", {
    "symbol": RATE_TIER, "name": "Rate E2E", "ratio": 1, "apiRate": CAP,
    "allowIp": False, "channels": [], "models": ["*"],
})
# 409 means a previous run left the tier behind; re-assert the cap below.
check(st in (200, 201, 409), f"create tier (got {st})")

# Make sure the cap really is what we think it is.
st, body = api("/api/user-groups")
tier = next((g for g in json.loads(body).get("groups", []) if g["symbol"] == RATE_TIER), None)
check(tier is not None and tier["apiRate"] == CAP,
      f"tier apiRate == {CAP} (got {tier['apiRate'] if tier else None})")

print("\n== key on the capped tier, with balance so cost never blocks first ==")
st, body = api("/api/keys", {
    "name": "rate-e2e", "userGroup": RATE_TIER, "balance": 1000000,
})
key = json.loads(body).get("key")
check(bool(key), f"key created (got {st})")

print(f"\n== fire CAP+3 requests quickly, expect the last ones blocked ==")
codes = []
for i in range(CAP + 3):
    res = chat(key)
    codes.append(res[0] if isinstance(res, tuple) else res)
    print(f"   req {i+1}: {res}")
    time.sleep(0.15)

ok_count = sum(1 for c in codes if c == 200)
blocked = [c for c in codes if c == 429]
print(f"   200s: {ok_count}  429s: {len(blocked)}  (cap={CAP})")

check(ok_count <= CAP, f"at most {CAP} requests allowed (got {ok_count})")
check(len(blocked) >= 3, f"excess requests blocked with 429 (got {len(blocked)})")

print("\n== 429 body is a rate_limit, not a quota error ==")
st, body = api("/api/keys")
last = [c for c in codes if c == 429]
if last:
    res = chat(key)
    if isinstance(res, tuple) and res[0] == 429:
        check("rate_limited" in res[1], f"429 body mentions rate_limited (got {res[1][:120]!r})")
    else:
        check(False, f"expected 429 on follow-up, got {res}")

print("\n== a key on an uncapped tier is unaffected ==")
st, body = api("/api/user-groups", {
    "symbol": NOCAP_TIER, "name": "No Cap E2E", "ratio": 1, "apiRate": 0,
    "allowIp": False, "channels": [], "models": ["*"],
})
check(st in (200, 201, 409), f"create uncapped tier (got {st})")
st, body = api("/api/keys", {"name": NOCAP_TIER, "userGroup": NOCAP_TIER, "balance": 1000000})
free_key = json.loads(body).get("key")
free_codes = []
for _ in range(CAP + 3):
    res = chat(free_key)
    free_codes.append(res[0] if isinstance(res, tuple) else res)
    time.sleep(0.15)
print(f"   codes: {free_codes}")
check(all(c == 200 for c in free_codes), f"uncapped tier allows all {CAP+3} requests")

print("\n== cleanup ==")
for k in (key, free_key):
    st, body = api("/api/keys")
    m = next((x for x in json.loads(body).get("keys", []) if x.get("key") == k), None)
    if m:
        api(f"/api/keys/{m['id']}", method="DELETE")
for s in (RATE_TIER, NOCAP_TIER):
    api("/api/user-groups", {"symbol": s}, method="DELETE")
st, body = api("/api/user-groups")
left = [g["symbol"] for g in json.loads(body).get("groups", [])]
check(RATE_TIER not in left and NOCAP_TIER not in left, f"tiers cleaned (left={left})")

print("\n" + "=" * 46)
if failures:
    print("FAILURES:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ALL RATE LIMIT CHECKS PASSED")
