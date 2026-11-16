import { apiFetch } from '@/lib/auth'
import { useAuth } from '@/lib/auth-store'
import { type Result } from '@/lib/m1'
import { fileSizeError } from '@/lib/upload-utils'

// ============ Tipos ============

export type ItemUnit =
  | 'unidad'
  | 'par'
  | 'juego'
  | 'caja'
  | 'litro'
  | 'galon'
  | 'kg'
  | 'g'
  | 'm'
  | 'm2'
  | 'rollo'
  | 'tubo'
  | 'filtro'
  | 'otro'

export const UNIT_LABELS: Record<ItemUnit, string> = {
  unidad: 'Unidad',
  par: 'Par',
  juego: 'Juego',
  caja: 'Caja',
  litro: 'Litro',
  galon: 'Galón',
  kg: 'Kilogramo',
  g: 'Gramo',
  m: 'Metro',
  m2: 'm²',
  rollo: 'Rollo',
  tubo: 'Tubo',
  filtro: 'Filtro',
  otro: 'Otro',
}

export type ItemRow = {
  id: string
  code: string
  name: string
  description: string | null
  item_category_id: string | null
  unit: ItemUnit
  unit_cost: number
  bin_location: string | null
  preferred_provider_id: string | null
  preferred_provider_name: string | null
  image_path: string | null
  technical_sheet_path: string | null
  is_active: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  category_name: string | null
  stock_total: number
  min_total: number
  has_negative: boolean
  has_low: boolean
  warehouse_count: number
}

export type ItemCategoryRow = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type WarehouseRow = {
  id: string
  name: string
  description: string | null
  responsible_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  responsible_name: string | null
}

export type StockCellRow = {
  warehouse_id: string
  item_id: string
  qty: number
  min_stock: number
  updated_at: string
  is_negative: boolean
  is_low: boolean
  item_code: string
  item_name: string
  unit: ItemUnit
  item_is_active: boolean
  item_category_id: string | null
  category_name: string | null
  warehouse_name: string
  warehouse_is_active: boolean
}

export type MovementType = 'entrada' | 'salida_ot' | 'ajuste' | 'devolucion' | 'transferencia'

export type KardexRow = {
  id: string
  type: MovementType
  item_id: string
  warehouse_id: string
  destiny_warehouse_id: string | null
  qty: number
  unit_cost: number
  line_total: number
  wo_id: string | null
  document_number: string | null
  provider_id: string | null
  provider_name: string | null
  reason: string | null
  count_id: string | null
  origin_movement_id: string | null
  user_id: string
  occurred_at: string
  created_at: string
  item_code: string
  item_name: string
  unit: ItemUnit
  warehouse_name: string
  destiny_warehouse_name: string | null
  wo_number: string | null
  user_name: string | null
}

export type CountStatus = 'in_progress' | 'confirmed' | 'cancelled'

export type CountRow = {
  id: string
  warehouse_id: string
  scope_type: 'warehouse' | 'category'
  scope_category_id: string | null
  count_date: string
  responsible_id: string
  status: CountStatus
  cancel_reason: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  warehouse_name: string
  responsible_name: string | null
  confirmed_by_name: string | null
  scope_category_name: string | null
  total_items: number
  counted_items: number
  diff_items: number
}

export type CountItemRow = {
  count_id: string
  item_id: string
  theoretical: number
  counted: number | null
  difference: number | null
  observation: string | null
  item_code: string
  item_name: string
  unit: ItemUnit
}

// ============ Etiquetas ============

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  entrada: 'Entrada',
  salida_ot: 'Salida por OT',
  ajuste: 'Ajuste',
  devolucion: 'Devolución a bodega',
  transferencia: 'Transferencia',
}

export const COUNT_STATUS_LABELS: Record<CountStatus, string> = {
  in_progress: 'En proceso',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
}

export const COUNT_STATUS_BADGE_CLASS: Record<CountStatus, string> = {
  in_progress: 'bg-primary/15 text-primary',
  confirmed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  cancelled: 'bg-destructive/15 text-destructive',
}

