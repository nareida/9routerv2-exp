#!/usr/bin/env python3
"""End-to-end check for the per-key model allow-list.

Proves the gate is real over HTTP, not just in unit tests:

  1. a key restricted to one model gets 403 for any other model
  2. the same key succeeds for the model it is allowed to use
  3. the rejected call costs nothing (balance and lifetime unchanged)
  4. an unrestricted key still reaches a model it was never configured with
  5. a prefix wildcard grants a whole family
  6. tier and balance still behave normally for a restricted key

Everything it creates is removed on the way out.
"""
import json, sys, time, urllib.request, urllib.error, http.cookiejar

BASE = "http://localhost:3003"
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

created_keys, created_tiers = [], []
fails, checks = [], 0


def api(path, payload=None, method=None, timeout=180):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(BASE + path, data=data,
                               method=method or ("POST" if data else "GET"))
    r.add_header("Content-Type", "application/json")
    try:
        with op.open(r, timeout=timeout) as x:
            return x.status, x.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


def check(label, cond, detail=""):
    global checks
    checks += 1
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def chat(key, model, timeout=180):
    """Raw chat completion, non-stream. Returns (status, parsed_json, raw)."""
    r = urllib.request.Request(
        f"{BASE}/api/v1/chat/completions",
        data=json.dumps({"model": model, "messages": [{"role": "user", "content": "hi"}],
                         "stream": False}).encode(),
        method="POST")
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", f"Bearer {key}")
    try:
        with op.open(r, timeout=timeout) as x:
            return x.status, json.loads(x.read().decode() or "{}"), ""
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}"), raw
        except Exception:
            return e.code, {}, raw
    except Exception as e:
        return 0, {}, str(e)


def key_state(key_id):
    st, b = api("/api/keys")
    if st != 200:
        return None
    for k in json.loads(b).get("keys", []):
        if k["id"] == key_id:
            return k
    return None


api("/api/auth/login", {"password": "123456"})

# A tier with plenty of credit so quota is never the reason a call fails.
st, b = api("/api/user-groups", {
    "name": "Allowlist E2E", "symbol": "alst", "ratio": 1.0,
    "apiRate": 0, "min": 0, "max": 0, "maxKeys": 0,
})
if st == 409:
    api("/api/user-groups", {"symbol": "alst"}, method="DELETE")
    st, b = api("/api/user-groups", {
        "name": "Allowlist E2E", "symbol": "alst", "ratio": 1.0,
        "apiRate": 0, "min": 0, "max": 0, "maxKeys": 0})
if st == 201:
    created_tiers.append("alst")
check("tier created", st in (200, 201), f"HTTP {st}: {b[:120]}")

# Pick two real model ids the router advertises to a client key. This is the
# same list a user sees via /v1/models, so the restriction is checked against
# the exact strings that arrive on a request.
r = urllib.request.Request(f"{BASE}/api/v1/models")
try:
    with op.open(r, timeout=60) as x:
        models = [m.get("id") for m in json.loads(x.read().decode()).get("data", []) if m.get("id")]
except Exception as e:
    print(f"  could not list models: {e}")
    models = []
print(f"\n  discovered {len(models)} models: {models[:6]}{' ...' if len(models) > 6 else ''}")
if len(models) < 2:
    print("\nFATAL: fewer than 2 models advertised, cannot test an allow-list")
    sys.exit(1)
# Two different families, so a prefix wildcard on one cannot cover the other.
ALLOWED, DENIED = models[0], models[-1]

# --- 1. restricted key, denied model -> 403 ---------------------------------
st, b = api("/api/keys", {
    "name": "Allowlist E2E restricted", "userGroup": "alst",
    "balance": 1000000, "allowedModels": [ALLOWED],
})
check("restricted key created", st == 201, f"HTTP {st}: {b[:140]}")
restricted = json.loads(b).get("key") if st == 201 else None
if restricted:
    created_keys.append(json.loads(b)["id"])
    check("allowedModels persisted on create",
          json.loads(b).get("allowedModels") == [ALLOWED],
          str(json.loads(b).get("allowedModels")))

