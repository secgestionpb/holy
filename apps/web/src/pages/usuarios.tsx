import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { History, KeyRound, Loader2, Pencil, Plus, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { HistoryDialog } from '@/components/usuarios/history-dialog'
import { ResetPasswordDialog } from '@/components/usuarios/reset-password-dialog'
import { UserFormDialog } from '@/components/usuarios/user-form-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ROLES,
  ROLE_LABELS,
  fetchUsers,
  updateUser,
  type AdminUserRow,
  type Role,
} from '@/lib/admin-users'
import { isAdmin, useAuth } from '@/lib/auth-store'

type Filters = {
  query: string
  role: string
  status: string
}

const dateFormatter = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })

export default function Usuarios() {
  const me = useAuth((s) => s.user)
  const roles = useAuth((s) => s.roles)
  const { refreshActiveCount } = useOutletContext<{ refreshActiveCount: () => void }>()
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [filters, setFilters] = useState<Filters>({ query: '', role: 'todos', status: 'todos' })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminUserRow | null>(null)
  const [resetTarget, setResetTarget] = useState<AdminUserRow | null>(null)
  const [historyTarget, setHistoryTarget] = useState<AdminUserRow | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchUsers()
      .then((data) => {
        if (alive) setRows(data)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Error al cargar usuarios.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  function refresh() {
    setLoading(true)
    setError(null)
    setReloadKey((key) => key + 1)
    refreshActiveCount()
  }

  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase()
    return rows.filter((row) => {
      if (query && !row.full_name.toLowerCase().includes(query) && !row.email.toLowerCase().includes(query)) {
        return false
      }
      if (filters.role !== 'todos' && !row.user_roles.some((r) => r.role === filters.role)) {
        return false
      }
      if (filters.status === 'activo' && !row.is_active) return false
      if (filters.status === 'inactivo' && row.is_active) return false
      return true
    })
  }, [rows, filters])

  const activeCount = useMemo(() => rows.filter((row) => row.is_active).length, [rows])

  async function toggleActive(row: AdminUserRow) {
    setTogglingId(row.id)
    const result = await updateUser(
      row.id,
      {
        email: row.email,
        full_name: row.full_name,
        phone: row.phone,
        hourly_rate: row.hourly_rate,
        roles: row.user_roles.map((r) => r.role),
        category_ids: row.user_category_assignments.map((a) => a.category_id),
      },
      { is_active: !row.is_active, avatar_path: row.avatar_path },
    )
    setTogglingId(null)
    if (result.ok) {
      toast.success(row.is_active ? 'Usuario desactivado.' : 'Usuario activado.')
      refresh()
      return
    }
    toast.error(result.message)
  }

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(row: AdminUserRow) {
    setEditing(row)
    setFormOpen(true)
  }

  const admin = isAdmin(roles)

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Usuarios y roles
            </p>
            <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
              Usuarios
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              {activeCount} {activeCount === 1 ? 'usuario activo' : 'usuarios activos'} · gestión
              exclusiva del Administrador.
            </p>
          </div>
          <Button onClick={openCreate} disabled={!admin}>
            <Plus />
            Nuevo usuario
          </Button>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar por nombre o correo"
              placeholder="Buscar por nombre o correo…"
              className="pl-9"
              value={filters.query}
              onChange={(event) => setFilters((f) => ({ ...f, query: event.target.value }))}
            />
          </div>

          <Select
            value={filters.role}
            onValueChange={(value) => setFilters((f) => ({ ...f, role: value }))}
          >
            <SelectTrigger className="w-[170px]" aria-label="Filtrar por rol">
              <SelectValue placeholder="Rol" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los roles</SelectItem>
              {ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {ROLE_LABELS[role as Role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.status}
            onValueChange={(value) => setFilters((f) => ({ ...f, status: value }))}
          >
            <SelectTrigger className="w-[150px]" aria-label="Filtrar por estado">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="activo">Activos</SelectItem>
              <SelectItem value="inactivo">Inactivos</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLoading(true)
              setError(null)
              setReloadKey((key) => key + 1)
            }}
            aria-label="Actualizar listado"
          >
            <RefreshCw />
            Actualizar
          </Button>
        </div>

        <div className="mt-5 overflow-hidden rounded-lg border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-14 text-[14px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando usuarios…
            </div>
          ) : error ? (
            <div className="px-6 py-10 text-center">
              <p className="text-[14px] text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setLoading(true)
                  setError(null)
                  setReloadKey((key) => key + 1)
                }}
              >
                Reintentar
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[14px] text-muted-foreground">
                Sin resultados con los filtros aplicados.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Correo</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Categorías</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Tarifa/h</TableHead>
                  <TableHead>Último acceso</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const hasTechnician = row.user_roles.some((r) => r.role === 'tecnico')
                  const categoryNames = row.user_category_assignments
                    .map((a) => a.categories?.name)
                    .filter((name): name is string => Boolean(name))
                  const isSelf = row.id === me?.id
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.full_name}
                        {isSelf && (
                          <Badge variant="outline" className="ml-2 text-[11px]">
                            Tú
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.email}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {row.user_roles.map((r) => (
                            <Badge key={r.role} variant="secondary">
                              {ROLE_LABELS[r.role]}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] text-[13px] text-muted-foreground">
                        {hasTechnician
                          ? categoryNames.length > 0
                            ? categoryNames.join(', ')
                            : '—'
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={row.is_active}
                            disabled={!admin || togglingId === row.id}
                            aria-label={
                              row.is_active
                                ? `Desactivar ${row.full_name}`
                                : `Activar ${row.full_name}`
                            }
                            onCheckedChange={() => void toggleActive(row)}
                          />
                          <span className="text-[13px] text-muted-foreground">
                            {row.is_active ? 'Activo' : 'Inactivo'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.hourly_rate !== null ? `$${Number(row.hourly_rate).toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">
                        {row.last_sign_in_at
                          ? dateFormatter.format(new Date(row.last_sign_in_at))
                          : 'Nunca'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Editar ${row.full_name}`}
                            disabled={!admin}
                            onClick={() => openEdit(row)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Restablecer contraseña de ${row.full_name}`}
                            disabled={!admin}
                            onClick={() => setResetTarget(row)}
                          >
                            <KeyRound />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Historial de ${row.full_name}`}
                            disabled={!admin}
                            onClick={() => setHistoryTarget(row)}
                          >
                            <History />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {formOpen && (
        <UserFormDialog open onOpenChange={setFormOpen} user={editing} onSaved={refresh} />
      )}
      {resetTarget && (
        <ResetPasswordDialog
          open
          onOpenChange={(open) => {
            if (!open) setResetTarget(null)
          }}
          user={resetTarget}
          onSaved={refresh}
        />
      )}
      {historyTarget && (
        <HistoryDialog
          open
          onOpenChange={(open) => {
            if (!open) setHistoryTarget(null)
          }}
          user={historyTarget}
        />
      )}
    </main>
  )
}
