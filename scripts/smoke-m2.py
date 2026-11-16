#!/usr/bin/env python3
"""Smoke M2 — OTs: RPCs, guards, RLS, EFs cierre/push, vistas, Eventos 1/5."""
import json, os, urllib.request, urllib.error, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = {}
for line in open(os.path.join(ROOT, ".env.local"), encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
URL = env["SUPABASE_URL"]; ANON = env["SUPABASE_ANON_KEY"]; SERVICE = env["SUPABASE_SERVICE_ROLE_KEY"]
PASSED = FAILED = 0

def safe(s):
    return str(s).encode("ascii", "replace").decode("ascii")

def check(name, cond, info=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1; print(f"PASS {name}", flush=True)
    else:
        FAILED += 1; print(f"FAIL {name} | {safe(info)[:220]}", flush=True)

def req(path, method="GET", data=None, token=None, headers=None, apikey=None, raw=None, ctype="application/json"):
    h = {"apikey": apikey or ANON}
    if raw is not None or data is not None:
        h["Content-Type"] = ctype
    if token: h["Authorization"] = f"Bearer {token}"
    if headers: h.update(headers)
    if raw is not None:
        body = raw if isinstance(raw, bytes) else raw.encode()
    else:
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

def svc_get(path):
    s, b = req(path, apikey=SERVICE, token=SERVICE)
    return j(b) if s == 200 and b else []

def login(email, pwd):
    s, b = req("/auth/v1/token?grant_type=password", "POST", {"email": email, "password": pwd})
    d = j(b) or {}
    return (d.get("access_token"), d.get("user", {}).get("id")), s, b[:120]

def rpc(name, payload, token):
    s, b = req(f"/rest/v1/rpc/{name}", "POST", payload, token=token)
    return s, (j(b) if b else None), b

# ---------- sesiones ----------
(ADMIN, ADMIN_ID), s, b = login("admin@holy.com", "PlayaBlanca2026")
check("login admin", s == 200 and ADMIN, b)

def get_or_create(email, full, roles, pwd):
    (tok, uid), s, _ = login(email, pwd)
    if tok: return tok, uid
    s, b = req("/functions/v1/admin-users", "POST",
               {"action": "create", "email": email, "full_name": full, "roles": roles, "password": pwd},
               token=ADMIN)
    if s not in (200, 201, 409):
        return None, None
    (tok, uid), s, b = login(email, pwd)
    return tok, uid

MANT, MANT_ID = get_or_create("smoke-m1-mant@holy.com", "Smoke M1 Mant", ["mantenimiento"], "Mantenimiento2027")
check("login mantenimiento", bool(MANT and MANT_ID), MANT)
TEC1, TEC1_ID = get_or_create("smoke-t2-tecnico@holy.com", "Smoke Tecnico 1", ["tecnico"], "Tecnico2027")
check("login tecnico 1", bool(TEC1 and TEC1_ID), TEC1)
TEC2, TEC2_ID = get_or_create("smoke-m2-tecnico2@holy.com", "Smoke Tecnico 2", ["tecnico"], "Tecnico2027")
check("login tecnico 2", bool(TEC2 and TEC2_ID), TEC2)
TEC3, TEC3_ID = get_or_create("smoke-m2-tecnico3@holy.com", "Smoke Tecnico 3", ["tecnico"], "Tecnico2027")
check("login tecnico 3", bool(TEC3 and TEC3_ID), TEC3)
CAL, CAL_ID = get_or_create("smoke-m2-calidad@holy.com", "Smoke Calidad", ["calidad"], "Calidad2027")
check("login calidad", bool(CAL and CAL_ID), CAL)

# ---------- limpieza de corridas previas ----------
old_wos = svc_get("/rest/v1/work_orders?select=id&description=ilike.SmokeM2%25")
wo_ids = [w["id"] for w in old_wos]
old_drs = svc_get("/rest/v1/damage_reports?select=id&description=ilike.SmokeM2%25")
dr_ids = [d["id"] for d in old_drs]
if dr_ids:
    dl = ",".join(dr_ids)
    req(f"/rest/v1/wo_evidence?damage_report_id=in.({dl})", "DELETE", apikey=SERVICE, token=SERVICE)
if wo_ids:
    wl = ",".join(wo_ids)
    for t in ("wo_technicians", "wo_comments", "wo_evidence", "wo_checklist_entries"):
        req(f"/rest/v1/{t}?wo_id=in.({wl})", "DELETE", apikey=SERVICE, token=SERVICE)
    req(f"/rest/v1/warranties?origin_wo_id=in.({wl})", "DELETE", apikey=SERVICE, token=SERVICE)
    req(f"/rest/v1/work_orders?id=in.({wl})", "DELETE", apikey=SERVICE, token=SERVICE)
if dr_ids:
    req(f"/rest/v1/damage_reports?id=in.({','.join(dr_ids)})", "DELETE", apikey=SERVICE, token=SERVICE)
req("/rest/v1/providers?code=eq.SMOKE-PRV-01", "DELETE", apikey=SERVICE, token=SERVICE)
req("/rest/v1/push_subscriptions?fcm_token=eq.smoke-m2-fake-token", "DELETE", apikey=SERVICE, token=SERVICE)

# ---------- fixtures base ----------
s, b = req("/rest/v1/locations?select=id,depth&kind=eq.hotel&depth=eq.0", token=ADMIN)
ROOT_LOC = (j(b) or [{}])[0]
check("root location", s == 200 and ROOT_LOC.get("id"), b[:150])
s, b = req("/rest/v1/categories?select=id,code_prefix&is_active=is.true&order=sort_order.asc", token=ADMIN)
CAT = (j(b) or [{}])[0]
check("seed category", s == 200 and CAT.get("id"), b[:150])

s, b = req("/rest/v1/locations?select=id&name=eq.SmokeM2 Suite", token=ADMIN)
LOC = (j(b) or [{}])[0]
if not LOC.get("id"):
    s, b = req("/rest/v1/locations", "POST",
               {"parent_id": ROOT_LOC["id"], "name": "SmokeM2 Suite", "kind": "zone",
                "zone_subtype": "room", "room_code": "921"},
               token=MANT, headers={"Prefer": "return=representation"})
    LOC = (j(b) or [{}])[0]
check("location smoke2", bool(LOC.get("id")), b[:200])

def alloc_code():
    s, b = req("/functions/v1/validate-asset-code", "POST",
               {"action": "allocate", "category_id": CAT["id"], "location_id": LOC["id"]}, token=MANT)
    return (j(b) or {}).get("code", "")

s, b = req("/rest/v1/assets?select=id&name=eq.SmokeM2 Activo", token=ADMIN)
ASSET = (j(b) or [{}])[0]
if not ASSET.get("id"):
    s, b = req("/rest/v1/assets", "POST",
               {"code": alloc_code(), "name": "SmokeM2 Activo", "category_id": CAT["id"],
                "location_id": LOC["id"], "criticality": "medium",
                "commissioning_date": "2026-10-01", "has_usage_counter": True},
               token=MANT, headers={"Prefer": "return=representation"})
    ASSET = (j(b) or [{}])[0]
AID = ASSET.get("id")
check("asset smoke2", bool(AID), b[:200])

s, b = req("/rest/v1/assets?select=id&name=eq.SmokeM2 Comp", token=ADMIN)
COMP = (j(b) or [{}])[0]
if not COMP.get("id"):
    s, b = req("/rest/v1/assets", "POST",
               {"code": alloc_code(), "name": "SmokeM2 Comp", "category_id": CAT["id"],
                "location_id": LOC["id"], "parent_id": AID, "criticality": "low",
                "commissioning_date": "2026-10-01"},
               token=MANT, headers={"Prefer": "return=representation"})
    COMP = (j(b) or [{}])[0]
CID = COMP.get("id")
check("component smoke2", bool(CID), b[:200])

s, b = req("/rest/v1/providers?select=id&code=eq.SMOKE-PRV-01", token=ADMIN)
PROV = (j(b) or [{}])[0]
if not PROV.get("id"):
    s, b = req("/rest/v1/providers", "POST",
               {"code": "SMOKE-PRV-01", "name": "SmokeM2 Contractor", "provider_type": "contractor",
                "contact_name": "Contacto Smoke"},
               token=MANT, headers={"Prefer": "return=representation"})
    PROV = (j(b) or [{}])[0]
PID = PROV.get("id")
check("provider smoke2", bool(PID), b[:250])

# ---------- A. m2_create_wo ----------
s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 manual open"}, MANT)
WO_BASE = (d or {}).get("id")
check("create wo manual", s == 200 and WO_BASE and str(d.get("wo_number", "")).startswith("OT-"), b[:200])
check("create wo default open", (d or {}).get("status") == "open", d)

s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 tec"}, TEC1)
check("create wo tecnico 400", s >= 400 and "Mantenimiento" in b, b[:200])
s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 calidad"}, CAL)
check("create wo calidad 400", s >= 400 and "Mantenimiento" in b, b[:200])
s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 ext",
                               "p_executed_by_type": "external"}, MANT)
