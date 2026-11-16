import { useAuth, type SessionPayload } from '@/lib/auth-store'

export type LoginResult =
  | { ok: true; mustChangePassword: boolean }
  | { ok: false; error: { message: string } }

const FN_BASE = '/functions/v1'
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

function baseHeaders(): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (anonKey) headers.apikey = anonKey
  return headers
}

export async function login(email: string, password: string): Promise<LoginResult> {
  try {
    const response = await fetch(`${FN_BASE}/login-custom`, {
      method: 'POST',
      headers: baseHeaders(),
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })
    const data = (await response.json().catch(() => null)) as
      | ({ message?: string } & Partial<SessionPayload>)
      | null

    if (!response.ok) {
      return {
        ok: false,
        error: {
          message:
            data?.message ??
            'El servicio de acceso no está disponible en este momento. Contacta al Administrador del sistema.',
        },
      }
    }

    if (!data?.access_token || !data.user) {
      return {
        ok: false,
        error: { message: 'Respuesta inesperada del servidor de acceso.' },
      }
    }

    useAuth.getState().setSession(data as SessionPayload)
    return { ok: true, mustChangePassword: data.user.must_change_password === true }
  } catch {
    return {
      ok: false,
      error: {
        message: 'No se pudo conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.',
      },
    }
  }
}

export async function refreshSession(): Promise<boolean> {
  try {
    const response = await fetch(`${FN_BASE}/auth-refresh`, {
      method: 'POST',
      headers: baseHeaders(),
      credentials: 'include',
    })
    if (response.ok) {
      const data = (await response.json()) as SessionPayload
      if (!data.access_token || !data.user) return false
      useAuth.getState().setSession(data)
      return true
    }
    if (response.status === 401 || response.status === 403) {
      useAuth.getState().clear()
    }
    return false
  } catch {
    return false
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${FN_BASE}/auth-refresh`, { method: 'DELETE', credentials: 'include' })
  } catch {
    // best-effort: la cookie se limpia igual en el cliente al hacer clear()
  }
  useAuth.getState().clear()
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = (token: string | null) => {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (anonKey && !headers.has('apikey')) headers.set('apikey', anonKey)
    return fetch(path, { ...init, credentials: 'include', headers })
  }

  const response = await doFetch(useAuth.getState().accessToken)
  if (response.status !== 401) return response

  const renewed = await refreshSession()
  if (!renewed) {
    useAuth.getState().clear()
    window.location.assign('/')
    return response
  }
  return doFetch(useAuth.getState().accessToken)
}

export async function postJson<T = object>(
  path: string,
  body: unknown,
): Promise<T & { ok: boolean; message?: string }> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { message?: string } | null
    return { ok: false, message: err?.message ?? 'Error en la petición' } as any
  }
  const data = (await response.json().catch(() => null)) as any
  const row = Array.isArray(data) ? (data[0] ?? null) : data
  return { ok: true, ...(row ?? {}) }
}

export async function patchRows(path: string, patch: unknown): Promise<{ ok: boolean; message?: string }> {
  const response = await apiFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { message?: string } | null
    return { ok: false, message: err?.message ?? 'Error en la actualización' }
  }
  return { ok: true }
}
