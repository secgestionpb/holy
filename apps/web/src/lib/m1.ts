import { apiFetch } from '@/lib/auth'
import { useAuth } from '@/lib/auth-store'
import { fileSizeError } from '@/lib/upload-utils'

// ============ Tipos ============

export type ZoneSubtype = 'room' | 'corridor' | 'bathroom' | 'exterior' | 'common_area' | 'technical_area'

export type LocationRow = {
  id: string
  parent_id: string | null
  name: string
  kind: 'hotel' | 'building' | 'floor' | 'zone'
  zone_subtype: ZoneSubtype | null
  room_code: string | null
  depth: number
  is_active: boolean
  sort_order: number | null
}

export type CategoryRow = {
  id: string
  name: string
  description: string | null
  code_prefix: string
  is_active: boolean
  sort_order: number | null
}

export type Criticality = 'high' | 'medium' | 'low'
export type OperationalStatus = 'operational' | 'inactive'
export type LifeStage =
  | 'no_warranty'
  | 'under_warranty'
  | 'operational'
  | 'pending_repair'
  | 'requires_replacement'
  | 'decommissioned'
export type LifespanUnit = 'years' | 'hours' | 'cycles'

export type AssetRow = {
  id: string
  parent_id: string | null
  location_id: string
  category_id: string | null
  code: string
  name: string
  description: string | null
  criticality: Criticality
  operational_status: OperationalStatus
  life_stage: LifeStage
  commissioning_date: string
  expected_lifespan_value: number | null
  lifespan_unit: LifespanUnit | null
  has_usage_counter: boolean
  usage_counter: number | null
  usage_counter_updated_at: string | null
  responsible_user_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
  category_name: string | null
  code_prefix: string | null
  category_is_active: boolean | null
  location_path: string | null
  responsible_name: string | null
  warranty_active: boolean
  has_warranty: boolean
  lifespan_consumed: number | null
  lifespan_remaining: number | null
  eol_reached: boolean
  open_wo_count: number
}

export type WarrantyType = 'purchase' | 'repair'
export type Coverage = 'parts' | 'labor' | 'both'

export type WarrantyRow = {
  id: string
  asset_id: string
  warranty_type: WarrantyType
  start_date: string
  end_date: string
  coverage: Coverage
  provider_id: string | null
  provider_name: string | null
  notes: string | null
  origin_wo_id: string | null
  status: 'active' | 'expired'
  notified_at: string | null
  created_at: string
  updated_at: string
}

export type AssetFileRow = {
  id: string
  asset_id: string
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number | null
  uploaded_by: string
  created_at: string
}

export type AuditRow = {
  id: number
  created_at: string
  user_id: string | null
  module: string
  entity_type: string
  entity_id: string | null
  entity_label: string | null
  action: string
  changes: Record<string, { old?: unknown; new?: unknown }> | null
  reason: string | null
  actor_name?: string | null
}

export type UserLite = {
  id: string
  full_name: string
  is_active: boolean
}

// ============ Etiquetas ============

export const CRITICALITY_LABELS: Record<Criticality, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
}

export const CRITICALITY_HELP: Record<Criticality, string> = {
  high: 'Falla → parada del servicio o riesgo para huéspedes/equipo.',
  medium: 'Falla → degradación noticeable del área o proceso.',
  low: 'Falla → molestia menor, sin impacto operativo inmediato.',
}

export const OPERATIONAL_LABELS: Record<OperationalStatus, string> = {
  operational: 'Operativo',
  inactive: 'Inactivo',
}

export const LIFE_STAGE_LABELS: Record<LifeStage, string> = {
  no_warranty: 'Sin garantía',
  under_warranty: 'En garantía',
  operational: 'Operativo',
  pending_repair: 'Por Reparar',
  requires_replacement: 'Requiere reemplazo',
  decommissioned: 'Dado de baja',
}

export const ENGINE_STAGES: LifeStage[] = ['no_warranty', 'under_warranty']

export const MANUAL_STAGES: LifeStage[] = [
  'operational',
  'pending_repair',
  'requires_replacement',
  'decommissioned',
]

export const LIFESPAN_UNIT_LABELS: Record<LifespanUnit, string> = {
  years: 'Años',
  hours: 'Horas',
  cycles: 'Ciclos',
}