check("external sin proveedor 400", s >= 400 and "proveedor" in b, b[:200])
s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 bad comp",
                               "p_component_id": str(uuid.uuid4())}, MANT)
check("componente ajeno 400", s >= 400 and "componente" in b, b[:200])
s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 dup",
                               "p_technicians": [TEC1_ID, TEC1_ID]}, MANT)
check("tecnicos duplicados 400", s >= 400 and "duplicados" in b, b[:200])

s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 asignada",
                               "p_component_id": CID, "p_technicians": [TEC1_ID]}, MANT)
WO_A = (d or {}).get("id")
check("create wo con tecnico", s == 200 and WO_A and d.get("status") == "assigned", b[:200])
rows = svc_get(f"/rest/v1/wo_technicians?select=user_id&wo_id=eq.{WO_A}&removed_at=is.null")
check("wo_technicians alta", len(rows) == 1 and rows[0]["user_id"] == TEC1_ID, rows)

s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 replace",
                               "p_technicians": [TEC1_ID, TEC2_ID]}, MANT)
WO_R = (d or {}).get("id")
check("create wo 2 tecnicos", s == 200 and WO_R and d.get("status") == "assigned", b[:200])

# insert directo (spec save_actions: numero autogenerado)
s, b = req("/rest/v1/work_orders", "POST", {"asset_id": AID,
                                            "description": "SmokeM2 direct insert"},
           token=MANT, headers={"Prefer": "return=representation"})
DIRECT = (j(b) or [{}])[0] if s in (200, 201) else {}
check("insert directo mant auto-number", s == 201 and str(DIRECT.get("wo_number", "")).startswith("OT-"), f"{s} {b[:200]}")
s, b = req("/rest/v1/work_orders", "POST", {"asset_id": AID, "description": "SmokeM2 tec insert"}, token=TEC1)
check("insert directo tecnico 403", s in (401, 403), f"{s} {b[:150]}")

# ---------- B. reportes de daño (F2.1) + Evento 5 ----------
s, b = req("/rest/v1/damage_reports", "POST",
           {"asset_id": AID, "description": "SmokeM2 rotura pantalla", "reported_by": TEC1_ID},
           token=TEC1, headers={"Prefer": "return=representation"})
DR1 = (j(b) or [{}])[0] if s in (200, 201) else {}
check("reporte tec1", s == 201 and DR1.get("id"), f"{s} {b[:200]}")
rows = svc_get(f"/rest/v1/notification_log?select=id&event_id=eq.5&dedup_key=eq.damage-report:{DR1.get('id','')}")
check("evento 5 alta reporte", len(rows) >= 1, rows)

s, b = req("/rest/v1/damage_reports", "POST",
           {"asset_id": AID, "description": "SmokeM2 admin no reporta", "reported_by": ADMIN_ID},
           token=ADMIN)
check("reporte admin 403", s in (401, 403), f"{s} {b[:150]}")

