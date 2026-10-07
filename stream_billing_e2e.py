"""E2E for the streaming billing path.

The default (no `stream` flag) now bills correctly. This checks the other half:
an explicit `stream:true` request through the SSE path must also reduce the
key's balance, and must return real SSE frames to the client.

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
PASSWORD = "123456"
DB = "/opt/data/9router-exp/.data/db/data.sqlite"
MODEL = "my9model-fast"

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


def set_balance(key, value):
    db = sqlite3.connect(DB)
    db.execute("UPDATE apiKeys SET balance = ? WHERE key = ?", (value, key))
    db.commit()
    db.close()


def chat_stream(key, content, timeout=150):
    """POST with stream:true; return (status, content_type, n_sse_frames)."""
    req = urllib.request.Request(
        BASE + "/v1/chat/completions",
        data=json.dumps({
            "model": MODEL,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 25,
            "stream": True,
        }).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("Accept", "text/event-stream")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode(errors="replace")
            ctype = r.headers.get("content-type", "")
            frames = [ln for ln in raw.split("\n") if ln.startswith("data:")]
            return r.status, ctype, len(frames)
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", ""), 0
    except Exception as e:
        return 0, "", 0


failures = []

print("== login ==")
print("  ", api("/api/auth/login", {"password": PASSWORD})[0])

print("\n== make sure a tier exists ==")
st, body = api("/api/user-groups")
syms = [g["symbol"] for g in json.loads(body).get("groups", [])]
if "bill" not in syms:
    st, body = api("/api/user-groups", {
        "symbol": "bill", "name": "Billing E2E", "ratio": 1,
        "allowIp": False, "channels": [], "models": ["*"],
    })
    print(f"   created: {st}")

print("\n== create key ==")
st, body = api("/api/keys", {"name": "stream-e2e"})
key = json.loads(body).get("key")
if not key:
    print(f"   FAIL: cannot create key ({st})")
    print("   body:", body[:300])
    sys.exit(1)
# /api/keys ignores balance/userGroup on create; set them directly like
# billing_e2e.py does.
db = sqlite3.connect(DB)
db.execute("UPDATE apiKeys SET balance = ?, userGroup = ?, unlimited = 0 WHERE key = ?",
           (100000, "bill", key))
db.commit()
db.close()
print(f"   key: {st}")

print("\n== 1. stream:true must bill ==")
before = balance_of(key)
st, ctype, frames = chat_stream(key, "hi")
print(f"   before: {before}")
print(f"   stream: {st} ctype={ctype.split(';')[0]} frames={frames}")
if st != 200:
    print("   FAIL: expected 200")
    failures.append("stream request status " + str(st))
elif "text/event-stream" not in ctype:
    print("   FAIL: expected text/event-stream")
    failures.append("content-type not SSE")
elif frames == 0:
    print("   FAIL: zero SSE frames")
    failures.append("no SSE frames")

time.sleep(3)
after = balance_of(key)
print(f"   after:  {after}")
if before and after and after[0] < before[0]:
    print(f"   PASS: balance decreased by {before[0] - after[0]}")
else:
    print("   FAIL: balance did not decrease")
    failures.append("stream path did not bill")

print("\n== 2. second stream request bills again ==")
b2 = balance_of(key)
st, ctype, frames = chat_stream(key, "hi again")
time.sleep(3)
a2 = balance_of(key)
delta = (b2[0] - a2[0]) if (b2 and a2) else 0
print(f"   chat={st} frames={frames} delta={delta}")
if delta <= 0:
    print("   FAIL: second stream request did not bill")
    failures.append("second stream did not bill")

print("\n== 3. drain to 0 then stream request blocks ==")
set_balance(key, 1)
for _ in range(12):
    st, ctype, frames = chat_stream(key, "x", timeout=90)
    if st == 429:
        break
    time.sleep(0.4)
print(f"   final: {st}")
if st == 429:
    print("   PASS: 429 after balance drained")
else:
    print("   FAIL: expected 429")
    failures.append("no 429 when drained")

print("\n== cleanup ==")
print("   done (key left in place for inspection)")

print("\n" + "=" * 46)
if failures:
    print("FAILURES:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ALL STREAM BILLING CHECKS PASSED")
