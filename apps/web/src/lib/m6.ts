import { apiFetch } from '@/lib/auth'
import { fileSizeError } from '@/lib/upload-utils'

export type Result = { ok: true } | { ok: false; message: string }

type ErrorBody = { message?: string; error?: string; details?: string }

async function restErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null
  return body?.message ?? body?.error ?? body?.details ?? fallback
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const response = await apiFetch(path)
  if (!response.ok) throw new Error(await restErrorMessage(response, fallback))
  return (await response.json()) as T
}

async function postJson<T extends object = object>(
  path: string,
  body: unknown,
  fallback: string,
): Promise<Result & Partial<T>> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, fallback) }
  const data = (await response.json().catch(() => null)) as Partial<T> | null
  const row = Array.isArray(data) ? (data[0] ?? null) : data
  return { ok: true, ...(row ?? {}) }
}

async function patchRows(path: string, patch: unknown): Promise<Result> {
  const response = await apiFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo guardar.') }
  return { ok: true }
}

async function callRpc<T extends object>(
  fn: string,
  args: Record<string, unknown>,
  fallback: string,
): Promise<Result & Partial<T>> {
  try {
    const response = await apiFetch(`/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!response.ok) return { ok: false, message: await restErrorMessage(response, fallback) }
    const data = (await response.json().catch(() => null)) as Partial<T> | null
    return { ok: true, ...(data ?? {}) }
  } catch {
    return { ok: false, message: fallback }
  }
}

async function callRpcRows<T>(
  fn: string,
  args: Record<string, unknown>,
  fallback: string,
): Promise<{ ok: true; rows: T[] } | { ok: false; message: string }> {
  try {
    const response = await apiFetch(`/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!response.ok) return { ok: false, message: await restErrorMessage(response, fallback) }
    const data = (await response.json().catch(() => null)) as unknown
    return { ok: true, rows: Array.isArray(data) ? (data as T[]) : data ? [data as T] : [] }
  } catch {
    return { ok: false, message: fallback }
  }
}

// ============ Etiquetas ============

export const RENEWAL_PERIOD_KEYS = [
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'annual',
  'other',
] as const
export type RenewalPeriod = (typeof RENEWAL_PERIOD_KEYS)[number]

export const RENEWAL_PERIOD_LABELS: Record<RenewalPeriod, string> = {
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
  other: 'Otra',
}

export const UNIT_KEYS = [
  'unidad',
  'pH',
  'ppm',
  'mg_l',
  'porcentaje',
  'celsius',
  'litro',
  'kg',
  'm3',
  'otro',
] as const
export type UnitKey = (typeof UNIT_KEYS)[number]

export const UNIT_LABELS: Record<UnitKey, string> = {
  unidad: 'Unidad',
  pH: 'pH',
  ppm: 'ppm',
  mg_l: 'mg/L',
  porcentaje: '%',
  celsius: '°C',
  litro: 'Litro',
  kg: 'kg',
  m3: 'm³',
  otro: 'Otro',
}

export const FREQUENCY_KEYS = ['daily', 'every_2_days', 'weekly', 'biweekly', 'monthly'] as const
export type MeasFrequency = (typeof FREQUENCY_KEYS)[number]

export const FREQUENCY_LABELS: Record<MeasFrequency, string> = {
  daily: 'Diaria',
  every_2_days: 'Cada 2 días',
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
}

export const CERT_STATUS_LABELS = {
  valid: 'Vigente',
  expiring: 'Por vencer',
  expired: 'Vencido',
} as const
export type CertStatus = keyof typeof CERT_STATUS_LABELS

export const RESULT_LABELS = {
  in_range: 'Dentro de rango',
  out_of_range: 'Fuera de rango',
} as const
export type MeasurementResult = keyof typeof RESULT_LABELS

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isoDaysFromToday(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (Number.isNaN(n)) return String(value)
  return n.toLocaleString('es-ES', { maximumFractionDigits: 3 })
}

// ============ Tipos de fila ============

export type ComplianceCategoryRow = {
  id: string
  name: string
  description: string | null
  is_active: boolean
}

