import { create } from 'zustand'

export type AuthUser = {
  id: string
  email: string
  full_name: string
  must_change_password: boolean
}

export type SessionPayload = {
  access_token: string
  expires_in: number
  user: AuthUser
  roles?: string[]
}

type AuthState = {
  accessToken: string | null
  user: AuthUser | null
  roles: string[]
  setSession: (payload: SessionPayload) => void
  patchUser: (patch: Partial<AuthUser>) => void
  clear: () => void
}

export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  roles: [],
  setSession: (payload) =>
    set({ accessToken: payload.access_token, user: payload.user, roles: payload.roles ?? [] }),
  patchUser: (patch) =>
    set((state) => ({ user: state.user ? { ...state.user, ...patch } : state.user })),
  clear: () => set({ accessToken: null, user: null, roles: [] }),
}))

export function isAdmin(roles: string[]): boolean {
  return roles.includes('administrador')
}
