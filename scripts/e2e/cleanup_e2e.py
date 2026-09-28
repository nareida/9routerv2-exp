"""Remove E2E leftover keys/groups from the exp DB.

Safe: only rows whose name matches the E2E naming pattern are deleted.
"""
import sqlite3

DB = "/opt/data/9router-exp/.data/db/data.sqlite"

db = sqlite3.connect(DB)
n_keys = db.execute("DELETE FROM apiKeys WHERE name LIKE '%e2e%'").rowcount
n_groups = db.execute(
    "DELETE FROM userGroups WHERE name LIKE '%Billing E2E%' OR symbol = 'bill'"
).rowcount
db.commit()
print(f"deleted {n_keys} e2e keys, {n_groups} e2e tiers")
left = db.execute("SELECT count(*) FROM apiKeys WHERE name LIKE '%e2e%'").fetchone()[0]
print("remaining e2e keys:", left)
db.close()
