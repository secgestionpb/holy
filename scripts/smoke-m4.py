#!/usr/bin/env python3
"""Smoke M4 — Inventario: catálogos, stock↔kardex (RPCs), RLS/guards,
conteo físico, Eventos 3 y 4, bucket documentos, kardex append-only."""
import json, os, re, urllib.request, urllib.error, uuid

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

def svc_req(path, method="GET", data=None, headers=None):
    return req(path, method, data, token=SERVICE, apikey=SERVICE, headers=headers)

def login(email, pwd):
    s, b = req("/auth/v1/token?grant_type=password", "POST", {"email": email, "password": pwd})
    d = j(b) or {}
    return (d.get("access_token"), d.get("user", {}).get("id")), s, b[:120]

def rpc(name, payload, token):
    s, b = req(f"/rest/v1/rpc/{name}", "POST", payload, token=token)
    return s, (j(b) if b else None), b

def stock_qty(wh, item):
    rows = svc_get(f"/rest/v1/warehouse_stock?select=qty&warehouse_id=eq.{wh}&item_id=eq.{item}")
    return float(rows[0]["qty"]) if rows else None

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
check("login tecnico asignado", bool(TEC1 and TEC1_ID), TEC1)
TEC3, TEC3_ID = get_or_create("smoke-m2-tecnico3@holy.com", "Smoke Tecnico 3", ["tecnico"], "Tecnico2027")
check("login tecnico ajeno", bool(TEC3 and TEC3_ID), TEC3)
CAL, CAL_ID = get_or_create("smoke-m2-calidad@holy.com", "Smoke Calidad", ["calidad"], "Calidad2027")
check("login calidad", bool(CAL and CAL_ID), CAL)

# ---------- fixtures ----------
cfg = svc_get("/rest/v1/notification_config?select=event_id,is_active&event_id=eq.4")
if not cfg or not cfg[0].get("is_active"):
    svc_req("/rest/v1/notification_config?event_id=eq.4", "PATCH", {"is_active": True})
    cfg = svc_get("/rest/v1/notification_config?select=event_id,is_active&event_id=eq.4")
check("evento 4 activo", bool(cfg and cfg[0].get("is_active")), cfg)

s, b = req("/rest/v1/item_categories?select=id&name=eq.SmokeM4 Cat", token=MANT)
CATM4 = (j(b) or [{}])[0]
if not CATM4.get("id"):
    s, b = req("/rest/v1/item_categories", "POST", {"name": "SmokeM4 Cat", "description": "Smoke M4"},
               token=MANT, headers={"Prefer": "return=representation"})
    CATM4 = (j(b) or [{}])[0]
check("categoria item m4", bool(CATM4.get("id")), b[:200])

s, b = req("/rest/v1/items?select=id,unit_cost&code=eq.SMOKE-M4-01", token=MANT)
ITEM = (j(b) or [{}])[0]
if not ITEM.get("id"):
    s, b = req("/rest/v1/items", "POST",
               {"code": "SMOKE-M4-01", "name": "SmokeM4 Repuesto", "item_category_id": CATM4["id"],
                "unit": "unidad"},
               token=MANT, headers={"Prefer": "return=representation"})
    ITEM = (j(b) or [{}])[0]
ITEM_ID = ITEM.get("id")
check("item m4", bool(ITEM_ID), b[:200])

def get_or_create_warehouse(name):
    s, b = req(f"/rest/v1/warehouses?select=id&name=eq.{name}", token=MANT)
    row = (j(b) or [{}])[0]
    if not row.get("id"):
        s, b = req("/rest/v1/warehouses", "POST", {"name": name, "responsible_id": MANT_ID},
                   token=MANT, headers={"Prefer": "return=representation"})
        row = (j(b) or [{}])[0]
    return row.get("id")

WHA = get_or_create_warehouse("SmokeM4 Bodega A")
WHB = get_or_create_warehouse("SmokeM4 Bodega B")
WHC = get_or_create_warehouse("SmokeM4 Bodega C")
check("bodegas m4", bool(WHA and WHB and WHC), f"{WHA} {WHB} {WHC}")

