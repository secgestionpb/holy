// wo_close_engine (M2 — F2.6 / modal M2.1): valida el formulario de cierre
// (diagnóstico/solución, ejecutada por con reglas de externo, garantía
// Sí/No obligatoria con sub-formulario V1.5 si aplica) y ejecuta la RPC
// atómica m2_close_wo: estado Cerrada + snapshot + garantía create-or-edit
// (F1.5/M1) + Evento 1 si afectó disponibilidad + assets.usage_counter +1.
// Solo rol Mantenimiento. La próxima fecha del plan (M3) queda pendiente.
import { jsonResponse } from "../_shared/cookies.ts";
import { requireActor, svcClient } from "../_shared/roles.ts";

type Body = {
  wo_id?: string;
  diagnosis?: string;
  solution?: string;
  executed_by_type?: string;
  provider_id?: string | null;
  external_cost?: number | null;
  affects_sale?: boolean;
  generates_warranty?: boolean;
  warranty?: {
    start_date?: string;
    end_date?: string;
    coverage?: string;
    provider_id?: string | null;
    provider_name?: string | null;
    notes?: string | null;
    document_path?: string | null;
  } | null;
  warranty_document_path?: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const actor = await requireActor(req, ["mantenimiento"]);
  if (actor.kind === "denied") {
    return jsonResponse(req, { error: "forbidden", message: actor.message }, actor.status);
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  const woId = String(body?.wo_id ?? "");
  const diagnosis = String(body?.diagnosis ?? "").trim();
  const solution = String(body?.solution ?? "").trim();
  if (!woId || !diagnosis || !solution) {
    return jsonResponse(req, { error: "validation", message: "Faltan OT, diagnóstico o solución." }, 400);
  }

  const executedByType = String(body?.executed_by_type ?? "internal");
  if (executedByType !== "internal" && executedByType !== "external") {
    return jsonResponse(req, { error: "validation", message: "Ejecución inválida." }, 400);
  }

  const generatesWarranty = body?.generates_warranty;
  if (typeof generatesWarranty !== "boolean") {
    return jsonResponse(
      req,
      { error: "validation", message: "Debe responder genera_o_extiende_garantia (Sí/No)." },
      400,
    );
  }

  const warranty = body?.warranty ?? null;
  if (generatesWarranty) {
    if (!warranty?.start_date || !warranty?.end_date || !warranty?.coverage) {
      return jsonResponse(
        req,
        { error: "validation", message: "La garantía requiere fechas y cobertura." },
        400,
      );
    }
    if (!["parts", "labor", "both"].includes(warranty.coverage)) {
      return jsonResponse(req, { error: "validation", message: "Cobertura inválida." }, 400);
    }
  }

  const svc = svcClient();
  try {
    const { data, error } = await svc.rpc("m2_close_wo", {
      p_wo_id: woId,
      p_diagnosis: diagnosis,
      p_solution: solution,
      p_actor: actor.userId,
      p_executed_by_type: executedByType,
      p_provider_id: body?.provider_id ?? null,
      p_external_cost: body?.external_cost ?? null,
      p_affects_sale: typeof body?.affects_sale === "boolean" ? body.affects_sale : null,
      p_generates_warranty: generatesWarranty,
      p_warranty: generatesWarranty ? (warranty as Record<string, unknown>) : null,
      p_warranty_document_path: body?.warranty_document_path ?? null,
    });
    if (error) {
      return jsonResponse(req, { error: "validation", message: error.message }, 400);
    }
    return jsonResponse(req, { ok: true, ...(data as Record<string, unknown>) }, 200);
  } catch (err) {
    return jsonResponse(
      req,
      { error: "internal", message: err instanceof Error ? err.message : "No se pudo cerrar la OT." },
      500,
    );
  }
});
