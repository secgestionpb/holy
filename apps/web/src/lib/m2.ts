import { apiFetch } from '@/lib/auth'
import { useAuth } from '@/lib/auth-store'
import { type Result } from '@/lib/m1'
import { compressImage, fileSizeError } from '@/lib/upload-utils'

// ============ Tipos ============

export type WoStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'waiting_parts'
  | 'completed'
  | 'closed'
  | 'cancelled'

export type WoType = 'corrective' | 'preventive' | 'inspection'
export type Priority = 'urgent' | 'normal' | 'low'
export type WoOrigin = 'manual' | 'damage_report' | 'preventive' | 'external_app'
export type ExecutedByType = 'internal' | 'external'
export type DamageStatus = 'pending_review' | 'converted' | 'discarded'
export type EvidenceKind = 'before' | 'after' | 'other'
export type Coverage = 'parts' | 'labor' | 'both'

export type WoRow = {
  id: string
  wo_number: string
  asset_id: string
  component_id: string | null
  wo_type: WoType
  priority: Priority
  description: string
  origin: WoOrigin
  damage_report_id: string | null
  damage_report_ref: string | null
  plan_id: string | null
  external_ref: string | null
  reported_by: string | null
  reported_at: string
  status: WoStatus
  scheduled_at: string | null
  assigned_at: string | null
  started_at: string | null
  finished_at: string | null
  closed_at: string | null
  closed_by: string | null
  affects_sale: boolean
  executed_by_type: ExecutedByType
  provider_id: string | null
  provider_name: string | null
  external_cost: number | null
  generates_warranty: boolean | null
  reassigned: boolean
  diagnosis: string | null
  solution: string | null
  created_at: string
  updated_at: string
  asset_code: string | null
  asset_name: string | null
  location_id: string | null
  component_code: string | null
  component_name: string | null
  location_path: string | null
  category_name: string | null
  reported_by_name: string | null
  closed_by_name: string | null
  tech_names: string | null
  tech_count: number | null
  multi_open: boolean
}

export type DamageRow = {
  id: string
  report_ref: string
  asset_id: string | null
  component_id: string | null
  description: string
  location: string | null
  reported_by: string
  reported_at: string
  status: DamageStatus
  reviewed_by: string | null
  reviewed_at: string | null
  discarded_by: string | null
  discarded_at: string | null
  discard_reason: string | null
  origin: string
  external_ref: string | null
  created_at: string
  updated_at: string
  asset_code: string | null
  asset_name: string | null
  category_id: string | null
  component_code: string | null
  component_name: string | null
  location_path: string | null
  category_name: string | null
  reporter_name: string | null
  wo_id: string | null
  wo_number: string | null
}

export type WoTechRow = {
  wo_id: string
  user_id: string
  assigned_by: string | null
  assigned_at: string
  removed_at: string | null
  removed_by: string | null
  hours_worked: number
  started_at: string | null
  finished_at: string | null
  users: { full_name: string; hourly_rate: number | null } | null
}

export type WoCommentRow = {
  id: string
  wo_id: string
  author_id: string
  body: string
  attachment_path: string | null
  created_at: string
  author?: { full_name: string } | null
}

export type WoEvidenceRow = {
  id: string
  work_order_id: string | null
  damage_report_id: string | null
  kind: EvidenceKind
  storage_path: string
  uploaded_by: string
  uploaded_at: string
}

export type ProviderLite = { id: string; name: string }
export type TechnicianLite = { id: string; full_name: string }

export type ChecklistEntryRow = {
  id: string
  wo_id: string
  position: number
  item_text: string
  status: 'pending' | 'done' | 'not_applicable'
  note: string | null
}

// ============ Etiquetas ============

export const STATUS_LABELS: Record<WoStatus, string> = {
  open: 'Abierta',
  assigned: 'Asignada',
  in_progress: 'En proceso',
  waiting_parts: 'Pendiente de repuesto/aprobación',
  completed: 'Completada',
  closed: 'Cerrada',
  cancelled: 'Cancelada',
}

