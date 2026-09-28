"""Add usageHistory.keyId and backfill where possible.

Backfill only works for rows that still have a joinable key. Stored apiKey
values are masked, so most historical rows cannot be matched and are left NULL
rather than guessed.

Safe to re-run.
"""
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "/opt/data/9router-exp/.data/db/data.sqlite"

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

cols = {r["name"] for r in db.execute("PRAGMA table_info(usageHistory)")}
if "keyId" not in cols:
    db.execute("ALTER TABLE usageHistory ADD COLUMN keyId TEXT")
    print("added column keyId")
else:
    print("column keyId already present")

db.execute("CREATE INDEX IF NOT EXISTS idx_uh_key ON usageHistory(keyId)")

cur = db.execute(
    """UPDATE usageHistory
          SET keyId = (SELECT k.id FROM apiKeys k WHERE k.key = usageHistory.apiKey)
        WHERE keyId IS NULL
          AND apiKey IS NOT NULL
          AND apiKey NOT LIKE '%...%'
          AND EXISTS (SELECT 1 FROM apiKeys k WHERE k.key = usageHistory.apiKey)"""
)
print("backfilled:", cur.rowcount)
db.commit()

print("\ncoverage:")
for r in db.execute(
    """SELECT
         CASE WHEN keyId IS NOT NULL THEN 'keyId set'
              WHEN apiKey LIKE '%...%'  THEN 'masked key (unjoinable)'
              ELSE 'no key recorded' END AS state,
         count(*) n
       FROM usageHistory GROUP BY state ORDER BY n DESC"""
):
    print(f"  {r['state']:28} n={r['n']}")

# Ambiguous masked keys: more than one apiKey shares the same masked shape.
print("\nkeyId uniqueness check (a key id must never map to >1 key row):")
dupes = db.execute("SELECT keyId, count(DISTINCT key) c FROM apiKeys GROUP BY keyId HAVING c > 1").fetchall()
print("  duplicates:", len(dupes))
db.close()
