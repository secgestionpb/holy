#!/usr/bin/env python3
"""Smoke T2 — motor de notificaciones + parámetros. Idempotente."""
import json, os, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = {}
for line in open(os.path.join(ROOT, ".env.local"), encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
URL = env["SUPABASE_URL"]; ANON = env["SUPABASE_ANON_KEY"]; SERVICE = env["SUPABASE_SERVICE_ROLE_KEY"]
PASSED = FAILED = 0
def check(name, cond, info=""):
    global PASSED, FAILED
    if cond: PASSED += 1; print(f"PASS {name}")
    else: FAILED += 1; print(f"FAIL {name} | {info}")

def req(path, method="GET", data=None, token=None, headers=None, apikey=None):
    h = {"apikey": apikey or ANON, "Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    if headers: h.update(headers)
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(URL + path, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def jloads(s):
    try: return json.loads(s)
    except Exception: return {}

s, b = req("/auth/v1/token?grant_type=password", "POST", {"email": "admin@holy.com", "password": "PlayaBlanca2026"})
jb = jloads(b); ADMIN = jb.get("access_token")
check("login admin 200", s == 200 and ADMIN, f"{s} {b[:200]}")

s, b = req("/rest/v1/notification_config?select=event_id,name,mode", token=ADMIN)
rows = jloads(b) if isinstance(jloads(b), list) else []
check("config has 12 events", s == 200 and len(rows) == 12, f"{s} {len(rows)}")

# Update event 9 recipients (admin) -> audit trigger fires
s, b = req("/rest/v1/notification_config?event_id=eq.9", "PATCH",
           {"recipients": ["smoke-test@holy.com"]}, token=ADMIN)
check("admin patch event 9 204", s == 204, f"{s} {b[:200]}")

s, b = req("/rest/v1/notification_config?select=recipients&event_id=eq.9", token=ADMIN)
check("event 9 recipients saved", s == 200 and jloads(b) == [{"recipients": ["smoke-test@holy.com"]}], b[:200])

# fn_notify creates pending row + attempts immediate dispatch
s, b = req("/rest/v1/rpc/fn_notify", "POST",
           {"p_event_id": 9, "p_entity_type": "measurement", "p_entity_id": None,
            "p_dedup_key": None, "p_payload": {"smoke": True}}, token=ADMIN)
log_id = b.strip().strip('"')
import re as _re
if not _re.fullmatch(r"[0-9a-fA-F-]{36}", log_id):
    print(f"FAIL fn_notify returns uuid | {s} {b[:200]}")
    raise SystemExit(1)
check("fn_notify returns uuid", s == 200, f"{s} {b[:200]}")

time.sleep(6)  # pg_net async dispatch
s, b = req(f"/rest/v1/notification_log?select=id,status,error_detail&id=eq.{log_id}", token=ADMIN)
row = (jloads(b) or [{}])[0]
check("log row exists", s == 200 and row.get("id") == log_id, b[:200])
check("immediate dispatch processed (failed: no Brevo key)", row.get("status") == "failed"
      and "BREVO" in (row.get("error_detail") or ""), row)

# dedup: same key -> NULL (no new row)
s, b = req("/rest/v1/rpc/fn_notify", "POST",
           {"p_event_id": 9, "p_entity_type": "measurement", "p_dedup_key": "smoke-dedup-1",
            "p_payload": {}}, token=ADMIN)
first = b.strip().strip('"')
s, b = req("/rest/v1/rpc/fn_notify", "POST",
           {"p_event_id": 9, "p_entity_type": "measurement", "p_dedup_key": "smoke-dedup-1",
            "p_payload": {}}, token=ADMIN)
check("dedup returns null on duplicate", s == 200 and b.strip() == "null", f"{s} {b[:80]}")

# inactive event silences without enqueueing
s, b = req("/rest/v1/notification_config?event_id=eq.12", "PATCH", {"is_active": False}, token=ADMIN)
check("deactivate event 12", s == 204, s)
s, b = req("/rest/v1/notification_log?select=id&event_id=eq.12", token=ADMIN)
before = len(jloads(b)) if isinstance(jloads(b), list) else -1
s, b = req("/rest/v1/rpc/fn_notify", "POST", {"p_event_id": 12, "p_payload": {}}, token=ADMIN)
check("fn_notify silenced (null)", s == 200 and b.strip() == "null", f"{s} {b[:80]}")
s, b = req("/rest/v1/notification_config?event_id=eq.12", "PATCH", {"is_active": True}, token=ADMIN)
check("reactivate event 12", s == 204, s)

# retry requires admin: no token -> 403
s, b = req("/functions/v1/send-notifications", "POST",
           {"mode": "immediate", "action": "retry", "log_id": log_id})
check("retry without token 403", s == 403, f"{s} {b[:160]}")

# retry as admin -> processes row again (failed: no Brevo) -> 200
s, b = req("/functions/v1/send-notifications", "POST",
           {"mode": "immediate", "action": "retry", "log_id": log_id}, token=ADMIN)
jb = jloads(b)
check("retry as admin 200", s == 200 and jb.get("ok") is True, f"{s} {b[:200]}")
s, b = req(f"/rest/v1/notification_log?select=status&id=eq.{log_id}", token=ADMIN)
check("retry still failed (no Brevo key)", (jloads(b) or [{}])[0].get("status") == "failed", b[:160])

# digest noop (event 2 has no pending today) -> 200 skipped
time.sleep(2)
s, b = req("/functions/v1/send-notifications", "POST", {"mode": "digest", "event_id": 2}, token=ADMIN)
check("digest noop 200", s == 200 and jloads(b).get("ok") is True, f"{s} {b[:200]}")

# fn_enqueue_digest callable
s, b = req("/rest/v1/rpc/fn_enqueue_digest", "POST", {}, token=ADMIN)
check("fn_enqueue_digest callable", s == 200, f"{s} {b[:200]}")

# system_parameters: update + updated_by trigger + audit
s, b = req("/rest/v1/system_parameters?select=value,updated_by&key=eq.login_attempts", token=ADMIN)
check("read login_attempts", s == 200 and (jloads(b) or [{}])[0].get("value") == "5", b[:160])
s, b = req("/rest/v1/system_parameters?key=eq.login_attempts", "PATCH", {"value": "6"}, token=ADMIN)
check("update login_attempts 6", s == 204, s)
s, b = req("/rest/v1/system_parameters?select=value,updated_by&key=eq.login_attempts", token=ADMIN)
row = (jloads(b) or [{}])[0]
check("updated_by set to admin", row.get("value") == "6" and row.get("updated_by") is not None, row)
s, b = req("/rest/v1/system_parameters?key=eq.login_attempts", "PATCH", {"value": "5"}, token=ADMIN)
check("restore login_attempts 5", s == 204, s)

# tecnico cannot patch notification_config — create a real tecnico first via EF
s, b = req("/functions/v1/admin-users", "POST",
           {"action": "create", "email": "smoke-t2-tecnico@holy.com",
            "full_name": "Smoke T2 Tecnico", "roles": ["tecnico"],
            "password": "Tecnico2027"}, token=ADMIN)
check("create tecnico", s in (200, 201, 409), f"{s} {b[:200]}")

s, b = req("/auth/v1/token?grant_type=password", "POST",
           {"email": "smoke-t2-tecnico@holy.com", "password": "Tecnico2027"})
TEC = jloads(b).get("access_token")
check("tecnico login", s == 200 and TEC, f"{s} {b[:160]}")

# RLS blocks UPDATE: use return=representation — 0 rows = blocked
s, b = req("/rest/v1/notification_config?event_id=eq.9", "PATCH", {"is_active": False},
           token=TEC, headers={"Prefer": "return=representation"})
rows = jloads(b) if isinstance(jloads(b), list) else []
check("tecnico patch blocked (0 rows)", s == 200 and rows == [], f"{s} {b[:160]}")

# non-admin cannot read failed logs
s, b = req("/rest/v1/notification_log?select=id&status=eq.failed", token=TEC)
check("tecnico select log rows 0 or 403", s == 200 and jloads(b) == [] or s in (401, 403), f"{s} {b[:120]}")

# restore event 9 recipients to empty (estado base limpio)
s, b = req("/rest/v1/notification_config?event_id=eq.9", "PATCH", {"recipients": []}, token=ADMIN)
check("restore event 9 recipients []", s == 204, s)

print(f"\n== {PASSED}/{PASSED+FAILED} PASS ==")
raise SystemExit(0 if FAILED == 0 else 1)