export const COUNT_SCOPE_LABELS: Record<CountRow['scope_type'], string> = {
  warehouse: 'Bodega completa',
  category: 'Categoría',
}

// ============ Pestañas de V4.1 (estado en la URL) ============

export const TAB_IDS = ['items', 'warehouses', 'stock_kardex', 'counts'] as const
export type TabId = (typeof TAB_IDS)[number]

export const TAB_LABELS: Record<TabId, string> = {
  items: 'Ítems',
  warehouses: 'Bodegas',
  stock_kardex: 'Stock y Kardex',
  counts: 'Conteo físico',
}

export function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value)
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
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, fallback) }
  const data = (await response.json().catch(() => null)) as Partial<T> | Partial<T>[] | null
  const row = Array.isArray(data) ? (data[0] ?? null) : data
  return { ok: true, ...(row ?? ({} as Partial<T>)) }
}

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

export function formatQty(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return String(value)
  return num.toLocaleString('es-ES', { maximumFractionDigits: 3 })
}

export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '$0.00'
  const num = Number(value)
  if (!Number.isFinite(num)) return '$0.00'
  return `$${num.toFixed(2)}`
}

export function movementReference(row: KardexRow): string {
  if (row.wo_number) return row.wo_number
  if (row.document_number) return row.document_number
  if (row.type === 'ajuste' && row.count_id) return 'Conteo físico'
  if (row.reason) return row.reason
  return '—'
}

export function countScopeLabel(row: CountRow): string {
  if (row.scope_type === 'category') return row.scope_category_name ?? 'Categoría'
  return COUNT_SCOPE_LABELS.warehouse
}

// ============ Consultas ============

export function fetchItems(): Promise<ItemRow[]> {
  return getJson<ItemRow[]>(
    '/rest/v1/v4_items?select=*&order=code.asc',
    'No se pudieron cargar los ítems.',
  )
}

export async function fetchItem(id: string): Promise<ItemRow | null> {
  const rows = await getJson<ItemRow[]>(
    `/rest/v1/v4_items?select=*&id=eq.${id}&limit=1`,
    'No se pudo cargar el ítem.',
  )
  return rows[0] ?? null
}

export function fetchItemCategories(): Promise<ItemCategoryRow[]> {
  return getJson<ItemCategoryRow[]>(
    '/rest/v1/item_categories?select=*&order=name.asc',
    'No se pudieron cargar las categorías de ítem.',
  )
}

type WarehouseApiRow = Omit<WarehouseRow, 'responsible_name'> & {
  responsible: { full_name: string } | null
}

export async function fetchWarehouses(): Promise<WarehouseRow[]> {
  const rows = await getJson<WarehouseApiRow[]>(
    '/rest/v1/warehouses?select=*,responsible:users!warehouses_responsible_id_fkey(full_name)&order=name.asc',
    'No se pudieron cargar las bodegas.',
  )
  return rows.map(({ responsible, ...row }) => ({
    ...row,
    responsible_name: responsible?.full_name ?? null,
  }))
}

export function fetchStockCells(): Promise<StockCellRow[]> {
  return getJson<StockCellRow[]>(
    '/rest/v1/v4_stock?select=*&order=item_name.asc',
    'No se pudo cargar el stock.',
  )
}

export type KardexFilters = {
  from?: string
  to?: string
  warehouseId?: string
  itemId?: string
  type?: string
  woNumber?: string
}

export function fetchKardex(filters: KardexFilters = {}): Promise<KardexRow[]> {
  const params = new URLSearchParams()
  params.set('select', '*')
  params.set('order', 'occurred_at.desc')
  params.set('limit', '1000')
  if (filters.from) params.append('occurred_at', `gte.${filters.from}`)
  if (filters.to) params.append('occurred_at', `lt.${filters.to}`)
  if (filters.warehouseId) params.append('warehouse_id', `eq.${filters.warehouseId}`)
  if (filters.itemId) params.append('item_id', `eq.${filters.itemId}`)
  if (filters.type) params.append('type', `eq.${filters.type}`)
  if (filters.woNumber) params.append('wo_number', `eq.${filters.woNumber}`)
  return getJson<KardexRow[]>(
    `/rest/v1/v4_kardex?${params.toString()}`,
    'No se pudo cargar el kardex.',
  )
}