export const TYPE_LABELS: Record<WoType, string> = {
  corrective: 'Correctiva',
  preventive: 'Preventiva',
  inspection: 'Inspección',
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgente',
  normal: 'Normal',
  low: 'Baja',
}

export const ORIGIN_LABELS: Record<WoOrigin, string> = {
  manual: 'Manual',
  damage_report: 'Reporte de daño',
  preventive: 'Preventiva',
  external_app: 'App externa',
}

export const DAMAGE_STATUS_LABELS: Record<DamageStatus, string> = {
  pending_review: 'Pendiente de revisión',
  converted: 'Convertido a OT',
  discarded: 'Descartado',
}

export const EXECUTED_LABELS: Record<ExecutedByType, string> = {
  internal: 'Personal interno',
  external: 'Contratista externo',
}

export const COVERAGE_LABELS: Record<Coverage, string> = {
  parts: 'Piezas',
  labor: 'Mano de obra',
  both: 'Ambas',
}

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  before: 'Antes',
  after: 'Después',
  other: 'Otra',
}

export const STATUS_BADGE_CLASS: Record<WoStatus, string> = {
  open: 'bg-muted text-muted-foreground',
  assigned: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  in_progress: 'bg-primary/15 text-primary',
  waiting_parts: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  closed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/15 text-destructive',
}

// ============ Pestañas de V2.1 (estado en la URL) ============

export const TAB_IDS = ['pendientes', 'completed', 'cancelled', 'all'] as const
export type TabId = (typeof TAB_IDS)[number]

export const TAB_LABELS: Record<TabId, string> = {
  pendientes: 'Pendientes',
  completed: 'Completadas',
  cancelled: 'Canceladas',
  all: 'Todas',
}

export const TAB_STATUS: Record<TabId, readonly WoStatus[] | null> = {
  pendientes: ['open', 'assigned', 'in_progress', 'waiting_parts'],
  completed: ['completed', 'closed'],
  cancelled: ['cancelled'],
  all: null,
}

export function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value)
}

export function statusInTab(status: WoStatus, tab: TabId): boolean {
  const group = TAB_STATUS[tab]
  return group === null || group.includes(status)
}

export const TERMINAL_STATUSES: readonly WoStatus[] = ['closed', 'cancelled']

export function isTerminal(status: WoStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

// ============ Helpers ============

type PgError = { message?: string; code?: string }

async function restErrorMessage(response: Response, fallback: string): Promise<string> {
  if (response.status === 403 || response.status === 401) {
    return 'No tienes permisos para esta operación.'
  }
  const body = (await response.json().catch(() => null)) as PgError | null
  return body?.message ?? fallback
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const response = await apiFetch(path)
  if (!response.ok) throw new Error(await restErrorMessage(response, fallback))
  return (await response.json()) as T
}

async function postJson<T = object>(
  path: string,
  body: unknown,
  fallback: string,
): Promise<Result & Partial<T>> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, fallback) }
  const data = (await response.json().catch(() => null)) as Partial<T> | null
  return { ok: true, ...(data ?? ({} as Partial<T>)) }
}

// PATCH con return=representation: si RLS bloquea, PostgREST devuelve 0 filas
// (200/204 silencioso) — lo traducimos en error para no fingir éxito.
async function patchRows(
  path: string,
  patch: Record<string, unknown>,
  fallback: string,
): Promise<Result> {
  const response = await apiFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, fallback) }
  const rows = (await response.json().catch(() => [])) as unknown[]
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, message: 'No tienes permisos para esta operación, o el registro ya no existe.' }
  }
  return { ok: true }
}

// ============ Consultas ============

export function fetchWorkOrders(): Promise<WoRow[]> {
  return getJson<WoRow[]>(
    '/rest/v1/v2_work_orders?select=*&order=reported_at.desc,wo_number.desc',
    'No se pudieron cargar las órdenes de trabajo.',
  )
}

