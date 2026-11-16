import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fetchUserHistory, type AdminUserRow, type UserHistoryRow } from '@/lib/admin-users'

const dateFormatter = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })

const ACTION_LABELS: Record<string, string> = {
  create: 'Creación',
  update: 'Modificación',
  deactivate: 'Desactivación',
  password_reset: 'Restablecimiento de contraseña',
}

const FIELD_LABELS: Record<string, string> = {
  email: 'Correo',
  full_name: 'Nombre',
  phone: 'Teléfono',
  hourly_rate: 'Tarifa/h',
  is_active: 'Estado',
  avatar_path: 'Foto',
  must_change_password: 'Cambio de clave',
  role: 'Rol',
  roles: 'Roles',
  category_ids: 'Categorías',
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (field === 'is_active') return value === true || value === 'true' ? 'Activo' : 'Inactivo'
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ') || '—'
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function summarizeChanges(changes: UserHistoryRow['changes']): string[] {
  if (!changes) return []
  return Object.entries(changes).map(([field, diff]) => {
    const label = FIELD_LABELS[field] ?? field
    return `${label}: ${formatValue(field, diff?.old)} → ${formatValue(field, diff?.new)}`
  })
}

function HistoryContent({ user }: { user: AdminUserRow }) {
  const [rows, setRows] = useState<UserHistoryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchUserHistory(user.id)
      .then((data) => {
        if (alive) setRows(data)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'No se pudo cargar el historial.')
      })
    return () => {
      alive = false
    }
  }, [user.id])

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
      >
        {error}
      </div>
    )
  }

  if (rows === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando historial…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground">Sin actividad registrada.</p>
    )
  }

  return (
    <div className="max-h-[55vh] overflow-y-auto pr-1">
      {rows.map((row) => {
        const changes = summarizeChanges(row.changes)
        return (
          <div key={row.id} className="border-b border-border py-3 last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-semibold">
                {ACTION_LABELS[row.action] ?? row.action}
              </span>
              <span className="text-[12px] tabular-nums text-muted-foreground">
                {dateFormatter.format(new Date(row.created_at))}
              </span>
            </div>
            {changes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {changes.map((line) => (
                  <li key={line} className="font-mono text-[12px] text-muted-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            {row.reason && (
              <p className="mt-1 text-[12px] text-muted-foreground">Motivo: {row.reason}</p>
            )}
            <p className="mt-1 text-[12px] text-muted-foreground">
              {row.action === 'password_reset'
                ? 'Registrado por el Administrador'
                : `Por: ${row.actor_name ?? 'Sistema'}`}
            </p>
          </div>
        )
      })}
    </div>
  )
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AdminUserRow | null
}

export function HistoryDialog({ open, onOpenChange, user }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Historial</DialogTitle>
          <DialogDescription>
            {user
              ? `Actividad registrada sobre la ficha de ${user.full_name} (últimos 50 eventos).`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {user && <HistoryContent key={user.id} user={user} />}
      </DialogContent>
    </Dialog>
  )
}
