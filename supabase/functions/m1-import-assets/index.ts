// m1-import_assets (M1 — F1.12): importación masiva de activos raíz.
// Recibe las filas ya prevalidadas en cliente (números de fila reales del
// .xlsx), las RE-valida contra la BD, resuelve/crea rutas de ubicación,
// reserva códigos vacíos con la lógica compartida y inserta por lotes
// (~200 filas/lote, una transacción por lote) vía la RPC m1_import_lot.
// Cierra con UNA entrada consolidada en audit_log (action 'import').
// Rol Mantenimiento. Alcance: solo activos — sin componentes/garantías/archivos.
import { jsonResponse } from "../_shared/cookies.ts";
import { computeCode, normalizeSegment } from "../_shared/asset_code.ts";
import { requireActor, svcClient } from "../_shared/roles.ts";

const MAX_ROWS = 5000;
const LOT_SIZE = 200;

type Body = {
  filename?: string;
  create_locations?: boolean;
  rows?: Array<{
    row?: number; // número de fila en el Excel (para el reporte)
    code?: string | null; // vacío → autogenerar
    name?: string;
    category?: string; // nombre de categoría
    path?: string; // ruta con "/"
    criticality?: string;
    commissioning_date?: string; // YYYY-MM-DD
    lifespan_value?: number | null;
    lifespan_unit?: string | null;
    responsible?: string | null; // nombre completo
    operational_status?: string | null;
    life_stage?: string | null;
  }>;
};

type Loc = {
  id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  is_active: boolean;
  room_code: string | null;
};

type LotRow = {
  row_num: number;
  code: string;
  name: string;
  category_id: string;
  location_id: string;
  criticality: string;
  commissioning_date: string;
  expected_lifespan_value: number | null;
  lifespan_unit: string | null;
  responsible_user_id: string | null;
  operational_status: string;
  life_stage: string;
};

type RowResult = { row: number; ok: boolean; code?: string; error?: string };

const CRITICALITIES = new Set(["high", "medium", "low"]);
const OPERATIONAL = new Set(["operational", "inactive"]);
const STAGES = new Set([
  "no_warranty",
  "under_warranty",
  "operational",
  "pending_repair",
  "requires_replacement",
  "decommissioned",
]);
const UNITS = new Set(["years", "hours", "cycles"]);

