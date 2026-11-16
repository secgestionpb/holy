// wo_dispatch_push (M2 — F2.3/F2.4/F2.5 + mecanismo F-T2.4): despacha push
// FCM a los técnicos destinatarios de una OT (asignado / saliente /
// reasignado / estado modificado por otro). Invocada por pg_net SIN header
// Authorization → desplegada con --no-verify-jwt.
// Sin tokens activos → no-op. Sin credenciales FCM (env FCM_SERVICE_ACCOUNT,
// JSON de service account) → no-op elegante con "skipped" (mecanismo T2
// pendiente de credenciales). Tokens inválidos (UNREGISTERED) se dan de baja
// (limpieza pendiente de T2).
import { jsonResponse } from "../_shared/cookies.ts";
import { svcClient } from "../_shared/roles.ts";

type Body = {
  action?: string;
  wo_id?: string;
  user_ids?: string[];
  actor?: string | null;
};

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

const enc = new TextEncoder();

const STATUS_ES: Record<string, string> = {
  open: "Abierta",
  assigned: "Asignada",
  in_progress: "En proceso",
  waiting_parts: "Pendiente de repuesto",
  completed: "Completada",
  closed: "Cerrada",
  cancelled: "Cancelada",
};

function b64url(data: Uint8Array): string {
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function buildMessage(
  action: string,
  wo: { wo_number: string; status: string; priority: string },
  token: string,
  woId: string,
) {
  let title = "Órdenes de Trabajo";
  let body = `Tienes una actualización en la ${wo.wo_number}.`;
  if (action === "assigned") {
    title = "OT asignada";
    body = `Te asignaron la ${wo.wo_number} (prioridad ${wo.priority}).`;
  } else if (action === "removed") {
    title = "Asignación retirada";
    body = `Ya no estás asignado a la ${wo.wo_number}.`;
  } else if (action === "reassigned") {
    title = "OT reasignada";
    body = `La ${wo.wo_number} fue reasignada.`;
  } else if (action === "wo_status") {
    title = "Tu OT cambió de estado";
    body = `La ${wo.wo_number} está ahora: ${STATUS_ES[wo.status] ?? wo.status}.`;
  }
  return {
    message: {
      token,
      notification: { title, body },
      data: { action, wo_id: woId, wo_number: wo.wo_number, status: wo.status },
      webpush: { fcm_options: { link: `/ordenes/${woId}` } },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const body = (await req.json().catch(() => ({}))) as Body;
  const action = String(body.action ?? "");
  const woId = String(body.wo_id ?? "");
  const userIds = Array.isArray(body.user_ids) ? body.user_ids.map(String) : [];

  if (!woId || userIds.length === 0) {
    return jsonResponse(req, { ok: true, skipped: "no_recipients" }, 200);
  }

  const svc = svcClient();
  try {
    const { data: wo } = await svc
      .from("work_orders")
      .select("wo_number, status, priority")
      .eq("id", woId)
      .maybeSingle();
    if (!wo) return jsonResponse(req, { ok: true, skipped: "wo_not_found" }, 200);

    const { data: subs } = await svc
      .from("push_subscriptions")
      .select("fcm_token")
      .in("user_id", userIds)
      .eq("is_active", true);
    if (!subs || subs.length === 0) {
      return jsonResponse(req, { ok: true, skipped: "no_tokens" }, 200);
    }

    const rawSa = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!rawSa) {
      return jsonResponse(req, { ok: true, skipped: "no_fcm_credentials" }, 200);
    }
    const sa = JSON.parse(rawSa) as ServiceAccount;
    const token = await fcmAccessToken(sa);

    let sent = 0;
    for (const sub of subs) {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildMessage(action, wo, sub.fcm_token, woId)),
        },
      );
      if (res.ok) {
        sent += 1;
      } else {
        const errBody = await res.text();
        if (errBody.includes("UNREGISTERED") || errBody.includes("NOT_FOUND")) {
          // Limpieza de tokens inválidos (pendiente T2): dar de baja el token
          await svc.from("push_subscriptions").update({ is_active: false }).eq("fcm_token", sub.fcm_token);
        }
      }
    }
    return jsonResponse(req, { ok: true, sent }, 200);
  } catch (err) {
    // Nunca fallar: pg_net no debe reintentar en bucle por errores de FCM.
    return jsonResponse(
      req,
      { ok: false, error: err instanceof Error ? err.message : "dispatch_failed" },
      200,
    );
  }
});
