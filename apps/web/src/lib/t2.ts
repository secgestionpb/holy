import { apiFetch } from '@/lib/auth'

export type NotificationEvent = {
  event_id: number
  name: string
  description: string
  channel: string
  mode: 'immediate' | 'daily_digest'
  digest_time: string
  recipients: string[]
  extra_param: number | null
  is_active: boolean
}

export type EventPatch = {
  mode: 'immediate' | 'daily_digest'
  digest_time: string
  recipients: string[]
  extra_param: number | null
  is_active: boolean
}

export const MODE_LABELS: Record<NotificationEvent['mode'], string> = {
  immediate: 'Inmediato',
  daily_digest: 'Resumen diario',
}

export async function fetchNotificationConfig(): Promise<NotificationEvent[]> {
  const response = await apiFetch('/rest/v1/notification_config?select=*&order=event_id.asc')
  if (!response.ok) throw new Error('No se pudo cargar la configuración de notificaciones.')
  return (await response.json()) as NotificationEvent[]
}

export async function updateNotificationEvent(id: number, patch: EventPatch): Promise<void> {
  const response = await apiFetch(`/rest/v1/notification_config?event_id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error('No se pudo guardar el evento.')
}

export type ParamRow = {
  key: string
  value: string
  description: string | null
}

export const EDITABLE_PARAMS = [
  'dias_anticipacion_garantia',
  'labor_hourly_rate',
  'login_attempts',
  'lockout_minutes',
] as const

export const PARAM_LABELS: Record<string, string> = {
  dias_anticipacion_garantia: 'Días de anticipación de garantía (Evento 7)',
  labor_hourly_rate: 'Tarifa global de mano de obra (USD/h)',
  login_attempts: 'Intentos fallidos antes de bloquear el login',
  lockout_minutes: 'Duración del bloqueo por intentos fallidos (min)',
}

export async function fetchSystemParams(keys: readonly string[]): Promise<ParamRow[]> {
  const response = await apiFetch(
    `/rest/v1/system_parameters?select=key,value,description&key=in.(${keys.join(',')})&order=key.asc`,
  )
  if (!response.ok) throw new Error('No se pudieron cargar los parámetros.')
  return (await response.json()) as ParamRow[]
}

export async function updateSystemParam(key: string, value: string): Promise<void> {
  const response = await apiFetch(`/rest/v1/system_parameters?key=eq.${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!response.ok) throw new Error('No se pudo guardar el parámetro.')
}

export type FailedLogRow = {
  id: string
  event_id: number
  target_entity_type: string | null
  target_entity_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
  error_detail: string | null
}

export async function fetchFailedLogs(): Promise<FailedLogRow[]> {
  const response = await apiFetch(
    '/rest/v1/notification_log?select=id,event_id,target_entity_type,target_entity_id,payload,created_at,error_detail&status=eq.failed&order=created_at.desc&limit=20',
  )
  if (!response.ok) return []
  return (await response.json()) as FailedLogRow[]
}

export async function retryNotification(logId: string): Promise<{ ok: boolean; message?: string }> {
  const response = await apiFetch('/functions/v1/send-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'immediate', action: 'retry', log_id: logId }),
  })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    return {
      ok: false,
      message: typeof body?.message === 'string' ? body.message : 'No se pudo reintentar el envío.',
    }
  }
  if (body?.status === 'sent') return { ok: true }
  return {
    ok: false,
    message: typeof body?.reason === 'string' ? body.reason : 'El envío no se completó.',
  }
}
