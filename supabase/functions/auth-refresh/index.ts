import { createClient } from "npm:@supabase/supabase-js@2";
import {
  clearCookie,
  corsHeaders,
  jsonResponse,
  readRefreshCookie,
  refreshCookie,
} from "../_shared/cookies.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  if (req.method === "DELETE") {
    const refreshToken = readRefreshCookie(req);
    if (refreshToken) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${refreshToken}` },
        body: JSON.stringify({ scope: "global" }),
      }).catch(() => undefined);
    }
    return jsonResponse(req, { ok: true }, 200, { "Set-Cookie": clearCookie(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "method_not_allowed" }, 405);
  }

  const refreshToken = readRefreshCookie(req);
  if (!refreshToken) {
    return jsonResponse(req, { error: "no_session", message: "No hay sesión activa." }, 401);
  }

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!authRes.ok) {
    return jsonResponse(
      req,
      { error: "session_expired", message: "Sesión expirada. Inicie sesión nuevamente." },
      401,
      { "Set-Cookie": clearCookie(req) },
    );
  }

  const session = await authRes.json();

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: profile } = await admin
    .from("users")
    .select("id, full_name, email, is_active, must_change_password")
    .eq("id", session.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    return jsonResponse(
      req,
      { error: "inactive", message: "Cuenta inactiva. Contacte al administrador." },
      403,
      { "Set-Cookie": clearCookie(req) },
    );
  }

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
