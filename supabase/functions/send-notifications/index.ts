import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cookies.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_FROM = Deno.env.get("BREVO_FROM") ?? "cmms@hotel.local";
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

const svc = createClient(SUPABASE_URL, SERVICE_KEY);

type LogRow = {
  id: string;
  event_id: number;
  dedup_key: string | null;
  target_entity_type: string | null;
  target_entity_id: string | null;
  payload: Record<string, unknown> | null;
  status: string;
  created_at: string;
};

type ConfigRow = {
  event_id: number;
  name: string;
  mode: string;
  recipients: string[];
  is_active: boolean;
};

function validEmails(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => String(item).trim())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

async function sendBrevo(to: string[], subject: string, text: string): Promise<string | null> {
  if (!BREVO_API_KEY) return "BREVO_API_KEY no configurada en los secrets del proyecto.";
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "CMMS Hotelero", email: BREVO_FROM },
      to: to.map((email) => ({ email })),
      subject,
      textContent: text,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return `Brevo ${response.status}: ${detail.slice(0, 300)}`;
  }
  return null;
}

async function markStatus(id: string, status: "sent" | "failed", error?: string) {
  await svc.from("notification_log").update({
    status,
    sent_at: status === "sent" ? new Date().toISOString() : null,
    error_detail: error ?? null,
  }).eq("id", id);
}

function logSummary(row: LogRow): string {
  const parts: string[] = [];
  if (row.target_entity_type) parts.push(row.target_entity_type);
  if (row.target_entity_id) parts.push(row.target_entity_id);
  if (row.payload) parts.push(JSON.stringify(row.payload));
  return parts.length > 0 ? parts.join(" · ") : "(sin detalle)";
}

async function isAdminToken(authHeader: string): Promise<boolean> {
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data } = await svc.auth.getUser(token);
  const userId = data.user?.id;
  if (!userId) return false;
  const { data: roleRow } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "administrador")
    .maybeSingle();
  return Boolean(roleRow);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "method_not_allowed" }, 405);
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse(req, { error: "invalid_body", message: "Cuerpo inválido." }, 400);

  const mode = String(body.mode ?? "");
  const action = String(body.action ?? "dispatch");

  // "retry" solo con sesión de Administrador; el despacho interno (pg_net) no trae JWT.
  if (action === "retry") {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader || !(await isAdminToken(authHeader))) {
      return jsonResponse(req, { error: "forbidden", message: "Requiere rol Administrador." }, 403);
    }
  } else if (action !== "dispatch") {
    return jsonResponse(req, { error: "validation", message: "Acción no reconocida." }, 400);
  }

  if (mode === "immediate" || action === "retry") {
    const logId = String(body.log_id ?? "");
    if (!logId) return jsonResponse(req, { error: "validation", message: "Falta log_id." }, 400);

    const { data: log, error: logError } = await svc
      .from("notification_log")
      .select("*")
      .eq("id", logId)
      .maybeSingle();
    if (logError || !log) {
      return jsonResponse(req, { error: "not_found", message: "Registro de notificación inexistente." }, 404);
    }
    if (log.status === "sent" && action === "dispatch") {
      return jsonResponse(req, { ok: true, skipped: "already_sent" }, 200);
    }

    const { data: cfg } = await svc
      .from("notification_config")
      .select("*")
      .eq("event_id", log.event_id)
      .maybeSingle<ConfigRow>();
    if (!cfg) return jsonResponse(req, { error: "not_found", message: "Evento sin configuración." }, 404);

    const recipients = validEmails(log.recipients?.length ? log.recipients : cfg.recipients);
    if (recipients.length === 0) {
      await markStatus(logId, "failed", "Sin destinatarios configurados para este evento.");
      return jsonResponse(req, { ok: true, status: "failed", reason: "no_recipients" }, 200);
    }

    const subject = `[CMMS] ${cfg.name}`;
    const text =
      `Evento: ${cfg.name} (#${cfg.event_id})\n` +
      `Fecha: ${log.created_at}\n` +
      `Detalle: ${logSummary(log as LogRow)}\n\n` +
      `Abrir sistema: ${APP_URL}/app\n`;

    const sendError = await sendBrevo(recipients, subject, text);
    if (sendError) {
      await markStatus(logId, "failed", sendError);
      return jsonResponse(req, { ok: true, status: "failed", reason: sendError }, 200);
    }
    await markStatus(logId, "sent");
    return jsonResponse(req, { ok: true, status: "sent" }, 200);
  }

  if (mode === "digest") {
    const eventId = Number(body.event_id);
    if (!Number.isInteger(eventId) || eventId < 1 || eventId > 12) {
      return jsonResponse(req, { error: "validation", message: "event_id inválido." }, 400);
    }
    const { data: cfg } = await svc
      .from("notification_config")
      .select("*")
      .eq("event_id", eventId)
      .maybeSingle<ConfigRow>();
    if (!cfg || !cfg.is_active) {
      return jsonResponse(req, { ok: true, skipped: "inactive_or_missing" }, 200);
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data: pending } = await svc
      .from("notification_log")
      .select("*")
      .eq("event_id", eventId)
      .eq("status", "pending")
      .gte("created_at", startOfDay.toISOString())
      .order("created_at", { ascending: true });

    const rows = (pending ?? []) as LogRow[];
    if (rows.length === 0) {
      return jsonResponse(req, { ok: true, skipped: "nothing_pending" }, 200);
    }

    const recipients = validEmails(cfg.recipients);
    if (recipients.length === 0) {
      for (const row of rows) {
        await markStatus(row.id, "failed", "Sin destinatarios configurados para este evento.");
      }
      return jsonResponse(req, { ok: true, status: "failed", count: rows.length, reason: "no_recipients" }, 200);
    }

    const lines = rows.map((row, index) => `${index + 1}. ${row.created_at} — ${logSummary(row)}`);
    const subject = `[CMMS] Resumen diario — ${cfg.name} (${rows.length})`;
    const text =
      `Resumen diario del evento: ${cfg.name} (#${cfg.event_id})\n` +
      `Pendientes del día: ${rows.length}\n\n` +
      lines.join("\n") +
      `\n\nAbrir sistema: ${APP_URL}/app\n`;

    const sendError = await sendBrevo(recipients, subject, text);
    if (sendError) {
      for (const row of rows) {
        await markStatus(row.id, "failed", sendError);
      }
      return jsonResponse(req, { ok: true, status: "failed", count: rows.length, reason: sendError }, 200);
    }
    for (const row of rows) {
      await markStatus(row.id, "sent");
    }
    return jsonResponse(req, { ok: true, status: "sent", count: rows.length }, 200);
  }

  return jsonResponse(req, { error: "validation", message: "mode inválido." }, 400);
});
