import json
import subprocess
import sys
import time

BASE = "http://localhost:3003"
BACKEND = "/opt/data/9router-exp/backend"


def curl(args, timeout=90):
    p = subprocess.run(["curl", "-s", "-m", str(timeout), *args],
                       capture_output=True, text=True)
    return p.stdout


def jload(raw, default=None):
    try:
        return json.loads(raw)
    except Exception:
        return {} if default is None else default


# 1. mint a key using the CLI token (machine-id based, salt "9r-cli-auth")
cli_token = subprocess.run(
    ["node", "-e",
     "import('./src/lib/shared/utils/machineId.js')"
     ".then(m=>m.getConsistentMachineId('9r-cli-auth'))"
     ".then(t=>console.log(t)).catch(()=>console.log(''))"],
    cwd=BACKEND, capture_output=True, text=True,
).stdout.strip()

print("cli_token length:", len(cli_token))

raw = curl(["-X", "POST", f"{BASE}/api/keys",
            "-H", "Content-Type: application/json",
            "-H", f"x-9r-cli-token: {cli_token}",
            "-d", '{"name":"soul-e2e"}'], timeout=20)
print("create key:", raw[:220])
key = jload(raw).get("key", "")
if not key:
    print("NO_KEY — stopping")
    sys.exit(1)
print("key length:", len(key))

# 2. chat request carrying a soul system message
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
            "-d", body], timeout=150)
print("chat:", out[:600])

time.sleep(2)
print("soul stats:", curl([f"{BASE}/api/soul/stats"], timeout=20))