s, b = req("/rest/v1/locations?select=id&kind=eq.hotel&depth=eq.0&limit=1", token=ADMIN)
ROOT_LOC = (j(b) or [{}])[0]
if not ROOT_LOC.get("id"):
    s, b = req("/rest/v1/locations", "POST", {"name": "Hotel", "kind": "hotel"},
               token=MANT, headers={"Prefer": "return=representation"})
    ROOT_LOC = (j(b) or [{}])[0]
check("root location", bool(ROOT_LOC.get("id")), b[:150])
s, b = req("/rest/v1/categories?select=id,code_prefix&is_active=is.true&order=sort_order.asc", token=ADMIN)
SEED_CAT = (j(b) or [{}])[0]
check("seed category", s == 200 and SEED_CAT.get("id"), b[:150])

s, b = req("/rest/v1/assets?select=id&name=eq.SmokeM4 Activo", token=ADMIN)
ASSET = (j(b) or [{}])[0]
if not ASSET.get("id"):
    s, b = req("/functions/v1/validate-asset-code", "POST",
               {"action": "allocate", "category_id": SEED_CAT["id"], "location_id": ROOT_LOC["id"]}, token=MANT)
    ACODE = (j(b) or {}).get("code", "")
    s, b = req("/rest/v1/assets", "POST",
               {"code": ACODE, "name": "SmokeM4 Activo", "category_id": SEED_CAT["id"],
                "location_id": ROOT_LOC["id"], "criticality": "medium",
                "commissioning_date": "2026-10-01", "has_usage_counter": True},
               token=MANT, headers={"Prefer": "return=representation"})
    ASSET = (j(b) or [{}])[0]
AID = ASSET.get("id")
check("asset m4", bool(AID), b[:200])

# OT persistente con TEC1 asignado (los consumos/declaraciones no se pueden
# deshacer: el kardex es append-only, por eso la OT es fixture permanente).
s, b = req("/rest/v1/work_orders?select=id,status&description=eq.SmokeM4 OT asignada&order=created_at.asc&limit=1",
           token=ADMIN)
WO = (j(b) or [{}])[0]
wo_id = WO.get("id")
if wo_id and WO.get("status") in ("closed", "cancelled"):
    wo_id = None
if wo_id:
    techs = svc_get(f"/rest/v1/wo_technicians?select=user_id&wo_id=eq.{wo_id}&removed_at=is.null")
    if not any(t["user_id"] == TEC1_ID for t in techs):
        wo_id = None
if not wo_id:
    s, d, b = rpc("m2_create_wo", {"p_asset_id": AID, "p_description": "SmokeM4 OT asignada",
                                   "p_technicians": [TEC1_ID]}, MANT)
    wo_id = (d or {}).get("id")
check("ot fixture m4", bool(wo_id), b[:200])

# ---------- A. m4_item_code (F4.1) ----------
s, d, b = rpc("m4_item_code", {"p_action": "preview"}, MANT)
check("code preview", s == 200 and re.match(r"^REP-\d{4}$", (d or {}).get("code", "")), f"{s} {b[:150]}")
s, d, b = rpc("m4_item_code", {"p_action": "preview"}, CAL)
check("code preview calidad 400", s >= 400 and "Mantenimiento" in b, b[:150])
s, d, b = rpc("m4_item_code", {"p_action": "check", "p_code": "SMOKE-M4-01"}, MANT)
check("code check ocupado", s == 200 and d and d.get("available") is False, f"{s} {b[:150]}")
s, d, b = rpc("m4_item_code", {"p_action": "check", "p_code": "SMOKE-M4-LIBRE-99"}, MANT)
check("code check libre", s == 200 and d and d.get("available") is True, f"{s} {b[:150]}")

# ---------- B. catálogos + guards ----------
s, b = req("/rest/v1/item_categories", "POST", {"name": "SmokeM4 Cat2"}, token=CAL)
check("categoria calidad insert 403", s in (401, 403), f"{s} {b[:150]}")
s, b = req("/rest/v1/items", "POST",
           {"code": "SMOKE-M4-BAD", "name": "Costo prohibido", "unit": "unidad", "unit_cost": 1},
           token=MANT)
