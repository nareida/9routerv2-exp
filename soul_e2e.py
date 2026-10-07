import json
import subprocess
import sys

BASE = "http://localhost:3003"


def curl(args, timeout=90):
    p = subprocess.run(["curl", "-s", "-m", str(timeout), *args],
                       capture_output=True, text=True)
    return p.stdout


def jload(raw, default=None):
    try:
        return json.loads(raw)
    except Exception:
        return default if default is not None else {}


# 1. mint a key
raw = curl(["-X", "POST", f"{BASE}/api/keys",
            "-H", "Content-Type: application/json",
            "-d", '{"name":"soul-e2e"}'], timeout=20)
print("create key response:", raw[:200])
key = jload(raw).get("key", "")
if not key:
    print("NO_KEY — cannot continue")
    sys.exit(1)
print("key length:", len(key))

# 2. chat with a soul system message
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
            "-d", body], timeout=120)
print("chat response:", out[:600])

# 3. soul counters
stats = curl([f"{BASE}/api/soul/stats"], timeout=20)
print("soul stats:", stats)
