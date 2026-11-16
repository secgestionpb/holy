import { apiFetch } from '@/lib/auth'
import { useAuth } from '@/lib/auth-store'

function currentUserId(): string | null {
  return useAuth.getState().user?.id ?? null
}

// ============ Tipos ============

export type PlanFrequency = 'time' | 'usage'
export type PlanPriority = 'urgent' | 'normal' | 'low'

export type PlanAssetLink = { asset_id: string }
export type PlanCategoryLink = { category_id: string }

export type MaintenancePlan = {
  id: string
  name: string
  description: string | null
  frequency_type: PlanFrequency
  interval_value: number
  checklist_template_id: string | null
  suggested_role: string | null
  default_priority: PlanPriority
  lead_days: number
  grace_days: number
  is_active: boolean
  next_due_at: string | null
  last_run_date: string | null
  last_run_counter: number | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  plan_asset_links?: PlanAssetLink[]
  plan_category_links?: PlanCategoryLink[]
}

export type ChecklistTemplateItem = {
  id: string
  template_id: string
  position: number
  text: string
}

export type ChecklistTemplate = {
  id: string
  name: string
  category_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  checklist_items?: ChecklistTemplateItem[]
}

export type ChecklistStatus = 'pending' | 'done' | 'not_applicable'

export type ChecklistEntry = {
  id: string
  wo_id: string
  checklist_item_id: string | null
  position: number
  item_text: string
  status: ChecklistStatus
  note: string | null
  done_by: string | null
  done_at: string | null
  created_at: string
}

// ============ Helpers (patrón m4) ============

type PgError = { message?: string }

async function restErrorMessage(response: Response, fallback: string): Promise<string> {
  if (response.status === 401 || response.status === 403) {
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
): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await restErrorMessage(response, fallback))
  const data = (await response.json().catch(() => null)) as T | T[] | null
  return (Array.isArray(data) ? (data[0] ?? ({} as T)) : data) ?? ({} as T)
}

async function patchRows(path: string, patch: Record<string, unknown>, fallback: string): Promise<void> {
  const response = await apiFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(await restErrorMessage(response, fallback))
  const rows = (await response.json().catch(() => [])) as unknown[]
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No tienes permisos para esta operación, o el registro ya no existe.')
  }
}

// ============ Planes ============

const PLAN_SELECT = '*,plan_asset_links(asset_id),plan_category_links(category_id)'

export function getPlans(): Promise<MaintenancePlan[]> {
  return getJson<MaintenancePlan[]>(
    `/rest/v1/maintenance_plans?select=${PLAN_SELECT}&order=name.asc`,
    'No se pudieron cargar los planes.',
  )
}

export async function getPlan(id: string): Promise<MaintenancePlan | null> {
  const rows = await getJson<MaintenancePlan[]>(
    `/rest/v1/maintenance_plans?select=${PLAN_SELECT}&id=eq.${id}&limit=1`,
    'No se pudo cargar el plan.',
  )
  return rows[0] ?? null
}

export function createPlan(data: Partial<MaintenancePlan>): Promise<MaintenancePlan> {
  return postJson<MaintenancePlan>('/rest/v1/maintenance_plans', data, 'No se pudo crear el plan.')
}

export function updatePlan(id: string, patch: Partial<MaintenancePlan>): Promise<void> {
  return patchRows(`/rest/v1/maintenance_plans?id=eq.${id}`, patch, 'No se pudo guardar el plan.')
}