export async function fetchWorkOrder(id: string): Promise<WoRow | null> {
  const rows = await getJson<WoRow[]>(
    `/rest/v1/v2_work_orders?select=*&id=eq.${id}&limit=1`,
    'No se pudo cargar la orden de trabajo.',
  )
  return rows[0] ?? null
}

export function fetchAssetWorkOrders(assetId: string): Promise<WoRow[]> {
  return getJson<WoRow[]>(
    `/rest/v1/v2_work_orders?select=*&asset_id=eq.${assetId}&order=reported_at.desc`,
    'No se pudieron cargar las OTs del activo.',
  )
}

export function fetchDamageReports(): Promise<DamageRow[]> {
  return getJson<DamageRow[]>(
    '/rest/v1/v2_damage_reports?select=*&order=reported_at.desc',
    'No se pudieron cargar los reportes de daño.',
  )
}

export async function fetchDamageReport(id: string): Promise<DamageRow | null> {
  const rows = await getJson<DamageRow[]>(
    `/rest/v1/v2_damage_reports?select=*&id=eq.${id}&limit=1`,
    'No se pudo cargar el reporte de daño.',
  )
  return rows[0] ?? null
}

export function fetchWoTechnicians(woId: string): Promise<WoTechRow[]> {
  return getJson<WoTechRow[]>(
    `/rest/v1/wo_technicians?select=*,users!wo_technicians_user_id_fkey(full_name,hourly_rate)&wo_id=eq.${woId}&order=assigned_at.asc`,
    'No se pudieron cargar los técnicos asignados.',
  )
}

export async function fetchAllActiveAssignments(): Promise<Array<{ wo_id: string; user_id: string }>> {
  return getJson<Array<{ wo_id: string; user_id: string }>>(
    '/rest/v1/wo_technicians?select=wo_id,user_id&removed_at=is.null&limit=5000',
    'No se pudieron cargar las asignaciones.',
  )
}

export function fetchWoComments(woId: string): Promise<WoCommentRow[]> {
  return getJson<WoCommentRow[]>(
    `/rest/v1/wo_comments?select=*,author:users(full_name)&wo_id=eq.${woId}&order=created_at.asc`,
    'No se pudieron cargar los comentarios.',
  )
}

export function fetchWoEvidence(workOrderId: string): Promise<WoEvidenceRow[]> {
  return getJson<WoEvidenceRow[]>(
    `/rest/v1/wo_evidence?select=*&work_order_id=eq.${workOrderId}&order=uploaded_at.asc`,
    'No se pudo cargar la evidencia.',
  )
}

export function fetchDamageEvidence(damageReportId: string): Promise<WoEvidenceRow[]> {
  return getJson<WoEvidenceRow[]>(
    `/rest/v1/wo_evidence?select=*&damage_report_id=eq.${damageReportId}&order=uploaded_at.asc`,
    'No se pudo cargar la evidencia.',
  )
}

export function fetchChecklist(woId: string): Promise<ChecklistEntryRow[]> {
  return getJson<ChecklistEntryRow[]>(
    `/rest/v1/wo_checklist_entries?select=*&wo_id=eq.${woId}&order=position.asc`,
    'No se pudo cargar el checklist.',
  )
}

type UserRolesRow = {
  id: string
  full_name: string
  is_active: boolean
  user_roles: Array<{ role: string }> | null
}

export async function fetchTechnicians(): Promise<TechnicianLite[]> {
  const rows = await getJson<UserRolesRow[]>(
    '/rest/v1/users?select=id,full_name,is_active,user_roles!user_roles_user_id_fkey(role)&order=full_name.asc',
    'No se pudieron cargar los técnicos.',
  )
  return rows
    .filter(
      (row) => row.is_active && (row.user_roles ?? []).some((entry) => entry.role === 'tecnico'),
    )
    .map((row) => ({ id: row.id, full_name: row.full_name }))
}

