"""E2E: per-tier and per-key usage aggregation.

Proves a fresh request is attributed to the caller's tier, that the new
columns exist, and that the endpoint returns sane totals.

Runs against the live exp instance (port 3003) only.
"""
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import http.cookiejar

BASE = "http://localhost:3003"
DB = "/opt/data/9router-exp/.data/db/data.sqlite"
PASSWORD = "123456"
MODEL = "my9model-fast"
TIER = "agg-e2e"

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


def chat(key, content, timeout=150):
    req = urllib.request.Request(
        BASE + "/v1/chat/completions",
        data=json.dumps({
            "model": MODEL,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 20,
        }).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


failures = []
print("== login ==")
print("  ", api("/api/auth/login", {"password": PASSWORD})[0])

print("\n== tier exists? ==")
st, body = api("/api/user-groups")
syms = [g["symbol"] for g in json.loads(body).get("groups", [])]
if TIER not in syms:
    api("/api/user-groups", {"symbol": TIER, "name": "Agg E2E", "ratio": 1,
                             "allowIp": False, "channels": [], "models": ["*"]})
    print("  created")

print("\n== create key on that tier ==")
st, body = api("/api/keys", {"name": "agg-e2e"})
key = json.loads(body).get("key")
db = sqlite3.connect(DB)
db.execute("UPDATE apiKeys SET balance=500000, userGroup=?, unlimited=0 WHERE key=?", (TIER, key))
db.commit(); db.close()
print("  key:", st)

print("\n== two requests ==")
for i in range(2):
    print(f"  chat {i+1}: {chat(key, f'Reply: agg test {i}')}")
time.sleep(3)

print("\n== usageHistory.userGroup written? ==")
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
rows = db.execute(
    "SELECT id, userGroup, promptTokens, completionTokens, cost, apiKey FROM usageHistory ORDER BY id DESC LIMIT 3"
).fetchall()
for r in rows:
    print(f"  id={r['id']} group={r['userGroup']!r} in={r['promptTokens']} out={r['completionTokens']} cost={r['cost']}")
tagged = db.execute("SELECT count(*) c FROM usageHistory WHERE userGroup = ?", (TIER,)).fetchone()["c"]
db.close()
print(f"  rows tagged {TIER}: {tagged}")
if tagged < 2:
    failures.append(f"expected >=2 tagged rows, got {tagged}")

print("\n== GET /api/usage/by-group ==")
st, body = api("/api/usage/by-group")
d = json.loads(body) if st == 200 else {}
if st != 200:
    print("  FAIL", st, body[:200])
    failures.append("by-group not 200")
else:
    print("  totals:", d.get("totals"))
    print("  unattributed:", d.get("unattributed"))
    for r in d.get("rows", []):
        print(f"   {r['bucket']:16} req={r['requests']:4} tok={r['totalTokens']:8} cost={r['cost']} ratio={r.get('ratio')}")

    rows = d.get("rows", [])
    # The GROUP BY must produce one row per distinct bucket. Without it SQLite
    # collapses everything into a single row and mis-attributes NULL rows.
    tier_row = next((r for r in rows if r["bucket"] == TIER), None)
    if not tier_row:
        failures.append("tier row missing")
    elif tier_row["requests"] != tagged:
        failures.append(
            f"tier request count {tier_row['requests']} != tagged rows {tagged} "
            "(missing GROUP BY, NULL rows mis-attributed)"
        )

    # Every row must sum back to the number of rows in the range.
    if sum(r["requests"] for r in rows) != d["totals"]["requests"]:
        failures.append("row requests do not sum to totals")

    # Historical rows predate the column and must surface as unattributed.
    if d["unattributed"] == 0:
        failures.append("expected pre-column rows to appear as (unattributed)")

print("\n== GET /api/usage/by-group?by=key ==")
st, body = api("/api/usage/by-group?by=key")
d = json.loads(body) if st == 200 else {}
if st != 200:
    print("  FAIL", st, body[:200])
    failures.append("by-key not 200")
else:
    for r in d.get("rows", []):
        print(f"   bucket={str(r['bucket'])[:14]:14} name={r.get('keyName')!r} "
              f"group={r.get('userGroup')!r} balance={r.get('balance')} req={r['requests']}")

    rows = d.get("rows", [])

    # One tier can own several keys, and each run of this script creates a new
    # one — so the tier's usage is the sum over all of its keys, not one bucket.
    tier_rows = [r for r in rows if r.get("userGroup") == TIER]
    tier_requests = sum(r["requests"] for r in tier_rows)
    if not tier_rows:
        failures.append("by-key: no buckets resolved to this tier")
    else:
        if tier_requests != tagged:
            failures.append(
                f"by-key: tier total {tier_requests} != tagged rows {tagged} (grouping on masked key?)"
            )
        if not all(r.get("resolved") for r in tier_rows):
            failures.append("by-key: a tier bucket did not resolve to an apiKeys row")
        if any(r.get("balance") is None for r in tier_rows):
            failures.append("by-key: tier bucket missing live balance")

    # Unresolved buckets (pre-keyId rows) must not claim a key name.
    unresolved = [r for r in rows if not r.get("resolved")]
    if unresolved and any(r.get("keyName") for r in unresolved):
        failures.append("by-key: unresolved buckets are showing a key name")

    if sum(r["requests"] for r in rows) != d["totals"]["requests"]:
        failures.append("by-key: rows do not sum to totals")

print("\n" + "=" * 46)
if failures:
    print("FAILURES:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ALL AGGREGATION CHECKS PASSED")