export function fetchWoMovements(woId: string): Promise<KardexRow[]> {
  return getJson<KardexRow[]>(
    `/rest/v1/v4_kardex?select=*&wo_id=eq.${woId}&order=occurred_at.asc`,
    'No se pudieron cargar los movimientos de la OT.',
  )
}

export function fetchCounts(): Promise<CountRow[]> {
  return getJson<CountRow[]>(
    '/rest/v1/v4_counts?select=*&order=count_date.desc,created_at.desc',
    'No se pudieron cargar los conteos.',
  )
}

export async function fetchCount(id: string): Promise<CountRow | null> {
  const rows = await getJson<CountRow[]>(
    `/rest/v1/v4_counts?select=*&id=eq.${id}&limit=1`,
    'No se pudo cargar el conteo.',
  )
  return rows[0] ?? null
}

type CountItemApiRow = Omit<CountItemRow, 'item_code' | 'item_name' | 'unit'> & {
  item: { code: string; name: string; unit: ItemUnit } | null
}

export async function fetchCountItems(countId: string): Promise<CountItemRow[]> {
  const rows = await getJson<CountItemApiRow[]>(
    `/rest/v1/physical_count_items?select=*,item:items(code,name,unit)&count_id=eq.${countId}`,
    'No se pudo cargar el detalle del conteo.',
  )
  return rows
    .map(({ item, ...row }) => ({
      ...row,
      item_code: item?.code ?? '—',
      item_name: item?.name ?? '—',
      unit: item?.unit ?? 'otro',
    }))
    .sort((a, b) => a.item_code.localeCompare(b.item_code, 'es'))
}

export function fetchItemAssetLinks(itemId: string): Promise<Array<{ asset_id: string }>> {
  return getJson<Array<{ asset_id: string }>>(
    `/rest/v1/item_asset_links?select=asset_id&item_id=eq.${itemId}`,
    'No se pudieron cargar los vínculos con activos.',
  )
}

export function fetchItemCategoryLinks(itemId: string): Promise<Array<{ category_id: string }>> {
  return getJson<Array<{ category_id: string }>>(
    `/rest/v1/item_category_links?select=category_id&item_id=eq.${itemId}`,
    'No se pudieron cargar los vínculos con categorías.',
  )
}

// Repuestos probables de una OT (F1.? "Ver repuestos probables"): ítems
// vinculados al activo O a la categoría del activo (item_asset_links / N:N).
export async function fetchProbableItems(
  assetId: string,
  categoryId: string | null,
): Promise<ItemRow[]> {
  const [assetLinks, categoryLinks] = await Promise.all([
    getJson<Array<{ item_id: string }>>(
      `/rest/v1/item_asset_links?select=item_id&asset_id=eq.${assetId}`,
      'No se pudieron cargar los repuestos probables.',
    ),
    categoryId
      ? getJson<Array<{ item_id: string }>>(
          `/rest/v1/item_category_links?select=item_id&category_id=eq.${categoryId}`,
          'No se pudieron cargar los repuestos probables.',
        )
      : Promise.resolve([]),
  ])
  const ids = [...new Set([...assetLinks, ...categoryLinks].map((link) => link.item_id))]
  if (ids.length === 0) return []
  return getJson<ItemRow[]>(
    `/rest/v1/v4_items?select=*&id=in.(${ids.join(',')})&order=code.asc`,
    'No se pudieron cargar los repuestos probables.',
  )
}

// Devoluciones ya hechas contra una línea de salida (para mostrar el máximo)
export async function fetchReturnedQty(movementId: string): Promise<number> {
  const rows = await getJson<Array<{ qty: number }>>(
    `/rest/v1/v4_kardex?select=qty&origin_movement_id=eq.${movementId}`,
    'No se pudo calcular lo devuelto.',
  )
  return rows.reduce((sum, row) => sum + Number(row.qty), 0)
}