export type CertificationRow = {
  id: string
  name: string
  asset_id: string | null
  compliance_category_id: string
  issuing_entity: string | null
  certificate_number: string | null
  issued_at: string | null
  expires_at: string
  renewal_period: RenewalPeriod | null
  lead_days: number | null
  responsible_provider_id: string | null
  document_path: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  asset: { id: string; code: string; name: string } | null
  compliance_category: { id: string; name: string } | null
  provider: { id: string; name: string } | null
}

export type CertHistoryRow = {
  id: string
  certification_id: string
  issued_at: string
  expires_at: string
  renewed_at: string
  responsible_provider_id: string | null
  document_path: string | null
  note: string | null
  provider: { id: string; name: string } | null
}

export type MeasurementTypeRow = {
  id: string
  name: string
  category_id: string
  unit: UnitKey
  min_value: number
  max_value: number
  frequency: MeasFrequency
  is_active: boolean
  category: { id: string; name: string } | null
  record_count?: number
}

export type MeasurementRecordRow = {
  id: string
  measurement_type_id: string
  asset_id: string
  measured_at: string
  value: number
  result: MeasurementResult
  recorded_by: string | null
  notes: string | null
  evidence_path: string | null
  measurement_type: { id: string; name: string; unit: UnitKey; min_value: number; max_value: number } | null
  asset: { id: string; code: string; name: string } | null
  recorder: { id: string; full_name: string } | null
}

export type MissingMeasurementRow = {
  type_id: string
  type_name: string
  asset_id: string
  asset_code: string
  asset_name: string
  unit: UnitKey
  last_measured_at: string | null
  window_days: number
  days_overdue: number | null
}

export type AssetLite = {
  id: string
  code: string
  name: string
  category_id: string | null
}

// ============ Estado derivado de certificaciones ============

export function certLeadDays(cert: Pick<CertificationRow, 'lead_days'>, globalLead: number | null): number {
  return cert.lead_days ?? globalLead ?? 30
}

export function certStatus(
  cert: Pick<CertificationRow, 'expires_at' | 'lead_days'>,
  globalLead: number | null,
  today = new Date(),
): CertStatus {
  const expires = new Date(`${cert.expires_at}T00:00:00`)
  const lead = certLeadDays(cert, globalLead)
  const windowStart = new Date(expires)
  windowStart.setDate(windowStart.getDate() - lead)
  if (today > expires) return 'expired'
  if (today > windowStart) return 'expiring'
  return 'valid'
}

export const CERT_BADGE_CLASS: Record<CertStatus, string> = {
  valid: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  expiring: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  expired: 'bg-red-500/15 text-red-600 dark:text-red-400',
}

// ============ Categorías normativas ============

export function fetchComplianceCategories(): Promise<ComplianceCategoryRow[]> {
  return getJson<ComplianceCategoryRow[]>(
    '/rest/v1/compliance_categories?select=*&order=name.asc',
    'No se pudieron cargar las categorías normativas.',
  )
}

export async function createComplianceCategory(input: {
  name: string
  description: string | null
}): Promise<Result & { id?: string }> {
  return postJson<{ id: string }>('/rest/v1/compliance_categories', input, 'No se pudo crear la categoría.')
}

export async function updateComplianceCategory(
  id: string,
  patch: { name?: string; description?: string | null; is_active?: boolean },
): Promise<Result> {
  const res = await patchRows(`/rest/v1/compliance_categories?id=eq.${id}`, patch)
  if (res.ok) return res
  return { ok: false, message: res.message ?? 'No se pudo guardar la categoría.' }
}

// ============ Certificaciones ============

const CERT_SELECT =
  '*,asset:assets(id,code,name),compliance_category:compliance_categories(id,name),provider:providers(id,name)'

export type CertificationFilters = {
  categoryId?: string
  status?: CertStatus
  assetId?: string
  providerId?: string
  withinDays?: number
  q?: string
  includeInactive?: boolean
}

export async function fetchCertifications(filters: CertificationFilters = {}): Promise<CertificationRow[]> {
  const params = new URLSearchParams()
  params.set('select', CERT_SELECT)
  params.set('order', 'expires_at.asc')
  if (!filters.includeInactive) params.append('is_active', 'eq.true')
  if (filters.categoryId) params.append('compliance_category_id', `eq.${filters.categoryId}`)
  if (filters.assetId) params.append('asset_id', `eq.${filters.assetId}`)
  if (filters.providerId) params.append('responsible_provider_id', `eq.${filters.providerId}`)
  if (filters.q) params.append('or', `(name.ilike.%${filters.q}%,certificate_number.ilike.%${filters.q}%,issuing_entity.ilike.%${filters.q}%)`)
  return getJson<CertificationRow[]>(
    `/rest/v1/certifications?${params.toString()}`,
    'No se pudieron cargar las certificaciones.',
  )
}

