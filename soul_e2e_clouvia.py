import json
import subprocess
import sys
import time

BASE = "http://localhost:3003"
COOKIE = "/opt/data/cache/scratch/9r_exp_ck.txt"

CANDIDATES = [
    "clouvia/gemini-3.6-flash",
    "clouvia/glm5.3",
    "clouvia/qwen-3.8-max-thinking-agentic",
    "clouvia/gpt-5.6",
    "clouvia/deepseek-v4-flash",
]


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


# fresh login + key
subprocess.run(["rm", "-f", COOKIE], capture_output=True)
curl(["-X", "POST", f"{BASE}/api/auth/login",
      "-H", "Content-Type: application/json",
      "-d", json.dumps({"password": "123456"})], timeout=20)

r = curl(["-X", "POST", f"{BASE}/api/keys",
          "-H", "Content-Type: application/json",
          "-d", '{"name":"soul-e2e"}'], timeout=20)
key = jload(r).get("key", "")
if not key:
    print("NO_KEY:", r[:200])
    sys.exit(1)
print("key ok, length", len(key))

for model in CANDIDATES:
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "You are Nareida, Boss's assistant."},
            {"role": "user", "content": "Say exactly: Nareida online."},
        ],
        "stream": False,
    })
    out = curl(["-X", "POST", f"{BASE}/v1/chat/completions",
                "-H", "Content-Type: application/json",
                "-H", f"Authorization: Bearer {key}",
                "-d", body], timeout=120, cookie=False)
    d = jload(out)
    if d.get("choices"):
        print(f"OK   {model}: {d['choices'][0]['message']['content'][:120]}")
        print("stats:", curl([f"{BASE}/api/soul/stats"], timeout=20, cookie=False))
        break
    err = d.get("error", {})
    msg = err.get("message") if isinstance(err, dict) else str(err)
    print(f"FAIL {model}: {str(msg)[:110]}")
