import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, refreshCookie } from "../_shared/cookies.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "method_not_allowed" }, 405);
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "invalid_json" }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return jsonResponse(req, { error: "missing_credentials", message: "Correo y contraseña son obligatorios." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: paramRows } = await admin
    .from("system_parameters")
    .select("key, value")
    .in("key", ["login_attempts", "lockout_minutes"]);
  const attemptsLimit = parseInt(paramRows?.find((p) => p.key === "login_attempts")?.value ?? "5", 10) || 5;
  const lockoutMinutes = parseInt(paramRows?.find((p) => p.key === "lockout_minutes")?.value ?? "15", 10) || 15;

  const { data: failed } = await admin
    .from("failed_logins")
    .select("failed_attempts, locked_until, last_attempt_at")
    .eq("email", email)
    .maybeSingle();

  if (failed?.locked_until && new Date(failed.locked_until).getTime() > Date.now()) {
    const mins = Math.max(1, Math.ceil((new Date(failed.locked_until).getTime() - Date.now()) / 60000));
    return jsonResponse(
      req,
      { error: "locked", message: `Cuenta bloqueada por intentos fallidos. Intente de nuevo en ${mins} min.` },
      423,
    );
  }

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });

  if (!authRes.ok) {
    const attempts = (failed?.failed_attempts ?? 0) + 1;
    const willLock = attempts >= attemptsLimit;
    await admin.from("failed_logins").upsert(
      {
        email,
        failed_attempts: attempts,
        last_attempt_at: new Date().toISOString(),
        locked_until: willLock ? new Date(Date.now() + lockoutMinutes * 60000).toISOString() : null,
      },
      { onConflict: "email" },
    );
    return jsonResponse(
      req,
      {
        error: "invalid_credentials",
        message: willLock
          ? `Cuenta bloqueada por ${lockoutMinutes} min tras ${attempts} intentos fallidos.`
          : "Correo o contraseña incorrectos.",
      },
      401,
    );
  }

  const session = await authRes.json();

  await admin.from("failed_logins").delete().eq("email", email);

  const { data: profile } = await admin
    .from("users")
    .select("id, full_name, email, is_active, must_change_password")
    .eq("id", session.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    return jsonResponse(req, { error: "inactive", message: "Cuenta inactiva. Contacte al administrador." }, 403);
  }

  await admin.from("users").update({ last_sign_in_at: new Date().toISOString() }).eq("id", profile.id);

  const { data: roleRows } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", profile.id);
  const roles = (roleRows ?? []).map((r) => r.role).sort();

  return jsonResponse(
    req,
    {
      access_token: session.access_token,
      expires_in: session.expires_in,
      token_type: "bearer",
      user: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        must_change_password: profile.must_change_password,
      },
      roles,
    },
    200,
    { "Set-Cookie": refreshCookie(req, session.refresh_token) },
  );
});