// Sincroniza los vínculos N:N de alcance del plan (activos y categorías).
export async function syncPlanScope(
  planId: string,
  assetIds: string[],
  categoryIds: string[],
): Promise<void> {
  const [currentAssets, currentCategories] = await Promise.all([
    getJson<Array<{ asset_id: string }>>(
      `/rest/v1/plan_asset_links?select=asset_id&plan_id=eq.${planId}`,
      'No se pudo leer el alcance del plan.',
    ),
    getJson<Array<{ category_id: string }>>(
      `/rest/v1/plan_category_links?select=category_id&plan_id=eq.${planId}`,
      'No se pudo leer el alcance del plan.',
    ),
  ])

  const currentAssetIds = new Set(currentAssets.map((link) => link.asset_id))
  const currentCategoryIds = new Set(currentCategories.map((link) => link.category_id))
  const wantedAssets = new Set(assetIds)
  const wantedCategories = new Set(categoryIds)

  for (const assetId of assetIds) {
    if (currentAssetIds.has(assetId)) continue
    const response = await apiFetch('/rest/v1/plan_asset_links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: planId, asset_id: assetId }),
    })
    if (!response.ok) throw new Error(await restErrorMessage(response, 'No se pudo vincular el activo.'))
  }
  for (const assetId of currentAssetIds) {
    if (wantedAssets.has(assetId)) continue
    const response = await apiFetch(`/rest/v1/plan_asset_links?plan_id=eq.${planId}&asset_id=eq.${assetId}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error(await restErrorMessage(response, 'No se pudo quitar el activo.'))
  }

  for (const categoryId of categoryIds) {
    if (currentCategoryIds.has(categoryId)) continue
    const response = await apiFetch('/rest/v1/plan_category_links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: planId, category_id: categoryId }),
    })
    if (!response.ok) throw new Error(await restErrorMessage(response, 'No se pudo vincular la categoría.'))
  }
  for (const categoryId of currentCategoryIds) {
    if (wantedCategories.has(categoryId)) continue
    const response = await apiFetch(
      `/rest/v1/plan_category_links?plan_id=eq.${planId}&category_id=eq.${categoryId}`,
      { method: 'DELETE' },
    )
    if (!response.ok) throw new Error(await restErrorMessage(response, 'No se pudo quitar la categoría.'))
  }
}

// ============ Plantillas de checklist ============

const TEMPLATE_SELECT = '*,checklist_items(id,template_id,position,text)'

function sortTemplates(rows: ChecklistTemplate[]): ChecklistTemplate[] {
  for (const row of rows) row.checklist_items?.sort((a, b) => a.position - b.position)
  return rows
}

export function getChecklistTemplates(): Promise<ChecklistTemplate[]> {
  return getJson<ChecklistTemplate[]>(
    `/rest/v1/checklist_templates?select=${TEMPLATE_SELECT}&order=name.asc`,
    'No se pudieron cargar las plantillas.',
  ).then(sortTemplates)
}

export async function getChecklistTemplate(id: string): Promise<ChecklistTemplate | null> {
  const rows = await getJson<ChecklistTemplate[]>(
    `/rest/v1/checklist_templates?select=${TEMPLATE_SELECT}&id=eq.${id}&limit=1`,
    'No se pudo cargar la plantilla.',
  )
  return rows[0] ? sortTemplates([rows[0]])[0] : null
}

export function createTemplate(data: { name: string; category_id?: string | null; is_active?: boolean }): Promise<ChecklistTemplate> {
  return postJson<ChecklistTemplate>(
    '/rest/v1/checklist_templates',
    data,
    'No se pudo crear la plantilla.',
  )
}

export function updateTemplate(
  id: string,
  patch: { name?: string; category_id?: string | null; is_active?: boolean },
): Promise<void> {
  return patchRows(`/rest/v1/checklist_templates?id=eq.${id}`, patch, 'No se pudo guardar la plantilla.')
}

// Reemplaza los ítems de una plantilla (borra y reinserta en orden).
export async function replaceTemplateItems(
  templateId: string,
  texts: string[],
): Promise<void> {
  const existing = await getJson<Array<{ id: string }>>(
    `/rest/v1/checklist_items?select=id&template_id=eq.${templateId}`,
    'No se pudieron leer los ítems de la plantilla.',
  )
  for (const row of existing) {
    const response = await apiFetch(`/rest/v1/checklist_items?id=eq.${row.id}`, { method: 'DELETE' })
    if (!response.ok) throw new Error(await restErrorMessage(response, 'No se pudo reemplazar los ítems.'))
  }
  const cleaned = texts.map((text) => text.trim()).filter(Boolean)
  if (cleaned.length === 0) return
  const response = await apiFetch('/rest/v1/checklist_items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cleaned.map((text, index) => ({ template_id: templateId, position: index + 1, text }))),
  })
  if (!response.ok) throw new Error(await restErrorMessage(response, 'No se pudieron guardar los ítems.'))
}

// ============ Checklist de OT (F3.4) ============

export function getWoChecklist(woId: string): Promise<ChecklistEntry[]> {
  return getJson<ChecklistEntry[]>(
    `/rest/v1/wo_checklist_entries?select=*&wo_id=eq.${woId}&order=position.asc`,
    'No se pudo cargar el checklist de la OT.',
  )
}

export async function updateChecklistEntry(
  id: string,
  patch: { status: ChecklistStatus; note?: string | null },
): Promise<void> {
  const body: Record<string, unknown> = { status: patch.status, note: patch.note ?? null }
  if (patch.status === 'pending') {
    body.done_by = null
    body.done_at = null
  } else {
    body.done_by = currentUserId()
    body.done_at = new Date().toISOString()
  }
  const response = await apiFetch(`/rest/v1/wo_checklist_entries?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await restErrorMessage(response, 'No se pudo actualizar el ítem del checklist.'))
  const rows = (await response.json().catch(() => [])) as unknown[]
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No tienes permisos para actualizar este ítem, o la OT ya no existe.')
  }
}

// RPC m3_wo_checklist_validate → true si no quedan pendientes (falla cerrada).
export async function validateChecklist(woId: string): Promise<boolean> {
  try {
    const response = await apiFetch('/rest/v1/rpc/m3_wo_checklist_validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_wo_id: woId }),
    })
    if (!response.ok) return false
    return (await response.json()) === true
  } catch {
    return false
  }
}
