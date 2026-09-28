"""E2E: post-request billing. Proves the key's balance actually decreases
after a successful chat, and that unlimited keys are exempt.

Runs against the live exp instance (port 3003) only.
"""
import json
import sqlite3
import time
import urllib.request
import urllib.error
import http.cookiejar

BASE = "http://localhost:3003"
PASSWORD = "123456"
DB = "/opt/data/9router-exp/.data/db/data.sqlite"

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


def balance_of(key):
    db = sqlite3.connect(DB)
    row = db.execute("SELECT balance, userGroup, unlimited FROM apiKeys WHERE key = ?", (key,)).fetchone()
    db.close()
    return row


def set_key(key, balance=None, group=None, unlimited=None):
    sets, args = [], []
    if balance is not None:
        sets.append("balance = ?"); args.append(balance)
    if group is not None:
        sets.append("userGroup = ?"); args.append(group)
    if unlimited is not None:
        sets.append("unlimited = ?"); args.append(1 if unlimited else 0)
    args.append(key)
    db = sqlite3.connect(DB)
    db.execute(f"UPDATE apiKeys SET {', '.join(sets)} WHERE key = ?", args)
    db.commit(); db.close()


def chat(model, key, content, timeout=150):
    # Default is now non-streaming for JSON-only providers, which is the case
    # that triggers billing.
    req = urllib.request.Request(
        BASE + "/v1/chat/completions",
        data=json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 25,
        }).encode(), method="POST")
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
print("  ", api("/api/auth/login", {"password": PASSWORD})[0])

print("\n== make sure a tier exists ==")
st, body = api("/api/user-groups")
syms = [g["symbol"] for g in json.loads(body).get("groups", [])]
if "bill" not in syms:
    st, body = api("/api/user-groups", {
        "symbol": "bill", "name": "Billing Test", "ratio": 1, "apiRate": 0,
        "public": True, "promotion": False, "min": 0, "max": 0, "enable": True,
    })
    print("   created bill tier:", st)

print("\n== create key ==")
st, body = api("/api/keys", {"name": "billing-e2e"})
key = json.loads(body).get("key")
print("   key:", st, key[:7] + "***")
if not key:
    raise SystemExit("no key")

print("\n== 1. finite balance, tier ratio 1 ==")
set_key(key, balance=100000, group="bill", unlimited=False)
before = balance_of(key)
print("   before:", before)
st, body = chat("my9model-fast", key, "Reply: billing test one")
print("   chat:", st)
time.sleep(2.5)
after = balance_of(key)
print("   after: ", after)
charged = round(before[0] - after[0], 2)
print(f"   charged: {charged}")
if st == 200 and charged > 0:
    print("   PASS: balance decreased")
else:
    print("   FAIL: expected 200 + positive charge")

print("\n== 2. second request charges again ==")
b2 = balance_of(key)[0]
st, _ = chat("my9model-fast", key, "Reply: billing test two")
time.sleep(2.5)
a2 = balance_of(key)[0]
print(f"   chat={st} delta={round(b2 - a2, 2)}")

print("\n== 3. unlimited key is NOT charged ==")
set_key(key, balance=0, unlimited=True)
bu = balance_of(key)[0]
st, _ = chat("my9model-fast", key, "Reply: unlimited should not charge")
time.sleep(2.5)
au = balance_of(key)[0]
print(f"   chat={st} before={bu} after={au} (expect equal)")

print("\n== 4. balance drains to 0 then blocks ==")
set_key(key, balance=1, unlimited=False)
st, _ = chat("my9model-fast", key, "Reply: last credit")
time.sleep(2.5)
print("   after small charge:", balance_of(key)[0])
st, body = chat("my9model-fast", key, "Reply: should be blocked now")
print("   next request:", st, "(expect 429)")
print("   body:", body[:160])

print("\n== cleanup ==")
set_key(key, balance=100000, unlimited=False)
api("/api/user-groups?symbol=bill", method="DELETE")
print("   done")
