#!/usr/bin/env python3
"""Prove /v1/models annotates rather than filters.

  1. an unrestricted key sees the plain catalog (no annotations)
  2. a restricted key sees the SAME catalog, with forbidden models flagged
  3. the allowed model is NOT flagged
  4. no key at all still gets a working list
  5. a bogus key is treated as unannotated, not as an error
  6. the list never shrinks — filtering would have made it shorter
  7. the annotation matches what /chat/completions actually enforces

Everything created is removed on the way out.
"""
import json, sys, urllib.request, urllib.error, http.cookiejar

BASE = "http://localhost:3003"
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
created = []
fails, checks = [], 0


def api(path, payload=None, method=None, timeout=120):
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


def list_models(key=None) -> tuple[int, dict]:
    """Return (status, parsed_body). Body is a dict either way."""
    r = urllib.request.Request(f"{BASE}/api/v1/models")
    if key:
        r.add_header("Authorization", f"Bearer {key}")
    try:
        with op.open(r, timeout=60) as x:
            body = json.loads(x.read().decode())
            return x.status, body if isinstance(body, dict) else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode() or "{}")
        except Exception:
            body = {}
        return e.code, body if isinstance(body, dict) else {}
    except Exception as e:
        return 0, {"err": str(e)}


api("/api/auth/login", {"password": "123456"})

# Baseline: the catalog as an unrestricted caller sees it.
st, base = list_models()
base_ids = [m["id"] for m in base.get("data", [])]
check("catalog reachable with no key", st == 200 and len(base_ids) > 50, f"HTTP {st}, {len(base_ids)} models")
check("baseline has no annotations",
      not any("restricted" in m for m in base.get("data", [])),
      "baseline already annotated")
print(f"  baseline: {len(base_ids)} models")

if len(base_ids) < 2:
    print("\nFATAL: catalog too small to test")
    sys.exit(1)
ALLOWED, DENIED = base_ids[0], base_ids[-1]

# A tier so keys are not tier-less; irrelevant to the catalog but keeps the
# fixture identical to real use.
st, b = api("/api/user-groups", {
    "name": "Catalog E2E", "symbol": "catx", "ratio": 1.0,
    "apiRate": 0, "min": 0, "max": 0, "maxKeys": 0})
if st == 409:
    api("/api/user-groups", {"symbol": "catx"}, method="DELETE")
    st, b = api("/api/user-groups", {
        "name": "Catalog E2E", "symbol": "catx", "ratio": 1.0,
        "apiRate": 0, "min": 0, "max": 0, "maxKeys": 0})
check("tier created", st in (200, 201), f"HTTP {st}")

# --- 1. unrestricted key: catalog unchanged -------------------------------
st, b = api("/api/keys", {"name": "Catalog E2E open", "userGroup": "catx",
                          "balance": 1000000, "allowedModels": ["*"]})
check("unrestricted key created", st == 201, f"HTTP {st} {b[:120]}")
if st == 201:
    k = json.loads(b)
    created.append(k["id"])
    st2, d = list_models(k["key"])
    ids = [m["id"] for m in d.get("data", [])]
    check("unrestricted key: same list length", len(ids) == len(base_ids), f"{len(ids)} vs {len(base_ids)}")
    check("unrestricted key: nothing flagged",
          not any(m.get("restricted") for m in d.get("data", [])),
          str([m["id"] for m in d.get("data", []) if m.get("restricted")][:3]))

# --- 2/3. restricted key: annotated, not filtered --------------------------
st, b = api("/api/keys", {"name": "Catalog E2E restricted", "userGroup": "catx",
                          "balance": 1000000, "allowedModels": [ALLOWED]})
check("restricted key created", st == 201, f"HTTP {st} {b[:120]}")
if st == 201:
    k = json.loads(b)
    created.append(k["id"])
    st2, d = list_models(k["key"])
    ids = [m["id"] for m in d.get("data", [])]
    flagged = [m["id"] for m in d.get("data", []) if m.get("restricted")]

    check("restricted key: HTTP 200", st2 == 200, f"HTTP {st2}")
    check("6. restricted key sees the FULL catalog (no filtering)",
          len(ids) == len(base_ids), f"{len(ids)} vs {len(base_ids)}")
    check("6b. no model was removed",
          set(base_ids) == set(ids), f"missing={set(base_ids)-set(ids)}")
    check("2. forbidden models are flagged", len(flagged) > 0, "nothing flagged")
    check("3. the allowed model is NOT flagged", ALLOWED not in flagged, ALLOWED)
    check("the denied model IS flagged", DENIED in flagged, DENIED)
    check("flagged count is the complement of the allow-list",
          len(flagged) == len(ids) - 1, f"{len(flagged)} flagged of {len(ids)}")
    sample = next((m for m in d.get("data", []) if m.get("restricted")), None)
    check("flagged entry carries unavailable_reason",
          bool(sample and sample.get("unavailable_reason")), json.dumps(sample)[:140])
    check("reason names the allow-list",
          bool(sample and ALLOWED in sample.get("unavailable_reason", "")),
          (sample or {}).get("unavailable_reason", "")[:120])
    check("unflagged entries carry no restricted field",
          all("restricted" not in m for m in d.get("data", []) if m["id"] not in flagged),
          "flag leaked onto an allowed model")
    print(f"  flagged {len(flagged)}/{len(ids)}; sample: {json.dumps(sample)[:120] if sample else 'n/a'}")

    # --- 7. annotation agrees with actual enforcement ---------------------
    for model, should_pass in ((ALLOWED, True), (DENIED, False)):
        rr = urllib.request.Request(f"{BASE}/api/v1/chat/completions",
            data=json.dumps({"model": model, "messages": [{"role": "user", "content": "hi"}],
                             "stream": False}).encode(), method="POST")
        rr.add_header("Content-Type", "application/json")
        rr.add_header("Authorization", f"Bearer {k['key']}")
        try:
            with op.open(rr, timeout=200) as x: code = x.status
        except urllib.error.HTTPError as e: code = e.code
        except Exception: code = 0
        was_flagged = model in flagged
        check(f"7. {model}: enforcement={'allow' if should_pass else '403'} annotation={'flagged' if was_flagged else 'clean'}",
              (code != 403) == should_pass and was_flagged == (not should_pass),
              f"HTTP {code}, flagged={was_flagged}")

# --- 4. no key at all ------------------------------------------------------
st, d = list_models(None)
check("4. anonymous catalog still works", st == 200 and len(d.get("data", [])) == len(base_ids),
      f"HTTP {st}, {len(d.get('data', []))}")

# --- 5. bogus key is not an error -----------------------------------------
st, d = list_models("sk-does-not-exist-000000000")
check("5. bogus key is ignored, not rejected",
      st == 200 and len(d.get("data", [])) == len(base_ids), f"HTTP {st}")
check("5b. bogus key gets an unannotated list",
      not any(m.get("restricted") for m in d.get("data", [])), "annotated for an unknown key")

print("\ncleanup:")
for kid in created:
    st, _ = api(f"/api/keys/{kid}", method="DELETE")
    print(f"  key {kid[:8]} -> {st}")
st, _ = api("/api/user-groups", {"symbol": "catx"}, method="DELETE")
print(f"  tier catx -> {st}")

st, b = api("/api/keys")
left = [k["name"] for k in json.loads(b).get("keys", []) if "Catalog E2E" in (k.get("name") or "")]
check("no test keys left behind", not left, str(left))

print(f"\n{checks - len(fails)}/{checks} checks passed")
sys.exit(1 if fails else 0)