export async function fetchCertification(id: string): Promise<CertificationRow | null> {
  const rows = await getJson<CertificationRow[]>(
    `/rest/v1/certifications?select=${CERT_SELECT}&id=eq.${id}&limit=1`,
    'No se pudo cargar la certificación.',
  )
  return rows[0] ?? null
}

export type CertificationInput = {
  name: string
  asset_id: string | null
  compliance_category_id: string
  issuing_entity: string | null
  certificate_number: string | null
  issued_at: string | null
  expires_at: string
  renewal_period: RenewalPeriod | null
  lead_days: number | null
  responsible_provider_id: string | null
  document_path: string | null
  notes: string | null
}

export async function createCertification(
  input: CertificationInput,
): Promise<Result & { id?: string }> {
  return postJson<{ id: string }>('/rest/v1/certifications', input, 'No se pudo crear la certificación.')
}

export async function updateCertification(id: string, patch: Partial<CertificationInput> & { is_active?: boolean }): Promise<Result> {
  const res = await patchRows(`/rest/v1/certifications?id=eq.${id}`, patch)
  if (res.ok) return res
  return { ok: false, message: res.message ?? 'No se pudo guardar la certificación.' }
}

export async function renewCertification(input: {
  certification_id: string
  issued_at: string
  expires_at: string
  document_path: string
  provider_id?: string | null
  note?: string | null
}): Promise<Result & { id?: string }> {
  const res = await callRpc<{ id: string }>(
    'm6_renew_certification',
    {
      p_certification_id: input.certification_id,
      p_issued_at: input.issued_at,
      p_expires_at: input.expires_at,
      p_document_path: input.document_path,
      p_provider_id: input.provider_id ?? null,
      p_note: input.note ?? null,
    },
    'No se pudo renovar la certificación.',
  )
  if (res.ok) return res
  return { ok: false, message: res.message ?? 'No se pudo renovar la certificación.' }
}

export function fetchCertHistory(certificationId: string): Promise<CertHistoryRow[]> {
  return getJson<CertHistoryRow[]>(
    `/rest/v1/certification_history?select=*,provider:providers(id,name)&certification_id=eq.${certificationId}&order=renewed_at.desc`,
    'No se pudo cargar el historial de vigencias.',
  )
}

export async function fetchEvent8Lead(): Promise<number | null> {
  const rows = await getJson<Array<{ extra_param: number | null }>>(
    '/rest/v1/notification_config?select=extra_param&event_id=eq.8&limit=1',
    'No se pudo cargar la config del Evento 8.',
  )
  return rows[0]?.extra_param ?? null
}

// ============ Tipos de medición ============

const TYPE_SELECT = '*,category:categories(id,name)'

export async function fetchMeasurementTypes(includeInactive = true): Promise<MeasurementTypeRow[]> {
  const params = new URLSearchParams()
  params.set('select', TYPE_SELECT)
  params.set('order', 'name.asc')
  if (!includeInactive) params.append('is_active', 'eq.true')
  const rows = await getJson<MeasurementTypeRow[]>(
    `/rest/v1/measurement_types?${params.toString()}`,
    'No se pudieron cargar los tipos de medición.',
  )
  const countsRes = await callRpcRows<{ measurement_type_id: string; n: number }>(
    'm6_type_record_counts',
    {},
    'No se pudieron contar los registros.',
  )
  const counts = countsRes.ok ? countsRes.rows : []
  const map = new Map<string, number>()
  for (const c of counts) map.set(c.measurement_type_id, (map.get(c.measurement_type_id) ?? 0) + Number(c.n))
  return rows.map((r) => ({ ...r, record_count: map.get(r.id) ?? 0 }))
}

export type MeasurementTypeInput = {
  name: string
  category_id: string
  unit: UnitKey
  min_value: number
  max_value: number
  frequency: MeasFrequency
}

export async function createMeasurementType(
  input: MeasurementTypeInput,
): Promise<Result & { id?: string }> {
  return postJson<{ id: string }>('/rest/v1/measurement_types', input, 'No se pudo crear el tipo de medición.')
}

