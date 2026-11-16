import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cookies.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ROLES = ["mantenimiento", "tecnico", "administrador", "calidad"] as const;

// Contraseña predeterminada para ALTAS y RESETS (decisión T1.9).
// must_change_password = true obliga a cambiarla en el primer inicio de sesión.
const DEFAULT_INITIAL_PASSWORD = "PlayaBlanca2026";

function passwordPolicyError(pw: string): string | null {
  if (pw.length < 8 || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
    return "La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.";
  }
  return null;
}

async function gotrueAdmin(path: string, method: string, body: unknown): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

function mapDbError(error: { message?: string; code?: string }): { status: number; body: Record<string, unknown> } {
  const msg = error.message ?? "";
  if (msg.includes("no puedes desactivar tu propia cuenta")) {
    return { status: 409, body: { error: "self_deactivate", message: "No puedes desactivar tu propia cuenta." } };
  }
  if (msg.includes("sin roles")) {
    return { status: 409, body: { error: "last_role", message: "Un usuario debe mantener al menos un rol. Para dar de baja, use el estado Inactivo." } };
  }
  if (msg.includes("Administrador activo")) {
    return { status: 409, body: { error: "last_admin", message: "Debe existir al menos un Administrador activo." } };
  }
  if (msg.includes("Usuario inexistente")) {
    return { status: 404, body: { error: "not_found", message: "El usuario ya no existe." } };
  }
  if (error.code === "23505") {
    return { status: 409, body: { error: "duplicate", message: "El correo ya está registrado." } };
  }
  return { status: 400, body: { error: "db_error", message: msg || "Error al guardar los cambios." } };
}