s, b = req("/rest/v1/damage_reports", "POST",
           {"asset_id": AID, "description": "SmokeM2 calidad reporte", "reported_by": CAL_ID},
           token=CAL, headers={"Prefer": "return=representation"})
DR2 = (j(b) or [{}])[0] if s in (200, 201) else {}
check("reporte calidad", s == 201 and DR2.get("id"), f"{s} {b[:200]}")

s, b = req(f"/rest/v1/v2_damage_reports?select=id&id=eq.{DR2.get('id','')}", token=TEC1)
check("rls tecnico no ve reporte ajeno", s == 200 and (j(b) or []) == [], b[:150])
s, b = req(f"/rest/v1/v2_damage_reports?select=id&id=eq.{DR2.get('id','')}", token=ADMIN)
check("admin ve todos los reportes", s == 200 and len(j(b) or []) == 1, b[:150])
s, b = req(f"/rest/v1/v2_damage_reports?select=id&reported_by=eq.{TEC1_ID}", token=TEC1)
check("tecnico ve los suyos", s == 200 and len(j(b) or []) >= 1, b[:150])

# ---------- C. conversion (F2.2) ----------
s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 desde reporte",
                               "p_origin": "damage_report", "p_damage_report_id": DR1.get("id"),
                               "p_reported_by": TEC1_ID, "p_technicians": [TEC1_ID]}, MANT)
WO_CONV = (d or {}).get("id")
check("convertir reporte a OT", s == 200 and WO_CONV, b[:200])
dr = svc_get(f"/rest/v1/damage_reports?select=status,reviewed_by&id=eq.{DR1.get('id','')}")
check("reporte convertido", dr and dr[0]["status"] == "converted" and dr[0]["reviewed_by"] == MANT_ID, dr)
wo = svc_get(f"/rest/v1/work_orders?select=origin,damage_report_id&id=eq.{WO_CONV}")
check("OT origen damage_report", wo and wo[0]["origin"] == "damage_report"
      and wo[0]["damage_report_id"] == DR1.get("id"), wo)

s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 reconvert",
                               "p_origin": "damage_report", "p_damage_report_id": DR1.get("id")}, MANT)
check("reconvertir reporte 400", s >= 400 and "revisado" in b, b[:200])
s, d, b = rpc("m2_create_wo", {"p_asset_id": CID, "p_description": "SmokeM2 asset equivocado",
                               "p_origin": "damage_report", "p_damage_report_id": DR2.get("id")}, MANT)
check("conversion asset equivocado 400", s >= 400 and "otro activo" in b, b[:200])

# ---------- D. asignacion (F2.4) ----------
s, d, b = rpc("m2_assign_wo", {"p_wo_id": WO_A, "p_technicians": [TEC1_ID]}, MANT)
check("assign mismo tecnico ok", s in (200, 204), b[:200])
s, d, b = rpc("m2_assign_wo", {"p_wo_id": WO_A, "p_technicians": [TEC2_ID]}, MANT)
check("reasignar set ok", s in (200, 204), b[:200])
rows = svc_get(f"/rest/v1/wo_technicians?select=user_id,removed_at&wo_id=eq.{WO_A}")
act = [r["user_id"] for r in rows if r["removed_at"] is None]
rem = [r["user_id"] for r in rows if r["removed_at"] is not None]
check("historico conservado", act == [TEC2_ID] and TEC1_ID in rem, rows)
wo = svc_get(f"/rest/v1/work_orders?select=status,reassigned&id=eq.{WO_A}")
check("flag reassigned en swap", wo and wo[0]["status"] == "assigned" and wo[0]["reassigned"] is True, wo)

s, d, b = rpc("m2_assign_wo", {"p_wo_id": WO_A, "p_technicians": []}, MANT)
wo = svc_get(f"/rest/v1/work_orders?select=status&id=eq.{WO_A}")
check("vaciar asignacion -> open", s in (200, 204) and wo and wo[0]["status"] == "open", f"{b[:120]} {wo}")

s, d, b = rpc("m2_assign_wo", {"p_wo_id": WO_A, "p_technicians": [CAL_ID]}, MANT)
check("asignar no-tecnico 400", s >= 400 and "seleccionados" in b, b[:200])
s, d, b = rpc("m2_assign_wo", {"p_wo_id": WO_A, "p_technicians": [TEC1_ID]}, TEC1)
check("assign por tecnico 400", s >= 400 and "Mantenimiento" in b, b[:200])

# ---------- E. reemplazo de tecnico (F2.4 por_tecnico) ----------
s, d, b = rpc("m2_assign_wo", {"p_wo_id": WO_R, "p_technicians": [TEC1_ID, TEC2_ID]}, MANT)
check("restaurar 2 tecnicos", s in (200, 204), b[:150])

s, d, b = rpc("m2_technician_replace",
              {"p_wo_id": WO_R, "p_out_user": TEC1_ID, "p_in_user": TEC3_ID,
               "p_observation": "SmokeM2 obs reemplazo"}, TEC1)
check("replace por tecnico asignado", s in (200, 204), b[:200])
rows = svc_get(f"/rest/v1/wo_technicians?select=user_id,removed_at&wo_id=eq.{WO_R}")
act = [r["user_id"] for r in rows if r["removed_at"] is None]
check("replace efectivo", sorted(act) == sorted([TEC2_ID, TEC3_ID]), rows)
rows = svc_get(f"/rest/v1/audit_log?select=action,reason&module=eq.work_orders&entity_id=eq.{WO_R}&action=eq.replace")
check("audit replace con motivo", any("SmokeM2 obs reemplazo" in (r.get("reason") or "") for r in rows), rows)

s, d, b = rpc("m2_technician_replace",
              {"p_wo_id": WO_R, "p_out_user": TEC3_ID, "p_in_user": TEC1_ID, "p_observation": "  "},
              TEC3)
check("replace sin obs 400", s >= 400 and "obligatoria" in b, b[:200])
s, d, b = rpc("m2_technician_replace",
              {"p_wo_id": WO_R, "p_out_user": TEC3_ID, "p_in_user": TEC2_ID, "p_observation": "x"}, CAL)