// ============ Escrituras de catálogos ============

export type ItemInput = {
  code: string
  name: string
  description?: string | null
  item_category_id?: string | null
  unit: ItemUnit
  bin_location?: string | null
  preferred_provider_id?: string | null
  is_active: boolean
}

export function createItem(input: ItemInput): Promise<Result & { id?: string }> {
  return postJson<{ id: string }>('/rest/v1/items', input, 'No se pudo crear el ítem.')
}

export function updateItem(
  id: string,
  patch: Partial<ItemInput> & { image_path?: string | null; technical_sheet_path?: string | null },
): Promise<Result> {
  return patchRows(`/rest/v1/items?id=eq.${id}`, patch, 'No se pudo guardar el ítem.')
}

export function createItemCategory(input: {
  name: string
  description?: string | null
}): Promise<Result> {
  return postJson('/rest/v1/item_categories', input, 'No se pudo crear la categoría de ítem.')
}

export function updateItemCategory(
  id: string,
  patch: Partial<{ name: string; description: string | null; is_active: boolean }>,
): Promise<Result> {
  return patchRows(
    `/rest/v1/item_categories?id=eq.${id}`,
    patch,
    'No se pudo guardar la categoría de ítem.',
  )
}

export function createWarehouse(input: {
  name: string
  description?: string | null
  responsible_id?: string | null
}): Promise<Result & { id?: string }> {
  return postJson<{ id: string }>('/rest/v1/warehouses', input, 'No se pudo crear la bodega.')
}

export function updateWarehouse(
  id: string,
  patch: Partial<{
    name: string
    description: string | null
    responsible_id: string | null
    is_active: boolean
  }>,
): Promise<Result> {
  return patchRows(`/rest/v1/warehouses?id=eq.${id}`, patch, 'No se pudo guardar la bodega.')
}

// ============ Escrituras de V4.2 (stock mínimo + vínculos N:N) ============

// Sincroniza las filas "Stock por bodega" del form del ítem: inserta pre-altas
// (qty=0), actualiza min_stock y quita filas vacías (qty=0) que se desmarcaron.
export async function saveItemStockRows(
  itemId: string,
  desired: Array<{ warehouse_id: string; min_stock: number }>,
  existing: StockCellRow[],
): Promise<Result> {
  const existingByWarehouse = new Map(existing.map((row) => [row.warehouse_id, row]))
  const desiredIds = new Set(desired.map((row) => row.warehouse_id))

  for (const row of existing) {
    if (!desiredIds.has(row.warehouse_id)) {
      if (Number(row.qty) !== 0) {
        return {
          ok: false,
          message: `No se puede quitar «${row.warehouse_name}»: tiene ${formatQty(row.qty)} en stock. Usa transferencias o un ajuste para moverlo.`,
        }
      }
      const result = await deleteRows(
        `/rest/v1/warehouse_stock?warehouse_id=eq.${row.warehouse_id}&item_id=eq.${itemId}`,
        'No se pudo quitar la fila de stock.',
      )
      if (!result.ok) return result
    }
  }

  for (const row of desired) {
    const current = existingByWarehouse.get(row.warehouse_id)
    if (!current) {
      const created = await postJson('/rest/v1/warehouse_stock', {
        warehouse_id: row.warehouse_id,
        item_id: itemId,
        qty: 0,
        min_stock: row.min_stock,
      }, 'No se pudo agregar la bodega al ítem.')
      if (!created.ok) return created
    } else if (Number(current.min_stock) !== row.min_stock) {
      const updated = await patchRows(
        `/rest/v1/warehouse_stock?warehouse_id=eq.${row.warehouse_id}&item_id=eq.${itemId}`,
        { min_stock: row.min_stock },
        'No se pudo guardar el stock mínimo.',
      )
      if (!updated.ok) return updated
    }
  }
  return { ok: true }
}