function validateRoles(roles: unknown): string[] {
  if (!Array.isArray(roles) || roles.length === 0) return [];
  return roles.filter((r): r is string => typeof r === "string" && (ROLES as readonly string[]).includes(r));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse(req, { error: "no_session", message: "Sesión requerida." }, 401);

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse(req, { error: "invalid_session", message: "Sesión inválida." }, 401);
  }
  const actorId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "invalid_json" }, 400);
  }
  const action = String(body.action ?? "");

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (action !== "change_own_password") {
    const [{ data: roleRows }, { data: profile }] = await Promise.all([
      svc.from("user_roles").select("role").eq("user_id", actorId),
      svc.from("users").select("is_active").eq("id", actorId).maybeSingle(),
    ]);
    const isAdmin = roleRows?.some((r) => r.role === "administrador") ?? false;
    if (!profile?.is_active || !isAdmin) {
      return jsonResponse(req, { error: "forbidden", message: "Solo Administrador puede realizar esta acción." }, 403);
    }
  }

  if (action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const roles = validateRoles(body.roles);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse(req, { error: "validation", message: "Correo inválido." }, 400);
    }
    if (!fullName) return jsonResponse(req, { error: "validation", message: "El nombre completo es obligatorio." }, 400);
    if (roles.length === 0 || roles.length !== (body.roles as unknown[]).length) {
      return jsonResponse(req, { error: "validation", message: "Seleccione al menos un rol válido del catálogo." }, 400);
    }

    const initialPassword = typeof body.password === "string" && body.password ? body.password : DEFAULT_INITIAL_PASSWORD;
    const createPolicyError = passwordPolicyError(initialPassword);
    if (createPolicyError) return jsonResponse(req, { error: "validation", message: createPolicyError }, 400);

    const gRes = await gotrueAdmin("/users", "POST", { email, password: initialPassword, email_confirm: true });
    if (!gRes.ok) {
      const detail = await gRes.text();
      if (detail.toLowerCase().includes("already") || detail.toLowerCase().includes("duplicate")) {
        return jsonResponse(req, { error: "duplicate", message: "El correo ya está registrado." }, 409);
      }
      return jsonResponse(req, { error: "auth_error", message: "No se pudo crear la cuenta de acceso." }, 500);
    }
    const authUser = await gRes.json();

    const { error: rpcError } = await svc.rpc("admin_create_user", {
      p_id: authUser.id,
      p_email: email,
      p_full_name: fullName,
      p_phone: body.phone ?? null,
      p_hourly_rate: body.hourly_rate ?? null,
      p_roles: roles,
      p_category_ids: Array.isArray(body.category_ids) ? body.category_ids : [],
      p_actor: actorId,
    });
    if (rpcError) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUser.id}`, {
        method: "DELETE",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }).catch(() => undefined);
      const mapped = mapDbError(rpcError as { message?: string; code?: string });
      return jsonResponse(req, mapped.body, mapped.status);
    }

    return jsonResponse(req, { user_id: authUser.id, temp_password: initialPassword }, 201);
  }

  if (action === "update") {
    const userId = String(body.user_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const roles = validateRoles(body.roles);
    const isActive = body.is_active === true;
    if (!userId || !email || !fullName) {
      return jsonResponse(req, { error: "validation", message: "Datos incompletos." }, 400);
    }
    if (roles.length === 0 || roles.length !== (body.roles as unknown[]).length) {
      return jsonResponse(req, { error: "validation", message: "Seleccione al menos un rol válido del catálogo." }, 400);
    }
    if (userId === actorId && isActive === false) {
      return jsonResponse(req, { error: "self_deactivate", message: "No puedes desactivar tu propia cuenta." }, 409);
    }

    const { data: current } = await svc.from("users").select("id, email").eq("id", userId).maybeSingle();
    if (!current) return jsonResponse(req, { error: "not_found", message: "El usuario ya no existe." }, 404);

    if (current.email !== email) {
      const pRes = await gotrueAdmin(`/users/${userId}`, "PUT", { email, email_confirm: true });
      if (!pRes.ok) {
        const detail = await pRes.text();
        if (detail.toLowerCase().includes("already") || detail.toLowerCase().includes("duplicate")) {
          return jsonResponse(req, { error: "duplicate", message: "El correo ya está registrado." }, 409);
        }
        return jsonResponse(req, { error: "auth_error", message: "No se pudo actualizar el correo de acceso." }, 500);
      }
    }

    const { error: rpcError } = await svc.rpc("admin_update_user", {
      p_user_id: userId,
      p_email: email,
      p_full_name: fullName,
      p_phone: body.phone ?? null,
      p_hourly_rate: body.hourly_rate ?? null,
      p_is_active: isActive,
      p_avatar_path: body.avatar_path ?? null,
      p_roles: roles,
      p_category_ids: Array.isArray(body.category_ids) ? body.category_ids : [],
      p_actor: actorId,
    });
    if (rpcError) {
      const mapped = mapDbError(rpcError as { message?: string; code?: string });
      return jsonResponse(req, mapped.body, mapped.status);
    }

    return jsonResponse(req, { user_id: userId }, 200);
  }

  if (action === "reset_password") {
    const userId = String(body.user_id ?? "");
    if (!userId) return jsonResponse(req, { error: "validation", message: "Usuario no indicado." }, 400);

    const { data: target } = await svc.from("users").select("id, email").eq("id", userId).maybeSingle();
    if (!target) return jsonResponse(req, { error: "not_found", message: "El usuario ya no existe." }, 404);

    const newPassword = typeof body.password === "string" && body.password ? body.password : DEFAULT_INITIAL_PASSWORD;
    const resetPolicyError = passwordPolicyError(newPassword);
    if (resetPolicyError) return jsonResponse(req, { error: "validation", message: resetPolicyError }, 400);
    const pRes = await gotrueAdmin(`/users/${userId}`, "PUT", { password: newPassword });
    if (!pRes.ok) {
      return jsonResponse(req, { error: "auth_error", message: "No se pudo restablecer la contraseña." }, 500);
    }

    const { error: rpcError } = await svc.rpc("admin_password_event", {
      p_user_id: userId,
      p_must_change: true,
      p_event: "password_reset",
      p_reason: "Reset por Administrador",
      p_actor: actorId,
    });
    if (rpcError) {
      const mapped = mapDbError(rpcError as { message?: string; code?: string });
      return jsonResponse(req, mapped.body, mapped.status);
    }

    return jsonResponse(req, { user_id: userId, temp_password: newPassword }, 200);
  }

  if (action === "change_own_password") {
    const password = String(body.password ?? "");
    const policyError = passwordPolicyError(password);
    if (policyError) return jsonResponse(req, { error: "validation", message: policyError }, 400);

    const pRes = await gotrueAdmin(`/users/${actorId}`, "PUT", { password });
    if (!pRes.ok) {
      return jsonResponse(req, { error: "auth_error", message: "No se pudo actualizar la contraseña." }, 500);
    }

    const { error: rpcError } = await svc.rpc("admin_password_event", {
      p_user_id: actorId,
      p_must_change: false,
      p_event: "update",
      p_reason: null,
      p_actor: actorId,
    });
    if (rpcError) {
      const mapped = mapDbError(rpcError as { message?: string; code?: string });
      return jsonResponse(req, mapped.body, mapped.status);
    }

    return jsonResponse(req, { ok: true }, 200);
  }

  return jsonResponse(req, { error: "unknown_action", message: "Acción no reconocida." }, 400);
});