check("replace por calidad 400", s >= 400 and "asignados" in b, b[:200])
s, d, b = rpc("m2_technician_replace",
              {"p_wo_id": WO_R, "p_out_user": TEC3_ID, "p_in_user": TEC2_ID, "p_observation": "x"}, TEC3)
check("replace hacia asignado 400", s >= 400 and "ya est" in b, b[:200])
s, d, b = rpc("m2_technician_replace",
              {"p_wo_id": WO_R, "p_out_user": TEC2_ID, "p_in_user": TEC1_ID,
               "p_observation": "SmokeM2 vuelve tec1"}, TEC3)
check("replace inverso ok", s in (200, 204), b[:200])

# ---------- F. transiciones y guards (F2.5) ----------
s, d, b = rpc("m2_assign_wo", {"p_wo_id": WO_A, "p_technicians": [TEC2_ID]}, MANT)
check("WO_A asignado a tec2", s in (200, 204), b[:150])
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_A}", "PATCH", {"status": "in_progress"}, token=TEC2)
check("tecnico inicia su OT", s == 204, f"{s} {b[:200]}")
wo = svc_get(f"/rest/v1/work_orders?select=status&id=eq.{WO_A}")
check("WO_A en curso", wo and wo[0]["status"] == "in_progress", wo)

s, d, b = rpc("m2_assign_wo", {"p_wo_id": WO_BASE, "p_technicians": [TEC1_ID]}, MANT)
check("WO_BASE asignado a tec1", s in (200, 204), b[:150])
wo = svc_get(f"/rest/v1/work_orders?select=status&id=eq.{WO_BASE}")
check("WO_BASE estado assigned", wo and wo[0]["status"] == "assigned", wo)
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_BASE}", "PATCH", {"status": "in_progress"}, token=TEC1)
check("WO_BASE inicia (asignada)", s == 204, f"{s} {b[:200]}")
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_BASE}", "PATCH", {"status": "waiting_parts"}, token=TEC1)
check("tecnico waiting_parts", s == 204, f"{s} {b[:200]}")
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_BASE}", "PATCH", {"status": "in_progress"}, token=TEC1)
check("vuelve in_progress", s == 204, f"{s} {b[:200]}")
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_BASE}", "PATCH", {"status": "completed"}, token=TEC1)
check("tecnico completa su OT", s == 204, f"{s} {b[:200]}")
wo = svc_get(f"/rest/v1/work_orders?select=finished_at,status&id=eq.{WO_BASE}")
check("finished_at marcado auto", wo and wo[0]["finished_at"] is not None and wo[0]["status"] == "completed", wo)

# RLS UPDATE: 204 con 0 filas (el dato no debe cambiar)
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_BASE}", "PATCH", {"description": "SmokeM2 tec2 edit"}, token=TEC2)
wo = svc_get(f"/rest/v1/work_orders?select=description&id=eq.{WO_BASE}")
check("otro tecnico bloqueado RLS", s == 204 and wo and wo[0]["description"] == "SmokeM2 manual open", f"{s} {wo}")
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_BASE}", "PATCH", {"status": "cancelled"}, token=TEC1)
check("tecnico no cancela", s >= 400 and "Mantenimiento" in b, b[:200])
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_BASE}", "PATCH", {"status": "closed"}, token=TEC1)
check("tecnico no cierra", s >= 400 and "Mantenimiento cierra" in b, b[:200])
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_R}", "PATCH", {"provider_id": PID}, token=TEC1)
check("tecnico no edita provider", s >= 400 and "Sin permiso" in b, b[:200])
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_R}", "PATCH", {"priority": "urgent"}, token=TEC1)
check("tecnico edita prioridad", s == 204, f"{s} {b[:150]}")
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_BASE}", "PATCH", {"description": "SmokeM2 cal edit"}, token=CAL)
wo = svc_get(f"/rest/v1/work_orders?select=description&id=eq.{WO_BASE}")
check("calidad no actualiza OT", s == 204 and wo and wo[0]["description"] == "SmokeM2 manual open", f"{s} {wo}")
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_BASE}", "PATCH", {"description": "SmokeM2 admin edit"}, token=ADMIN)
wo = svc_get(f"/rest/v1/work_orders?select=description&id=eq.{WO_BASE}")
check("admin no actualiza OT", s == 204 and wo and wo[0]["description"] == "SmokeM2 manual open", f"{s} {wo}")

# horas por tecnico
s, b = req(f"/rest/v1/wo_technicians?wo_id=eq.{WO_R}&user_id=eq.{TEC1_ID}",
           "PATCH", {"hours_worked": 2.5}, token=TEC1)
check("horas propias editables", s == 204, f"{s} {b[:150]}")
rows = svc_get(f"/rest/v1/wo_technicians?select=hours_worked&wo_id=eq.{WO_R}&user_id=eq.{TEC1_ID}")
check("horas persistidas", rows and float(rows[0]["hours_worked"]) == 2.5, rows)
s, b = req(f"/rest/v1/wo_technicians?wo_id=eq.{WO_R}&user_id=eq.{TEC1_ID}",
           "PATCH", {"removed_at": "2026-10-10T00:00:00+00:00"}, token=TEC1)
check("tecnico no se remueve solo", s >= 400 and "horas de trabajo" in b, b[:200])
s, b = req(f"/rest/v1/wo_technicians?wo_id=eq.{WO_R}&user_id=eq.{TEC2_ID}",
           "PATCH", {"hours_worked": 9}, token=TEC1)
rows = svc_get(f"/rest/v1/wo_technicians?select=hours_worked&wo_id=eq.{WO_R}&user_id=eq.{TEC2_ID}")
check("tecnico no edita horas ajenas", s in (200, 204) and rows and float(rows[0]["hours_worked"]) == 0, f"{s} {rows}")

# replace en estado Completada (WO_R)
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_R}", "PATCH", {"status": "in_progress"}, token=TEC3)
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_R}", "PATCH", {"status": "completed"}, token=TEC3)
check("WO_R completada", s == 204, f"{s} {b[:150]}")
s, d, b = rpc("m2_technician_replace",
              {"p_wo_id": WO_R, "p_out_user": TEC1_ID, "p_in_user": TEC2_ID,
               "p_observation": "x"}, TEC3)