check("items unit_cost inicial 400", s >= 400 and "costo inicial" in b, f"{s} {b[:150]}")
s, b = req(f"/rest/v1/items?id=eq.{ITEM_ID}", "PATCH", {"unit_cost": 99}, token=MANT)
check("items unit_cost guard 400", s >= 400 and "solo lo actualiza una Entrada" in b, f"{s} {b[:150]}")
s, b = req(f"/rest/v1/items?id=eq.{ITEM_ID}", "PATCH", {"name": "Hacked"}, token=CAL)
rows = svc_get(f"/rest/v1/items?select=name&id=eq.{ITEM_ID}")
check("items calidad update bloqueado", s in (200, 204) and rows and rows[0]["name"] == "SmokeM4 Repuesto",
      f"{s} {rows}")
s, b = req("/rest/v1/warehouses", "POST", {"name": "SmokeM4 Cat warehouses"}, token=CAL)
check("warehouses calidad insert 403", s in (401, 403), f"{s} {b[:150]}")

# Fila de stock en A (pre-alta qty=0 permitida) para probar los guards
pair = svc_get(f"/rest/v1/warehouse_stock?select=qty&warehouse_id=eq.{WHA}&item_id=eq.{ITEM_ID}")
if not pair:
    s, b = req("/rest/v1/warehouse_stock", "POST",
               {"warehouse_id": WHA, "item_id": ITEM_ID, "qty": 0}, token=MANT)
    check("stock pre-alta qty 0", s in (200, 201), f"{s} {b[:150]}")
pair = svc_get(f"/rest/v1/warehouse_stock?select=qty&warehouse_id=eq.{WHC}&item_id=eq.{ITEM_ID}")
if not pair:
    s, b = req("/rest/v1/warehouse_stock", "POST",
               {"warehouse_id": WHC, "item_id": ITEM_ID, "qty": 9}, token=MANT)
    check("stock alta con qty 400", s >= 400 and "qty 0" in b, f"{s} {b[:150]}")
s, b = req(f"/rest/v1/warehouse_stock?warehouse_id=eq.{WHA}&item_id=eq.{ITEM_ID}", "PATCH", {"qty": 5}, token=MANT)
check("stock update qty guard 400", s >= 400 and "solo cambia vía movimientos" in b, f"{s} {b[:150]}")
s, b = req(f"/rest/v1/warehouse_stock?warehouse_id=eq.{WHA}&item_id=eq.{ITEM_ID}", "PATCH",
           {"qty": 12345}, token=CAL)
rows = svc_get(f"/rest/v1/warehouse_stock?select=qty&warehouse_id=eq.{WHA}&item_id=eq.{ITEM_ID}")
check("stock calidad update bloqueado", s in (200, 204) and rows and float(rows[0]["qty"]) != 12345, f"{s} {rows}")

# ---------- C. m4_entry (F4.3) ----------
prev = stock_qty(WHA, ITEM_ID) or 0.0 or 0.0
s, d, b = rpc("m4_entry", {"p_item_id": ITEM_ID, "p_warehouse_id": WHA, "p_qty": 10,
                           "p_unit_cost": 4.5, "p_document_number": "FAC-SMOKE-1",
                           "p_note": "entrada smoke"}, MANT)
check("entry ok", s == 200 and d and abs(float(d.get("new_qty", -1)) - (prev + 10)) < 0.001, f"{s} {b[:200]}")
check("entry new_unit_cost", d and float(d.get("new_unit_cost", 0)) == 4.5, d)
MOV_ENTRY = (d or {}).get("movement_id")
item_rows = svc_get(f"/rest/v1/items?select=unit_cost&id=eq.{ITEM_ID}")
check("items unit_cost post-entry", item_rows and float(item_rows[0]["unit_cost"]) == 4.5, item_rows)
rows = svc_get(f"/rest/v1/v4_kardex?select=qty,type,document_number&id=eq.{MOV_ENTRY}")
check("kardex entrada fila", rows and rows[0]["type"] == "entrada" and float(rows[0]["qty"]) == 10
      and rows[0]["document_number"] == "FAC-SMOKE-1", rows)
rows = svc_get(f"/rest/v1/audit_log?select=action,module,entity_type&entity_id=eq.{MOV_ENTRY}")
check("audit entry module inventory",
      any(r["module"] == "inventory" and r["action"] == "entry" for r in rows), rows)
