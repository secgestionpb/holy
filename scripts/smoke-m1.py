#!/usr/bin/env python3
"""Smoke M1 — warranties, guards, auditoría, motor de garantías, 4 EFs, vistas."""
import json, os, time, urllib.request, urllib.error
from datetime import date, timedelta

TODAY = date.today()
D = lambda n: (TODAY + timedelta(days=n)).isoformat()

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
    r = urllib.request.Request(URL + path.replace(" ", "%20"), data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def j(s):
    try: return json.loads(s)
    except Exception: return None

# ---------- sesiones ----------
s, b = req("/auth/v1/token?grant_type=password", "POST", {"email": "admin@holy.com", "password": "PlayaBlanca2026"})
ADMIN = j(b).get("access_token"); check("login admin", s == 200 and ADMIN, f"{s} {b[:150]}")

s, b = req("/functions/v1/admin-users", "POST",
           {"action": "create", "email": "smoke-m1-mant@holy.com", "full_name": "Smoke M1 Mant",
            "roles": ["mantenimiento"], "password": "Mantenimiento2027"}, token=ADMIN)
check("create mantenimiento", s in (200, 201, 409), f"{s} {b[:150]}")
s, b = req("/auth/v1/token?grant_type=password", "POST", {"email": "smoke-m1-mant@holy.com", "password": "Mantenimiento2027"})
MANT = j(b).get("access_token"); check("login mantenimiento", s == 200 and MANT, f"{s} {b[:150]}")
s, b = req("/auth/v1/token?grant_type=password", "POST", {"email": "smoke-t2-tecnico@holy.com", "password": "Tecnico2027"})
TEC = j(b).get("access_token"); check("login tecnico", s == 200 and TEC, f"{s} {b[:150]}")

# ventana de anticipación del Evento 7 (global) a 30 días durante la prueba
s, b = req("/rest/v1/system_parameters?select=value&key=eq.dias_anticipacion_garantia", token=ADMIN)
PARAM_OLD = (j(b) or [{"value": "0"}])[0]["value"]
s, b = req("/rest/v1/system_parameters?key=eq.dias_anticipacion_garantia",
           "PATCH", {"value": "30"}, token=ADMIN)
check("set dias_anticipacion=30", s == 204, s)

# limpieza de restos de corridas/debug previas (service role)
req("/rest/v1/assets?name=like.DBG%20Asset*", "DELETE", apikey=SERVICE, token=SERVICE)

# ---------- estructura base ----------
s, b = req("/rest/v1/locations?select=id,name,depth&kind=eq.hotel", token=ADMIN)
ROOT_LOC = (j(b) or [{}])[0]
check("root location", s == 200 and ROOT_LOC.get("depth") == 0, b[:150])
s, b = req("/rest/v1/categories?select=id,code_prefix&is_active=is.true&order=sort_order.asc", token=ADMIN)
CAT = (j(b) or [{}])[0]
check("seed category", s == 200 and CAT.get("id"), b[:150])

# ubicaciones de prueba (mantenimiento) — buscar o crear (idempotente)
def get_or_create_loc(name, code=None):
    q = f"/rest/v1/locations?select=id,name,depth&name=eq.{name}"
    s, b = req(q, token=ADMIN)
    rows = j(b) or []
    if rows:
        return rows[0]
    payload = {"parent_id": ROOT_LOC["id"], "name": name, "kind": "zone", "zone_subtype": "room"}
    if code:
        payload["room_code"] = code
    s, b = req("/rest/v1/locations", "POST", payload, token=MANT,
               headers={"Prefer": "return=representation"})
    rows = j(b) if isinstance(j(b), list) else None
    return rows[0] if rows else {}

LOC1 = get_or_create_loc("Smoke Suite 901", "901")
check("location 901", bool(LOC1.get("id")), LOC1)
check("depth computed = 1", LOC1.get("depth") == 1, LOC1)
LOC2 = get_or_create_loc("Smoke Suite 902", "902")
check("location 902", bool(LOC2.get("id")), LOC2)

# profundidad máxima 5: cadena hasta fallar (limpia restos de corridas previas)
req("/rest/v1/locations?name=like.SmokeDepth*", "DELETE", apikey=SERVICE, token=SERVICE)
prev, depth_fail = ROOT_LOC["id"], False
for i in range(1, 7):
    s, b = req("/rest/v1/locations", "POST",
               {"parent_id": prev, "name": f"SmokeDepth{i}", "kind": "zone"}, token=MANT,
               headers={"Prefer": "return=representation"})
    if s >= 400:
        depth_fail = "Profundidad" in b
        break
    prev = j(b)[0]["id"]
check("depth > 5 rejected", depth_fail, b[:200])

# ---------- código: preview / check / allocate (EF) ----------
s, b = req("/functions/v1/validate-asset-code", "POST",
           {"action": "preview", "category_id": CAT["id"], "location_id": LOC1["id"]}, token=MANT)
preview = (j(b) or {}).get("code", "")
check("code preview pattern", s == 200 and preview.startswith(f"{CAT['code_prefix']}-901-"), f"{s} {b[:200]}")

s, b = req("/functions/v1/validate-asset-code", "POST",
           {"action": "allocate", "category_id": CAT["id"], "location_id": LOC1["id"]}, token=MANT)
CODE1 = (j(b) or {}).get("code", "")
check("code allocate", s == 200 and CODE1.startswith(f"{CAT['code_prefix']}-901-"), f"{s} {b[:200]}")

s, b = req("/functions/v1/validate-asset-code", "POST",
           {"action": "preview", "category_id": CAT["id"], "location_id": LOC1["id"]}, token=TEC)
check("tecnico code EF 403", s == 403, f"{s} {b[:150]}")

s, b = req("/functions/v1/validate-asset-code", "POST", {"action": "check", "code": "HVAC-901-999"}, token=MANT)
check("check free code -> available", s == 200 and j(b).get("available") is True, b[:150])

# ---------- activo + componente ----------
s, b = req("/rest/v1/assets", "POST",
           {"code": CODE1, "name": "Smoke Compresor", "category_id": CAT["id"],
            "location_id": LOC1["id"], "criticality": "high", "commissioning_date": "2026-10-08"},
           token=MANT, headers={"Prefer": "return=representation"})
ASSET = (j(b) or [{}])[0]
check("create asset", s == 201 and ASSET.get("id"), f"{s} {b[:250]}")
AID = ASSET.get("id")
check("asset default stage no_warranty", ASSET.get("life_stage") == "no_warranty", ASSET)

s, b = req("/rest/v1/audit_log?select=action,module,entity_type&entity_id=eq." + str(AID), token=ADMIN)
acts = j(b) or []
check("audit create asset", any(a["action"] == "create" and a["module"] == "assets" for a in acts), acts)

s, b = req("/functions/v1/validate-asset-code", "POST", {"action": "check", "code": CODE1}, token=MANT)
check("check used code -> unavailable", s == 200 and j(b).get("available") is False, b[:150])

s, b = req("/rest/v1/assets", "POST",
           {"code": CODE1 + "-C1", "name": "Compresor Motor", "parent_id": AID,
            "location_id": LOC1["id"], "criticality": "medium", "commissioning_date": "2026-10-08"},
           token=MANT, headers={"Prefer": "return=representation"})
CHILD = (j(b) or [{}])[0]
check("create component", s == 201 and CHILD.get("id"), f"{s} {b[:250]}")
CID = CHILD.get("id")

# cascada de ubicación (F1.2.4)
s, b = req(f"/rest/v1/assets?id=eq.{AID}", "PATCH", {"location_id": LOC2["id"]}, token=MANT)
check("PATCH location ok", s == 204, f"{s} {b[:200]}")
s, b = req(f"/rest/v1/assets?select=location_id&id=eq.{CID}", token=ADMIN)
check("component inherits location", (j(b) or [{}])[0].get("location_id") == LOC2["id"], b[:150])
s, b = req(f"/rest/v1/audit_log?select=action&entity_id=eq.{AID}&order=created_at.desc&limit=1", token=ADMIN)
check("audit plain update", (j(b) or [{}])[0].get("action") == "update", b[:150])

# ---------- vista v1_assets ----------
s, b = req(f"/rest/v1/v1_assets?select=code,category_name,location_path,warranty_active,eol_reached&id=eq.{AID}", token=ADMIN)
row = (j(b) or [{}])[0]
check("view v1_assets", s == 200 and row.get("category_name") and "Smoke Suite 902" in (row.get("location_path") or ""), f"{s} {b[:250]}")

# ---------- motor de garantías (F1.4) ----------
s, b = req("/rest/v1/warranties", "POST",
           {"asset_id": AID, "warranty_type": "purchase", "start_date": D(-30),
            "end_date": D(16), "coverage": "both", "provider_name": "Smoke Fabricante"},
           token=MANT, headers={"Prefer": "return=representation"})
W = (j(b) or [{}])[0]
check("create warranty", s == 201 and W.get("id"), f"{s} {b[:250]}")
WID = W.get("id")
check("warranty default active", W.get("status") == "active", W)

# digest_time del Evento 7 a 23:59 durante la prueba (evita el cron horario)
s, b = req("/rest/v1/notification_config?event_id=eq.7", "PATCH", {"digest_time": "23:59"}, token=ADMIN)
check("park event 7 digest_time", s == 204, s)

s, b = req("/functions/v1/asset-warranty-engine", "POST",
           {"action": "recalc", "warranty_id": WID}, token=MANT)
check("engine recalc (mant)", s == 200 and j(b).get("ok") is True, f"{s} {b[:200]}")
s, b = req(f"/rest/v1/assets?select=life_stage&id=eq.{AID}", token=ADMIN)
check("stage -> under_warranty", (j(b) or [{}])[0].get("life_stage") == "under_warranty", b[:150])

s, b = req("/functions/v1/asset-warranty-engine", "POST", {"action": "recalc"}, token=TEC)
check("engine tecnico 403", s == 403, f"{s} {b[:150]}")
s, b = req("/functions/v1/asset-warranty-engine", "POST", {"action": "recalc"})
check("engine bare (cron) 200", s == 200 and j(b).get("ok") is True, f"{s} {b[:150]}")

# Evento 7: encola con dedup, sin despachar (modo daily_digest)
s, b = req("/functions/v1/warranty-expiring-digest", "POST", {"action": "schedule"}, token=MANT)
check("digest schedule (mant)", s == 200 and j(b).get("queued", -1) >= 1, f"{s} {b[:200]}")
DEDUP = f"warranty:{WID}"
s, b = req(f"/rest/v1/notification_log?select=id,status,event_id&dedup_key=eq.{DEDUP}", token=ADMIN)
rows = j(b) or []
check("event 7 queued pending", len(rows) == 1 and rows[0]["event_id"] == 7, rows)
time.sleep(6)
s, b = req(f"/rest/v1/notification_log?select=status&dedup_key=eq.{DEDUP}", token=ADMIN)
check("digest NOT dispatched (pending)", (j(b) or [{}])[0].get("status") == "pending", b[:150])
s, b = req("/functions/v1/warranty-expiring-digest", "POST", {"action": "schedule"}, token=MANT)
check("digest dedup (queued 0)", s == 200 and j(b).get("queued") == 0, f"{s} {b[:150]}")
s, b = req("/functions/v1/warranty-expiring-digest", "POST", {"action": "schedule"})
check("digest bare (cron) 200", s == 200, f"{s} {b[:150]}")

# editar garantía → reset de dedup → re-encolado
s, b = req(f"/rest/v1/warranties?id=eq.{WID}", "PATCH", {"end_date": D(20)}, token=MANT)
check("edit warranty", s == 204, s)
s, b = req("/functions/v1/asset-warranty-engine", "POST", {"action": "recalc", "warranty_id": WID}, token=MANT)
check("engine resets dedup", s == 200, f"{s} {b[:150]}")
s, b = req(f"/rest/v1/notification_log?select=id&dedup_key=eq.{DEDUP}", token=ADMIN)
check("dedup row deleted on edit", (j(b) or []) == [], b[:150])
s, b = req("/functions/v1/warranty-expiring-digest", "POST", {"action": "schedule"}, token=MANT)
check("requeued after edit", s == 200 and j(b).get("queued") == 1, f"{s} {b[:150]}")

# vencimiento → status expired + etapa de vuelta a no_warranty
s, b = req(f"/rest/v1/warranties?id=eq.{WID}", "PATCH", {"end_date": D(-5)}, token=MANT)
check("patch end_date pasado", s == 204, f"{s} {b[:200]}")
s, b = req("/functions/v1/asset-warranty-engine", "POST", {"action": "recalc", "warranty_id": WID}, token=MANT)
check("engine expiry recalc", s == 200, f"{s} {b[:150]}")
s, b = req(f"/rest/v1/warranties?select=status&id=eq.{WID}", token=ADMIN)
check("warranty expired", (j(b) or [{}])[0].get("status") == "expired", b[:150])
s, b = req(f"/rest/v1/assets?select=life_stage&id=eq.{AID}", token=ADMIN)
check("stage back to no_warranty", (j(b) or [{}])[0].get("life_stage") == "no_warranty", b[:150])

# ---------- RPC m1_set_life_stage (F1.3) ----------
s, b = req("/rest/v1/rpc/m1_set_life_stage", "POST",
           {"p_asset_id": AID, "p_stage": "decommissioned"}, token=MANT)
check("baja sin motivo rechazada", s >= 400 and "motivo" in b, f"{s} {b[:200]}")
s, b = req("/rest/v1/rpc/m1_set_life_stage", "POST",
           {"p_asset_id": AID, "p_stage": "under_warranty"}, token=MANT)
check("etapa del motor rechazada", s >= 400 and "motor" in b, f"{s} {b[:200]}")
s, b = req("/rest/v1/rpc/m1_set_life_stage", "POST",
           {"p_asset_id": AID, "p_stage": "operational"}, token=TEC)
check("tecnico RPC 403", s >= 400 and "Mantenimiento" in b, f"{s} {b[:200]}")

s, b = req("/rest/v1/rpc/m1_set_life_stage", "POST",
           {"p_asset_id": AID, "p_stage": "decommissioned", "p_reason": "smoke: baja temporal"}, token=MANT)
check("baja con motivo", s in (200, 204), f"{s} {b[:200]}")
s, b = req(f"/rest/v1/assets?select=life_stage,operational_status&id=eq.{AID}", token=ADMIN)
row = (j(b) or [{}])[0]
check("baja fuerza Inactivo", row.get("life_stage") == "decommissioned" and row.get("operational_status") == "inactive", row)

s, b = req(f"/rest/v1/audit_log?select=action,reason&entity_id=eq.{AID}&order=created_at.desc&limit=3", token=ADMIN)
acts = j(b) or []
check("audit baja con motivo", any(a["action"] == "state_change" and a.get("reason") for a in acts), acts)

# baja reversible: volver a operativo y rehabilitar estado operativo
s, b = req("/rest/v1/rpc/m1_set_life_stage", "POST",
           {"p_asset_id": AID, "p_stage": "operational"}, token=MANT)
check("baja reversible", s in (200, 204), f"{s} {b[:200]}")
s, b = req(f"/rest/v1/assets?id=eq.{AID}", "PATCH", {"operational_status": "operational"}, token=MANT)
check("estado rehabilitado tras baja", s == 204, f"{s} {b[:150]}")

# ---------- Evento 10 (EF asset-replacement-alert) ----------
s, b = req("/functions/v1/asset-replacement-alert", "POST", {"asset_id": AID})
check("alert sin JWT -> plataforma 401/403", s in (401, 403), f"{s} {b[:150]}")
s, b = req("/rest/v1/rpc/m1_set_life_stage", "POST",
           {"p_asset_id": AID, "p_stage": "requires_replacement", "p_reason": "smoke"}, token=MANT)
check("etapa requiere reemplazo", s in (200, 204), f"{s} {b[:200]}")
s, b = req("/functions/v1/asset-replacement-alert", "POST", {"asset_id": AID}, token=MANT)
check("alert dispara evento 10", s == 200 and j(b).get("ok") is True, f"{s} {b[:200]}")
time.sleep(6)
s, b = req(f"/rest/v1/notification_log?select=status,error_detail&event_id=eq.10&order=created_at.desc&limit=1", token=ADMIN)
row = (j(b) or [{}])[0]
check("evento 10 inmediato procesado", row.get("status") == "failed" and bool(row.get("error_detail")), row)

# ---------- Evento 12 + job diario ----------
s, b = req("/rest/v1/assets", "POST",
           {"code": "SMOKE-EOL-001", "name": "Smoke EOL", "category_id": CAT["id"],
            "location_id": LOC1["id"], "criticality": "low", "commissioning_date": "2019-01-01",
            "expected_lifespan_value": 1, "lifespan_unit": "years"},
           token=MANT, headers={"Prefer": "return=representation"})
EOL = (j(b) or [{}])[0]
check("create EOL asset", s == 201 and EOL.get("id"), f"{s} {b[:250]}")
EID = EOL.get("id")
s, b = req(f"/rest/v1/v1_assets?select=eol_reached,lifespan_remaining&id=eq.{EID}", token=ADMIN)
row = (j(b) or [{}])[0]
check("view eol_reached", row.get("eol_reached") is True, f"{s} {b[:200]}")

s, b = req("/rest/v1/rpc/fn_m1_warranty_jobs", "POST", {}, apikey=SERVICE, token=SERVICE)
check("fn_m1_warranty_jobs runs", s in (200, 204), f"{s} {b[:200]}")
time.sleep(2)
s, b = req(f"/rest/v1/notification_log?select=id,dedup_key&event_id=eq.12&target_entity_id=eq.{EID}", token=ADMIN)
rows12 = j(b) or []
check("evento 12 queued", len(rows12) == 1 and (rows12[0].get("dedup_key") or "").endswith(time.strftime("%Y-%m-%d")), rows12)
s, b = req("/rest/v1/rpc/fn_m1_warranty_jobs", "POST", {}, apikey=SERVICE, token=SERVICE)
time.sleep(2)
s, b = req(f"/rest/v1/notification_log?select=id&event_id=eq.12&target_entity_id=eq.{EID}", token=ADMIN)
check("evento 12 dedup por día", len(j(b) or []) == 1, b[:150])

# ---------- RLS negativos ----------
s, b = req("/rest/v1/assets", "POST",
           {"code": "NOPE-1", "name": "x", "category_id": CAT["id"], "location_id": LOC1["id"],
            "criticality": "low", "commissioning_date": "2026-01-01"}, token=ADMIN)
check("admin sin mantenimiento no crea activos", s in (401, 403), f"{s} {b[:150]}")
s, b = req("/rest/v1/locations", "POST",
           {"parent_id": ROOT_LOC["id"], "name": "NopeLoc", "kind": "zone"}, token=TEC)
check("tecnico no crea ubicaciones", s in (401, 403), f"{s} {b[:150]}")

# borrar ubicación con activos → guard
s, b = req(f"/rest/v1/locations?id=eq.{LOC1['id']}", "PATCH", {"is_active": False},
           token=MANT, headers={"Prefer": "return=representation"})
check("desactivar ubicación con activos bloqueada", s >= 400 and "contiene" in b, f"{s} {b[:250]}")

# DELETE de warranties prohibido (sin policy)
s, b = req(f"/rest/v1/warranties?id=eq.{WID}", "DELETE", token=MANT,
           headers={"Prefer": "return=representation"})
check("delete warranties bloqueado", s == 200 and (j(b) or []) == [], f"{s} {b[:150]}")

# ---------- limpieza (service role; bajas físicas solo de datos de smoke) ----------
for path in [f"/rest/v1/notification_log?dedup_key=eq.{DEDUP}",
             f"/rest/v1/notification_log?target_entity_id=in.({AID},{EID})",
             f"/rest/v1/warranties?asset_id=in.({AID},{EID})",
             f"/rest/v1/assets?id=in.({EID},{CID},{AID})",
             f"/rest/v1/code_counters?location_id=in.({LOC1['id']},{LOC2['id']})",
             f"/rest/v1/locations?id=in.({LOC1['id']},{LOC2['id']})",
             "/rest/v1/locations?name=like.SmokeDepth*"]:
    req(path, "DELETE", apikey=SERVICE, token=SERVICE)

# restaurar parámetros tocados (Evento 7 + ventana global)
req("/rest/v1/notification_config?event_id=eq.7", "PATCH", {"digest_time": "08:00"}, token=ADMIN)
req("/rest/v1/system_parameters?key=eq.dias_anticipacion_garantia",
    "PATCH", {"value": PARAM_OLD}, token=ADMIN)

print(f"\n== {PASSED}/{PASSED+FAILED} PASS ==")
raise SystemExit(0 if FAILED == 0 else 1)