check("replace en completada 400", s >= 400 and "Reemplazo no permitido" in b, b[:200])

# ---------- G. vistas ----------
s, b = req("/rest/v1/v2_work_orders?select=wo_number,status&status=eq.open&description=ilike.SmokeM2%25",
           token=TEC1)
rows = j(b) or [] if s == 200 else []
check("v2_work_orders tecnico", s == 200 and len(rows) >= 1, b[:150])

s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 externa",
                               "p_executed_by_type": "external", "p_provider_id": PID,
                               "p_technicians": [TEC1_ID]}, MANT)
WO_EXT = (d or {}).get("id")
check("create wo externa", s == 200 and WO_EXT, b[:200])
s, b = req(f"/rest/v1/v2_work_orders?select=provider_name&id=eq.{WO_EXT}", token=TEC1)
rows = j(b) or []
check("provider_name visible para tecnico", s == 200 and rows and rows[0]["provider_name"] == "SmokeM2 Contractor", b[:200])
s, b = req("/rest/v1/v2_work_orders?select=id&description=ilike.SmokeM2%25", token=CAL)
check("v2_work_orders calidad", s == 200 and len(j(b) or []) >= 1, b[:150])
s, b = req(f"/rest/v1/v1_assets?select=open_wo_count&id=eq.{AID}", token=ADMIN)
rows = j(b) or []
check("v1_assets open_wo_count >= 1", s == 200 and rows and rows[0]["open_wo_count"] >= 1, b[:200])

# ---------- H. evidencia (V2.3) + storage ----------
EV_ID = None
s, b = req("/rest/v1/wo_evidence", "POST",
           {"work_order_id": WO_BASE, "kind": "after",
            "storage_path": f"smoke2/{uuid.uuid4()}.jpg", "uploaded_by": TEC1_ID},
           apikey=SERVICE, token=SERVICE, headers={"Prefer": "return=representation"})
EV_ID = ((j(b) or [{}])[0] or {}).get("id") if s in (200, 201) else None
check("evidencia insert (service)", bool(EV_ID), f"{s} {b[:200]}")
s, b = req(f"/rest/v1/wo_evidence?id=eq.{EV_ID}", "DELETE", token=MANT)
rows = svc_get(f"/rest/v1/wo_evidence?select=id&id=eq.{EV_ID}")
check("evidencia borrada (OT abierta)", s in (200, 204) and rows == [], f"{s} {rows}")

s, b = req("/storage/v1/bucket", token=SERVICE, apikey=SERVICE)
check("bucket ot_evidencias", s == 200 and "ot_evidencias" in b, b[:200])
up_path = f"smoke2/{uuid.uuid4()}.txt"
s, b = req(f"/storage/v1/object/ot_evidencias/{up_path}", "POST", raw="smoke m2", token=TEC1, ctype="text/plain")
check("upload tecnico", s in (200, 201), f"{s} {b[:200]}")
s, b = req(f"/storage/v1/object/ot_evidencias/{up_path}-admin", "POST", raw="admin", token=ADMIN, ctype="text/plain")
check("upload admin 403", s in (400, 401, 403), f"{s} {b[:150]}")
s, b = req(f"/storage/v1/object/ot_evidencias/{up_path}", token=ADMIN)
check("download admin", s == 200, f"{s} {b[:150]}")
s, b = req(f"/storage/v1/object/ot_evidencias/{up_path}", "DELETE", token=ADMIN)
s2, b2 = req(f"/storage/v1/object/ot_evidencias/{up_path}", token=TEC1)
check("delete admin denegado", s2 == 200, f"del={s} get={s2} {b2[:150]}")
s, b = req(f"/storage/v1/object/ot_evidencias/{up_path}", "DELETE", token=TEC1)
check("delete owner", s in (200, 204), f"{s} {b[:150]}")

# ---------- I. comentarios (V2.3 — Calidad comenta) ----------
s, b = req("/rest/v1/wo_comments", "POST", {"wo_id": WO_BASE, "author_id": CAL_ID,
                                            "body": "SmokeM2 calidad comenta"},
           token=CAL, headers={"Prefer": "return=representation"})
CMT = (j(b) or [{}])[0] if s in (200, 201) else {}
check("calidad comenta (V2.3)", s == 201 and CMT.get("id"), f"{s} {b[:200]}")
s, b = req("/rest/v1/wo_comments", "POST", {"wo_id": WO_BASE, "author_id": TEC2_ID,
                                            "body": "SmokeM2 tec2"}, token=TEC2)
check("tecnico no asignado comenta 403", s in (401, 403), f"{s} {b[:150]}")
s, b = req("/rest/v1/wo_comments", "POST", {"wo_id": WO_BASE, "author_id": ADMIN_ID,
                                            "body": "admin"}, token=ADMIN)
check("admin no comenta 403", s in (401, 403), f"{s} {b[:150]}")
s, b = req("/rest/v1/wo_comments?select=id", token=ADMIN)
check("admin lee comentarios", s == 200 and len(j(b) or []) >= 1, b[:150])
s, b = req(f"/rest/v1/wo_comments?id=eq.{CMT.get('id','')}", "PATCH", {"body": "editado"}, token=MANT)
rows = svc_get(f"/rest/v1/wo_comments?select=body&id=eq.{CMT.get('id','')}")
check("comentario inmutable", s == 204 and rows and rows[0]["body"] == "SmokeM2 calidad comenta", rows)

# ---------- J. checklist (bloqueo de cierre) ----------
s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 checklist",
                               "p_technicians": [TEC1_ID]}, MANT)
WO_CHK = (d or {}).get("id")
s, b = req("/rest/v1/wo_checklist_entries", "POST",
           {"wo_id": WO_CHK, "position": 1, "item_text": "SmokeM2 item"},
           apikey=SERVICE, token=SERVICE, headers={"Prefer": "return=representation"})
