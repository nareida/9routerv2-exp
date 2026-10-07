import json
import subprocess
import sys
import time

BASE = "http://localhost:3003"
COOKIE = "/opt/data/cache/scratch/9r_exp_ck.txt"


def curl(args, timeout=90, cookie=True):
    cmd = ["curl", "-s", "-m", str(timeout)]
    if cookie:
        cmd += ["-b", COOKIE, "-c", COOKIE]
    cmd += list(args)
    return subprocess.run(cmd, capture_output=True, text=True).stdout


def jload(raw):
    try:
        return json.loads(raw)
    except Exception:
        return {}


# 0. fresh cookie jar
subprocess.run(["rm", "-f", COOKIE], capture_output=True)

# 1. dashboard login (default password)
for pw in ("123456", "admin"):
    r = curl(["-X", "POST", f"{BASE}/api/auth/login",
              "-H", "Content-Type: application/json",
              "-d", json.dumps({"password": pw})], timeout=20)
    print(f"login({pw}):", r[:200])
    if jload(r).get("success"):
        break
else:
    print("LOGIN_FAILED")
    sys.exit(1)

# 2. mint API key through the authenticated dashboard session
r = curl(["-X", "POST", f"{BASE}/api/keys",
          "-H", "Content-Type: application/json",
          "-d", '{"name":"soul-e2e"}'], timeout=20)
print("create key:", r[:200])
key = jload(r).get("key", "")
if not key:
    print("NO_KEY — stopping")
    sys.exit(1)
print("key length:", len(key))

# 3. chat request carrying a soul system message
body = json.dumps({
    "model": "auto",
    "messages": [
        {"role": "system", "content": "You are Nareida, Boss's assistant."},
        {"role": "user", "content": "Say exactly: Nareida online."},
    ],
    "stream": False,
})
out = curl(["-X", "POST", f"{BASE}/v1/chat/completions",
            "-H", "Content-Type: application/json",
            "-H", f"Authorization: Bearer {key}",
            "-d", body], timeout=150, cookie=False)
print("chat:", out[:700])

time.sleep(2)
print("soul stats:", curl([f"{BASE}/api/soul/stats"], timeout=20, cookie=False))
