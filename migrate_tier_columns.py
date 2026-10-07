"""Separate the two meanings of min/max onto distinct columns.

Before:
  userGroups.min / userGroups.max  → one column, two conflicting rules
                                    (key count in the new cap check, consumption
                                     window in the promotion math)

After:
  userGroups.min / userGroups.max  → consumption window, read against
                                    apiKeys.lifetimeCharge (0 = open ended)
  userGroups.maxKeys               → hard cap on active keys (0 = unlimited)
  apiKeys.lifetimeCharge           → running charged total per key

Safe to re-run.
"""
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "/opt/data/9router-exp/.data/db/data.sqlite"

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row


def cols(table):
    return {r["name"] for r in db.execute(f"PRAGMA table_info({table})")}


# 1. userGroups.maxKeys
ug = cols("userGroups")
if "maxKeys" not in ug:
    db.execute("ALTER TABLE userGroups ADD COLUMN maxKeys INTEGER DEFAULT 0")
    print("added userGroups.maxKeys")
else:
    print("userGroups.maxKeys already present")

# 2. apiKeys.lifetimeCharge
ak = cols("apiKeys")
if "lifetimeCharge" not in ak:
    db.execute("ALTER TABLE apiKeys ADD COLUMN lifetimeCharge REAL DEFAULT 0")
    print("added apiKeys.lifetimeCharge")
else:
    print("apiKeys.lifetimeCharge already present")

# 3. Seed lifetimeCharge from history so promotion thresholds are not
#    misleading for keys that already carry spend.
seeded = db.execute("""
    UPDATE apiKeys
       SET lifetimeCharge = COALESCE((
             SELECT SUM(cost) FROM usageHistory u
              WHERE u.keyId = apiKeys.id
           ), 0)
     WHERE lifetimeCharge = 0
""").rowcount
print(f"seeded lifetimeCharge on {seeded} key(s)")

db.commit()

print("\nfinal state:")
for r in db.execute("SELECT symbol, min, max, maxKeys, promotion FROM userGroups"):
    print(f"  {r['symbol']:10} min={r['min']} max={r['max']} maxKeys={r['maxKeys']} promotion={r['promotion']}")
for r in db.execute("SELECT name, userGroup, balance, lifetimeCharge FROM apiKeys"):
    print(f"  key {r['name']!r}: tier={r['userGroup']!r} balance={r['balance']} lifetimeCharge={r['lifetimeCharge']}")
db.close()
