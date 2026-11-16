import { Fragment, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Download, Loader2, Search } from 'lucide-react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiFetch } from '@/lib/auth'
import { isAdmin, useAuth } from '@/lib/auth-store'
import { exportExcel, exportPdf, type ExportSection } from '@/lib/export-utils'
import { fetchUsersLite, type UserLite } from '@/lib/m1'

type AuditLogRow = {
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
  ip_address: string | null
  user_agent: string | null
}

type Filters = {
  users: string[]
  module: string
  action: string
  entity: string
  dfrom: string
  dto: string
}

const MODULE_LABELS: Record<string, string> = {
  assets: 'Activos',
  work_orders: 'Órdenes de Trabajo',
  damage_reports: 'Reportes de Daño',
  inventory: 'Inventario',
  warranties: 'Garantías',
  providers: 'Proveedores',
  preventive_maintenance: 'Preventivo',
  compliance: 'Cumplimiento',
  measurements: 'Mediciones',
  users: 'Usuarios',
  configuration: 'Configuración',
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Crear',
  update: 'Modificar',
  state_change: 'Cambio de estado',
  deactivate: 'Desactivar',
  activate: 'Activar',
  close: 'Cierre',
  reopen: 'Reapertura',
  assign: 'Asignación',
  reassign: 'Reasignación',
  import: 'Importación',
  password_reset: 'Reset de contraseña',
  confirm: 'Confirmación',
  cancel: 'Cancelación',
  adjust: 'Ajuste',
  entry: 'Entrada',
  exit: 'Salida',
  return: 'Devolución',
  transfer: 'Transferencia',
  delete_tech: 'Borrado técnico',
}

const ACTION_ORDER = [
  'create',
  'update',
  'state_change',
  'deactivate',
  'close',
  'reopen',
  'assign',
  'reassign',
  'import',
  'password_reset',
  'confirm',
  'cancel',
  'adjust',
  'entry',
  'exit',
  'return',
  'transfer',
  'delete_tech',
]

const PAGE_SIZE = 50

