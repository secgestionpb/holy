// Lógica compartida de códigos de activo [Prefijo]-[Ubicación]-[NNN]
// (M1 F1.1): usada por validate-asset-code y por m1-import-assets (F1.12).
import type { svcClient } from "./roles.ts";

/** Segmento de ubicación del código: room_code o nombre, normalizado. */
export function normalizeSegment(roomCode: string | null, name: string): string {
  const raw = (roomCode ?? "").trim() || name;
  const segment = raw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return segment || "LOC";
}

/**
 * Calcula el consecutivo [prefix]-[segment]-[NNN] mirando assets + code_counters.
 * Con reserve=true incrementa el contador (asignación definitiva); con false es
 * solo preview.
 */
export async function computeCode(
  svc: ReturnType<typeof svcClient>,
  prefix: string,
  segment: string,
  locationId: string,
  reserve: boolean,
): Promise<string> {
  const base = `${prefix}-${segment}`;
  const { data: rows, error } = await svc
    .from("assets")
    .select("code")
    .like("code", `${base}-%`);
  if (error) throw new Error("No se pudo calcular el código.");

  let maxUsed = 0;
  for (const row of rows ?? []) {
    const tail = String(row.code).slice(base.length + 1);
    if (/^\d+$/.test(tail)) maxUsed = Math.max(maxUsed, Number(tail));
  }

  const { data: counter } = await svc
    .from("code_counters")
    .select("id, next_value")
    .eq("prefix", prefix)
    .eq("location_id", locationId)
    .maybeSingle();

  let next = Math.max(maxUsed + 1, counter?.next_value ?? 1);
  let code = `${base}-${String(next).padStart(3, "0")}`;

  // Evita colisión con códigos editados manualmente sobre consecutivos futuros.
  while ((rows ?? []).some((row) => row.code === code)) {
    next += 1;
    code = `${base}-${String(next).padStart(3, "0")}`;
  }

  if (reserve) {
    if (counter) {
      await svc.from("code_counters").update({ next_value: next + 1 }).eq("id", counter.id);
    } else {
      await svc.from("code_counters").insert({ prefix, location_id: locationId, next_value: next + 1 });
    }
  }
  return code;
}
