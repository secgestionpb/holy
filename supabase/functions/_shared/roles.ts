import { createClient } from "npm:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function svcClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

export type ActorResolution =
  | { kind: "none" } // sin Authorization → llamada interna (cron / pg_net)
  | { kind: "actor"; userId: string }
  | { kind: "denied"; status: 401 | 403; message: string };

/**
 * Resuelve el actor del request. Sin header Authorization → {kind:"none"}
 * (solo para EFs con --no-verify-jwt invocadas por pg_cron). Con JWT →
 * valida usuario activo y rol; si falta → denied.
 */
export async function resolveActor(req: Request, roles: string[]): Promise<ActorResolution> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header) return { kind: "none" };
  const token = header.replace(/^Bearer\s+/i, "");
  const svc = svcClient();
  const { data, error } = await svc.auth.getUser(token);
  const userId = data.user?.id;
  if (error || !userId) return { kind: "denied", status: 401, message: "Sesión inválida." };
  const { data: rows } = await svc.from("user_roles").select("role").eq("user_id", userId);
  const allowed = (rows ?? []).some((row) => roles.includes(row.role));
  if (!allowed) return { kind: "denied", status: 403, message: "No tiene permiso para esta operación." };
  return { kind: "actor", userId };
}

/** Como resolveActor, pero la ausencia de JWT también es denegada (401). */
export async function requireActor(req: Request, roles: string[]): Promise<ActorResolution> {
  const res = await resolveActor(req, roles);
  if (res.kind === "none") return { kind: "denied", status: 401, message: "Requiere sesión activa." };
  return res;
}
