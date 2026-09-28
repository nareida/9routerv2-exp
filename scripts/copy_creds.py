"""Copy provider connections/nodes from the v2 DB into the exp DB.

Read-only on the source. The running v2 server is never touched.
"""
import sqlite3
import sys

SRC = "/opt/data/home/.9router-v2/db/data.sqlite"
DST = "/opt/data/9router-exp/.data/db/data.sqlite"

TABLES = ["providerConnections", "providerNodes", "combos", "proxyPools", "settings"]


def main():
    src = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)
    dst = sqlite3.connect(DST)

    for table in TABLES:
        try:
            srows = src.execute(f"SELECT * FROM {table}").fetchall()
        except sqlite3.Error as e:
            print(f"{table}: read error {e}")
            continue
        if not srows:
            print(f"{table}: source empty")
            continue

        dcols = [r[1] for r in dst.execute(f"PRAGMA table_info({table})")]
        if not dcols:
            print(f"{table}: dest table missing")
            continue

        scol_names = [r[1] for r in src.execute(f"PRAGMA table_info({table})")]
        common = [c for c in dcols if c in scol_names]
        sidx = [scol_names.index(c) for c in common]

        existing = dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        if existing:
            print(f"{table}: dest already has {existing} rows, skipping")
            continue

        placeholders = ",".join("?" * len(common))
        cols = ",".join(common)
        rows = [tuple(r[i] for i in sidx) for r in srows]
        dst.executemany(f"INSERT INTO {table} ({cols}) VALUES ({placeholders})", rows)
        print(f"{table}: copied {len(rows)} rows")

    dst.commit()
    dst.close()
    src.close()
    print("done")


if __name__ == "__main__":
    main()
