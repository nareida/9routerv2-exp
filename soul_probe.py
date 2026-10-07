import sqlite3, json
db = sqlite3.connect("/opt/data/9router-exp/.data/db/data.sqlite")
for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'"):
    if "sett" in r[0].lower():
        print("table:", r[0])
        for row in db.execute(f"SELECT * FROM {r[0]}"):
            print("  ", str(row)[:400])
