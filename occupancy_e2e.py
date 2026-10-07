"""Verify keyCount on GET /api/user-groups, which is what the UI renders as "1/3 keys".

The occupancy shown next to maxKeys has to come from a live count, otherwise
the cap looks enforced while the page says the tier is empty.
"""
import json
import time
import urllib.request
import urllib.error
import http.cookiejar

BASE = "http://localhost:3003"
TIER = "occ-e2e"
CAP = 3

jar = http.cookiejar.CookieJar()
o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

failures = []


def check(cond, label):
    print(f"  {'ok  ' if cond else 'FAIL'} {label}")
    if not cond:
        failures.append(label)


def api(path, payload=None, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method or ("POST" if data else "GET"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with o.open(r, timeout=30) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


print("== login ==")
st, _ = api("/api/auth/login", {"password": "123456"})
check(st == 200, f"login (got {st})")

# Guard: this script creates and rewrites tiers; a typo in a symbol would
# clobber live config, so refuse anything that is not a test tier.
if not TIER.endswith("-e2e"):
    raise SystemExit(f"refusing to touch non-test tier: {TIER!r}")

print(f"\n== set up tier {TIER} with maxKeys={CAP} ==")
payload = {
    "symbol": TIER, "name": "Occupancy E2E", "ratio": 1, "apiRate": 0,
    "public": False, "promotion": False, "min": 0, "max": 0, "maxKeys": CAP,
    "allowIp": False, "channels": [], "models": ["*"],
}
st, _ = api("/api/user-groups", payload)
check(st in (200, 201, 409), f"upsert tier (got {st})")

print("\n== keyCount is 0 on an empty tier ==")
st, body = api("/api/user-groups")
g = next((x for x in json.loads(body)["groups"] if x["symbol"] == TIER), None)
check(g is not None, "tier present")
check(g.get("keyCount") == 0, f"empty tier reports keyCount 0 (got {g.get('keyCount')})")
check(g.get("maxKeys") == CAP, f"maxKeys round-trips as {CAP} (got {g.get('maxKeys')})")

print("\n== keyCount tracks created keys ==")
made = []
for i in range(2):
    st, body = api("/api/keys", {"name": f"occ-{i}", "userGroup": TIER, "balance": 1000})
    if st == 201:
        made.append(json.loads(body)["id"])
    time.sleep(0.1)

st, body = api("/api/user-groups")
g = next((x for x in json.loads(body)["groups"] if x["symbol"] == TIER), None)
check(g.get("keyCount") == 2, f"2 keys created -> keyCount 2 (got {g.get('keyCount')})")

print("\n== keyCount reaches the cap and the card says PENUH ==")
st, body = api("/api/keys", {"name": "occ-2", "userGroup": TIER, "balance": 1000})
if st == 201:
    made.append(json.loads(body)["id"])
check(st == 201, f"third key fills the tier (got {st})")

st, body = api("/api/user-groups")
g = next((x for x in json.loads(body)["groups"] if x["symbol"] == TIER), None)
check(g.get("keyCount") == 3, f"full tier reports keyCount 3 (got {g.get('keyCount')})")
print(f"   UI will render: keys {g.get('keyCount')}/{g.get('maxKeys')} (penuh)")

print("\n== a deleted key frees the count ==")
if made:
    st, _ = api(f"/api/keys/{made[-1]}", method="DELETE")
    check(st == 200, f"delete key (got {st})")
    st, body = api("/api/user-groups")
    g = next((x for x in json.loads(body)["groups"] if x["symbol"] == TIER), None)
    check(g.get("keyCount") == 2, f"after delete keyCount back to 2 (got {g.get('keyCount')})")

print("\n== cleanup ==")
for kid in made:
    api(f"/api/keys/{kid}", method="DELETE")
st, _ = api("/api/user-groups", {"symbol": TIER}, method="DELETE")
st, body = api("/api/user-groups")
left = [x["symbol"] for x in json.loads(body).get("groups", [])]
check(TIER not in left, f"tier removed (left={left})")

print("\n" + "=" * 46)
if failures:
    print("FAILURES:")
    for f in failures:
        print("  -", f)
else:
    print("ALL OCCUPANCY CHECKS PASSED")
raise SystemExit(1 if failures else 0)
