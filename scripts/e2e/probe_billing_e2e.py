"""Prove model tests are outside quota while real requests are not.

Before this change the dashboard's "test model" button sent a real API key, so
every row reported 429/402 whenever that key's balance was low — the credit
looked broken, not the model. A health probe must not consume credit, and must
not be blocked by a depleted balance, while ordinary traffic keeps both.

Run with the exp server on 3003.
"""
import json
import sqlite3
import time
import urllib.error
import urllib.request
import http.cookiejar

BASE = "http://localhost:3003"
DB = "/opt/data/9router-exp/.data/db/data.sqlite"
PASSWORD = "123456"
# clouvia answers in well under a second; dahono sometimes exceeds the 15s
# ping timeout, which would look like a failure that has nothing to do with
# quota.
MODEL = "clouvia/gemini-3.8-flash-high"

jar = http.cookiejar.CookieJar()
o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

failures = []


def check(cond, label):
    print(f"  {'ok  ' if cond else 'FAIL'} {label}")
    if not cond:
        failures.append(label)


def api(path, payload=None, method=None, timeout=120):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(
        f"{BASE}{path}", data=data, method=method or ("POST" if data else "GET")
    )
    r.add_header("Content-Type", "application/json")
    try:
        with o.open(r, timeout=timeout) as x:
            return x.status, x.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def snap(key_id):
    db = sqlite3.connect(DB)
    row = db.execute(
        "SELECT balance, lifetimeCharge FROM apiKeys WHERE id=?", (key_id,)
    ).fetchone()
    db.close()
    return row


def chat(raw_key, model=MODEL, timeout=120):
    """A normal user request: real key, no CLI token, so it is billable."""
    body = json.dumps({
        "model": model, "max_tokens": 1, "stream": False,
        "messages": [{"role": "user", "content": "hi"}],
    }).encode()
    r = urllib.request.Request(f"{BASE}/api/v1/chat/completions", data=body, method="POST")
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", f"Bearer {raw_key}")
    try:
        with o.open(r, timeout=timeout) as x:
            return x.status, x.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


print("== login ==")
st, _ = api("/api/auth/login", {"password": PASSWORD})
check(st == 200, f"login (got {st})")

keys = {k["name"]: k for k in json.loads(api("/api/keys")[1])["keys"]}
target = keys.get("Tes")
check(target is not None, "key 'Tes' exists")
if not target:
    raise SystemExit(1)
kid = target["id"]
# GET /api/keys returns a MASKED key. A masked key passes auth but cannot be
# resolved for charging, so a billed-request check has to use the real value.
_db = sqlite3.connect(DB)
raw_key = _db.execute("SELECT key FROM apiKeys WHERE id=?", (kid,)).fetchone()[0]
_db.close()
assert raw_key and not raw_key.endswith("..."), "need the unmasked key"

print("\n== a model test does not spend credit ==")
api(f"/api/keys/{kid}", {"id": kid, "balance": 500000}, method="PUT")
b0, l0 = snap(kid)
st, body = api("/api/models/test", {"model": MODEL})
d = json.loads(body)
b1, l1 = snap(kid)
print(f"   test -> ok={d.get('ok')}  balance {b0} -> {b1}")
check(b0 == b1, f"balance unchanged by a model test ({b0} -> {b1})")
check(l0 == l1, f"lifetimeCharge unchanged by a model test ({l0} -> {l1})")

print("\n== a model test is not blocked by an empty balance ==")
api(f"/api/keys/{kid}", {"id": kid, "balance": 0}, method="PUT")
b0, _ = snap(kid)
st, body = api("/api/models/test", {"model": MODEL})
d = json.loads(body)
err = str(d.get("error") or "")
b1, l1 = snap(kid)
print(f"   test on a zero-balance key -> ok={d.get('ok')}  {err[:80]}")
check(d.get("ok") is True, "test succeeded despite a zero balance")
check("insufficient_quota" not in err, "no quota error leaked into the result")
check(b0 == b1 == 0, f"balance stayed at 0 ({b0} -> {b1})")

print("\n== real user traffic is still billed ==")
api(f"/api/keys/{kid}", {"id": kid, "balance": 500000}, method="PUT")
b0, l0 = snap(kid)
st, body = chat(raw_key)
# chargeRequest is fire-and-forget: it is not awaited by the response path, so
# the deduction lands shortly AFTER the client already has its 200.
b1, l1 = b0, l0
for _ in range(40):
    time.sleep(0.25)
    b1, l1 = snap(kid)
    if l1 > l0:
        break
print(f"   chat -> HTTP {st}  balance {b0} -> {b1}  lifetime {l0} -> {l1}")
check(st == 200, f"real request accepted (got {st})")
check(l1 > l0, f"lifetimeCharge increased ({l0} -> {l1})")
check(b1 < b0, f"balance decreased ({b0} -> {b1})")

print("\n== real user traffic is still blocked when empty ==")
api(f"/api/keys/{kid}", {"id": kid, "balance": 0}, method="PUT")
st, body = chat(raw_key)
b0, _ = snap(kid)
print(f"   chat -> HTTP {st}  {body[:110]}")
check(st == 429, f"depleted key rejected with 429 (got {st})")
check(b0 == 0, "no charge recorded for a rejected request")

print("\n== restore ==")
api(f"/api/keys/{kid}", {"id": kid, "balance": 1000000}, method="PUT")
print(f"   'Tes' balance restored to {snap(kid)[0]}")

print("\n" + "=" * 46)
if failures:
    print("FAILURES:")
    for f in failures:
        print("  -", f)
else:
    print("ALL PROBE-ISOLATION CHECKS PASSED")
raise SystemExit(1 if failures else 0)
