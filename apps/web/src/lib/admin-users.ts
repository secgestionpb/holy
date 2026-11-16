import { apiFetch } from '@/lib/auth'
import { fileSizeError } from '@/lib/upload-utils'

export const ROLES = ['mantenimiento', 'tecnico', 'administrador', 'calidad'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  mantenimiento: 'Mantenimiento',
  tecnico: 'Técnico',
  administrador: 'Administrador',
  calidad: 'Calidad',
}

export type AdminUserInput = {
  email: string
  full_name: string
  phone: string | null
  hourly_rate: number | null
  roles: string[]
  category_ids?: string[]
}

export type CreateUserResult =
  | { ok: true; user_id: string; temp_password: string }
  | { ok: false; message: string }

export type AdminActionResult = { ok: true } | { ok: false; message: string }

export type ResetPasswordResult =
  | { ok: true; temp_password: string }
  | { ok: false; message: string }

async function callAdminUsers(
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  try {
    const response = await apiFetch('/functions/v1/admin-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return { status: response.status, body }
  } catch {
    return { status: 0, body: null }
  }
}

function messageFrom(body: Record<string, unknown> | null, fallback: string): string {
  const message = body?.message
  return typeof message === 'string' && message ? message : fallback
}

export async function createUser(input: AdminUserInput): Promise<CreateUserResult> {
  const { status, body } = await callAdminUsers({ action: 'create', ...input })
  if (status === 201 && body && typeof body.temp_password === 'string') {
    return { ok: true, user_id: String(body.user_id), temp_password: body.temp_password }
  }
  if (status === 0) return { ok: false, message: 'No se pudo conectar con el servidor.' }
  return { ok: false, message: messageFrom(body, 'No se pudo crear el usuario.') }
}

export async function updateUser(
  userId: string,
  input: AdminUserInput,
  options: { is_active: boolean; avatar_path: string | null },
): Promise<AdminActionResult> {
  const { status, body } = await callAdminUsers({
    action: 'update',
    user_id: userId,
    is_active: options.is_active,
    avatar_path: options.avatar_path,
    ...input,
  })
  if (status === 200) return { ok: true }
  if (status === 0) return { ok: false, message: 'No se pudo conectar con el servidor.' }
  return { ok: false, message: messageFrom(body, 'No se pudieron guardar los cambios.') }
}

export async function resetPassword(userId: string): Promise<ResetPasswordResult> {
  const { status, body } = await callAdminUsers({ action: 'reset_password', user_id: userId })
  if (status === 200 && body && typeof body.temp_password === 'string') {
    return { ok: true, temp_password: body.temp_password }
  }
  if (status === 0) return { ok: false, message: 'No se pudo conectar con el servidor.' }
  return { ok: false, message: messageFrom(body, 'No se pudo restablecer la contraseña.') }
}

export async function changeOwnPassword(password: string): Promise<AdminActionResult> {
  const { status, body } = await callAdminUsers({ action: 'change_own_password', password })
  if (status === 200) return { ok: true }
  if (status === 0) return { ok: false, message: 'No se pudo conectar con el servidor.' }
  return { ok: false, message: messageFrom(body, 'No se pudo actualizar la contraseña.') }
}

export type CategoryOption = { id: string; name: string }

export async function fetchCategories(): Promise<CategoryOption[]> {
  const response = await apiFetch('/rest/v1/categories?select=id,name&order=name.asc')
  if (!response.ok) return []
  const rows = (await response.json()) as Array<{ id: string; name: string }>
  return rows
}

export type CategoryAssignment = { category_id: string; categories: { name: string } | null }

export type AdminUserRow = {
  id: string
  email: string
  full_name: string
  phone: string | null
  hourly_rate: number | null
  is_active: boolean
  must_change_password: boolean
  avatar_path: string | null
  created_at: string
  last_sign_in_at: string | null
  user_roles: Array<{ role: Role }>
  user_category_assignments: CategoryAssignment[]
}

export async function fetchUsers(): Promise<AdminUserRow[]> {
  const response = await apiFetch(
    '/rest/v1/users?select=id,email,full_name,phone,hourly_rate,is_active,must_change_password,avatar_path,created_at,last_sign_in_at,user_roles!user_roles_user_id_fkey(role),user_category_assignments!user_category_assignments_user_id_fkey(category_id,categories(name))&order=full_name.asc',
  )
  if (!response.ok) throw new Error('No se pudo cargar el listado de usuarios.')
  return (await response.json()) as AdminUserRow[]
}

export async function fetchActiveCount(): Promise<number> {
  const response = await apiFetch('/rest/v1/users?select=id&is_active=is.true&limit=1', {
    headers: { Prefer: 'count=exact' },
  })
  if (!response.ok) return 0
  const contentRange = response.headers.get('content-range') ?? ''
  const match = /\/(\d+)(?:\s|$)/.exec(contentRange)
  return match ? Number(match[1]) : 0
}

export async function uploadAvatar(file: File, userId: string): Promise<string> {
  const sizeError = fileSizeError(file)
  if (sizeError) throw new Error(sizeError)
  const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
  const objectPath = `${userId}/avatar-${Date.now()}.${extension}`
  const response = await apiFetch(`/storage/v1/object/usuarios/${objectPath}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!response.ok) throw new Error('No se pudo subir la imagen.')
  return `usuarios/${objectPath}`
}

export async function signAvatarUrl(avatarPath: string): Promise<string | null> {
  try {
    const response = await apiFetch(
      `/storage/v1/object/sign/${avatarPath}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) },
    )
    if (!response.ok) return null
    const data = (await response.json()) as { signedURL?: string }
    if (!data.signedURL) return null
    const origin = new URL(import.meta.env.VITE_SUPABASE_URL as string).origin
    return `${origin}/storage/v1${data.signedURL}`
  } catch {
    return null
  }
}

export type UserHistoryRow = {
  id: number
  created_at: string
  action: string
  entity_type: string
  entity_label: string | null
  changes: Record<string, { old?: unknown; new?: unknown }> | null
  reason: string | null
  user_id: string | null
  actor_name: string | null
}

export async function fetchUserHistory(userId: string): Promise<UserHistoryRow[]> {
  const response = await apiFetch(
    `/rest/v1/audit_log?select=id,created_at,action,entity_type,entity_label,changes,reason,user_id&module=eq.users&entity_id=eq.${userId}&order=created_at.desc&limit=50`,
  )
  if (!response.ok) throw new Error('No se pudo cargar el historial.')
  const rows = (await response.json()) as Array<Omit<UserHistoryRow, 'actor_name'>>

  const actorIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id)))]
  if (actorIds.length === 0) {
    return rows.map((row) => ({ ...row, actor_name: null }))
  }
  const namesResponse = await apiFetch(
    `/rest/v1/users?select=id,full_name&id=in.(${actorIds.join(',')})`,
  )
  if (!namesResponse.ok) {
    return rows.map((row) => ({ ...row, actor_name: null }))
  }
  const names = (await namesResponse.json()) as Array<{ id: string; full_name: string }>
  const byId = new Map(names.map((entry) => [entry.id, entry.full_name]))
  return rows.map((row) => ({
    ...row,
    actor_name: row.user_id ? (byId.get(row.user_id) ?? null) : null,
  }))
}