export async function syncItemAssetLinks(itemId: string, assetIds: string[]): Promise<Result> {
  const current = await fetchItemAssetLinks(itemId)
  const currentIds = new Set(current.map((row) => row.asset_id))
  const wanted = new Set(assetIds)
  for (const assetId of assetIds) {
    if (currentIds.has(assetId)) continue
    const created = await postJson('/rest/v1/item_asset_links', { item_id: itemId, asset_id: assetId }, 'No se pudo vincular el activo.')
    if (!created.ok) return created
  }
  for (const assetId of currentIds) {
    if (wanted.has(assetId)) continue
    const removed = await deleteRows(
      `/rest/v1/item_asset_links?item_id=eq.${itemId}&asset_id=eq.${assetId}`,
      'No se pudo quitar el vínculo con el activo.',
    )
    if (!removed.ok) return removed
  }
  return { ok: true }
}

export async function syncItemCategoryLinks(itemId: string, categoryIds: string[]): Promise<Result> {
  const current = await fetchItemCategoryLinks(itemId)
  const currentIds = new Set(current.map((row) => row.category_id))
  const wanted = new Set(categoryIds)
  for (const categoryId of categoryIds) {
    if (currentIds.has(categoryId)) continue
    const created = await postJson('/rest/v1/item_category_links', { item_id: itemId, category_id: categoryId }, 'No se pudo vincular la categoría.')
    if (!created.ok) return created
  }
  for (const categoryId of currentIds) {
    if (wanted.has(categoryId)) continue
    const removed = await deleteRows(
      `/rest/v1/item_category_links?item_id=eq.${itemId}&category_id=eq.${categoryId}`,
      'No se pudo quitar el vínculo con la categoría.',
    )
    if (!removed.ok) return removed
  }
  return { ok: true }
}

// ============ Storage `documentos` (prefijo items/) ============

export async function uploadItemFile(itemId: string, file: File): Promise<Result & { path?: string }> {
  const sizeError = fileSizeError(file)
  if (sizeError) return { ok: false, message: sizeError }
  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const objectPath = `items/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
  const upload = await apiFetch(`/storage/v1/object/documentos/${objectPath}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!upload.ok) return { ok: false, message: 'No se pudo subir el archivo.' }
  return { ok: true, path: `documentos/${objectPath}` }
}

export async function removeItemFile(path: string): Promise<void> {
  await apiFetch(`/storage/v1/object/${path}`, { method: 'DELETE' })
}

// ============ RPCs de movimientos (M4.1–M4.4, F4.3–F4.8) ============

export function itemCode(
  action: 'preview' | 'allocate' | 'check',
  code?: string,
  itemId?: string,
): Promise<Result & { code?: string; available?: boolean }> {
  return callRpc<{ code: string; available: boolean }>(
    'm4_item_code',
    { p_action: action, p_code: code ?? null, p_item_id: itemId ?? null },
    'No se pudo procesar el código del ítem.',
  )
}

export function m4Entry(input: {
  itemId: string
  warehouseId: string
  qty: number
  unitCost: number
  documentNumber: string
  occurredAt?: string | null
  providerId?: string | null
  note?: string | null
}): Promise<Result & { movement_id?: string; new_qty?: number }> {
  return callRpc<{ movement_id: string; new_qty: number }>(
    'm4_entry',
    {
      p_item_id: input.itemId,
      p_warehouse_id: input.warehouseId,
      p_qty: input.qty,
      p_unit_cost: input.unitCost,
      p_document_number: input.documentNumber,
      p_occurred_at: input.occurredAt || null,
      p_provider_id: input.providerId ?? null,
      p_note: input.note ?? null,
    },
    'No se pudo registrar la entrada.',
  )
}

export function m4Adjust(input: {
  itemId: string
  warehouseId: string
  delta: number
  reason: string
  note?: string | null
}): Promise<Result & { movement_id?: string; new_qty?: number }> {
  return callRpc<{ movement_id: string; new_qty: number }>(
    'm4_adjust',
    {
      p_item_id: input.itemId,
      p_warehouse_id: input.warehouseId,
      p_delta: input.delta,
      p_reason: input.reason,
      p_note: input.note ?? null,
    },
    'No se pudo registrar el ajuste.',
  )
}