s, d, b = rpc("m4_entry", {"p_item_id": ITEM_ID, "p_warehouse_id": WHA, "p_qty": 1,
                           "p_unit_cost": 2, "p_document_number": "FAC-X"}, CAL)
check("entry calidad 400", s >= 400 and "Mantenimiento" in b, b[:150])
s, d, b = rpc("m4_entry", {"p_item_id": ITEM_ID, "p_warehouse_id": WHA, "p_qty": 0,
                           "p_unit_cost": 2, "p_document_number": "FAC-X"}, MANT)
check("entry qty 0 400", s >= 400 and "mayor a 0" in b, b[:150])
s, d, b = rpc("m4_entry", {"p_item_id": ITEM_ID, "p_warehouse_id": WHA, "p_qty": 1,
                           "p_unit_cost": 2, "p_document_number": " "}, MANT)
check("entry sin documento 400", s >= 400 and "documento" in b, b[:150])

# ---------- D. m4_adjust (F4.6) ----------
prev = stock_qty(WHA, ITEM_ID) or 0.0
s, d, b = rpc("m4_adjust", {"p_item_id": ITEM_ID, "p_warehouse_id": WHA, "p_delta": 3,
                            "p_reason": "conteo previo", "p_note": "ajuste smoke"}, MANT)
check("adjust +3", s == 200 and d and abs(float(d.get("new_qty", -1)) - (prev + 3)) < 0.001, f"{s} {b[:200]}")
rows = svc_get(f"/rest/v1/audit_log?select=action&module=eq.inventory&entity_type=eq.stock_movement"
               f"&entity_id=eq.{(d or {}).get('movement_id', '')}")
check("audit adjust", any(r["action"] == "adjust" for r in rows), rows)
s, d, b = rpc("m4_adjust", {"p_item_id": ITEM_ID, "p_warehouse_id": WHA, "p_delta": 1,
                            "p_reason": "x"}, TEC3)
check("adjust tecnico 400", s >= 400 and "Mantenimiento" in b, b[:150])
s, d, b = rpc("m4_adjust", {"p_item_id": ITEM_ID, "p_warehouse_id": WHA, "p_delta": 0,
                            "p_reason": "x"}, MANT)
check("adjust delta 0 400", s >= 400 and "distinta de 0" in b, b[:150])
s, d, b = rpc("m4_adjust", {"p_item_id": ITEM_ID, "p_warehouse_id": WHA, "p_delta": 1,
                            "p_reason": ""}, MANT)
check("adjust sin motivo 400", s >= 400 and "motivo" in b, b[:150])

# ---------- E. m4_transfer (F4.7) ----------
prev_a = stock_qty(WHA, ITEM_ID) or 0.0
prev_b = stock_qty(WHB, ITEM_ID) or 0.0
s, d, b = rpc("m4_transfer", {"p_item_id": ITEM_ID, "p_origin_id": WHA, "p_destiny_id": WHB,
                              "p_qty": 2, "p_note": "transfer smoke"}, MANT)
check("transfer ok", s == 200 and d
      and abs(float(d.get("origin_qty", -1)) - (prev_a - 2)) < 0.001
      and abs(float(d.get("destiny_qty", -1)) - (prev_b + 2)) < 0.001, f"{s} {b[:200]}")
out_id, in_id = (d or {}).get("movement_out_id"), (d or {}).get("movement_in_id")
rows = svc_get(f"/rest/v1/v4_kardex?select=id,qty,warehouse_id,destiny_warehouse_id,type,unit_cost&id=in.({out_id},{in_id})")
by_id = {r["id"]: r for r in rows}
out_row, in_row = by_id.get(out_id), by_id.get(in_id)
check("transfer salida signo/par", out_row and out_row["type"] == "transferencia"
      and float(out_row["qty"]) == -2 and out_row["warehouse_id"] == WHA
      and out_row["destiny_warehouse_id"] == WHB, out_row)
check("transfer entrada signo/par", in_row and float(in_row["qty"]) == 2
      and in_row["warehouse_id"] == WHB and in_row["destiny_warehouse_id"] == WHA, in_row)
