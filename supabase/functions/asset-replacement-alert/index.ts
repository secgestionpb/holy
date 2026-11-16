// asset_replacement_alert (M1 — F1.3): dispara el Evento 10 "Activo requiere
// reemplazo" (Inmediato) cuando Mantenimiento cambia la etapa a
// 'requires_replacement'. El front la llama tras guardar el cambio de etapa.
import { jsonResponse } from "../_shared/cookies.ts";
import { requireActor, svcClient } from "../_shared/roles.ts";

type Body = { asset_id?: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);
  const body = (await req.json().catch(() => null)) as Body | null;
  const assetId = String(body?.asset_id ?? "");
  if (!assetId) return jsonResponse(req, { error: "validation", message: "Falta asset_id." }, 400);

  const actor = await requireActor(req, ["mantenimiento", "administrador"]);
  if (actor.kind === "denied") {
    return jsonResponse(req, { error: "forbidden", message: actor.message }, actor.status);
  }

  const svc = svcClient();
  const { data: asset } = await svc
    .from("assets")
    .select("id, code, name, life_stage")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset) return jsonResponse(req, { error: "not_found", message: "Activo inexistente." }, 404);
  if (asset.life_stage !== "requires_replacement") {
    return jsonResponse(
      req,
      { error: "validation", message: "El activo no está en etapa «Requiere reemplazo»." },
      409,
    );
  }

  // Evento 10 inmediato: fn_notify encola + pg_net despacha (modo immediate).
  const { data: logId, error } = await svc.rpc("fn_notify", {
    p_event_id: 10,
    p_entity_type: "asset",
    p_entity_id: asset.id,
    p_dedup_key: null,
    p_payload: { code: asset.code, name: asset.name },
  });
  if (error) {
    return jsonResponse(req, { error: "internal", message: "No se pudo disparar el evento." }, 500);
  }
  return jsonResponse(req, { ok: true, log_id: logId }, 200);
});