export const WARRANTY_TYPE_LABELS: Record<WarrantyType, string> = {
  purchase: 'Compra',
  repair: 'Reparación',
}

export const COVERAGE_LABELS: Record<Coverage, string> = {
  parts: 'Piezas',
  labor: 'Mano de obra',
  both: 'Ambas',
}

export const ZONE_SUBTYPE_LABELS: Record<ZoneSubtype, string> = {
  room: 'Habitación',
  corridor: 'Pasillo',
  bathroom: 'Baño',
  exterior: 'Exterior',
  common_area: 'Área común',
  technical_area: 'Área técnica',
}

export const KIND_LABELS: Record<LocationRow['kind'], string> = {
  hotel: 'Hotel (raíz)',
  building: 'Torre/Edificio',
  floor: 'Piso',
  zone: 'Ubicación',
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: 'Crear',
  update: 'Modificar',
  state_change: 'Cambio de estado',
  deactivate: 'Desactivar',
  delete: 'Eliminar',
  import: 'Importación masiva',
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

// ============ Consultas ============

export function fetchLocations(): Promise<LocationRow[]> {
  return getJson<LocationRow[]>(
    '/rest/v1/locations?select=*&order=depth.asc,name.asc',
    'No se pudieron cargar las ubicaciones.',
  )
}

export function fetchCategories(): Promise<CategoryRow[]> {
  return getJson<CategoryRow[]>(
    '/rest/v1/categories?select=*&order=sort_order.asc,name.asc',
    'No se pudieron cargar las categorías.',
  )
}

export function fetchAssets(): Promise<AssetRow[]> {
  return getJson<AssetRow[]>(
    '/rest/v1/v1_assets?select=*&order=code.asc',
    'No se pudieron cargar los activos.',
  )
}

export async function fetchAsset(id: string): Promise<AssetRow | null> {
  const rows = await getJson<AssetRow[]>(
    `/rest/v1/v1_assets?select=*&id=eq.${id}&limit=1`,
    'No se pudo cargar el activo.',
  )
  return rows[0] ?? null
}

export function fetchAssetChildren(parentId: string): Promise<AssetRow[]> {
  return getJson<AssetRow[]>(
    `/rest/v1/v1_assets?select=*&parent_id=eq.${parentId}&order=code.asc`,
    'No se pudieron cargar los componentes.',
  )
}

export function fetchWarranties(assetId: string): Promise<WarrantyRow[]> {
  return getJson<WarrantyRow[]>(
    `/rest/v1/warranties?select=*&asset_id=eq.${assetId}&order=start_date.desc`,
    'No se pudieron cargar las garantías.',
  )
}

export function fetchAssetFiles(assetId: string): Promise<AssetFileRow[]> {
  return getJson<AssetFileRow[]>(
    `/rest/v1/asset_files?select=*&asset_id=eq.${assetId}&order=created_at.desc`,
    'No se pudo cargar la documentación.',
  )
}

export function fetchUsersLite(): Promise<UserLite[]> {
  return getJson<UserLite[]>(
    '/rest/v1/users?select=id,full_name,is_active&order=full_name.asc',
    'No se pudieron cargar los usuarios.',
  )
}

export async function fetchAuditFor(entityId: string, limit = 50): Promise<AuditRow[]> {
  const rows = await getJson<AuditRow[]>(
    `/rest/v1/audit_log?select=id,created_at,user_id,module,entity_type,entity_id,entity_label,action,changes,reason&entity_id=eq.${entityId}&order=created_at.desc&limit=${limit}`,
    'No se pudo cargar el historial.',
  )
  const actorIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id)))]
  const names = new Map<string, string>()
  if (actorIds.length > 0) {
    const response = await apiFetch(`/rest/v1/users?select=id,full_name&id=in.(${actorIds.join(',')})`)
    if (response.ok) {
      const list = (await response.json()) as Array<{ id: string; full_name: string }>
      for (const entry of list) names.set(entry.id, entry.full_name)
    }
  }
  return rows.map((row) => ({
    ...row,
    actor_name: row.user_id ? (names.get(row.user_id) ?? null) : null,
  }))
}

// ============ Escrituras de activos ============