check("transfer costo intacto", out_row and in_row
      and float(out_row["unit_cost"]) == float(in_row["unit_cost"]), (out_row, in_row))
s, d, b = rpc("m4_transfer", {"p_item_id": ITEM_ID, "p_origin_id": WHA, "p_destiny_id": WHA,
                              "p_qty": 1}, MANT)
check("transfer misma bodega 400", s >= 400 and "distinta" in b, b[:150])

# ---------- F. m4_consume (F4.4 / F2.5) ----------
prev = stock_qty(WHA, ITEM_ID) or 0.0
s, d, b = rpc("m4_consume", {"p_wo_id": wo_id, "p_item_id": ITEM_ID, "p_warehouse_id": WHA,
                             "p_qty": 2, "p_note": "consumo smoke"}, MANT)
check("consume mant ok", s == 200 and d
      and abs(float(d.get("new_qty", -1)) - (prev - 2)) < 0.001
      and abs(float(d.get("line_total", -1)) - 9.0) < 0.001, f"{s} {b[:200]}")
MOV_SALIDA = (d or {}).get("movement_id")
rows = svc_get(f"/rest/v1/v4_kardex?select=type,qty,wo_id,unit_cost&id=eq.{MOV_SALIDA}")
check("salida_ot kardex", rows and rows[0]["type"] == "salida_ot" and float(rows[0]["qty"]) == -2
      and rows[0]["wo_id"] == wo_id and float(rows[0]["unit_cost"]) == 4.5, rows)
s, d, b = rpc("m4_consume", {"p_wo_id": wo_id, "p_item_id": ITEM_ID, "p_warehouse_id": WHA,
                             "p_qty": 1}, TEC3)
check("consume tecnico ajeno 400", s >= 400 and "asignados" in b, b[:150])
s, d, b = rpc("m4_consume", {"p_wo_id": wo_id, "p_item_id": ITEM_ID, "p_warehouse_id": WHA,
                             "p_qty": 1}, TEC1)
check("consume tecnico asignado ok", s == 200 and d, f"{s} {b[:200]}")
s, d, b = rpc("m4_consume", {"p_wo_id": wo_id, "p_item_id": ITEM_ID, "p_warehouse_id": WHA,
                             "p_qty": 1}, CAL)
check("consume calidad 400", s >= 400, b[:150])
s, d, b = rpc("m4_consume", {"p_wo_id": wo_id, "p_item_id": ITEM_ID, "p_warehouse_id": WHC,
                             "p_qty": 1}, MANT)
check("consume sin fila stock 400", s >= 400 and "no tiene existencias registradas" in b, b[:180])

# ---------- G. m4_return (F4.5 / F2.9) ----------
s, b = req(f"/rest/v1/v4_kardex?select=id,qty,unit_cost&wo_id=eq.{wo_id}&type=eq.salida_ot"
           f"&item_id=eq.{ITEM_ID}&order=occurred_at.desc&limit=1", token=MANT)
sal = (j(b) or [{}])[0]
ORIG = sal.get("id")
check("salida original", bool(ORIG), b[:150])
s, d, b = rpc("m4_return", {"p_movement_id": ORIG, "p_qty": 1, "p_destiny_warehouse_id": WHA,
                            "p_reason": "sobrante"}, TEC1)
check("return tecnico asignado", s == 200 and d and abs(float(d.get("line_total", -1)) - 4.5) < 0.001
      and d.get("remaining_available") is not None, f"{s} {b[:200]}")
MOV_DEV = (d or {}).get("movement_id")
rows = svc_get(f"/rest/v1/v4_kardex?select=type,qty,origin_movement_id,unit_cost,wo_id&id=eq.{MOV_DEV}")
check("devolucion fila", rows and rows[0]["type"] == "devolucion" and float(rows[0]["qty"]) == 1
      and rows[0]["origin_movement_id"] == ORIG and float(rows[0]["unit_cost"]) == 4.5
      and rows[0]["wo_id"] == wo_id, rows)
s, d, b = rpc("m4_return", {"p_movement_id": ORIG, "p_qty": 1, "p_destiny_warehouse_id": WHA,
                            "p_reason": "x"}, TEC3)
