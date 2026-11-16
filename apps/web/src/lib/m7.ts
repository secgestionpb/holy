import { apiFetch } from '@/lib/auth'

export type Result = { ok: true } | { ok: false; message: string }

type ErrorBody = { message?: string; error?: string; details?: string }

async function restErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null
  return body?.message ?? body?.error ?? body?.details ?? fallback
}

async function callRpc<T>(fn: string, args: Record<string, unknown>, fallback: string): Promise<Result & { data?: T }> {
  try {
    const response = await apiFetch(`/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!response.ok) return { ok: false, message: await restErrorMessage(response, fallback) }
    const data = (await response.json().catch(() => null)) as T | null
    return { ok: true, data: data ?? undefined }
  } catch {
    return { ok: false, message: fallback }
  }
}

export type KpiRow = Record<string, unknown>

export type KpiGroup = 'operativos' | 'inventario' | 'proveedores' | 'cumplimiento' | 'activos'

export const KPI_GROUPS: Array<{ key: KpiGroup; label: string }> = [
  { key: 'operativos', label: 'Operativos de mantenimiento' },
  { key: 'inventario', label: 'Inventario' },
  { key: 'proveedores', label: 'Proveedores y contratistas' },
  { key: 'cumplimiento', label: 'Cumplimiento normativo y calidad' },
  { key: 'activos', label: 'Activos' },
]

export const KPI_TITLES: Record<string, string> = {
  mttr: 'MTTR',
  mtbf: 'MTBF',
  pm_on_time_pct: '% cumplimiento de PM',
  overdue_pms: 'OTs vencidas actuales',
  avg_response_time: 'Tiempo promedio de respuesta',
  cost_per_asset: 'Costo por activo',
  cost_per_category: 'Costo por categoría',
  cost_per_location: 'Costo por ubicación',
  failure_ranking: 'Ranking de fallas',
  ots_by_origin: 'OTs por origen',
  reassigned_ots: 'OTs reasignadas',
  technician_performance: 'Desempeño por técnico',
  inventory_value: 'Valor de inventario',
  low_stock_items: 'Ítems bajo mínimo',
  negative_stock_items: 'Stock negativo',
  parts_consumption: 'Consumo de repuestos',
  count_history: 'Historial de conteos',
  provider_cost: 'Costo por proveedor',
  contracts_expiring: 'Contratos por vencer',
  contractor_history: 'Historial de contratista',
  certification_status: 'Certificaciones',
  certification_history: 'Historial de vigencias',
  out_of_range_measurements: 'Mediciones fuera de rango',
  measurement_trends: 'Tendencia de mediciones',
  assets_by_stage: 'Activos por etapa',
  remaining_life: 'Vida útil restante',
  warranty_status: 'Garantías',
}

export const KPI_KEYS_BY_GROUP: Record<KpiGroup, string[]> = {
  operativos: ['mttr', 'mtbf', 'pm_on_time_pct', 'overdue_pms', 'avg_response_time', 'cost_per_asset', 'cost_per_category', 'cost_per_location', 'failure_ranking', 'ots_by_origin', 'reassigned_ots', 'technician_performance'],
  inventario: ['inventory_value', 'low_stock_items', 'negative_stock_items', 'parts_consumption', 'count_history'],
  proveedores: ['provider_cost', 'contracts_expiring', 'contractor_history'],
  cumplimiento: ['certification_status', 'certification_history', 'out_of_range_measurements', 'measurement_trends'],
  activos: ['assets_by_stage', 'remaining_life', 'warranty_status'],
}

const SETS: Record<string, string[]> = {
  administrador: Object.values(KPI_KEYS_BY_GROUP).flat(),
  mantenimiento: [...KPI_KEYS_BY_GROUP.operativos, ...KPI_KEYS_BY_GROUP.inventario, ...KPI_KEYS_BY_GROUP.proveedores, ...KPI_KEYS_BY_GROUP.activos],
  calidad: ['pm_on_time_pct', 'overdue_pms', ...KPI_KEYS_BY_GROUP.cumplimiento],
  tecnico: ['technician_performance', 'overdue_pms'],
}

export function roleSet(roles: string[]): string[] {
  const set = new Set<string>()
  for (const role of roles) for (const key of SETS[role] ?? []) set.add(key)
  return Object.values(KPI_KEYS_BY_GROUP).flat().filter((k) => set.has(k))
}

export type UserKpiRow = { id: string; kpi_key: string; visible: boolean }

export async function seedDashboardKpis(): Promise<Result> {
  const r = await callRpc<number>('m7_seed_dashboard_kpis', {}, 'No se pudo inicializar el dashboard.')
  if (!r.ok) return r
  return { ok: true }
}

export async function fetchVisibleKpis(): Promise<{ ok: true; rows: UserKpiRow[] } | { ok: false; message: string }> {
  const response = await apiFetch('/rest/v1/user_dashboard_kpis?select=id,kpi_key,visible&order=kpi_key.asc')
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo cargar la personalización.') }
  return { ok: true, rows: (await response.json()) as UserKpiRow[] }
}

export async function upsertKpiVisible(kpiKey: string, visible: boolean): Promise<Result> {
  const response = await apiFetch('/rest/v1/user_dashboard_kpis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ kpi_key: kpiKey, visible }),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo guardar la preferencia.') }
  return { ok: true }
}

export async function fetchKpiGroup(group: KpiGroup, from: string, to: string): Promise<Result & { data?: Record<string, KpiRow> }> {
  if (group === 'activos') return callRpc<Record<string, KpiRow>>('kpi_activos', {}, 'No se pudo calcular el grupo.')
  return callRpc<Record<string, KpiRow>>(`kpi_${group}`, { p_from: from, p_to: to }, 'No se pudo calcular el grupo.')
}

export type ScheduledReport = {
  id: string
  report_key: string
  report_name: string
  frequency: string
  send_day: number
  format: 'pdf' | 'excel'
  recipients: string
  is_active: boolean
  updated_at: string
}

export type ReportSendLog = {
  id: string
  report_id: string
  period_ym: string
  sent_at: string
  status: 'sent' | 'failed' | 'skipped_no_recipients'
  recipients: string
  file_path: string | null
  error_message: string | null
}

export async function fetchScheduledReports(): Promise<{ ok: true; rows: ScheduledReport[] } | { ok: false; message: string }> {
  const response = await apiFetch('/rest/v1/scheduled_reports?select=*&order=report_name.asc')
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudieron cargar los reportes programados.') }
  return { ok: true, rows: (await response.json()) as ScheduledReport[] }
}

export async function fetchSendLogs(): Promise<{ ok: true; rows: ReportSendLog[] } | { ok: false; message: string }> {
  const response = await apiFetch('/rest/v1/report_send_log?select=*&order=sent_at.desc&limit=100')
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo cargar el historial de envíos.') }
  return { ok: true, rows: (await response.json()) as ReportSendLog[] }
}

export async function updateScheduledReport(
  id: string,
  patch: Partial<Pick<ScheduledReport, 'send_day' | 'format' | 'recipients' | 'is_active'>>,
): Promise<Result> {
  const response = await apiFetch(`/rest/v1/scheduled_reports?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo guardar el reporte.') }
  return { ok: true }
}

export async function resendReport(reportId: string): Promise<Result & { status?: string; reason?: string }> {
  try {
    const response = await apiFetch('/functions/v1/send-scheduled-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resend', report_id: reportId, force: true }),
    })
    if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo reenviar el reporte.') }
    const data = (await response.json().catch(() => null)) as { ok?: boolean; status?: string; reason?: string; error?: string } | null
    if (data?.error) return { ok: false, message: data.error }
    return { ok: true, status: data?.status, reason: data?.reason }
  } catch {
    return { ok: false, message: 'No se pudo reenviar el reporte.' }
  }
}