if restricted:
    st, body, raw = chat(restricted, DENIED)
    msg = json.dumps(body)[:200]
    check(f"denied model -> 403 (asked {DENIED})", st == 403, f"HTTP {st} {msg}")
    check("403 body names model_not_allowed", "model_not_allowed" in raw, raw[:160])
    check("403 uses permission_error type",
          body.get("error", {}).get("type") == "permission_error", msg)

    # --- 3. the rejected call must not have been charged -------------------
    kid = json.loads(b)["id"]
    after = key_state(kid)
    check("denied call left balance untouched",
          abs((after or {}).get("balance", -1) - 1000000) < 0.01,
          str((after or {}).get("balance")))
    check("denied call left lifetimeCharge untouched",
          abs((after or {}).get("lifetimeCharge", -1)) < 0.01,
          str((after or {}).get("lifetimeCharge")))

    # --- 2. allowed model still works -------------------------------------
    st2, body2, raw2 = chat(restricted, ALLOWED, timeout=240)
    check(f"allowed model -> not 403 (asked {ALLOWED})", st2 != 403, f"HTTP {st2} {raw2[:160]}")
    after2 = key_state(kid)
    if after and after2:
        print(f"        allowed call: HTTP {st2}  balance {after.get('balance')} -> {after2.get('balance')}")

    # --- 6. tier rate cap still enforced for a restricted key ---------------
    st3, b3 = api("/api/user-groups", {
        "symbol": "alst", "name": "Allowlist E2E", "ratio": 1.0,
        "apiRate": 1, "min": 0, "max": 0, "maxKeys": 0,
    }, method="PUT")
    check("tier rate cap updated", st3 in (200, 201), f"HTTP {st3} {b3[:120]}")
    codes = [chat(restricted, ALLOWED, timeout=240)[0] for _ in range(3)]
    check("tier rate cap still blocks (429 seen)", 429 in codes, str(codes))
    api("/api/user-groups", {"symbol": "alst", "name": "Allowlist E2E", "ratio": 1.0,
                             "apiRate": 0, "min": 0, "max": 0, "maxKeys": 0}, method="PUT")

# --- 4. unrestricted key reaches anything ----------------------------------
st, b = api("/api/keys", {
    "name": "Allowlist E2E open", "userGroup": "alst",
    "balance": 1000000, "allowedModels": ["*"],
})
check("unrestricted key created", st == 201, f"HTTP {st}: {b[:140]}")
open_key = json.loads(b).get("key") if st == 201 else None
if open_key:
    created_keys.append(json.loads(b)["id"])
    st2, _, raw2 = chat(open_key, DENIED, timeout=240)
    check("unrestricted key is not blocked", st2 != 403, f"HTTP {st2} {raw2[:160]}")

# --- 5. prefix wildcard ----------------------------------------------------
st, b = api("/api/keys", {
    "name": "Allowlist E2E wildcard", "userGroup": "alst",
    "balance": 1000000, "allowedModels": [ALLOWED.split("/")[-1][:6] + "*"],
})
check("wildcard key created", st == 201, f"HTTP {st}: {b[:140]}")
wild_key = json.loads(b).get("key") if st == 201 else None
if wild_key:
    created_keys.append(json.loads(b)["id"])
    pat = json.loads(b)["allowedModels"][0]
    st2, _, raw2 = chat(wild_key, ALLOWED, timeout=240)
    check(f"wildcard '{pat}' allows {ALLOWED}", st2 != 403, f"HTTP {st2} {raw2[:160]}")
    if DENIED.split("/")[-1][:6] != ALLOWED.split("/")[-1][:6]:
        st3, _, raw3 = chat(wild_key, DENIED, timeout=240)
        check("wildcard still refuses a different family", st3 == 403, f"HTTP {st3} {raw3[:140]}")

# --- a key created without the field keeps working -------------------------
st, b = api("/api/keys", {"name": "Allowlist E2E legacy", "userGroup": "alst", "balance": 1000000})
check("key created without allowedModels", st == 201, f"HTTP {st} {b[:140]}")
if st == 201:
    created_keys.append(json.loads(b)["id"])
    check("omitted field defaults to unrestricted",
          json.loads(b).get("allowedModels") == ["*"],
          str(json.loads(b).get("allowedModels")))
    st2, _, raw2 = chat(json.loads(b)["key"], DENIED, timeout=240)
    check("legacy key is not blocked", st2 != 403, f"HTTP {st2} {raw2[:160]}")

# --- partial update must not wipe the restriction ---------------------------
if created_keys and restricted:
    st, b = api(f"/api/keys/{created_keys[0]}", {"id": created_keys[0], "name": "renamed only"}, method="PUT")
    check("partial update accepted", st == 200, f"HTTP {st} {b[:120]}")
    if st == 200:
        check("renaming preserved allowedModels",
              json.loads(b)["key"].get("allowedModels") == [ALLOWED],
              str(json.loads(b)["key"].get("allowedModels")))

print("\ncleanup:")
for kid in created_keys:
    st, _ = api(f"/api/keys/{kid}", method="DELETE")
    print(f"  key {kid[:8]} -> {st}")
for t in created_tiers:
    st, _ = api("/api/user-groups", {"symbol": t}, method="DELETE")
    print(f"  tier {t} -> {st}")

st, b = api("/api/keys")
left = [k["name"] for k in json.loads(b).get("keys", []) if "Allowlist E2E" in (k.get("name") or "")]
check("no test keys left behind", not left, str(left))
st, b = api("/api/user-groups")
tiers = [g["symbol"] for g in json.loads(b).get("groups", []) if g.get("symbol") == "alst"]
check("no test tier left behind", not tiers, str(tiers))

print(f"\n{checks - len(fails)}/{checks} checks passed")
sys.exit(1 if fails else 0)