check("return tecnico ajeno 400", s >= 400 and "asignadas" in b, b[:150])
s, d, b = rpc("m4_return", {"p_movement_id": ORIG, "p_qty": 999, "p_destiny_warehouse_id": WHA,
                            "p_reason": "x"}, MANT)
check("return excede max 400", s >= 400 and "devolver" in b, b[:180])
s, d, b = rpc("m4_return", {"p_movement_id": ORIG, "p_qty": 1, "p_destiny_warehouse_id": WHA,
                            "p_reason": " "}, MANT)
check("return sin motivo 400", s >= 400 and "motivo" in b, b[:150])
rows = svc_get(f"/rest/v1/v4_kardex?select=qty&origin_movement_id=eq.{ORIG}")
check("vista lo devuelto", rows and sum(float(r["qty"]) for r in rows) >= 1, rows)

# ---------- H. Evento 4 — stock negativo ----------
prev_a = stock_qty(WHA, ITEM_ID)
over = prev_a + 5
s, d, b = rpc("m4_transfer", {"p_item_id": ITEM_ID, "p_origin_id": WHA, "p_destiny_id": WHB,
                              "p_qty": over, "p_note": "negativo smoke"}, MANT)
check("transfer sobre stock", s == 200 and d, f"{s} {b[:200]}")
neg_qty = stock_qty(WHA, ITEM_ID)
check("stock negativo resultante", neg_qty is not None and neg_qty < 0, neg_qty)
rows = svc_get("/rest/v1/notification_log?select=id,dedup_key&event_id=eq.4"
               f"&dedup_key=eq.negative-stock:{(d or {}).get('movement_out_id', '')}")
check("evento 4 encolado", len(rows) >= 1, rows)
fix = stock_qty(WHA, ITEM_ID)
if fix is not None and fix < 0:
    s, dd, b = rpc("m4_adjust", {"p_item_id": ITEM_ID, "p_warehouse_id": WHA, "p_delta": -fix,
                                 "p_reason": "reparacion smoke"}, MANT)
    check("reparacion stock", s == 200, f"{s} {b[:200]}")
fixed = stock_qty(WHA, ITEM_ID)
check("stock reparado", fixed is not None and fixed >= 0, fixed)
s, d, b = rpc("m4_entry", {"p_item_id": ITEM_ID, "p_warehouse_id": WHA, "p_qty": 5,
                           "p_unit_cost": 4.5, "p_document_number": "FAC-SMOKE-2"}, MANT)
check("re-entrada ok", s == 200 and d, f"{s} {b[:150]}")

# ---------- I. kardex append-only ----------
s, b = svc_req(f"/rest/v1/stock_movements?id=eq.{MOV_ENTRY}", "PATCH", {"reason": "editado"})
check("kardex update 400", s >= 400 and "append-only" in b, f"{s} {b[:150]}")
s, b = svc_req(f"/rest/v1/stock_movements?id=eq.{MOV_ENTRY}", "DELETE")
check("kardex delete 400", s >= 400 and "append-only" in b, f"{s} {b[:150]}")

# ---------- J. conteo físico (F4.8) ----------
s, d, b = rpc("m4_count_create", {"p_warehouse_id": WHA, "p_scope_type": "warehouse",
                                  "p_count_date": "2026-10-11"}, MANT)
CID = d if isinstance(d, str) else None
check("count create uuid", s == 200 and isinstance(CID, str) and len(CID) == 36, f"{s} {b[:200]}")
snap = svc_get(f"/rest/v1/physical_count_items?select=item_id,theoretical&count_id=eq.{CID}")
check("count snapshot", len(snap) >= 1, snap)
theo = float(snap[0]["theoretical"])
s, b = req(f"/rest/v1/physical_count_items?count_id=eq.{CID}&item_id=eq.{snap[0]['item_id']}", "PATCH",
           {"counted": 999}, token=CAL)
rows = svc_get(f"/rest/v1/physical_count_items?select=counted&count_id=eq.{CID}&item_id=eq.{snap[0]['item_id']}")
check("count item calidad bloqueado", s in (200, 204) and rows and rows[0]["counted"] is None, f"{s} {rows}")
s, b = req(f"/rest/v1/physical_count_items?count_id=eq.{CID}&item_id=eq.{snap[0]['item_id']}", "PATCH",
           {"counted": 999}, token=TEC3)
