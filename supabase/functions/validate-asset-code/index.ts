// validate_asset_code (M1 — F1.1): preview, verificación de unicidad y
// reserva atómica del consecutivo [Prefijo]-[Ubicación]-[NNN] en
// code_counters. Rol Mantenimiento (alto de activos).
import { jsonResponse } from "../_shared/cookies.ts";
import { computeCode, normalizeSegment } from "../_shared/asset_code.ts";
import { requireActor, svcClient, type ActorResolution } from "../_shared/roles.ts";

type Body = {
  action?: string;
  category_id?: string;
  location_id?: string;
  code?: string;
  asset_id?: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return jsonResponse(req, { error: "invalid_body", message: "Cuerpo inválido." }, 400);

  const actor: ActorResolution = await requireActor(req, ["mantenimiento"]);
  if (actor.kind === "denied") {
    return jsonResponse(req, { error: "forbidden", message: actor.message }, actor.status);
  }

  const svc = svcClient();
  const action = body.action ?? "preview";

  if (action === "check") {
    const code = String(body.code ?? "").trim();
    if (!code) return jsonResponse(req, { error: "validation", message: "Falta el código." }, 400);
    const exclude = body.asset_id ? String(body.asset_id) : null;
    let query = svc.from("assets").select("id").eq("code", code);
    if (exclude) query = query.neq("id", exclude);
    const { data } = await query.limit(1);
    return jsonResponse(req, { available: (data ?? []).length === 0 }, 200);
  }

  const categoryId = String(body.category_id ?? "");
  const locationId = String(body.location_id ?? "");
  if (!categoryId || !locationId) {
    return jsonResponse(req, { error: "validation", message: "Se requieren categoría y ubicación." }, 400);
  }

  const { data: category } = await svc
    .from("categories")
    .select("code_prefix, name")
    .eq("id", categoryId)
    .maybeSingle();
  if (!category) return jsonResponse(req, { error: "not_found", message: "Categoría inexistente." }, 404);

  const { data: location } = await svc
    .from("locations")
    .select("name, room_code")
    .eq("id", locationId)
    .maybeSingle();
  if (!location) return jsonResponse(req, { error: "not_found", message: "Ubicación inexistente." }, 404);

  try {
    const segment = normalizeSegment(location.room_code, location.name);
    const code = await computeCode(svc, category.code_prefix, segment, locationId, action === "allocate");
    return jsonResponse(req, { code, action }, 200);
  } catch (err) {
    return jsonResponse(
      req,
      { error: "internal", message: err instanceof Error ? err.message : "No se pudo generar el código." },
      500,
    );
  }
});