export async function updateMeasurementType(
  id: string,
  patch: Partial<MeasurementTypeInput> & { is_active?: boolean },
): Promise<Result> {
  const res = await patchRows(`/rest/v1/measurement_types?id=eq.${id}`, patch)
  if (res.ok) return res
  return { ok: false, message: res.message ?? 'No se pudo guardar el tipo de medición.' }
}

// ============ Registros de medición ============

const RECORD_SELECT =
  '*,measurement_type:measurement_types(id,name,unit,min_value,max_value),asset:assets(id,code,name),recorder:users(id,full_name)'

export type MeasurementFilters = {
  typeId?: string
  assetId?: string
  from?: string
  to?: string
}

export async function fetchMeasurementRecords(filters: MeasurementFilters = {}): Promise<MeasurementRecordRow[]> {
  const params = new URLSearchParams()
  params.set('select', RECORD_SELECT)
  params.set('order', 'measured_at.desc')
  params.set('limit', '500')
  if (filters.typeId) params.append('measurement_type_id', `eq.${filters.typeId}`)
  if (filters.assetId) params.append('asset_id', `eq.${filters.assetId}`)
  if (filters.from) params.append('measured_at', `gte.${filters.from}`)
  if (filters.to) params.append('measured_at', `lte.${filters.to}T23:59:59`)
  return getJson<MeasurementRecordRow[]>(
    `/rest/v1/measurement_records?${params.toString()}`,
    'No se pudieron cargar las mediciones.',
  )
}

export async function fetchMeasurementRecord(id: string): Promise<MeasurementRecordRow | null> {
  const rows = await getJson<MeasurementRecordRow[]>(
    `/rest/v1/measurement_records?select=${RECORD_SELECT}&id=eq.${id}&limit=1`,
    'No se pudo cargar la medición.',
  )
  return rows[0] ?? null
}

export async function registerMeasurement(input: {
  measurement_type_id: string
  asset_id: string
  value: number
  measured_at: string
  notes: string | null
  evidence_path: string | null
}): Promise<Result & { id?: string; result?: MeasurementResult }> {
  const res = await callRpc<{ id: string; result: MeasurementResult }>(
    'm6_register_measurement',
    {
      p_measurement_type_id: input.measurement_type_id,
      p_asset_id: input.asset_id,
      p_value: input.value,
      p_measured_at: input.measured_at,
      p_notes: input.notes,
      p_evidence_path: input.evidence_path,
    },
    'No se pudo registrar la medición.',
  )
  if (res.ok) return res
  return { ok: false, message: res.message ?? 'No se pudo registrar la medición.' }
}

export async function fetchMissingMeasurements(): Promise<MissingMeasurementRow[]> {
  const res = await callRpcRows<MissingMeasurementRow>(
    'm6_missing_measurements',
    {},
    'No se pudieron calcular las mediciones faltantes.',
  )
  return res.ok ? res.rows : []
}

// ============ Activos (selector filtrable por categoría) ============

export async function fetchAssetsLite(): Promise<AssetLite[]> {
  const rows = await getJson<AssetLite[]>(
    '/rest/v1/assets?select=id,code,name,category_id&operational_status=eq.operational&order=code.asc',
    'No se pudieron cargar los activos.',
  )
  return rows
}

// ============ Storage (bucket documentos, prefijo cumplimiento/) ============

export async function uploadComplianceFile(file: File): Promise<Result & { path?: string }> {
  const sizeError = fileSizeError(file)
  if (sizeError) return { ok: false, message: sizeError }
  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const objectPath = `cumplimiento/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
  const upload = await apiFetch(`/storage/v1/object/documentos/${objectPath}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!upload.ok) return { ok: false, message: 'No se pudo subir el archivo.' }
  return { ok: true, path: `documentos/${objectPath}` }
}

export async function signComplianceFileUrl(storagePath: string): Promise<string | null> {
  try {
    const response = await apiFetch(`/storage/v1/object/sign/${storagePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { signedURL?: string }
    if (!data.signedURL) return null
    const origin = new URL(import.meta.env.VITE_SUPABASE_URL as string).origin
    return `${origin}/storage/v1${data.signedURL}`
  } catch {
    return null
  }
}
