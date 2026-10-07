"""E2E: tier min/max key cap, and promotion auto-upgrade.

Two previously-inert columns:
  max       — hard cap on how many active keys a tier may hold
  promotion — a key whose balance runs dry moves up the promotion ladder

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

CAP_TIER = "cap-e2e"
CAP_MAX = 2
LOW = "low-e2e"      # ratio 0.5, promotion on  (the entry rung)
HIGH = "high-e2e"    # ratio 4.0, promotion on  (the rung above)

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
            return 200
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def key_info(name):
    st, body = api("/api/keys")
    return next((k for k in json.loads(body).get("keys", []) if k.get("name") == name), None)


failures = []
def check(cond, msg):
    print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
    if not cond:
        failures.append(msg)


print("== login ==")
st, _ = api("/api/auth/login", {"password": PASSWORD})
check(st == 200, f"login (got {st})")


def upsert_tier(symbol, name, ratio, api_rate, promotion, mn, mx, keys_cap=0):
    st, body = api("/api/user-groups")
    existing = next((g for g in json.loads(body).get("groups", []) if g["symbol"] == symbol), None)
    payload = {
        "symbol": symbol, "name": name, "ratio": ratio, "apiRate": api_rate,
        "public": False, "promotion": promotion, "min": mn, "max": mx,
        "maxKeys": keys_cap,
        "allowIp": False, "channels": [], "models": ["*"],
    }
    # Guard: never let this test write to a real tier. It creates and rewrites
    # tiers, so a typo in a symbol would otherwise clobber live config.
    if not symbol.endswith("-e2e"):
        raise SystemExit(f"refusing to touch non-test tier: {symbol!r}")
    if existing:
        st, body = api("/api/user-groups", {**payload, **existing}, method="PUT")
    else:
        st, body = api("/api/user-groups", payload)
    return st


print(f"\n== tier {CAP_TIER} with maxKeys={CAP_MAX} ==")
st = upsert_tier(CAP_TIER, "Cap E2E", 1.0, 0, False, 0, 0, CAP_MAX)
check(st in (200, 201), f"upsert tier with maxKeys={CAP_MAX} (got {st})")

st, body = api("/api/user-groups")
cap_row = next((g for g in json.loads(body).get("groups", []) if g["symbol"] == CAP_TIER), None)
check(cap_row is not None and cap_row.get("maxKeys") == CAP_MAX,
      f"tier reports maxKeys == {CAP_MAX} (got {cap_row.get('maxKeys') if cap_row else None})")
check(cap_row is not None and cap_row.get("max") == 0,
      f"key-count cap did not leak into the spend window max (got {cap_row.get('max') if cap_row else None})")

print("\n== fill the tier to its cap ==")
made = []
for i in range(CAP_MAX):
    st, body = api("/api/keys", {"name": f"cap-{i}", "userGroup": CAP_TIER, "balance": 1000})
    check(st == 201, f"key {i} created (got {st})")
    made.append(json.loads(body).get("key"))

st, body = api("/api/keys", {"name": "cap-overflow", "userGroup": CAP_TIER, "balance": 1000})
check(st == 409, f"over-cap key rejected with 409 (got {st})")
check("full" in body, f"error mentions the tier is full (got {body[:100]!r})")

print("\n== a disabled key frees its slot ==")
info = key_info("cap-0")
st, _ = api(f"/api/keys/{info['id']}", {"id": info["id"], "isActive": False}, method="PUT")
check(st == 200, f"disable key (got {st})")
st, body = api("/api/keys", {"name": "cap-reuse", "userGroup": CAP_TIER, "balance": 1000})
check(st == 201, f"new key fits after disabling one (got {st})")
reuse_key = json.loads(body).get("key") if st == 201 else None

print("\n== re-saving a key does not count itself ==")
if reuse_key:
    info = key_info("cap-reuse")
    st, _ = api(f"/api/keys/{info['id']}",
                {"id": info["id"], "name": "cap-reuse-2", "userGroup": CAP_TIER, "balance": 1000},
                method="PUT")
    check(st == 200, f"re-saving a key on a full tier succeeds (got {st})")

print("\n== occupancy is reported ==")
k = key_info("cap-reuse-2") or key_info("cap-reuse")
check(k is not None and k.get("groupMaxKeys") == CAP_MAX,
      f"key reports groupMaxKeys == {CAP_MAX} (got {k.get('groupMaxKeys') if k else None})")
check(k is not None and k.get("groupUsed") is not None,
      f"key reports groupUsed (got {k.get('groupUsed') if k else None})")

print(f"\n== promotion by consumption window: {LOW} (0..N) -> {HIGH} (N..) ==")
# HIGH's min is the threshold a key must cross in lifetime charge.
THRESHOLD = 5
st = upsert_tier(LOW, "Low E2E", 0.5, 0, True, 0, THRESHOLD, 0)
check(st in (200, 201), f"upsert low tier (got {st})")
st = upsert_tier(HIGH, "High E2E", 4.0, 0, True, THRESHOLD, 0, 0)
check(st in (200, 201), f"upsert high tier (got {st})")

st, body = api("/api/user-groups")
gs = {g["symbol"]: g for g in json.loads(body).get("groups", [])}
check(gs[LOW]["min"] == 0 and gs[LOW]["max"] == THRESHOLD,
      f"low window is [0,{THRESHOLD}) (got min={gs[LOW]['min']} max={gs[LOW]['max']})")
check(gs[HIGH]["min"] == THRESHOLD, f"high window starts at {THRESHOLD} (got {gs[HIGH]['min']})")

st, body = api("/api/keys", {"name": "promo-key", "userGroup": LOW, "balance": 1000000})
promo_key = json.loads(body).get("key") if st == 201 else None
check(st == 201, f"key on the low tier (got {st})")

if promo_key:
    before = key_info("promo-key")
    check(before["userGroup"] == LOW, f"starts on {LOW} (got {before['userGroup']!r})")
    seen = [before["userGroup"]]
    for _ in range(10):
        chat(promo_key)
        time.sleep(0.05)
        cur = key_info("promo-key")
        if not seen or seen[-1] != cur["userGroup"]:
            seen.append(cur["userGroup"])
    after = key_info("promo-key")
    print(f"   tier path: {seen}")
    print(f"   lifetimeCharge={after.get('lifetimeCharge')} tier={after['userGroup']!r}")
    check(HIGH in seen, f"key crossed into {HIGH} (path={seen})")
    check(after["userGroup"] == HIGH, f"settles on {HIGH} (got {after['userGroup']!r})")
else:
    failures.append("could not create promo key")
    check(False, "promo key created")

print("\n== cleanup ==")
for nm in ("cap-0", "cap-1", "cap-reuse", "cap-reuse-2", "cap-overflow", "promo-key"):
    k = key_info(nm)
    if k:
        api(f"/api/keys/{k['id']}", method="DELETE")
for s in (CAP_TIER, LOW, HIGH):
    api("/api/user-groups", {"symbol": s}, method="DELETE")
st, body = api("/api/user-groups")
left = [g["symbol"] for g in json.loads(body).get("groups", [])]
check(CAP_TIER not in left and LOW not in left and HIGH not in left, f"tiers cleaned (left={left})")

print("\n" + "=" * 46)
if failures:
    print("FAILURES:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ALL MIN/MAX + PROMOTION CHECKS PASSED")