rows = svc_get(f"/rest/v1/physical_count_items?select=counted&count_id=eq.{CID}&item_id=eq.{snap[0]['item_id']}")
check("count item tecnico bloqueado", s in (200, 204) and rows and rows[0]["counted"] is None, f"{s} {rows}")
s, b = req(f"/rest/v1/physical_count_items?count_id=eq.{CID}&item_id=eq.{snap[0]['item_id']}", "PATCH",
           {"counted": theo + 2, "observation": "conteo smoke"}, token=MANT,
           headers={"Prefer": "return=representation"})
check("count item mant patch", s == 200, f"{s} {b[:200]}")
rows = svc_get(f"/rest/v1/physical_count_items?select=difference,observation&count_id=eq.{CID}")
check("count difference generado", rows and float(rows[0]["difference"]) == 2, rows)
s, b = req(f"/rest/v1/physical_counts?id=eq.{CID}", "PATCH", {"status": "confirmed"}, token=MANT)
check("count status directo 400", s >= 400 and "vía RPC" in b, f"{s} {b[:150]}")
s, d, b = rpc("m4_count_confirm", {"p_count_id": CID}, TEC3)
check("count confirm tecnico 400", s >= 400 and "Mantenimiento" in b, b[:150])
s, d, b = rpc("m4_count_confirm", {"p_count_id": CID}, MANT)
check("count confirm ok", s == 200 and d and int(d.get("adjustments", 0)) >= 1
      and int(d.get("counted_items", 0)) >= 1, f"{s} {b[:200]}")
rows = svc_get(f"/rest/v1/warehouse_stock?select=qty&warehouse_id=eq.{WHA}&item_id=eq.{snap[0]['item_id']}")
check("count ajusto stock", rows and abs(float(rows[0]["qty"]) - (theo + 2)) < 0.001, rows)
rows = svc_get(f"/rest/v1/v4_kardex?select=type,reason,count_id&count_id=eq.{CID}")
check("count kardex ajuste", any(r["type"] == "ajuste" and r["count_id"] == CID for r in rows), rows)
rows = svc_get(f"/rest/v1/audit_log?select=action&module=eq.inventory&entity_type=eq.physical_count"
               f"&entity_id=eq.{CID}")
check("audit count confirm", any(r["action"] == "confirm" for r in rows), rows)
s, b = req(f"/rest/v1/v4_counts?select=status,confirmed_at&id=eq.{CID}", token=CAL)
check("v4_counts calidad lee", s == 200 and (j(b) or [{}])[0].get("status") == "confirmed", b[:150])
s, d, b = rpc("m4_count_confirm", {"p_count_id": CID}, MANT)
check("count re-confirm 400", s >= 400 and "En proceso" in b, b[:150])

s, d, b = rpc("m4_count_create", {"p_warehouse_id": WHA, "p_scope_type": "warehouse"}, MANT)
CID2 = d if isinstance(d, str) else None
check("count 2 create", s == 200 and CID2, f"{s} {b[:150]}")
s, d, b = rpc("m4_count_cancel", {"p_count_id": CID2, "p_reason": ""}, MANT)
check("count cancel sin motivo 400", s >= 400 and "motivo" in b, b[:150])
s, d, b = rpc("m4_count_cancel", {"p_count_id": CID2, "p_reason": "duplicado"}, MANT)
check("count cancel ok", s in (200, 204), f"{s} {b[:150]}")
rows = svc_get(f"/rest/v1/physical_counts?select=status,cancel_reason&id=eq.{CID2}")
check("count cancelado", rows and rows[0]["status"] == "cancelled"
      and rows[0]["cancel_reason"] == "duplicado", rows)
s, b = svc_req(f"/rest/v1/physical_counts?id=eq.{CID2}", "DELETE")
check("count delete 400", s >= 400 and "no se eliminan" in b, f"{s} {b[:150]}")

# ---------- K. Evento 3 — resumen bajo mínimo ----------
rows = svc_get(f"/rest/v1/warehouse_stock?select=qty,min_stock&warehouse_id=eq.{WHA}&item_id=eq.{ITEM_ID}")
base_qty = float(rows[0]["qty"]) if rows else 0
s, b = req(f"/rest/v1/warehouse_stock?warehouse_id=eq.{WHA}&item_id=eq.{ITEM_ID}", "PATCH",
           {"min_stock": base_qty + 50}, token=MANT)
