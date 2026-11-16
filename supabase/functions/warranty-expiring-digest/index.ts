// warranty_expiring_digest (M1 — F1.4 paso 3): agenda el Evento 7
// "Garantía por vencer" (Resumen diario) como filas pending en
// notification_log con dedup único por garantía. Días de anticipación =
// parámetro GLOBAL system_parameters.dias_anticipacion_garantia (T2).
// Invocada por pg_cron (sin Authorization) o por sesión Mant/Admin.
import { jsonResponse } from "../_shared/cookies.ts";
import { resolveActor, svcClient } from "../_shared/roles.ts";

type Payload = {
  asset_code?: string;
  asset_name?: string;
  end_date?: string;
  provider?: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);
  await req.json().catch(() => ({}));

  const actor = await resolveActor(req, ["mantenimiento", "administrador"]);
  if (actor.kind === "denied") {
    return jsonResponse(req, { error: "forbidden", message: actor.message }, actor.status);
  }

  const svc = svcClient();

  const { data: cfg } = await svc
    .from("notification_config")
    .select("is_active")
    .eq("event_id", 7)
    .maybeSingle();
  if (!cfg?.is_active) return jsonResponse(req, { ok: true, skipped: "inactive" }, 200);

  const { data: param } = await svc
    .from("system_parameters")
    .select("value")
    .eq("key", "dias_anticipacion_garantia")
    .maybeSingle();
  const days = Number.parseInt(String(param?.value ?? "0"), 10);
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + (Number.isFinite(days) && days > 0 ? days : 0));
  const horizonDate = horizon.toISOString().slice(0, 10);

  const { data: expiring, error } = await svc
    .from("warranties")
    .select("id, asset_id, end_date, provider_name, provider_id, notified_at")
    .eq("status", "active")
    .lte("end_date", horizonDate);
  if (error) return jsonResponse(req, { error: "internal", message: "No se pudieron leer garantías." }, 500);

  const rows = expiring ?? [];
  const assetIds = [...new Set(rows.map((w) => w.asset_id))];
  const { data: assets } = await svc
    .from("assets")
    .select("id, code, name")
    .in("id", assetIds);
  const assetById = new Map((assets ?? []).map((a) => [a.id, a]));

  let queued = 0;
  for (const w of rows) {
    const dedup = `warranty:${w.id}`;
    const asset = assetById.get(w.asset_id);
    // fn_notify respeta dedup + is_active y NO despacha (modo daily_digest):
    // las filas pending las agrupa el cron horario t2-digest (T2.4/T2.9).
    const { data: logId } = await svc.rpc("fn_notify", {
      p_event_id: 7,
      p_entity_type: "warranty",
      p_entity_id: w.id,
      p_dedup_key: dedup,
      p_payload: {
        asset_code: asset?.code,
        asset_name: asset?.name,
        end_date: w.end_date,
        provider: w.provider_name,
      } satisfies Payload,
    });
    if (logId) {
      queued += 1;
      if (!w.notified_at) {
        await svc.from("warranties").update({ notified_at: new Date().toISOString() }).eq("id", w.id);
      }
    }
  }

  return jsonResponse(req, { ok: true, eligible: rows.length, queued }, 200);
});
