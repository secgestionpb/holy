import json, os, sys, time, urllib.request, urllib.error

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
def load_env(path):
    env = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

env = load_env(os.path.join(ROOT, ".env.local"))
URL = env["SUPABASE_URL"]
ANON = env["SUPABASE_ANON_KEY"]

def post(path, body, token=None, apikey=None):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "apikey": apikey or ANON,
                 **({"Authorization": "Bearer " + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

results = []
TEC_EMAIL = f"tecnico.test.{int(time.time())}@holy.com"
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (" | " + str(detail)[:300] if not cond else ""))

# 1. login admin
s, b = post("/functions/v1/login-custom", {"email": "admin@holy.com", "password": "PlayaBlanca2026"})
try: jb = json.loads(b)
except: jb = {}
check("login admin 200", s == 200, f"{s} {b[:200]}")
ADMIN_TOKEN = jb.get("access_token")
check("login admin roles == [administrador]", jb.get("roles") == ["administrador"], jb.get("roles"))
# must_change_password del admin es estado manejado por el usuario (S-T1.2);
# no se asierte aquí — las altas sí se comprueban con must_change = true abajo.

# 2. create user tecnico
s, b = post("/functions/v1/admin-users",
    {"action": "create", "email": TEC_EMAIL, "full_name": "Tecnico Prueba",
     "phone": "600111222", "hourly_rate": 18, "roles": ["tecnico"], "category_ids": []},
    token=ADMIN_TOKEN)
try: jb = json.loads(b)
except: jb = {}
check("create tecnico 201", s == 201, f"{s} {b[:300]}")
TEC_ID = jb.get("user_id"); TEC_PW = jb.get("temp_password")
check("temp password >= 12 + policy", bool(TEC_PW) and len(TEC_PW) >= 12 and any(c.isupper() for c in TEC_PW) and any(c.isdigit() for c in TEC_PW), TEC_PW)
check("default initial password PlayaBlanca2026", TEC_PW == "PlayaBlanca2026", TEC_PW)

# 3. create duplicate email -> 409
s, b = post("/functions/v1/admin-users",
    {"action": "create", "email": TEC_EMAIL, "full_name": "Dup", "roles": ["tecnico"]},
    token=ADMIN_TOKEN)
check("duplicate email 409", s == 409, f"{s} {b[:200]}")

# 4. create with empty roles -> 400
s, b = post("/functions/v1/admin-users",
    {"action": "create", "email": "x@holy.com", "full_name": "X", "roles": []}, token=ADMIN_TOKEN)
check("empty roles 400", s == 400, f"{s} {b[:200]}")

# 5. non-admin cannot call (use tecnico token later); anon -> 401
s, b = post("/functions/v1/admin-users", {"action": "create", "email": "y@holy.com", "full_name": "Y", "roles": ["tecnico"]})
check("no token 401", s == 401, f"{s} {b[:200]}")

# 6. login tecnico with temp password
s, b = post("/functions/v1/login-custom", {"email": TEC_EMAIL, "password": TEC_PW})
try: jb = json.loads(b)
except: jb = {}
check("tecnico login 200", s == 200, f"{s} {b[:200]}")
TEC_TOKEN = jb.get("access_token")
check("tecnico roles == [tecnico]", jb.get("roles") == ["tecnico"], jb.get("roles"))
check("tecnico must_change true", jb.get("user", {}).get("must_change_password") is True, jb.get("user"))

# 7. tecnico (no admin) calling admin-users -> 403
s, b = post("/functions/v1/admin-users",
    {"action": "create", "email": "z@holy.com", "full_name": "Z", "roles": ["tecnico"]}, token=TEC_TOKEN)
check("non-admin 403", s == 403, f"{s} {b[:200]}")

# 8. tecnico change_own_password
s, b = post("/functions/v1/admin-users",
    {"action": "change_own_password", "password": "NuevaClave123"}, token=TEC_TOKEN)
check("change_own 200", s == 200, f"{s} {b[:300]}")
s, b = post("/functions/v1/login-custom", {"email": TEC_EMAIL, "password": "NuevaClave123"})
try: jb = json.loads(b)
except: jb = {}
check("login with new password 200", s == 200, f"{s} {b[:200]}")
TEC_TOKEN = jb.get("access_token")
check("must_change false after own change", jb.get("user", {}).get("must_change_password") is False, jb.get("user"))

# 9. weak password policy server-side
s, b = post("/functions/v1/admin-users",
    {"action": "change_own_password", "password": "abcdefg"}, token=TEC_TOKEN)
check("weak password 400", s == 400, f"{s} {b[:200]}")

# 10. guards: self-deactivate
s, b = post("/functions/v1/admin-users",
    {"action": "update", "user_id": "0217d325-b0e2-4ec4-a938-d4104c60c0c2",
     "email": "admin@holy.com", "full_name": "Administrador Holy",
     "roles": ["administrador"], "is_active": False}, token=ADMIN_TOKEN)
check("self-deactivate 409", s == 409, f"{s} {b[:200]}")

# 11. guard: edit self keeping active (ok) + last-admin guard when removing own role
s, b = post("/functions/v1/admin-users",
    {"action": "update", "user_id": "0217d325-b0e2-4ec4-a938-d4104c60c0c2",
     "email": "admin@holy.com", "full_name": "Administrador Holy",
     "roles": ["tecnico"], "is_active": True}, token=ADMIN_TOKEN)
check("drop last admin 409", s == 409, f"{s} {b[:300]}")

# 12. update tecnico: rename + reassign roles/categories
s, b = post("/functions/v1/admin-users",
    {"action": "update", "user_id": TEC_ID, "email": TEC_EMAIL,
     "full_name": "Tecnico Prueba Editado", "phone": "600333444", "hourly_rate": 20,
     "roles": ["tecnico", "calidad"], "is_active": True}, token=ADMIN_TOKEN)
check("update tecnico 200", s == 200, f"{s} {b[:300]}")

# 13. reset password
s, b = post("/functions/v1/admin-users", {"action": "reset_password", "user_id": TEC_ID}, token=ADMIN_TOKEN)
try: jb = json.loads(b)
except: jb = {}
check("reset_password 200", s == 200, f"{s} {b[:300]}")
RESET_PW = jb.get("temp_password")
check("reset password == PlayaBlanca2026", RESET_PW == "PlayaBlanca2026", RESET_PW)
s, b = post("/functions/v1/login-custom", {"email": TEC_EMAIL, "password": RESET_PW})
try: jb2 = json.loads(b)
except: jb2 = {}
check("login with reset password 200", s == 200, f"{s} {b[:200]}")
check("reset forces must_change true", jb2.get("user", {}).get("must_change_password") is True, jb2.get("user"))
TEC_TOKEN2 = jb2.get("access_token")

# 14. refresh returns roles
import http.cookiejar
# simulate auth-refresh via direct token? needs refresh cookie; skip here (covered by frontend E2E)

# 15. audit_log check: rows with actor = admin for create/update, user_id = tecnico for reset
rest_req = urllib.request.Request(URL + "/rest/v1/audit_log?select=id,module,entity_type,action,user_id,entity_label,changes&order=created_at.desc&limit=50",
    headers={"apikey": ANON, "Authorization": "Bearer " + ADMIN_TOKEN, "Accept-Profile": "public"})
try:
    with urllib.request.urlopen(rest_req, timeout=30) as r:
        rows = json.loads(r.read().decode())
except urllib.error.HTTPError as e:
    rows = json.loads(e.read().decode() or "[]"); print("audit err", e.code, rows)
rows = [r for r in rows if r.get("entity_label") == TEC_EMAIL]
acts = [(r["action"], r.get("user_id"), r.get("entity_label")) for r in rows]
print("audit rows:", json.dumps(acts, indent=1))
check("audit has create with admin actor",
      any(a[0] == "create" and a[1] == "0217d325-b0e2-4ec4-a938-d4104c60c0c2" for a in acts), acts)
check("audit has deactivate/update with admin actor",
      any(a[0] in ("update", "deactivate") and a[1] == "0217d325-b0e2-4ec4-a938-d4104c60c0c2" for a in acts), acts)
check("audit has password_reset with user_id = tecnico",
      any(a[0] == "password_reset" and a[1] == TEC_ID for a in acts), acts)

print()
fails = [r for r in results if not r[1]]
print(f"== {len(results) - len(fails)}/{len(results)} PASS ==")
sys.exit(1 if fails else 0)