/** Normalización de comparación: mayúsculas + sin acentos + espacios simples. */
function norm(value: string): string {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlank(value: string | null | undefined): boolean {
  return !value || !value.trim();
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const actor = await requireActor(req, ["mantenimiento"]);
  if (actor.kind !== "actor") {
    return jsonResponse(req, { error: "forbidden", message: actor.kind === "denied" ? actor.message : "Requiere sesión activa." }, actor.kind === "denied" ? actor.status : 401);
  }
  const actorId = actor.userId;

  const body = (await req.json().catch(() => null)) as Body | null;
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!body || !rows || rows.length === 0) {
    return jsonResponse(req, { error: "validation", message: "No hay filas para importar." }, 400);
  }
  if (rows.length > MAX_ROWS) {
    return jsonResponse(
      req,
      { error: "validation", message: `Máximo ${MAX_ROWS} filas por importación.` },
      400,
    );
  }

  const svc = svcClient();
  const createLocations = body.create_locations === true;
  const filename = (body.filename ?? "archivo.xlsx").slice(0, 120);

  // ---- Datos de referencia ----
  const { data: categories, error: catError } = await svc
    .from("categories")
    .select("id, name, code_prefix, is_active");
  if (catError) return jsonResponse(req, { error: "internal", message: "No se pudieron cargar las categorías." }, 500);

  const { data: locRows, error: locError } = await svc
    .from("locations")
    .select("id, parent_id, name, depth, is_active, room_code");
  if (locError) return jsonResponse(req, { error: "internal", message: "No se pudieron cargar las ubicaciones." }, 500);

  const { data: users, error: userError } = await svc
    .from("users")
    .select("id, full_name, is_active");
  if (userError) return jsonResponse(req, { error: "internal", message: "No se pudieron cargar los usuarios." }, 500);

  const locations: Loc[] = (locRows ?? []) as Loc[];
  const children = new Map<string, Loc[]>();
  for (const loc of locations) {
    const key = loc.parent_id ?? "";
    const list = children.get(key) ?? [];
    list.push(loc);
    children.set(key, list);
  }

  const categoryByName = new Map<string, { id: string; code_prefix: string; is_active: boolean }>();
  for (const cat of categories ?? []) categoryByName.set(norm(cat.name), cat);
  // Acepta también el prefijo del código (ej. "HVAC").
  for (const cat of categories ?? []) {
    const key = norm(cat.code_prefix);
    if (key && !categoryByName.has(key)) categoryByName.set(key, cat);
  }

  const userByName = new Map<string, { id: string; is_active: boolean }>();
  for (const user of users ?? []) userByName.set(norm(user.full_name), user);

  // ---- Validación fila a fila ----
  const results: RowResult[] = [];
  const prepared: LotRow[] = [];
  const seenCodes = new Set<string>();
  const fileCodes: string[] = [];
  let locationsCreated = 0;

  async function resolvePath(
    rawPath: string,
  ): Promise<{ location_id: string } | { error: string }> {
    const segments = rawPath.split("/").map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) return { error: "Falta la ruta de ubicación." };

    const roots = locations.filter((loc) => loc.parent_id === null);
    let best: { cursor: Loc; next: number } | null = null;

    for (const root of roots) {
      let idx = 0;
      if (norm(segments[0]) === norm(root.name)) idx = 1;
      let cursor = root;
      while (idx < segments.length) {
        const child = (children.get(cursor.id) ?? []).find(
          (loc) => norm(loc.name) === norm(segments[idx]),
        );
        if (!child) break;
        if (!child.is_active) {
          return { error: `La ubicación "${segments.slice(0, idx + 1).join(" / ")}" está desactivada.` };
        }
        cursor = child;
        idx += 1;
      }
      if (idx === segments.length) return { location_id: cursor.id };
      if (!best || idx > best.next) best = { cursor, next: idx };
    }

    if (!best) return { error: `Ruta de ubicación no encontrada: ${rawPath}` };

    const missing = segments.slice(best.next);
    if (!createLocations) {
      return { error: `Ubicación inexistente: ${missing.join(" / ")}` };
    }
    if (best.cursor.depth + missing.length > 5) {
      return { error: `La ruta "${rawPath}" excede la profundidad máxima de 5 niveles.` };
    }

    // Crea la cadena de nodos que falta (etiquetas libres F1.11; kind por
    // profundidad: 1→building, 2→floor, ≥3→zone).
    let cursor = best.cursor;
    for (const segment of missing) {
      const depth = cursor.depth + 1;
      const kind = depth <= 1 ? "building" : depth === 2 ? "floor" : "zone";
      const { data, error } = await svc
        .from("locations")
        .insert({ parent_id: cursor.id, name: segment, kind, created_by: actorId })
        .select("id, depth")
        .single();
      if (error) {
        if (error.code === "23505") {
          // Carrera con otra creación simultánea: reutiliza el nodo existente.
          const { data: existing } = await svc
            .from("locations")
            .select("id, depth")
            .eq("parent_id", cursor.id)
            .eq("name", segment)
            .maybeSingle();
          if (existing) {
            cursor = { ...cursor, id: existing.id, depth: existing.depth, name: segment };
            continue;
          }
        }
        return { error: `No se pudo crear la ubicación "${segment}": ${error.message}` };
      }
      locationsCreated += 1;
      const created: Loc = {
        id: data.id,
        parent_id: cursor.id,
        name: segment,
        depth: data.depth,
        is_active: true,
        room_code: null,
      };
      const list = children.get(created.parent_id ?? "") ?? [];
      list.push(created);
      children.set(created.parent_id ?? "", list);
      locations.push(created);
      cursor = created;
    }
    return { location_id: cursor.id };
  }

  for (const entry of rows) {
    const rowNum = Number(entry.row);
    if (!Number.isInteger(rowNum) || rowNum < 2) {
      results.push({ row: 0, ok: false, error: "Fila sin número válido." });
      continue;
    }
    const fail = (error: string) => results.push({ row: rowNum, ok: false, error });

    const name = (entry.name ?? "").trim();
    if (isBlank(name)) {
      fail("Falta el nombre.");
      continue;
    }

    // Categoría: existe y activa.
    const category = categoryByName.get(norm(entry.category ?? ""));
    if (!category) {
      fail(`Categoría inexistente: "${entry.category ?? ""}".`);
      continue;
    }
    if (!category.is_active) {
      fail(`Categoría inactiva: "${entry.category}".`);
      continue;
    }

    // Criticidad / estado / etapa.
    const criticality = (entry.criticality ?? "").trim();
    if (!CRITICALITIES.has(criticality)) {
      fail(`Criticidad inválida: "${criticality}".`);
      continue;
    }
    const operational = (entry.operational_status ?? "operational").trim() || "operational";
    if (!OPERATIONAL.has(operational)) {
      fail(`Estado operativo inválido: "${operational}".`);
      continue;
    }
    const stage = (entry.life_stage ?? "no_warranty").trim() || "no_warranty";
    if (!STAGES.has(stage)) {
      fail(`Etapa inicial inválida: "${stage}".`);
      continue;
    }

    // Fecha.
    const date = (entry.commissioning_date ?? "").trim();
    if (!validDate(date)) {
      fail(`Fecha de puesta en operación inválida: "${date}".`);
      continue;
    }

    // Vida útil.
    let lifespanValue: number | null = null;
    let lifespanUnit: string | null = null;
    if (entry.lifespan_value !== null && entry.lifespan_value !== undefined) {
      lifespanValue = Number(entry.lifespan_value);
      lifespanUnit = (entry.lifespan_unit ?? "").trim();
      if (!Number.isFinite(lifespanValue) || lifespanValue <= 0) {
        fail("La vida útil debe ser un número mayor que cero.");
        continue;
      }
      if (!UNITS.has(lifespanUnit)) {
        fail(`Unidad de vida útil inválida: "${lifespanUnit}".`);
        continue;
      }
    }

    // Responsable (opcional): si viene, debe existir y estar activo.
    let responsibleId: string | null = null;
    if (!isBlank(entry.responsible)) {
      const user = userByName.get(norm(entry.responsible as string));
      if (!user) {
        fail(`Responsable no encontrado: "${entry.responsible}".`);
        continue;
      }
      if (!user.is_active) {
        fail(`Responsable inactivo: "${entry.responsible}".`);
        continue;
      }
      responsibleId = user.id;
    }

    // Ubicación: resuelve o crea la ruta.
    const resolved = await resolvePath((entry.path ?? "").trim());
    if ("error" in resolved) {
      fail(resolved.error);
      continue;
    }

    // Código: vacío → reservar consecutivo; con valor → único en BD y en el archivo.
    let code = (entry.code ?? "").trim();
    if (code) {
      const key = norm(code);
      if (seenCodes.has(key)) {
        fail(`Código repetido dentro del archivo: ${code}.`);
        continue;
      }
      seenCodes.add(key);
      fileCodes.push(code);
    }

    prepared.push({
      row_num: rowNum,
      code, // se completa abajo si está vacío
      name,
      category_id: category.id,
      location_id: resolved.location_id,
      criticality,
      commissioning_date: date,
      expected_lifespan_value: lifespanValue,
      lifespan_unit: lifespanUnit,
      responsible_user_id: responsibleId,
      operational_status: operational,
      life_stage: stage,
    });
  }

  // ---- Códigos: unicidad contra la BD ----
  const dbCodes = new Set<string>();
  for (let i = 0; i < fileCodes.length; i += 100) {
    const chunk = fileCodes.slice(i, i + 100);
    const { data } = await svc.from("assets").select("code").in("code", chunk);
    for (const row of data ?? []) dbCodes.add(norm(row.code));
  }
  const preparedWithCodes: LotRow[] = [];
  for (const row of prepared) {
    if (row.code) {
      if (dbCodes.has(norm(row.code))) {
        results.push({ row: row.row_num, ok: false, error: `El código ${row.code} ya existe en el sistema.` });
        continue;
      }
      preparedWithCodes.push(row);
    } else {
      preparedWithCodes.push(row);
    }
  }

  // ---- Reserva de códigos autogenerados ----
  const finalRows: LotRow[] = [];
  for (const row of preparedWithCodes) {
    if (row.code) {
      finalRows.push(row);
      continue;
    }
    const category = (categories ?? []).find((cat) => cat.id === row.category_id);
    const location = locations.find((loc) => loc.id === row.location_id);
    if (!category || !location) {
      results.push({ row: row.row_num, ok: false, error: "No se pudo generar el código (datos faltantes)." });
      continue;
    }
    try {
      const segment = normalizeSegment(location.room_code, location.name);
      const code = await computeCode(svc, category.code_prefix, segment, row.location_id, true);
      finalRows.push({ ...row, code });
    } catch {
      results.push({ row: row.row_num, ok: false, error: "No se pudo reservar el código autogenerado." });
    }
  }

  // ---- Inserción por lotes (una transacción por lote = una llamada RPC) ----
  let created = 0;
  for (let i = 0; i < finalRows.length; i += LOT_SIZE) {
    const lot = finalRows.slice(i, i + LOT_SIZE);
    const { data, error } = await svc.rpc("m1_import_lot", {
      p_rows: lot,
      p_actor: actorId,
    });
    if (error) {
      return jsonResponse(
        req,
        {
          error: "internal",
          message: `No se pudo ejecutar la importación (¿migración aplicada?): ${error.message}`,
        },
        500,
      );
    }
    for (const item of (data ?? []) as Array<{ row: number; ok: boolean; code?: string; error?: string }>) {
      if (item.ok) {
        created += 1;
        results.push({ row: item.row, ok: true, code: item.code });
      } else {
        results.push({ row: item.row, ok: false, error: item.error ?? "Error al insertar la fila." });
      }
    }
  }

  // ---- Auditoría CONSOLIDADA (una sola entrada, F1.12 paso 4) ----
  if (created > 0) {
    const reason = `Importación masiva: ${created} activos creados`;
    const { error: auditError } = await svc.from("audit_log").insert({
      user_id: actorId,
      module: "assets",
      entity_type: "asset",
      entity_id: null,
      entity_label: reason,
      action: "import",
      changes: {
        created,
        failed: results.filter((r) => !r.ok).length,
        locations_created: locationsCreated,
        file: filename,
      },
      reason,
    });
    if (auditError) {
      // La importación ya está hecha; el fallo del log no la deshace.
      console.error("m1-import-assets: no se pudo escribir la auditoría consolidada", auditError.message);
    }
  }

  results.sort((a, b) => a.row - b.row);
  return jsonResponse(req, {
    created,
    failed: results.filter((r) => !r.ok).length,
    locations_created: locationsCreated,
    results,
  }, 200);
});