CHK = (j(b) or [{}])[0] if s in (200, 201) else {}
check("checklist insert (service)", s in (200, 201) and CHK.get("id"), f"{s} {b[:200]}")
s, b = req(f"/rest/v1/wo_checklist_entries?id=eq.{CHK.get('id','')}", "PATCH", {"status": "done"}, token=CAL)
rows = svc_get(f"/rest/v1/wo_checklist_entries?select=status&id=eq.{CHK.get('id','')}")
check("calidad no marca checklist (RLS)", s in (200, 204) and rows and rows[0]["status"] == "pending",
      f"{s} {rows}")

s, b = req(f"/rest/v1/work_orders?id=eq.{WO_CHK}", "PATCH", {"status": "in_progress"}, token=TEC1)
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_CHK}", "PATCH", {"status": "completed"}, token=TEC1)
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_CHK, "diagnosis": "d", "solution": "s", "generates_warranty": False},
           token=MANT)
check("cierre con checklist pendiente 400", s == 400 and "pendientes" in b, f"{s} {b[:200]}")

s, b = req(f"/rest/v1/wo_checklist_entries?id=eq.{CHK.get('id','')}", "PATCH", {"status": "done"}, token=TEC1)
rows = svc_get(f"/rest/v1/wo_checklist_entries?select=status,done_by&id=eq.{CHK.get('id','')}")
check("tecnico marca checklist", s == 204 and rows and rows[0]["status"] == "done"
      and rows[0]["done_by"] == TEC1_ID, f"{s} {rows}")
s, b = req(f"/rest/v1/wo_checklist_entries?id=eq.{CHK.get('id','')}", "DELETE", token=MANT)
rows = svc_get(f"/rest/v1/wo_checklist_entries?select=id&id=eq.{CHK.get('id','')}")
check("checklist sin DELETE", s in (200, 204) and len(rows) == 1, rows)

s, b = req(f"/rest/v1/wo_checklist_entries?id=eq.{CHK.get('id','')}", "PATCH", {"status": "pending"}, token=TEC1)
rows = svc_get(f"/rest/v1/wo_checklist_entries?select=status,done_by&id=eq.{CHK.get('id','')}")
check("checklist vuelve pending", s == 204 and rows and rows[0]["status"] == "pending"
      and rows[0]["done_by"] is None, rows)
s, b = req(f"/rest/v1/wo_checklist_entries?id=eq.{CHK.get('id','')}", "PATCH",
           {"status": "not_applicable", "note": "SmokeM2 na"}, token=TEC1)
check("not_applicable exige motivo ok", s == 204, f"{s} {b[:150]}")

# ---------- K. cierre EF (F2.6 / M2.1) ----------
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_BASE, "diagnosis": "d", "solution": "s", "generates_warranty": False},
           token=ADMIN)
check("cierre admin 403", s == 403, f"{s} {b[:150]}")
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_BASE, "diagnosis": "d", "solution": "s", "generates_warranty": False},
           token=TEC1)
check("cierre tecnico 403", s == 403, f"{s} {b[:150]}")
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_BASE, "diagnosis": "d", "solution": "s"}, token=MANT)
check("cierre sin garantia 400", s == 400 and "garantia" in b.lower(), f"{s} {b[:200]}")
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_BASE, "diagnosis": "", "solution": "s", "generates_warranty": False}, token=MANT)
check("cierre sin diagnostico 400", s == 400, f"{s} {b[:200]}")

cnt_before = svc_get(f"/rest/v1/assets?select=usage_counter&id=eq.{AID}")
CB = cnt_before[0]["usage_counter"] if cnt_before else None
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_BASE, "diagnosis": "SmokeM2 diag", "solution": "SmokeM2 sol",
            "generates_warranty": False, "affects_sale": False}, token=MANT)
resp = j(b) or {}
wo = svc_get(f"/rest/v1/work_orders?select=status,closed_by,diagnosis,generates_warranty&id=eq.{WO_BASE}")
check("cierre EF ok", s == 200 and resp.get("ok") is True, f"{s} {b[:200]}")
check("OT cerrada", wo and wo[0]["status"] == "closed" and wo[0]["closed_by"] == MANT_ID, wo)
check("diagnostico persistido", wo and wo[0]["diagnosis"] == "SmokeM2 diag"
      and wo[0]["generates_warranty"] is False, wo)
cnt_after = svc_get(f"/rest/v1/assets?select=usage_counter&id=eq.{AID}")
CA = cnt_after[0]["usage_counter"] if cnt_after else None
check("usage_counter +1", CA == (CB or 0) + 1, f"before={CB} after={CA}")

# evidencia en OT cerrada: nunca se borra
s, b = req("/rest/v1/wo_evidence", "POST",
           {"work_order_id": WO_BASE, "kind": "before",
            "storage_path": f"smoke2/{uuid.uuid4()}.jpg", "uploaded_by": TEC1_ID},
           apikey=SERVICE, token=SERVICE, headers={"Prefer": "return=representation"})
EV2 = ((j(b) or [{}])[0] or {}).get("id")
s, b = req(f"/rest/v1/wo_evidence?id=eq.{EV2}", "DELETE", token=MANT)
rows = svc_get(f"/rest/v1/wo_evidence?select=id&id=eq.{EV2}")
check("borrado bloqueado en Cerrada", s >= 400 and "Cerrada" in b and len(rows) == 1, f"{s} {b[:200]}")

# cierre externo: costo obligatorio
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_EXT}", "PATCH", {"status": "in_progress"}, token=TEC1)
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_EXT}", "PATCH", {"status": "completed"}, token=TEC1)
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_EXT, "diagnosis": "d", "solution": "s", "generates_warranty": False,
            "executed_by_type": "external", "provider_id": PID}, token=MANT)
check("cierre externo sin costo 400", s == 400 and "costo" in b.lower(), f"{s} {b[:200]}")
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_EXT, "diagnosis": "d", "solution": "s", "generates_warranty": False,
            "executed_by_type": "external", "provider_id": PID, "external_cost": 150}, token=MANT)
