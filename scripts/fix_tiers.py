"""One-off: fix orphaned key and give the two tiers distinct values.

- key "Tes" points at a deleted tier ("free") — move it to "usr".
- usr / tok are currently identical (ratio 1, no rate cap), which makes the
  tier system a no-op. Give them meaning:
    usr → everyday personal use: normal price, modest rate cap
    tok → production/high-throughput: same price, high rate cap

Only touches the exp DB.
"""
import json
import sqlite3
import urllib.request
import http.cookiejar

BASE = "http://localhost:3003"
DB = "/opt/data/9router-exp/.data/db/data.sqlite"

TIER_VALUES = {
    # symbol: (ratio, apiRate)
    "usr": (1.0, 60),
    "tok": (1.0, 600),
}

jar = http.cookiejar.CookieJar()
o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
r = urllib.request.Request(BASE + "/api/auth/login",
                           data=json.dumps({"password": "123456"}).encode(), method="POST")
r.add_header("Content-Type", "application/json")
o.open(r, timeout=20)


def api(path, payload=None, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data,
                                 method=method or ("POST" if data else "GET"))
    if data:
        req.add_header("Content-Type", "application/json")
    with o.open(req, timeout=30) as resp:
        return resp.status, resp.read().decode()


db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

print("== tiers ==")
with o.open(BASE + "/api/user-groups", timeout=20) as f:
    groups = json.load(f)
for g in groups.get("groups", []):
    sym = g["symbol"]
    if sym in TIER_VALUES:
        ratio, rate = TIER_VALUES[sym]
        if g["ratio"] != ratio or g["apiRate"] != rate:
            st, _ = api("/api/user-groups", {**g, "ratio": ratio, "apiRate": rate}, method="PUT")
            print(f"  {sym}: ratio {g['ratio']}->{ratio}, apiRate {g['apiRate']}->{rate} ({st})")
        else:
            print(f"  {sym}: already correct")

print("\n== orphaned keys ==")
orphans = set(groups.get("orphanedGroups", []))
if orphans:
    default = "usr" if "usr" in {g["symbol"] for g in groups.get("groups", [])} else None
    for row in db.execute("SELECT id, name, userGroup FROM apiKeys").fetchall():
        if row["userGroup"] in orphans:
            if default:
                db.execute("UPDATE apiKeys SET userGroup = ? WHERE id = ?", (default, row["id"]))
                print(f"  {row['name']!r}: {row['userGroup']!r} -> {default!r}")
            else:
                db.execute("UPDATE apiKeys SET userGroup = NULL WHERE id = ?", (row["id"],))
                print(f"  {row['name']!r}: {row['userGroup']!r} -> None (no tier)")
db.commit()

print("\n== final state ==")
for g in groups.get("groups", []):
    pass
with o.open(BASE + "/api/user-groups", timeout=20) as f:
    final = json.load(f)
for g in final.get("groups", []):
    print(f"  {g['symbol']:8} ratio={g['ratio']} apiRate={g['apiRate']} enabled={g['enable']}")
print("  orphaned:", final.get("orphanedGroups"))
for row in db.execute("SELECT name, userGroup, balance, unlimited FROM apiKeys").fetchall():
    print(f"  key {row['name']!r}: tier={row['userGroup']!r} balance={row['balance']} unlimited={row['unlimited']}")
db.close()