function defaultDateFrom(): string {
  const from = new Date(Date.now() - 30 * 86_400_000)
  return from.toISOString().slice(0, 10)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function buildQuery(filters: Filters, cursorId: number | null): string {
  const params = new URLSearchParams()
  params.set(
    'select',
    'id,created_at,user_id,module,entity_type,entity_id,entity_label,action,changes,reason,ip_address,user_agent',
  )
  params.set('order', 'id.desc')
  params.set('limit', String(PAGE_SIZE))
  if (filters.users.length > 0) params.set('user_id', `in.(${filters.users.join(',')})`)
  if (filters.module !== 'todos') params.set('module', `eq.${filters.module}`)
  if (filters.action !== 'todas') params.set('action', `eq.${filters.action}`)
  if (filters.entity) params.set('entity_label', `ilike.*${filters.entity}*`)
  const from = filters.dfrom ? `${filters.dfrom}T00:00:00` : null
  const to = filters.dto ? `${filters.dto}T23:59:59.999` : null
  if (from && to) params.set('created_at', `and(gte.${from},lte.${to})`)
  else if (from) params.set('created_at', `gte.${from}`)
  else if (to) params.set('created_at', `lte.${to}`)
  if (cursorId !== null) params.set('id', `lt.${cursorId}`)
  return `/rest/v1/audit_log?${params.toString()}`
}

async function fetchPage(active: Filters, cursorId: number | null): Promise<AuditLogRow[]> {
  const response = await apiFetch(buildQuery(active, cursorId))
  if (!response.ok) throw new Error('No se pudo cargar el log de auditoría.')
  return (await response.json()) as AuditLogRow[]
}

export default function Auditoria() {
  const roles = useAuth((s) => s.roles)
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [entityDraft, setEntityDraft] = useState('')
  const [filters, setFilters] = useState<Filters>(() => ({
    users: [],
    module: 'todos',
    action: 'todas',
    entity: '',
    dfrom: defaultDateFrom(),
    dto: '',
  }))

  useEffect(() => {
    if (!isAdmin(roles)) return
    let alive = true
    setLoading(true)
    setError(null)
    Promise.all([
      fetchUsersLite().catch(() => [] as UserLite[]),
      fetchPage(filters, null),
    ])
      .then(([userRows, pageRows]) => {
        if (!alive) return
        setUsers(userRows)
        setRows(pageRows)
        setHasMore(pageRows.length === PAGE_SIZE)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'No se pudo cargar el log.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reloadKey, filters, roles])

  const moduleOptions = useMemo(() => Object.entries(MODULE_LABELS), [])

  if (!isAdmin(roles)) return <Navigate to="/app" replace />

  function apply(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }))
    setReloadKey((key) => key + 1)
  }

  async function loadMore() {
    const last = rows[rows.length - 1]
    if (!last) return
    setLoadingMore(true)
    try {
      const pageRows = await fetchPage(filters, last.id)
      setRows((current) => [...current, ...pageRows])
      setHasMore(pageRows.length === PAGE_SIZE)
    } catch {
      setError('No se pudieron cargar más entradas.')
    } finally {
      setLoadingMore(false)
    }
  }

  function exportAudit(format: 'pdf' | 'excel') {
    const section: ExportSection = {
      title: 'Registro de auditoría',
      headers: ['Fecha/hora', 'Usuario', 'Módulo', 'Entidad', 'Acción', 'Detalle', 'Motivo', 'IP'],
      rows: rows.map((row) => [
        formatDateTime(row.created_at),
        users.find((u) => u.id === row.user_id)?.full_name ?? row.user_id ?? '',
        MODULE_LABELS[row.module] ?? row.module,
        row.entity_label ?? row.entity_type,
        ACTION_LABELS[row.action] ?? row.action,
        row.changes ? Object.keys(row.changes).join(', ') : '',
        row.reason ?? '',
        row.ip_address ?? '',
      ]),
    }
    const meta = {
      title: 'Registro de auditoría',
      filtersLabel: `${rows.length} entrada(s) cargada(s)`,
    }
    if (format === 'pdf') void exportPdf(meta, [section], 'auditoria')
    else void exportExcel(meta, [section], 'auditoria')
  }

  const selectedUserNames = filters.users
    .map((id) => users.find((user) => user.id === id)?.full_name)
    .filter((name): name is string => Boolean(name))

  return (
    <main className="px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Módulo T3
            </p>
            <h1 className="font-heading mt-1 text-[26px] font-extrabold tracking-[-0.02em]">
              Auditoría — Registro general
            </h1>
            <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-muted-foreground">
              Historial inmutable de cada acción sobre los datos del sistema. Retención
              indefinida; solo lectura (nadie edita ni borra entradas, ni siquiera el
              Administrador).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length === 0}
              title="Exportar las entradas cargadas a PDF."
              onClick={() => exportAudit('pdf')}
            >
              <Download className="size-4" />
              PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length === 0}
              title="Exportar las entradas cargadas a Excel."
              onClick={() => exportAudit('excel')}
            >
              <Download className="size-4" />
              Excel
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative">
            <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Usuario</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-between font-normal"
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <span className="truncate">
                {selectedUserNames.length === 0
                  ? 'Todos'
                  : selectedUserNames.length <= 2
                    ? selectedUserNames.join(', ')
                    : `${selectedUserNames.length} seleccionados`}
              </span>
            </Button>
            {userMenuOpen && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-2 shadow-md">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={filters.users.length === 0}
                    onChange={() => apply({ users: [] })}
                  />
                  Todos
                </label>
                {users.map((user) => (
                  <label
                    key={user.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={filters.users.includes(user.id)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...filters.users, user.id]
                          : filters.users.filter((id) => id !== user.id)
                        apply({ users: next })
                      }}
                    />
                    <span className="truncate">{user.full_name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Módulo</p>
            <Select value={filters.module} onValueChange={(value) => apply({ module: value })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {moduleOptions.map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Acción</p>
            <Select value={filters.action} onValueChange={(value) => apply({ action: value })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {ACTION_ORDER.map((key) => (
                  <SelectItem key={key} value={key}>
                    {ACTION_LABELS[key] ?? key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Entidad</p>
            <form
              className="relative"
              onSubmit={(event) => {
                event.preventDefault()
                apply({ entity: entityDraft.trim() })
              }}
            >
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar (Enter)…"
                value={entityDraft}
                onChange={(event) => setEntityDraft(event.target.value)}
              />
            </form>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Desde</p>
              <Input
                type="date"
                value={filters.dfrom}
                onChange={(event) => apply({ dfrom: event.target.value })}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Hasta</p>
              <Input
                type="date"
                value={filters.dto}
                onChange={(event) => apply({ dto: event.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">Fecha/hora</TableHead>
                <TableHead className="hidden md:table-cell">Usuario</TableHead>
                <TableHead className="hidden lg:table-cell">Módulo</TableHead>
                <TableHead>Entidad</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead className="hidden xl:table-cell">Detalle</TableHead>
                <TableHead className="hidden xl:table-cell">Motivo</TableHead>
                <TableHead className="hidden 2xl:table-cell">IP / Dispositivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-primary" />
                  </TableCell>
                </TableRow>
              )}
              {!loading && error && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-[13.5px] text-destructive">
                    {error}
                  </TableCell>
                </TableRow>
              )}
              {!loading && !error && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-[13.5px] text-muted-foreground"
                  >
                    Sin entradas para los filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded((current) => (current === row.id ? null : row.id))}
                    >
                      <TableCell className="font-mono text-[12.5px] whitespace-nowrap">
                        {formatDateTime(row.created_at)}
                      </TableCell>
                      <TableCell className="hidden text-[13px] md:table-cell">
                        {row.user_id ? (
                          users.find((user) => user.id === row.user_id)?.full_name ?? 'Usuario'
                        ) : (
                          <span className="text-muted-foreground italic">Sistema</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-[13px] lg:table-cell">
                        <Badge variant="outline" className="text-[11px]">
                          {MODULE_LABELS[row.module] ?? row.module}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-[13px]">
                        {row.entity_label ?? row.entity_type}
                      </TableCell>
                      <TableCell className="text-[13px]">
                        {ACTION_LABELS[row.action] ?? row.action}
                      </TableCell>
                      <TableCell className="hidden max-w-[260px] truncate text-[13px] text-muted-foreground xl:table-cell">
                        {row.changes
                          ? Object.keys(row.changes)
                              .slice(0, 3)
                              .join(', ') + (Object.keys(row.changes).length > 3 ? '…' : '')
                          : '—'}
                      </TableCell>
                      <TableCell className="hidden max-w-[200px] truncate text-[13px] xl:table-cell">
                        {row.reason ?? '—'}
                      </TableCell>
                      <TableCell className="hidden max-w-[220px] truncate text-[12.5px] text-muted-foreground 2xl:table-cell">
                        {[row.ip_address, row.user_agent].filter(Boolean).join(' · ') || '—'}
                      </TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/40">
                          <div className="space-y-2 py-1">
                            <p className="text-[12.5px] font-semibold tracking-wide uppercase">
                              Detalle del cambio
                            </p>
                            {row.changes && Object.keys(row.changes).length > 0 ? (
                              <ul className="space-y-1.5">
                                {Object.entries(row.changes).map(([field, diff]) => (
                                  <li key={field} className="text-[13px]">
                                    <span className="font-medium">{field}:</span>{' '}
                                    <span className="text-muted-foreground line-through">
                                      {JSON.stringify(diff.old ?? null)}
                                    </span>{' '}
                                    →{' '}
                                    <span className="font-medium">
                                      {JSON.stringify(diff.new ?? null)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-[13px] text-muted-foreground">
                                Sin cambios de campos registrados.
                              </p>
                            )}
                            {row.reason && (
                              <p className="text-[13px]">
                                <span className="font-medium">Motivo:</span> {row.reason}
                              </p>
                            )}
                            <p className="text-[12.5px] text-muted-foreground">
                              Entidad: {row.entity_type}
                              {row.entity_id ? ` · ${row.entity_id}` : ''} ·{' '}
                              {row.user_agent ?? 'sin dispositivo registrado'}
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-[12.5px] text-muted-foreground">
            {rows.length} entrada{rows.length === 1 ? '' : 's'} · paginación por cursor (id
            descendente)
          </p>
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Cargar más
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