wo = svc_get(f"/rest/v1/work_orders?select=status,external_cost,executed_by_type&id=eq.{WO_EXT}")
check("cierre externo con costo", s == 200 and wo and wo[0]["status"] == "closed"
      and float(wo[0]["external_cost"]) == 150, f"{b[:200]} {wo}")

s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_CHK, "diagnosis": "d", "solution": "s", "generates_warranty": False},
           token=MANT)
wo = svc_get(f"/rest/v1/work_orders?select=status&id=eq.{WO_CHK}")
check("cierre tras checklist na", s == 200 and wo and wo[0]["status"] == "closed", f"{s} {b[:200]}")

# ---------- L. Evento 1 (alta + cierre) ----------
s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 venta",
                               "p_affects_sale": True}, MANT)
WO_SALE = (d or {}).get("id")
check("create wo afecta venta", s == 200 and WO_SALE, b[:200])
rows = svc_get(f"/rest/v1/notification_log?select=id&event_id=eq.1&dedup_key=eq.wo-open:{WO_SALE}")
check("evento 1 alta", len(rows) >= 1, rows)
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_SALE}", "PATCH", {"status": "in_progress"}, token=MANT)
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_SALE}", "PATCH", {"status": "completed"}, token=MANT)
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_SALE, "diagnosis": "d", "solution": "s", "generates_warranty": False,
            "affects_sale": True}, token=MANT)
rows = svc_get(f"/rest/v1/notification_log?select=id&event_id=eq.1&dedup_key=eq.wo-close:{WO_SALE}")
check("evento 1 cierre", s == 200 and len(rows) >= 1, f"{s} {b[:150]} {rows}")

# ---------- M. garantia al cierre (F1.5 + create-or-edit) ----------
s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 garantia",
                               "p_technicians": [TEC1_ID]}, MANT)
WO_W = (d or {}).get("id")
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_W}", "PATCH", {"status": "in_progress"}, token=TEC1)
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_W}", "PATCH", {"status": "completed"}, token=TEC1)
WARR = {"start_date": "2026-10-10", "end_date": "2027-10-10", "coverage": "both",
        "provider_id": PID, "provider_name": "SmokeM2 Contractor", "notes": "SmokeM2 w"}
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_W, "diagnosis": "d", "solution": "s", "generates_warranty": True,
            "warranty": WARR}, token=MANT)
w = svc_get(f"/rest/v1/warranties?select=id,warranty_type,origin_wo_id,asset_id,coverage"
            f"&origin_wo_id=eq.{WO_W}")
check("cierre con garantia", s == 200 and len(w) == 1 and w[0]["warranty_type"] == "repair"
      and w[0]["asset_id"] == AID and w[0]["coverage"] == "both", f"{s} {b[:200]} {w}")
WID = w[0]["id"] if w else None

s, _, b = rpc("m2_reopen_wo", {"p_wo_id": WO_W, "p_reason": "SmokeM2 reabrir"}, MANT)
check("reapertura ok", s in (200, 204), f"{s} {b[:200]}")
w = svc_get(f"/rest/v1/warranties?select=is_origin_reopened&id=eq.{WID}")
check("garantia marcada reabierta", w and w[0]["is_origin_reopened"] is True, w)
wo = svc_get(f"/rest/v1/work_orders?select=status,closed_at,finished_at,generates_warranty&id=eq.{WO_W}")
check("reabierta limpia cierre", wo and wo[0]["status"] == "in_progress"
      and wo[0]["closed_at"] is None and wo[0]["finished_at"] is None
      and wo[0]["generates_warranty"] is None, wo)

s, b = req(f"/rest/v1/work_orders?id=eq.{WO_W}", "PATCH", {"status": "completed"}, token=TEC1)
wo = svc_get(f"/rest/v1/work_orders?select=finished_at&id=eq.{WO_W}")
check("finished_at tras re-cierre directo", s == 204 and wo and wo[0]["finished_at"] is not None, f"{s} {wo}")
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_W}", "PATCH", {"status": "in_progress"}, token=TEC1)
WARR2 = dict(WARR, end_date="2028-10-10")
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_W, "diagnosis": "d2", "solution": "s2", "generates_warranty": True,
            "warranty": WARR2}, token=MANT)
w = svc_get(f"/rest/v1/warranties?select=id,end_date&origin_wo_id=eq.{WO_W}")
check("re-cierre edita garantia", s == 200 and len(w) == 1 and w[0]["id"] == WID
      and w[0]["end_date"] == "2028-10-10", f"{s} {b[:200]} {w}")

# ---------- N. cancelacion y reapertura (F2.7/F2.8) ----------
s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM2 cancel"}, MANT)
WO_C = (d or {}).get("id")
s, _, b = rpc("m2_cancel_wo", {"p_wo_id": WO_C, "p_reason": "x"}, TEC1)
check("cancelar por tecnico 400", s >= 400 and "Mantenimiento" in b, b[:200])
s, _, b = rpc("m2_cancel_wo", {"p_wo_id": WO_C, "p_reason": "   "}, MANT)
check("cancelar sin motivo 400", s >= 400 and "motivo" in b, b[:200])
s, _, b = rpc("m2_cancel_wo", {"p_wo_id": WO_C, "p_reason": "SmokeM2 cancel motivo"}, MANT)
wo = svc_get(f"/rest/v1/work_orders?select=status&id=eq.{WO_C}")
check("cancelar ok", s in (200, 204) and wo and wo[0]["status"] == "cancelled", f"{s} {b[:200]}")
rows = svc_get(f"/rest/v1/audit_log?select=reason&module=eq.work_orders&entity_id=eq.{WO_C}"
               "&action=eq.state_change")
