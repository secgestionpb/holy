// Edge Function: send-scheduled-report (F7.5 M7)
// dispatch (pg_net, sin auth) | resend (Admin JWT + force)
// Genera adjunto (exceljs / pdf-lib), sube a bucket `reportes`, envía Brevo
// con adjunto, upsert report_send_log (dedup UNIQUE report_id+period_ym).
import { createClient } from "npm:@supabase/supabase-js@2";
import ExcelJS from "npm:exceljs@4.4.0";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { jsonResponse } from "../_shared/cookies.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_FROM = Deno.env.get("BREVO_FROM") ?? "cmms@hotel.local";
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

const svc = createClient(SUPABASE_URL, SERVICE_KEY);

type ScheduledReport = {
  id: string;
  report_key: string;
  report_name: string;
  format: "pdf" | "excel";
  recipients: string;
  is_active: boolean;
};

type ReportSection = {
  title: string;
  headers: string[];
  rows: (string | number | null)[][];
};

function validEmails(raw: string): string[] {
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function prevPeriodYmd(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
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

function periodRange(periodYm: string): { from: string; to: string } {
  const [y, m] = periodYm.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

async function buildSections(reportKey: string, periodYm: string): Promise<ReportSection[]> {
  const { from, to } = periodRange(periodYm);
  const sections: ReportSection[] = [];

  if (reportKey === "costos_mantenimiento") {
    const { data } = await svc.rpc("kpi_operativos", { p_from: from, p_to: to });
    const costCat = data?.cost_per_category?.rows ?? [];
    const costLoc = data?.cost_per_location?.rows ?? [];
    sections.push({
      title: "Costos por categoría de activo",
      headers: ["Categoría", "Total"],
      rows: costCat.map((r: Record<string, unknown>) => [String(r.name ?? ""), Number(r.total ?? 0)]),
    });
    sections.push({
      title: "Costos por ubicación",
      headers: ["Ubicación", "Total"],
      rows: costLoc.map((r: Record<string, unknown>) => [String(r.name ?? ""), Number(r.total ?? 0)]),
    });
  } else if (reportKey === "cumplimiento_pm") {
    const { data } = await svc.rpc("kpi_operativos", { p_from: from, p_to: to });
    const pct = data?.pm_on_time_pct ?? {};
    sections.push({
      title: "Cumplimiento de PM",
      headers: ["Indicador", "Valor"],
      rows: [
        ["% a tiempo", Number(pct.value ?? 0)],
        ["Preventivas generadas", Number(pct.total ?? 0)],
        ["Cerradas a tiempo", Number(pct.on_time ?? 0)],
        ["OTs vencidas actuales", Number(data?.overdue_pms?.value ?? 0)],
      ],
    });
  } else if (reportKey === "estado_certificaciones") {
    const { data } = await svc.rpc("kpi_cumplimiento", { p_from: from, p_to: to });
    const st = data?.certification_status ?? {};
    sections.push({
      title: "Certificaciones",
      headers: ["Estado", "Cantidad"],
      rows: [
        ["Vigentes", Number(st.vigente ?? st.vigor ?? 0)],
        ["Por vencer", Number(st.due ?? 0)],
        ["Vencidas", Number(st.expired ?? 0)],
      ],
    });
    sections.push({
      title: "Detalle",
      headers: ["Certificación", "Vence", "Días restantes", "Estado"],
      rows: (st.rows ?? []).map((r: Record<string, unknown>) => [
        String(r.name ?? ""),
        String(r.expires_at ?? ""),
        Number(r.days_left ?? 0),
        String(r.status ?? ""),
      ]),
    });
  } else if (reportKey === "consumo_inventario") {
    const { data } = await svc.rpc("kpi_inventario", { p_from: from, p_to: to });
    sections.push({
      title: "Valor de inventario por bodega",
      headers: ["Bodega", "Valor"],
      rows: (data?.inventory_value?.rows ?? []).map((r: Record<string, unknown>) => [
        String(r.name ?? ""),
        Number(r.total ?? 0),
      ]),
    });
    sections.push({
      title: "Ítems bajo stock mínimo",
      headers: ["Código", "Ítem", "Bodega", "Stock", "Mínimo"],
      rows: (data?.low_stock_items?.rows ?? []).map((r: Record<string, unknown>) => [
        String(r.code ?? ""),
        String(r.name ?? ""),
        String(r.warehouse ?? ""),
        Number(r.qty ?? 0),
        Number(r.min_stock ?? 0),
      ]),
    });
  } else if (reportKey === "ranking_fallas") {
    const { data } = await svc.rpc("kpi_operativos", { p_from: from, p_to: to });
    sections.push({
      title: "Activos con más fallas (correctivas)",
      headers: ["Código", "Activo", "OTs correctivas"],
      rows: (data?.failure_ranking?.rows ?? []).map((r: Record<string, unknown>) => [
        String(r.code ?? ""),
        String(r.name ?? ""),
        Number(r.count ?? 0),
      ]),
    });
  } else if (reportKey === "costos_proveedor") {
    const { data } = await svc.rpc("kpi_proveedores", { p_from: from, p_to: to });
    sections.push({
      title: "Costos externos por proveedor",
      headers: ["Proveedor", "OTs", "Total"],
      rows: (data?.provider_cost?.rows ?? []).map((r: Record<string, unknown>) => [
        String(r.name ?? ""),
        Number(r.wo_count ?? 0),
        Number(r.total ?? 0),
      ]),
    });
  }

  if (sections.length === 0) {
    sections.push({ title: "Sin datos", headers: ["Detalle"], rows: [["Sin datos en el período"]] });
  }
  return sections;
}

async function buildXlsx(report: ScheduledReport, periodYm: string, sections: ReportSection[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CMMS Hotelero";
  for (const sec of sections) {
    const ws = wb.addWorksheet(sec.title.slice(0, 31));
    ws.addRow([`CMMS Hotelero — ${report.report_name}`]);
    ws.addRow([`Período: ${periodYm}`]);
    ws.addRow([]);
    ws.addRow(sec.headers);
    for (const row of sec.rows) ws.addRow(row);
    ws.getRow(4).font = { bold: true };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

async function buildPdf(report: ScheduledReport, periodYm: string, sections: ReportSection[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage();
  let y = 760;
  const drawLine = (text: string, size: number, isBold = false) => {
    if (y < 60) {
      page = doc.addPage();
      y = 760;
    }
    page.drawText(text, { x: 40, y, size, font: isBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= size + 8;
  };
  drawLine("CMMS Hotelero", 16, true);
  drawLine(report.report_name, 13, true);
  drawLine(`Periodo: ${periodYm}`, 10);
  drawLine(`Generado: ${new Date().toISOString().slice(0, 10)}`, 9);
  y -= 6;
  for (const sec of sections) {
    drawLine(sec.title, 12, true);
    drawLine(sec.headers.join(" | "), 9, true);
    for (const row of sec.rows.slice(0, 60)) {
      drawLine(row.map((c) => (c === null ? "" : String(c))).join(" | "), 8);
    }
    y -= 8;
  }
  return await doc.save();
}

async function sendBrevoWithAttachment(
  to: string[],
  subject: string,
  text: string,
  filename: string,
  contentBase64: string,
): Promise<string | null> {
  if (!BREVO_API_KEY) return "BREVO_API_KEY no configurada.";
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
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
      attachment: [{ content: contentBase64, name: filename }],
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return `Brevo ${resp.status}: ${detail.slice(0, 300)}`;
  }
  return null;
}

async function upsertLog(
  reportId: string,
  periodYm: string,
  status: string,
  recipients: string,
  filePath: string | null,
  errorMessage: string | null,
) {
  const { error } = await svc
    .from("report_send_log")
    .upsert(
      {
        report_id: reportId,
        period_ym: periodYm,
        status,
        recipients,
        file_path: filePath,
        error_message: errorMessage,
        sent_at: new Date().toISOString(),
      },
      { onConflict: "report_id,period_ym" },
    );
  if (error) console.error("upsert log", error);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "method_not_allowed" }, 405);
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse(req, { error: "invalid_body" }, 400);

  const action = String(body.action ?? "dispatch");
  const force = body.force === true;

  if (action === "resend") {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader || !(await isAdminToken(authHeader))) {
      return jsonResponse(req, { error: "forbidden", message: "Requiere rol Administrador." }, 403);
    }
  } else if (action !== "dispatch") {
    return jsonResponse(req, { error: "validation", message: "Acción no reconocida." }, 400);
  }

  const reportId = String(body.report_id ?? "");
  if (!reportId) return jsonResponse(req, { error: "validation", message: "Falta report_id." }, 400);
  const periodYm = String(body.period_ym ?? prevPeriodYmd());
  if (!/^\d{4}-\d{2}$/.test(periodYm)) {
    return jsonResponse(req, { error: "validation", message: "period_ym inválido." }, 400);
  }

  const { data: report } = await svc
    .from("scheduled_reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle<ScheduledReport>();
  if (!report) return jsonResponse(req, { error: "not_found", message: "Reporte inexistente." }, 404);

  if (action === "dispatch") {
    const { data: existing } = await svc
      .from("report_send_log")
      .select("id")
      .eq("report_id", reportId)
      .eq("period_ym", periodYm)
      .maybeSingle();
    if (existing) {
      return jsonResponse(req, { ok: true, skipped: "already_logged" }, 200);
    }
  }

  const recipients = validEmails(report.recipients);
  if (recipients.length === 0) {
    await upsertLog(reportId, periodYm, "skipped_no_recipients", "", null, null);
    return jsonResponse(req, { ok: true, status: "skipped_no_recipients" }, 200);
  }

  try {
    const sections = await buildSections(report.report_key, periodYm);
    const isXlsx = report.format === "excel";
    const bytes = isXlsx
      ? await buildXlsx(report, periodYm, sections)
      : await buildPdf(report, periodYm, sections);
    const ext = isXlsx ? "xlsx" : "pdf";
    const filePath = `${report.report_key}/${periodYm}.${ext}`;
    const filename = `${report.report_key}_${periodYm}.${ext}`;

    const { error: upErr } = await svc.storage
      .from("reportes")
      .upload(filePath, bytes, { contentType: isXlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf", upsert: true });
    if (upErr) throw new Error(`Storage: ${upErr.message}`);

    const b64 = btoa(String.fromCharCode(...bytes));
    const subject = `[CMMS] ${report.report_name} — ${periodYm}`;
    const text =
      `Reporte programado: ${report.report_name}\n` +
      `Período reportado: ${periodYm}\n` +
      `Formato: ${isXlsx ? "Excel" : "PDF"}\n\n` +
      `Abrir sistema: ${APP_URL}/app/reportes\n`;

    const sendError = await sendBrevoWithAttachment(recipients, subject, text, filename, b64);
    if (sendError) {
      await upsertLog(reportId, periodYm, "failed", recipients.join(", "), filePath, sendError);
      return jsonResponse(req, { ok: true, status: "failed", reason: sendError }, 200);
    }

    await upsertLog(reportId, periodYm, "sent", recipients.join(", "), filePath, null);
    return jsonResponse(req, { ok: true, status: "sent", file_path: filePath }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await upsertLog(reportId, periodYm, "failed", recipients.join(", "), null, msg);
    return jsonResponse(req, { ok: true, status: "failed", reason: msg }, 200);
  }
});