export function fetchProvidersLite(): Promise<ProviderLite[]> {
  return getJson<ProviderLite[]>(
    '/rest/v1/providers?select=id,name&is_active=eq.true&order=name.asc',
    'No se pudieron cargar los proveedores.',
  )
}

export async function fetchLaborRate(): Promise<number> {
  const rows = await getJson<Array<{ key: string; value: string }>>(
    '/rest/v1/system_parameters?select=key,value&key=eq.labor_hourly_rate&limit=1',
    'No se pudo cargar la tarifa de mano de obra.',
  )
  const rate = Number(rows[0]?.value ?? '0')
  return Number.isFinite(rate) ? rate : 0
}

export async function fetchPendingDamageCount(): Promise<number> {
  const rows = await getJson<Array<{ id: string }>>(
    '/rest/v1/v2_damage_reports?select=id&status=eq.pending_review&limit=500',
    'No se pudo cargar el contador de reportes.',
  )
  return rows.length
}

// ============ Escrituras de OT ============

export type CreateWoInput = {
  asset_id: string
  description: string
  component_id?: string | null
  wo_type?: WoType
  priority?: Priority
  origin?: WoOrigin
  damage_report_id?: string | null
  scheduled_at?: string | null
  affects_sale?: boolean
  executed_by_type?: ExecutedByType
  provider_id?: string | null
  external_cost?: number | null
  technicians?: string[]
}

export function createWo(input: CreateWoInput): Promise<Result & { id?: string; wo_number?: string }> {
  return postJson<{ id: string; wo_number: string; status: string }>(
    '/rest/v1/rpc/m2_create_wo',
    {
      p_asset_id: input.asset_id,
      p_description: input.description,
      p_component_id: input.component_id ?? null,
      p_wo_type: input.wo_type ?? 'corrective',
      p_priority: input.priority ?? 'normal',
      p_origin: input.origin ?? 'manual',
      p_damage_report_id: input.damage_report_id ?? null,
      p_scheduled_at: input.scheduled_at || null,
      p_affects_sale: input.affects_sale ?? false,
      p_executed_by_type: input.executed_by_type ?? 'internal',
      p_provider_id: input.provider_id ?? null,
      p_external_cost: input.external_cost ?? null,
      p_technicians: input.technicians && input.technicians.length > 0 ? input.technicians : null,
    },
    'No se pudo crear la orden de trabajo.',
  )
}

export function updateWo(id: string, patch: Record<string, unknown>): Promise<Result> {
  return patchRows(`/rest/v1/work_orders?id=eq.${id}`, patch, 'No se pudo guardar la orden de trabajo.')
}

export function transitionWo(id: string, status: WoStatus): Promise<Result> {
  return patchRows(`/rest/v1/work_orders?id=eq.${id}`, { status }, 'No se pudo cambiar el estado.')
}

export function assignWo(woId: string, technicians: string[]): Promise<Result> {
  return postJson(
    '/rest/v1/rpc/m2_assign_wo',
    { p_wo_id: woId, p_technicians: technicians },
    'No se pudo guardar la asignación.',
  )
}

export function replaceTechnician(
  woId: string,
  outUser: string,
  inUser: string,
  observation: string,
): Promise<Result> {
  return postJson(
    '/rest/v1/rpc/m2_technician_replace',
    { p_wo_id: woId, p_out_user: outUser, p_in_user: inUser, p_observation: observation },
    'No se pudo reemplazar al técnico.',
  )
}

export function cancelWo(woId: string, reason: string): Promise<Result> {
  return postJson(
    '/rest/v1/rpc/m2_cancel_wo',
    { p_wo_id: woId, p_reason: reason },
    'No se pudo cancelar la OT.',
  )
}

export function reopenWo(woId: string, reason: string): Promise<Result> {
  return postJson(
    '/rest/v1/rpc/m2_reopen_wo',
    { p_wo_id: woId, p_reason: reason },
    'No se pudo reabrir la OT.',
  )
}