check("audit cancel con motivo", any("SmokeM2 cancel motivo" in (r.get("reason") or "") for r in rows), rows)
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_C}", "PATCH", {"status": "in_progress"}, token=MANT)
check("update directo tras cancel 400", s >= 400 and "reapertura" in b, f"{s} {b[:200]}")
s, _, b = rpc("m2_reopen_wo", {"p_wo_id": WO_C, "p_reason": "y"}, TEC1)
check("reabrir por tecnico 400", s >= 400 and "Mantenimiento" in b, b[:200])
s, _, b = rpc("m2_reopen_wo", {"p_wo_id": WO_C, "p_reason": " "}, MANT)
check("reabrir sin motivo 400", s >= 400 and "motivo" in b, b[:200])
s, _, b = rpc("m2_reopen_wo", {"p_wo_id": WO_C, "p_reason": "SmokeM2 reabrir motivo"}, MANT)
wo = svc_get(f"/rest/v1/work_orders?select=status&id=eq.{WO_C}")
check("reabrir ok", s in (200, 204) and wo and wo[0]["status"] == "in_progress", f"{s} {b[:200]}")

# ---------- O. descarte de reporte (F2.2) ----------
s, _, b = rpc("m2_discard_damage_report", {"p_report_id": DR2.get("id"), "p_reason": "x"}, CAL)
check("descartar por calidad 400", s >= 400 and "Mantenimiento" in b, b[:200])
s, _, b = rpc("m2_discard_damage_report", {"p_report_id": DR2.get("id"), "p_reason": ""}, MANT)
check("descartar sin motivo 400", s >= 400 and "motivo" in b, b[:200])
s, _, b = rpc("m2_discard_damage_report", {"p_report_id": DR2.get("id"), "p_reason": "SmokeM2 descarte"}, MANT)
rows = svc_get(f"/rest/v1/damage_reports?select=status,discard_reason&id=eq.{DR2.get('id','')}")
check("descartar ok", s in (200, 204) and rows and rows[0]["status"] == "discarded"
      and "SmokeM2" in rows[0]["discard_reason"], f"{s} {b[:200]} {rows}")
rows = svc_get(f"/rest/v1/audit_log?select=action,reason&module=eq.work_orders"
               f"&entity_id=eq.{DR2.get('id','')}")
check("audit discard", any(r.get("action") == "discard" and "SmokeM2 descarte" in (r.get("reason") or "")
                           for r in rows), rows)
s, _, b = rpc("m2_discard_damage_report", {"p_report_id": DR1.get("id"), "p_reason": "z"}, MANT)
check("descartar convertido 400", s >= 400 and "revisado" in b, b[:200])

# ---------- P. EF wo_dispatch_push (push T2) ----------
s, b = req("/functions/v1/wo_dispatch_push", "POST",
           {"action": "assigned", "wo_id": WO_A, "user_ids": [TEC1_ID]})
check("push sin tokens no-op", s == 200 and '"ok"' in b, f"{s} {b[:200]}")
s, b = req("/rest/v1/push_subscriptions", "POST",
           {"user_id": TEC1_ID, "fcm_token": "smoke-m2-fake-token", "device_info": "smoke"},
           apikey=SERVICE, token=SERVICE)
check("push_sub insert", s in (200, 201, 409), f"{s} {b[:200]}")
s, b = req("/functions/v1/wo_dispatch_push", "POST",
           {"action": "assigned", "wo_id": WO_A, "user_ids": [TEC1_ID]})
check("push con token no-op elegante", s == 200 and '"ok"' in b, f"{s} {b[:200]}")
req("/rest/v1/push_subscriptions?fcm_token=eq.smoke-m2-fake-token", "DELETE",
    apikey=SERVICE, token=SERVICE)

# ---------- Q. RLS negativos varios ----------
s, b = req(f"/rest/v1/work_orders?id=eq.{WO_A}", "DELETE", token=TEC1)
rows = svc_get(f"/rest/v1/work_orders?select=id&id=eq.{WO_A}")
check("DELETE prohibido (persiste)", s in (200, 204) and len(rows) == 1, rows)
s, b = req(f"/rest/v1/wo_technicians?wo_id=eq.{WO_A}&user_id=eq.{TEC2_ID}", "DELETE", token=TEC2)
rows = svc_get(f"/rest/v1/wo_technicians?select=wo_id&wo_id=eq.{WO_A}&user_id=eq.{TEC2_ID}")
check("wo_technicians sin DELETE", s in (200, 204) and len(rows) == 1, rows)
s, b = req("/rest/v1/rpc/m2_assign_wo", "POST", {"p_wo_id": WO_A, "p_technicians": []}, token=CAL)
check("calidad no asigna 400", s >= 400 and "Mantenimiento" in b, b[:200])
s, d, b = rpc("m2_assign_wo", {"p_wo_id": WO_BASE, "p_technicians": [TEC1_ID]}, MANT)
check("assign en OT cerrada 400", s >= 400 and "terminal" in b, b[:200])
s, b = req("/functions/v1/wo_close_engine", "POST",
           {"wo_id": WO_C, "diagnosis": "d", "solution": "s", "generates_warranty": False}, token=MANT)
check("cierre directo desde en-proceso", s == 200, f"{s} {b[:200]}")

# ---------- R. cobertura de auditoria ----------
ids = ",".join(filter(None, [WO_BASE, WO_A, WO_R, WO_CONV, WO_C, WO_W, WO_SALE, WO_EXT, WO_CHK]))
rows = svc_get(f"/rest/v1/audit_log?select=action&module=eq.work_orders&entity_id=in.({ids})")
actions = {r["action"] for r in rows}
need = {"create", "assign", "unassign", "replace", "state_change", "close"}
check("auditoria cobertura WO", need.issubset(actions), f"missing={need - actions}")
rows = svc_get("/rest/v1/audit_log?select=action&module=eq.work_orders&entity_type=eq.damage_report"
               f"&entity_id=in.({DR1.get('id','x')},{DR2.get('id','x')})")
check("auditoria reportes", {"create", "convert", "discard"}.issubset({r["action"] for r in rows}),
      {r["action"] for r in rows})
rows = svc_get("/rest/v1/audit_log?select=action&module=eq.work_orders&entity_type=eq.wo_comment")
check("auditoria comentarios", any(r["action"] == "create" for r in rows), len(rows))

# ---------- resultado ----------
print(f"\nRESULT smoke-m2: {PASSED} passed, {FAILED} failed")
raise SystemExit(1 if FAILED else 0)