export type AssetInput = {
  code: string
  name: string
  category_id?: string | null
  location_id: string
  criticality: Criticality
  commissioning_date: string
  description?: string | null
  expected_lifespan_value?: number | null
  lifespan_unit?: LifespanUnit | null
  has_usage_counter?: boolean
  responsible_user_id?: string | null
  operational_status?: OperationalStatus
  notes?: string | null
  parent_id?: string | null
}

export type Result = { ok: true } | { ok: false; message: string }

export async function createAsset(input: AssetInput): Promise<Result & { id?: string }> {
  const response = await apiFetch('/rest/v1/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(input),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo crear el activo.') }
  const rows = (await response.json()) as Array<{ id: string }>
  return { ok: true, id: rows[0]?.id }
}

export async function updateAsset(id: string, patch: Partial<AssetInput>): Promise<Result> {
  const response = await apiFetch(`/rest/v1/assets?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo guardar el activo.') }
  return { ok: true }
}

export async function setLifeStage(
  assetId: string,
  stage: LifeStage,
  reason?: string,
): Promise<Result> {
  const response = await apiFetch('/rest/v1/rpc/m1_set_life_stage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_asset_id: assetId, p_stage: stage, p_reason: reason ?? null }),
  })
  if (!response.ok) {
    return { ok: false, message: await restErrorMessage(response, 'No se pudo cambiar la etapa de vida.') }
  }
  return { ok: true }
}

// ============ Ubicaciones ============

export type LocationInput = {
  parent_id?: string | null
  name: string
  kind: LocationRow['kind']
  zone_subtype?: ZoneSubtype | null
  room_code?: string | null
}

export async function createLocation(input: LocationInput): Promise<Result & { id?: string }> {
  const response = await apiFetch('/rest/v1/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(input),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo crear la ubicación.') }
  const rows = (await response.json()) as Array<{ id: string }>
  return { ok: true, id: rows[0]?.id }
}

export async function updateLocation(id: string, patch: Partial<LocationInput> & { is_active?: boolean }): Promise<Result> {
  const response = await apiFetch(`/rest/v1/locations?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo guardar la ubicación.') }
  return { ok: true }
}

// ============ Categorías ============

export type CategoryInput = {
  name: string
  description?: string | null
  code_prefix: string
  is_active: boolean
}

export async function createCategory(input: CategoryInput): Promise<Result> {
  const response = await apiFetch('/rest/v1/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo crear la categoría.') }
  return { ok: true }
}

export async function updateCategory(id: string, patch: Partial<CategoryInput>): Promise<Result> {
  const response = await apiFetch(`/rest/v1/categories?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo guardar la categoría.') }
  return { ok: true }
}

// ============ Garantías ============

export type WarrantyInput = {
  asset_id: string
  warranty_type: WarrantyType
  start_date: string
  end_date: string
  coverage: Coverage
  provider_name?: string | null
  notes?: string | null
}

export async function createWarranty(input: WarrantyInput): Promise<Result & { id?: string }> {
  const response = await apiFetch('/rest/v1/warranties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(input),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo crear la garantía.') }
  const rows = (await response.json()) as Array<{ id: string }>
  return { ok: true, id: rows[0]?.id }
}

export async function updateWarranty(id: string, patch: Partial<WarrantyInput>): Promise<Result> {
  const response = await apiFetch(`/rest/v1/warranties?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo guardar la garantía.') }
  return { ok: true }
}

// ============ Documentación (Storage `activos`) ============

export async function uploadAssetFile(assetId: string, file: File): Promise<Result> {
  const sizeError = fileSizeError(file)
  if (sizeError) return { ok: false, message: sizeError }
  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const objectPath = `${assetId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
  const upload = await apiFetch(`/storage/v1/object/activos/${objectPath}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!upload.ok) return { ok: false, message: 'No se pudo subir el archivo.' }
  const insert = await apiFetch('/rest/v1/asset_files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asset_id: assetId,
      file_name: file.name,
      storage_path: `activos/${objectPath}`,
      mime_type: file.type || null,
      file_size_bytes: file.size,
      uploaded_by: useAuth.getState().user?.id ?? null,
    }),
  })
  if (!insert.ok) return { ok: false, message: await restErrorMessage(insert, 'No se pudo registrar el archivo.') }
  return { ok: true }
}

