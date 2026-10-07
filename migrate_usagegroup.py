"""Migrate usageHistory to carry userGroup, then backfill from apiKeys.

Two steps:
  1. ADD COLUMN userGroup (idempotent — skips if already present).
  2. Backfill: join usageHistory.apiKey -> apiKeys.key to fill userGroup.
     Rows whose key no longer exists stay NULL rather than being guessed.

Safe to re-run.
"""
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "/opt/data/9router-exp/.data/db/data.sqlite"

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

# 1. add column
cols = {r["name"] for r in db.execute("PRAGMA table_info(usageHistory)")}
if "userGroup" not in cols:
    db.execute("ALTER TABLE usageHistory ADD COLUMN userGroup TEXT")
    print("added column userGroup")
else:
    print("column userGroup already present")

# 2. index
db.execute("CREATE INDEX IF NOT EXISTS idx_uh_group ON usageHistory(userGroup)")

# 3. backfill
cur = db.execute(
    """UPDATE usageHistory
          SET userGroup = (SELECT k.userGroup FROM apiKeys k WHERE k.key = usageHistory.apiKey)
        WHERE userGroup IS NULL
          AND apiKey IS NOT NULL
          AND EXISTS (SELECT 1 FROM apiKeys k WHERE k.key = usageHistory.apiKey)"""
)
print("backfilled rows:", cur.rowcount)

db.commit()

# report
print("\nrows by userGroup:")
for r in db.execute(
    """SELECT COALESCE(userGroup,'(null)') g, count(*) n, round(sum(cost),6) cost
         FROM usageHistory GROUP BY userGroup ORDER BY n DESC"""
):
    print(f"  {r['g']:14} n={r['n']:5} cost={r['cost']}")

total = db.execute("SELECT count(*) c FROM usageHistory").fetchone()["c"]
nulls = db.execute(
    "SELECT count(*) c FROM usageHistory WHERE userGroup IS NULL"
).fetchone()["c"]
print(f"\ntotal rows: {total}, still null: {nulls}")
db.close()
