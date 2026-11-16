import { apiFetch } from '@/lib/auth'
import { useAuth } from '@/lib/auth-store'
import { type Result } from '@/lib/m1'
import { fileSizeError } from '@/lib/upload-utils'

// ============ Tipos ============

export type ProviderType = 'supplier' | 'contractor' | 'both'

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  supplier: 'Proveedor',
  contractor: 'Contratista',
  both: 'Ambos',
}

export type VisitFrequency =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'

export const VISIT_FREQUENCY_LABELS: Record<VisitFrequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

export type AmountPeriod = 'once' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'

export const AMOUNT_PERIOD_LABELS: Record<AmountPeriod, string> = {
  once: 'Único',
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

export const visitFrequencyKeys = Object.keys(VISIT_FREQUENCY_LABELS) as [
  VisitFrequency,
  ...VisitFrequency[],
]

export const amountPeriodKeys = Object.keys(AMOUNT_PERIOD_LABELS) as [
  AmountPeriod,
  ...AmountPeriod[],
]

export type ProviderDocType = 'contract' | 'certification' | 'policy' | 'other'

export const DOC_TYPE_LABELS: Record<ProviderDocType, string> = {
  contract: 'Contrato marco',
  certification: 'Certificación',
  policy: 'Póliza',
  other: 'Otro',
}

export type ProviderRow = {
  id: string
  code: string
  name: string
  provider_type: ProviderType
  service_category_id: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  notes: string | null
  is_active: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  service_category: { id: string; name: string } | null
}

export type ContractRow = {
  id: string
  provider_id: string
  name: string
  scope: string | null
  start_date: string
  end_date: string
  visit_frequency: VisitFrequency | null
  amount: number | null
  amount_period: AmountPeriod
  document_path: string | null
  notes: string | null
  is_active: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type ContractStatus = 'vigente' | 'por_vencer' | 'vencido' | 'inactivo'

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  vigente: 'Vigente',
  por_vencer: 'Por vencer',
  vencido: 'Vencido',
  inactivo: 'Inactivo',
}

export type ProviderFileRow = {
  id: string
  provider_id: string
  doc_type: ProviderDocType
  path: string
  original_name: string
  uploaded_by: string | null
  created_at: string
}

export type InterventionRow = {
  id: string
  wo_number: string
  status: string
  external_cost: number | null
  created_at: string
  asset: { id: string; code: string; name: string; location: { name: string } | null } | null
}

export type InterventionStats = {
  rows: InterventionRow[]
  total: number
  last12: number
  cost12: number
}

export type ProviderInput = {
  code: string
  name: string
  provider_type: ProviderType
  service_category_id: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  notes: string | null
  is_active: boolean
}

export type ContractInput = {
  provider_id: string
  name: string
  scope: string | null
  start_date: string
  end_date: string
  visit_frequency: VisitFrequency | null
  amount: number | null
  amount_period: AmountPeriod
  document_path: string | null
  notes: string | null
  is_active: boolean
}

// ============ Helpers ============

type PgError = { message?: string; code?: string }

async function restErrorMessage(response: Response, fallback: string): Promise<string> {
  if (response.status === 403 || response.status === 401) {
    return 'No tienes permisos para esta operación.'
  }
  const body = (await response.json().catch(() => null)) as PgError | null
  if (body?.code === '23505') return 'Ese código ya está en uso. Elige otro.'
  if (body?.code === '23514' || body?.code === '23502') {
    return body.message ?? 'Revisa los datos: violan una restricción de la base.'
  }
  return body?.message ?? fallback
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const response = await apiFetch(path)
  if (!response.ok) throw new Error(await restErrorMessage(response, fallback))
  return (await response.json()) as T
}

async function postJson<T = object>(path: string, body: unknown, fallback: string): Promise<Result & Partial<T>> {
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

async function patchRows(path: string, patch: Record<string, unknown>, fallback: string): Promise<Result> {
  const response = await apiFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, fallback) }
  return { ok: true }
}

async function deleteRows(path: string, fallback: string): Promise<Result> {
  const response = await apiFetch(path, { method: 'DELETE' })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, fallback) }
  return { ok: true }
}

async function callRpc<T extends object>(
  fn: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<Result & Partial<T>> {
  const response = await apiFetch(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, fallback) }
  const data = (await response.json().catch(() => null)) as Partial<T> | null
  return { ok: true, ...(data ?? {}) }
}

