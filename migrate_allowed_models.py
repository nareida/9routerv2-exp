#!/usr/bin/env python3
"""Add apiKeys.allowedModels to the experimental DB and backfill existing keys.

Existing keys get ["*"] (unrestricted), which is exactly how they behaved
before the column existed — no key changes behaviour on upgrade.
"""
import sqlite3, sys, json

DB = "/opt/data/9router-exp/.data/db/data.sqlite"

con = sqlite3.connect(DB)
cur = con.cursor()

cols = {r[1] for r in cur.execute("PRAGMA table_info(apiKeys)")}
if "allowedModels" not in cols:
    cur.execute("""CREATE TABLE apiKeys_new (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT,
        machineId TEXT,
        isActive INTEGER DEFAULT 1,
        balance REAL DEFAULT 0,
        userGroup TEXT,
        unlimited INTEGER DEFAULT 0,
        lifetimeCharge REAL DEFAULT 0,
        allowedModels TEXT DEFAULT '["*"]',
        createdAt TEXT NOT NULL
    )""")
    cur.execute("""INSERT INTO apiKeys_new
        (id, key, name, machineId, isActive, balance, userGroup, unlimited, lifetimeCharge, createdAt)
        SELECT id, key, name, machineId, isActive, balance, userGroup, unlimited,
               COALESCE(lifetimeCharge, 0), createdAt
        FROM apiKeys""")
    cur.execute("DROP TABLE apiKeys")
    cur.execute("ALTER TABLE apiKeys_new RENAME TO apiKeys")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_apiKeys_key ON apiKeys(key)")
    print("added apiKeys.allowedModels")
else:
    print("allowedModels already present")

con.commit()

rows = cur.execute("SELECT id, name, allowedModels FROM apiKeys").fetchall()
print(f"\n{len(rows)} keys:")
for kid, name, am in rows:
    print(f"  {str(name)[:20]:20} allowedModels={am}")
con.close()