check("min_stock update ok", s in (200, 204), f"{s} {b[:150]}")
s, d, b = rpc("m4_low_stock_summary", {}, MANT)
check("low stock summary", s == 200 and isinstance(d, int) and d >= 1, f"{s} {b[:150]}")
s, b = req(f"/rest/v1/warehouse_stock?warehouse_id=eq.{WHA}&item_id=eq.{ITEM_ID}", "PATCH",
           {"min_stock": 0}, token=MANT)
check("min_stock reset", s in (200, 204), f"{s} {b[:150]}")

# ---------- L. bucket documentos (prefijo items/) ----------
OBJ = "items/smoke-m4-test.txt"
PATH = f"/storage/v1/object/documentos/{OBJ}"
s, b = req(PATH, "POST", token=MANT, raw="smoke m4", ctype="text/plain")
check("upload mant", s in (200, 201), f"{s} {b[:150]}")
s, b = req(PATH, "POST", token=CAL, raw="x", ctype="text/plain")
check("upload calidad 403", (s in (401, 403)) or "row-level security" in b, f"{s} {b[:150]}")
s, b = req(PATH, "DELETE", token=TEC3)
check("delete tecnico 403", (s in (401, 403)) or "Access denied" in b, f"{s} {b[:150]}")
s, b = req(PATH, "GET", token=CAL)
check("lectura calidad", s == 200, f"{s} {b[:150]}")
s, b = req(PATH, "DELETE", token=MANT)
check("delete mant", s in (200, 204), f"{s} {b[:150]}")

# ---------- M. vínculos N:N ----------
s, b = req("/rest/v1/item_asset_links", "POST", {"item_id": ITEM_ID, "asset_id": AID}, token=MANT)
check("link item-asset mant", s in (200, 201) or "duplicate" in b or "already" in b, f"{s} {b[:150]}")
s, b = req("/rest/v1/item_asset_links", "POST",
           {"item_id": ITEM_ID, "asset_id": str(uuid.uuid4())}, token=CAL)
check("link item-asset calidad 403", s in (401, 403), f"{s} {b[:150]}")
s, b = req(f"/rest/v1/item_asset_links?item_id=eq.{ITEM_ID}&asset_id=eq.{AID}", "DELETE", token=MANT)
check("link item-asset delete", s in (200, 204), f"{s} {b[:150]}")
s, b = req("/rest/v1/item_category_links", "POST",
           {"item_id": ITEM_ID, "category_id": SEED_CAT["id"]}, token=MANT)
check("link item-cat mant", s in (200, 201) or "duplicate" in b or "already" in b, f"{s} {b[:150]}")
s, b = req(f"/rest/v1/item_category_links?item_id=eq.{ITEM_ID}&category_id=eq.{SEED_CAT['id']}",
           "DELETE", token=MANT)
check("link item-cat delete", s in (200, 204), f"{s} {b[:150]}")

# ---------- N. lecturas RLS / vistas ----------
for view in ("v4_items", "v4_stock", "v4_kardex", "v4_counts"):
    col = "warehouse_id" if view == "v4_stock" else "id"
    s, b = req(f"/rest/v1/{view}?select={col}&limit=1", token=CAL)
    check(f"{view} calidad lee", s == 200, f"{s} {b[:120]}")
s, b = req("/rest/v1/items?select=id&limit=1", token=TEC3)
check("items tecnico lee", s == 200, f"{s} {b[:120]}")
s, b = req("/rest/v1/stock_movements", "POST", {"type": "ajuste", "item_id": ITEM_ID,
                                                "warehouse_id": WHA, "qty": -1, "unit_cost": 1,
                                                "line_total": 1, "reason": "directo",
                                                "user_id": MANT_ID}, token=MANT)
check("kardex insert directo 403", s in (401, 403), f"{s} {b[:150]}")

# ---------- resultado ----------
print(f"\nRESULT smoke-m4: {PASSED} passed, {FAILED} failed")
raise SystemExit(1 if FAILED else 0)
