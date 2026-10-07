import sqlite3, json
db = sqlite3.connect("/opt/data/9router-exp/.data/db/data.sqlite")
db.row_factory = sqlite3.Row

print("=== apiKeys rows ===")
for r in db.execute("SELECT id, name, substr(key,1,12) k, userGroup, length(key) len FROM apiKeys"):
    print(f"  id={r['id']} name={r['name']!r} key_prefix={r['k']!r} len={r['len']} group={r['userGroup']!r}")

print("\n=== usageHistory apiKey samples ===")
for r in db.execute("SELECT DISTINCT apiKey, length(apiKey) len, count(*) n FROM usageHistory GROUP BY apiKey LIMIT 10"):
    print(f"  apiKey={str(r['apiKey'])[:20]!r} len={r['len']} n={r['n']}")

print("\n=== direct join test ===")
row = db.execute(
    """SELECT u.id, u.apiKey, k.userGroup
         FROM usageHistory u LEFT JOIN apiKeys k ON k.key = u.apiKey
        WHERE u.userGroup IS NULL LIMIT 5"""
).fetchall()
for r in row:
    print(f"  u.id={r['id']} u.apiKey={str(r['apiKey'])[:24]!r} -> group={r['userGroup']!r}")