export function m4Transfer(input: {
  itemId: string
  originId: string
  destinyId: string
  qty: number
  note?: string | null
}): Promise<Result & { origin_qty?: number; destiny_qty?: number }> {
  return callRpc<{ origin_qty: number; destiny_qty: number }>(
    'm4_transfer',
    {
      p_item_id: input.itemId,
      p_origin_id: input.originId,
      p_destiny_id: input.destinyId,
      p_qty: input.qty,
      p_note: input.note ?? null,
    },
    'No se pudo registrar la transferencia.',
  )
}

export function m4Consume(input: {
  woId: string
  itemId: string
  warehouseId: string
  qty: number
  note?: string | null
}): Promise<Result & { movement_id?: string; new_qty?: number; line_total?: number }> {
  return callRpc<{ movement_id: string; new_qty: number; line_total: number }>(
    'm4_consume',
    {
      p_wo_id: input.woId,
      p_item_id: input.itemId,
      p_warehouse_id: input.warehouseId,
      p_qty: input.qty,
      p_note: input.note ?? null,
    },
    'No se pudo registrar el consumo.',
  )
}

export function m4Return(input: {
  movementId: string
  qty: number
  destinyWarehouseId: string
  reason: string
}): Promise<Result & { movement_id?: string; new_qty?: number; remaining_available?: number; line_total?: number }> {
  return callRpc<{ movement_id: string; new_qty: number; remaining_available: number; line_total: number }>(
    'm4_return',
    {
      p_movement_id: input.movementId,
      p_qty: input.qty,
      p_destiny_warehouse_id: input.destinyWarehouseId,
      p_reason: input.reason,
    },
    'No se pudo registrar la devolución.',
  )
}

// ============ RPCs de conteo físico (V4.4 / F4.8) ============

// m4_count_create RETURNS UUID (JSON plano, no objeto).
export async function m4CountCreate(input: {
  warehouseId: string
  scopeType: 'warehouse' | 'category'
  scopeCategoryId?: string | null
  countDate?: string | null
  responsibleId?: string | null
}): Promise<Result & { id?: string }> {
  const response = await apiFetch('/rest/v1/rpc/m4_count_create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_warehouse_id: input.warehouseId,
      p_scope_type: input.scopeType,
      p_scope_category_id: input.scopeCategoryId ?? null,
      p_count_date: input.countDate || null,
      p_responsible_id: input.responsibleId ?? null,
    }),
  })
  if (!response.ok) return { ok: false, message: await restErrorMessage(response, 'No se pudo crear el conteo.') }
  const data = (await response.json().catch(() => null)) as unknown
  return { ok: true, id: typeof data === 'string' ? data : undefined }
}

export function m4CountConfirm(countId: string): Promise<Result & { adjustments?: number }> {
  return callRpc<{ adjustments: number; counted_items: number }>(
    'm4_count_confirm',
    { p_count_id: countId },
    'No se pudo confirmar el conteo.',
  )
}

export function m4CountCancel(countId: string, reason: string): Promise<Result> {
  return callRpc(
    'm4_count_cancel',
    { p_count_id: countId, p_reason: reason },
    'No se pudo cancelar el conteo.',
  )
}

// Guarda el avance del conteo (contado/observación) — PATCH directo sobre
// physical_count_items: permitido a Mantenimiento mientras está En proceso.
export async function saveCountItem(
  countId: string,
  itemId: string,
  patch: { counted: number | null; observation: string | null },
): Promise<Result> {
  return patchRows(
    `/rest/v1/physical_count_items?count_id=eq.${countId}&item_id=eq.${itemId}`,
    patch,
    'No se pudo guardar el renglón del conteo.',
  )
}

// ============ Sesión ============

export function currentUserId(): string | null {
  return useAuth.getState().user?.id ?? null
}