export function todayIso(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

export function isoDaysFromToday(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

// ============ Proveedores ============

const PROVIDER_SELECT = '*,service_category:categories(id,name)'

export function fetchProviders(): Promise<ProviderRow[]> {
  return getJson<ProviderRow[]>(
    `/rest/v1/providers?select=${PROVIDER_SELECT}&order=code.asc`,
    'No se pudieron cargar los proveedores.',
  )
}

export async function fetchProvider(id: string): Promise<ProviderRow | null> {
  const rows = await getJson<ProviderRow[]>(
    `/rest/v1/providers?select=${PROVIDER_SELECT}&id=eq.${id}`,
    'No se pudo cargar el proveedor.',
  )
  return rows[0] ?? null
}

export async function createProvider(input: ProviderInput): Promise<Result & { id?: string }> {
  return postJson<{ id: string }>('/rest/v1/providers', input, 'No se pudo crear el proveedor.')
}

export async function updateProvider(id: string, patch: Partial<ProviderInput>): Promise<Result> {
  return patchRows(`/rest/v1/providers?id=eq.${id}`, patch, 'No se pudo guardar el proveedor.')
}

export async function deleteProvider(id: string): Promise<Result> {
  return deleteRows(`/rest/v1/providers?id=eq.${id}`, 'No se pudo eliminar el proveedor.')
}

export function providerCode(
  action: 'preview' | 'allocate' | 'check',
  code?: string,
  providerId?: string,
): Promise<Result & { code?: string; available?: boolean }> {
  return callRpc<{ code: string; available: boolean }>(
    'm5_provider_code',
    {
      p_action: action,
      ...(code !== undefined ? { p_code: code } : {}),
      ...(providerId !== undefined ? { p_provider_id: providerId } : {}),
    },
    'No se pudo generar el código del proveedor.',
  )
}

// ============ Documentos (Storage `documentos/proveedores/`) ============

export function fetchProviderFiles(providerId: string): Promise<ProviderFileRow[]> {
  return getJson<ProviderFileRow[]>(
    `/rest/v1/provider_files?select=*&provider_id=eq.${providerId}&order=created_at.desc`,
    'No se pudieron cargar los documentos.',
  )
}

export async function uploadProviderFile(
  providerId: string,
  file: File,
  docType: ProviderDocType,
): Promise<Result> {
  const sizeError = fileSizeError(file)
  if (sizeError) return { ok: false, message: sizeError }
  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const objectPath = `proveedores/${providerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
  const upload = await apiFetch(`/storage/v1/object/documentos/${objectPath}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!upload.ok) return { ok: false, message: 'No se pudo subir el archivo.' }
  const insert = await apiFetch('/rest/v1/provider_files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider_id: providerId,
      doc_type: docType,
      path: `documentos/${objectPath}`,
      original_name: file.name,
      uploaded_by: useAuth.getState().user?.id ?? null,
    }),
  })
  if (!insert.ok) return { ok: false, message: await restErrorMessage(insert, 'No se pudo registrar el documento.') }
  return { ok: true }
}

export async function deleteProviderFile(row: ProviderFileRow): Promise<Result> {
  await apiFetch(`/storage/v1/object/${row.path}`, { method: 'DELETE' })
  return deleteRows(`/rest/v1/provider_files?id=eq.${row.id}`, 'No se pudo eliminar el documento.')
}

export async function signProviderFileUrl(storagePath: string): Promise<string | null> {
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

// ============ Contratos ============

export function fetchContracts(providerId: string): Promise<ContractRow[]> {
  return getJson<ContractRow[]>(
    `/rest/v1/contracts?select=*&provider_id=eq.${providerId}&order=start_date.desc`,
    'No se pudieron cargar los contratos.',
  )
}

export async function fetchContract(id: string): Promise<ContractRow | null> {
  const rows = await getJson<ContractRow[]>(
    `/rest/v1/contracts?select=*&id=eq.${id}`,
    'No se pudo cargar el contrato.',
  )
  return rows[0] ?? null
}

export function fetchActiveContractBadges(): Promise<Array<{ provider_id: string; end_date: string }>> {
  return getJson<Array<{ provider_id: string; end_date: string }>>(
    '/rest/v1/contracts?select=provider_id,end_date&is_active=eq.true&order=end_date.asc',
    'No se pudieron cargar los contratos.',
  )
}

export async function createContract(input: ContractInput): Promise<Result & { id?: string }> {
  return postJson<{ id: string }>('/rest/v1/contracts', input, 'No se pudo crear el contrato.')
}

export async function updateContract(id: string, patch: Partial<ContractInput>): Promise<Result> {
  return patchRows(`/rest/v1/contracts?id=eq.${id}`, patch, 'No se pudo guardar el contrato.')
}

export function contractStatus(
  contract: Pick<ContractRow, 'end_date' | 'is_active'>,
  warnDays: number,
): ContractStatus {
  if (!contract.is_active) return 'inactivo'
  const today = todayIso()
  if (contract.end_date < today) return 'vencido'
  if (contract.end_date <= isoDaysFromToday(warnDays)) return 'por_vencer'
  return 'vigente'
}

export async function fetchEvent11Days(): Promise<number> {
  try {
    const rows = await getJson<Array<{ extra_param: number | null }>>(
      '/rest/v1/notification_config?event_id=eq.11&select=extra_param',
      'No se pudo leer la configuración de vencimientos.',
    )
    const days = rows[0]?.extra_param
    return typeof days === 'number' && days > 0 ? days : 30
  } catch {
    return 30
  }
}

// ============ Historial de intervención ============

export async function fetchInterventions(providerId: string): Promise<InterventionStats> {
  const rows = await getJson<InterventionRow[]>(
    `/rest/v1/work_orders?select=id,wo_number,status,external_cost,created_at,asset:assets!work_orders_asset_id_fkey(id,code,name,location:locations(name))&provider_id=eq.${providerId}&order=created_at.desc&limit=500`,
    'No se pudo cargar el historial de intervención.',
  )
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000
  const recent = rows.filter((row) => new Date(row.created_at).getTime() >= cutoff)
  const cost12 = recent.reduce((sum, row) => sum + (Number(row.external_cost) || 0), 0)
  return { rows, total: rows.length, last12: recent.length, cost12 }
}