export function discardDamageReport(reportId: string, reason: string): Promise<Result> {
  return postJson(
    '/rest/v1/rpc/m2_discard_damage_report',
    { p_report_id: reportId, p_reason: reason },
    'No se pudo descartar el reporte.',
  )
}

// ============ Cierre formal (Edge Function wo_close_engine — M2.1) ============

export type WarrantySubform = {
  start_date: string
  end_date: string
  coverage: Coverage
  provider_id?: string | null
  provider_name?: string | null
  notes?: string | null
  document_path?: string | null
}

export type CloseWoPayload = {
  wo_id: string
  diagnosis: string
  solution: string
  executed_by_type: ExecutedByType
  provider_id?: string | null
  external_cost?: number | null
  affects_sale?: boolean
  generates_warranty: boolean
  warranty?: WarrantySubform | null
  warranty_document_path?: string | null
}

export function closeWo(payload: CloseWoPayload): Promise<Result> {
  return postJson(
    '/functions/v1/wo_close_engine',
    payload,
    'No se pudo cerrar la orden de trabajo.',
  )
}

// ============ Comentarios, horas y evidencia ============

export async function addComment(woId: string, body: string): Promise<Result> {
  const response = await apiFetch('/rest/v1/wo_comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ wo_id: woId, author_id: useAuth.getState().user?.id ?? null, body }),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo publicar el comentario.') }
  return { ok: true }
}

export function setTechnicianHours(
  woId: string,
  userId: string,
  hours: number,
): Promise<Result> {
  return patchRows(
    `/rest/v1/wo_technicians?wo_id=eq.${woId}&user_id=eq.${userId}`,
    { hours_worked: hours },
    'No se pudieron guardar las horas.',
  )
}

export async function createDamageReport(input: {
  description: string
  location: string
}): Promise<Result & { id?: string }> {
  const response = await apiFetch('/rest/v1/damage_reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      asset_id: null,
      description: input.description,
      location: input.location,
      reported_by: useAuth.getState().user?.id ?? null,
    }),
  })
  if (!response.ok) {
    return { ok: false, message: await restErrorMessage(response, 'No se pudo crear el reporte.') }
  }
  const rows = (await response.json().catch(() => [])) as Array<{ id: string }>
  return { ok: true, id: rows[0]?.id }
}

function storageObjectPath(parentId: string, file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
  return `${parentId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
}

export async function uploadEvidence(input: {
  parentId: string
  file: File
  kind: EvidenceKind
  damageReport?: boolean
}): Promise<Result> {
  let file = input.file
  if (file.type.startsWith('image/')) file = await compressImage(file)
  const sizeError = fileSizeError(file)
  if (sizeError) return { ok: false, message: sizeError }
  const objectPath = storageObjectPath(input.parentId, file)
  const upload = await apiFetch(`/storage/v1/object/ot_evidencias/${objectPath}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!upload.ok) return { ok: false, message: 'No se pudo subir la fotografía.' }
  const insert = await apiFetch('/rest/v1/wo_evidence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: input.kind,
      storage_path: `ot_evidencias/${objectPath}`,
      uploaded_by: useAuth.getState().user?.id ?? null,
      ...(input.damageReport
        ? { damage_report_id: input.parentId, work_order_id: null }
        : { work_order_id: input.parentId, damage_report_id: null }),
    }),
  })
  if (!insert.ok) return { ok: false, message: await restErrorMessage(insert, 'No se pudo registrar la evidencia.') }
  return { ok: true }
}

export async function deleteEvidence(row: WoEvidenceRow): Promise<Result> {
  await apiFetch(`/storage/v1/object/${row.storage_path}`, { method: 'DELETE' })
  const response = await apiFetch(`/rest/v1/wo_evidence?id=eq.${row.id}`, { method: 'DELETE' })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo eliminar la evidencia.') }
  return { ok: true }
}

export function evidenceFileName(row: WoEvidenceRow): string {
  const segment = row.storage_path.split('/').pop() ?? row.storage_path
  return segment
}
