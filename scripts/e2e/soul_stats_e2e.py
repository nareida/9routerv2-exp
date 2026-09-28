"""E2E: after one chat, /api/soul/stats must return non-zero counts
and usageHistory rows must contain soul_meta.
"""
import json, sys, time, urllib.request, urllib.error, http.cookiejar, sqlite3

BASE = "http://localhost:3003"
DB = "/opt/data/9router-exp/.data/db/data.sqlite"
PASSWORD = "123456"
MODEL = "my9model-fast"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def api(path, payload=None, method=None, timeout=60):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method or ("POST" if data else "GET"))
    if data: req.add_header("Content-Type", "application/json")
    try:
        with opener.open(req, timeout=timeout) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()

print("== login ==")
print("  ", api("/api/auth/login", {"password": PASSWORD})[0])

print("\n== make sure tier exists ==")
st, body = api("/api/user-groups")
syms = [g["symbol"] for g in json.loads(body).get("groups", [])]
if "soul-e2e" not in syms:
    api("/api/user-groups", {"symbol": "soul-e2e", "name": "Soul E2E", "ratio": 1, "allowIp": False, "channels": [], "models": ["*"]})
    print("  created tier")

print("\n== create key ==")
st, body = api("/api/keys", {"name": "soul-stats-e2e"})
key = json.loads(body).get("key")
db = sqlite3.connect(DB)
db.execute("UPDATE apiKeys SET balance = 100000, userGroup = 'soul-e2e', unlimited = 0 WHERE key = ?", (key,))
db.commit(); db.close()
print("  key:", st)

print("\n== run ONE chat (non-stream) ==")
req = urllib.request.Request(
    BASE + "/v1/chat/completions",
    data=json.dumps({"model": MODEL, "messages": [{"role": "user", "content": "Reply: soul stats test"}], "max_tokens": 10}).encode(),
    method="POST")
req.add_header("Content-Type", "application/json")
req.add_header("Authorization", "Bearer " + key)
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        print("  status:", r.status)
except urllib.error.HTTPError as e:
    print("  status:", e.code, e.read().decode()[:200])
    sys.exit(1)

time.sleep(3)

print("\n== usageHistory meta check ==")
db = sqlite3.connect(DB)
rows = db.execute("SELECT id, meta FROM usageHistory WHERE apiKey = ? ORDER BY id DESC LIMIT 3", (key,)).fetchall()
db.close()
print("  rows with this key:", len(rows))
soul_rows = 0
for rid, raw in rows:
    try:
        m = json.loads(raw) if raw else {}
    except Exception:
        m = {}
    if isinstance(m, dict) and "soul_ok" in m:
        soul_rows += 1
        print("  id", rid, "soul_ok=", m.get("soul_ok"), "canary=", m.get("soul_canary"))
print("  total with soul_meta:", soul_rows)

print("\n== /api/soul/stats ==")
with opener.open(BASE + "/api/soul/stats", timeout=20) as r:
    stats = json.loads(r.read().decode())
print("  ", json.dumps(stats, indent=2))

ok = stats.get("scanned", 0) > 0 and soul_rows > 0
print("\n" + "=" * 46)
if not ok:
    print("FAIL: stats.scanned=", stats.get("scanned"), "soul_rows=", soul_rows)
    sys.exit(1)
print("PASS: soul stats persisted + API nonzero")
