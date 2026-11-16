// asset_warranty_engine (M1 — F1.4): recalcula warranties.status según fecha,
// alterna etapa de vida "Sin garantía" ↔ "En garantía" SOLO cuando la etapa
// actual es del motor, y resetea el dedup del Evento 7 al editar una
// garantía. Invocada por el front tras guardar garantías y por pg_cron
// (sin Authorization). Nunca toca fases manuales.
import { jsonResponse } from "../_shared/cookies.ts";
import { resolveActor, svcClient } from "../_shared/roles.ts";

type Body = {
  action?: string;
  asset_id?: string;
  warranty_id?: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);
  const body = (await req.json().catch(() => ({}))) as Body;
  const action = String(body.action ?? "recalc");
  if (action !== "recalc") {
    return jsonResponse(req, { error: "validation", message: "Acción no reconocida." }, 400);
  }

  const actor = await resolveActor(req, ["mantenimiento", "administrador"]);
  if (actor.kind === "denied") {
    return jsonResponse(req, { error: "forbidden", message: actor.message }, actor.status);
  }

  const svc = svcClient();
  const today = new Date().toISOString().slice(0, 10);
  const warrantyId = body.warranty_id ? String(body.warranty_id) : null;
  const assetId = body.asset_id ? String(body.asset_id) : null;

  try {
    // 1. Alcance de garantías
    let warrantyQuery = svc.from("warranties").select("id, asset_id, end_date, status");
    if (warrantyId) warrantyQuery = warrantyQuery.eq("id", warrantyId);
    else if (assetId) warrantyQuery = warrantyQuery.eq("asset_id", assetId);
    const { data: warranties, error: wErr } = await warrantyQuery;
    if (wErr) throw new Error("No se pudieron leer las garantías.");

    // 2. Recálculo de estado calculado (Vigente/Vencida por fecha)
    let statusUpdated = 0;
    for (const w of warranties ?? []) {
      const target = w.end_date >= today ? "active" : "expired";
      if (w.status !== target) {
        const { error } = await svc.from("warranties").update({ status: target }).eq("id", w.id);
        if (error) throw new Error("No se pudo recalcular el estado de la garantía.");
        statusUpdated += 1;
      }
    }

    // 3. Al editar una garantía: reset del aviso único Evento 7 (dedup) —
    //    el próximo digesto la re-agenda con el nuevo vencimiento (F1.4).
    if (warrantyId) {
      await svc
        .from("notification_log")
        .delete()
        .eq("event_id", 7)
        .eq("dedup_key", `warranty:${warrantyId}`);
      await svc.from("warranties").update({ notified_at: null }).eq("id", warrantyId);
    }

    // 4. Etapa de vida: SOLO alterna no_warranty/under_warranty; jamás
    //    sobrescribe una fase manual (F1.3/F1.4).
    const assetIds = [...new Set((warranties ?? []).map((w) => w.asset_id))];
    let stageUpdated = 0;
    for (const id of assetIds) {
      const { data: asset } = await svc
        .from("assets")
        .select("id, life_stage")
        .eq("id", id)
        .maybeSingle();
      if (!asset) continue;
      if (asset.life_stage !== "no_warranty" && asset.life_stage !== "under_warranty") continue;

      const { data: active } = await svc
        .from("warranties")
        .select("id")
        .eq("asset_id", id)
        .eq("status", "active");
      const target = (active ?? []).length > 0 ? "under_warranty" : "no_warranty";
      if (asset.life_stage !== target) {
        // service role → auth.uid() NULL → el guard permite la transición
        // del motor; el trigger de auditoría la registra como sistema.
        const { error } = await svc.from("assets").update({ life_stage: target }).eq("id", id);
        if (error) throw new Error("No se pudo actualizar la etapa de vida.");
        stageUpdated += 1;
      }
    }

    return jsonResponse(req, { ok: true, status_updated: statusUpdated, stage_updated: stageUpdated }, 200);
  } catch (err) {
    return jsonResponse(
      req,
      { error: "internal", message: err instanceof Error ? err.message : "Fallo del motor de garantías." },
      500,
    );
  }
});