export async function deleteAssetFile(file: AssetFileRow): Promise<Result> {
  await apiFetch(`/storage/v1/object/${file.storage_path}`, { method: 'DELETE' })
  const response = await apiFetch(`/rest/v1/asset_files?id=eq.${file.id}`, { method: 'DELETE' })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo eliminar el archivo.') }
  return { ok: true }
}

export async function signAssetFileUrl(storagePath: string): Promise<string | null> {
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

// ============ Edge Functions de M1 ============

async function postFunction<T>(fn: string, body: Record<string, unknown>, fallback: string): Promise<Result & Partial<T>> {
  const response = await apiFetch(`/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => null)) as (T & { message?: string }) | null
  if (!response.ok) return { ok: false, message: data?.message ?? fallback }
  return { ok: true, ...(data as Partial<T>) }
}

export function previewAssetCode(categoryId: string, locationId: string) {
  return postFunction<{ code: string }>(
    'validate-asset-code',
    { action: 'preview', category_id: categoryId, location_id: locationId },
    'No se pudo generar el código.',
  )
}

export function allocateAssetCode(categoryId: string, locationId: string) {
  return postFunction<{ code: string }>(
    'validate-asset-code',
    { action: 'allocate', category_id: categoryId, location_id: locationId },
    'No se pudo reservar el código.',
  )
}

export function checkAssetCode(code: string, excludeAssetId?: string) {
  return postFunction<{ available: boolean }>(
    'validate-asset-code',
    excludeAssetId ? { action: 'check', code, asset_id: excludeAssetId } : { action: 'check', code },
    'No se pudo verificar el código.',
  )
}

export function warrantyEngineRecalc(warrantyId?: string) {
  return postFunction(
    'asset-warranty-engine',
    warrantyId ? { action: 'recalc', warranty_id: warrantyId } : { action: 'recalc' },
    'No se pudo recalcular la garantía.',
  )
}

export function replacementAlert(assetId: string) {
  return postFunction(
    'asset-replacement-alert',
    { asset_id: assetId },
    'No se pudo disparar el aviso de reemplazo.',
  )
}

// ============ Utilidades de presentación ============

export function locationAssetCounts(
  locations: LocationRow[],
  assets: AssetRow[],
): Map<string, number> {
  const childrenOf = new Map<string | null, string[]>()
  for (const location of locations) {
    const list = childrenOf.get(location.parent_id) ?? []
    list.push(location.id)
    childrenOf.set(location.parent_id, list)
  }
  const direct = new Map<string, number>()
  for (const asset of assets) {
    direct.set(asset.location_id, (direct.get(asset.location_id) ?? 0) + 1)
  }
  const counts = new Map<string, number>()
  const compute = (id: string): number => {
    let total = direct.get(id) ?? 0
    for (const childId of childrenOf.get(id) ?? []) total += compute(childId)
    counts.set(id, total)
    return total
  }
  for (const location of locations) if (location.parent_id === null) compute(location.id)
  return counts
}

export function locationOptions(locations: LocationRow[]): Array<{ id: string; label: string; depth: number }> {
  const byParent = new Map<string | null, LocationRow[]>()
  for (const location of locations) {
    const list = byParent.get(location.parent_id) ?? []
    list.push(location)
    byParent.set(location.parent_id, list)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }
  const out: Array<{ id: string; label: string; depth: number }> = []
  const walk = (parentId: string | null) => {
    for (const location of byParent.get(parentId) ?? []) {
      if (location.is_active) {
        out.push({
          id: location.id,
          label: `${'— '.repeat(location.depth)}${location.name}`,
          depth: location.depth,
        })
      }
      walk(location.id)
    }
  }
  walk(null)
  return out
}

export function warrantyBadge(row: Pick<AssetRow, 'warranty_active' | 'has_warranty'>): {
  label: 'Vigente' | 'Vencida' | 'Ninguna'
  variant: 'default' | 'destructive' | 'secondary'
} {
  if (row.warranty_active) return { label: 'Vigente', variant: 'default' }
  if (row.has_warranty) return { label: 'Vencida', variant: 'destructive' }
  return { label: 'Ninguna', variant: 'secondary' }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(date)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
