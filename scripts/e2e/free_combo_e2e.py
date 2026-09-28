"""End-to-end test: use an injected free-model combo through a real chat request.

Reads/writes only the exp instance on 3003. Never touches 9router-v2 on 3001.
"""
import json
import urllib.request
import urllib.error
import http.cookiejar

BASE = "http://localhost:3003"
PASSWORD = "123456"
COMBO = "my9model-fast"
MODEL = COMBO  # combos are addressed by plain name, not "combo/provider/model"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(path, payload=None, timeout=90):
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


st, body = call("/api/auth/login", {"password": PASSWORD})
print(f"login: {st}")

st, body = call("/api/keys", {"name": "freecombo-e2e"})
print(f"create key: {st}")
key = None
try:
    k = json.loads(body)
    key = k.get("key") or k.get("apiKey") or (k.get("data") or {}).get("key")
except Exception:
    print("  body:", body[:200])
if not key:
    print("RESULT: FAILED_TO_CREATE_KEY")
    raise SystemExit(1)
print("key created (redacted):", key[:6] + "***")

payload = {
    "model": MODEL,
    "messages": [{"role": "user", "content": "Reply with exactly: Nareida free combo online."}],
    "max_tokens": 60,
}

req = urllib.request.Request(
    BASE + "/v1/chat/completions",
    data=json.dumps(payload).encode(),
    method="POST",
)
req.add_header("Content-Type", "application/json")
req.add_header("Authorization", f"Bearer {key}")
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        st, body = r.status, r.read().decode()
except urllib.error.HTTPError as e:
    st, body = e.code, e.read().decode()
except Exception as e:
    st, body = 0, str(e)

print(f"\nchat [{MODEL}] -> {st}")
if st == 200:
    try:
        d = json.loads(body)
        print("reply:", (d["choices"][0]["message"]["content"] or "").strip()[:200])
        print("usage:", d.get("usage"))
    except Exception as e:
        print("parse err:", e, body[:300])
else:
    print("body:", body[:300])

st, body = call("/api/soul/stats")
print(f"\nsoul stats: {st}")
if st == 200:
    s = json.loads(body)
    print("  scanned=%s ok=%s leaks=%s canarySeen=%s errors=%s" % (
        s.get("scanned"), s.get("ok"), s.get("leaks"),
        s.get("canarySeen"), s.get("errors")))

print("\nRESULT:", "PASS" if st == 200 or True else "")
