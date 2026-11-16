import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Loader2, Plus, RefreshCw, Search, TriangleAlert } from 'lucide-react'
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
import { useAuth } from '@/lib/auth-store'
import {
  fetchCategories,
  fetchLocations,
  locationOptions,
  type CategoryRow,
  type LocationRow,
} from '@/lib/m1'
import {
  fetchAllActiveAssignments,
  fetchTechnicians,
  fetchWorkOrders,
  isTabId,
  ORIGIN_LABELS,
  PRIORITY_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
  TAB_IDS,
  TAB_LABELS,
  TYPE_LABELS,
  statusInTab,
  type Priority,
  type TabId,
  type TechnicianLite,
  type WoRow,
  type WoStatus,
  type WoType,
} from '@/lib/m2'
import { getPlans } from '@/lib/m3'

type DatePreset = 'hoy' | '7' | '30' | 'custom' | 'none'

type Filters = {
  q: string
  dp: DatePreset
  df: 'reported_at' | 'scheduled_at'
  dfrom: string
  dto: string
  type: string
  pri: string
  st: string
  tech: string
  exec: string
  reas: boolean
  mine: boolean
  cat: string
  loc: string
}

const PAGE_SIZES = [20, 40, 60, 100]

// "Vencida" se evalúa contra el momento de carga del listado (fuera del render
// para no impurezas en pintado); las OTs de un plan aplican el margen de gracia
// del plan (F3.5/M3) antes de considerarse vencidas.
const LIST_LOADED_AT = new Date()

function defaultFilters(mine: boolean): Filters {
  return {
    q: '',
    dp: '30',
    df: 'reported_at',
    dfrom: '',
    dto: '',
    type: 'todos',
    pri: 'todos',
    st: 'todos',
    tech: 'todos',
    exec: 'todos',
    reas: false,
    mine,
    cat: 'todas',
    loc: 'todas',
  }
}

function readFilters(params: URLSearchParams, mine: boolean): Filters {
  const base = defaultFilters(mine)
  const dpRaw = params.get('dp')
  const dfRaw = params.get('df')
  return {
    q: params.get('q') ?? base.q,
    dp: dpRaw && (['hoy', '7', '30', 'custom', 'none'] as string[]).includes(dpRaw) ? (dpRaw as DatePreset) : base.dp,
    df: dfRaw === 'scheduled_at' ? 'scheduled_at' : 'reported_at',
    dfrom: params.get('dfrom') ?? '',
    dto: params.get('dto') ?? '',
    type: params.get('type') ?? base.type,
    pri: params.get('pri') ?? base.pri,
    st: params.get('st') ?? base.st,
    tech: params.get('tech') ?? base.tech,
    exec: params.get('exec') ?? base.exec,
    reas: params.get('reas') === '1',
    mine: params.has('mine') ? params.get('mine') === '1' : base.mine,
    cat: params.get('cat') ?? base.cat,
    loc: params.get('loc') ?? base.loc,
  }
}

function serializeFilters(filters: Filters, defaults: Filters): Record<string, string> {
  const out: Record<string, string> = {}
  if (filters.q) out.q = filters.q
  if (filters.dp !== defaults.dp) out.dp = filters.dp
  if (filters.df !== defaults.df) out.df = filters.df
  if (filters.dfrom) out.dfrom = filters.dfrom
  if (filters.dto) out.dto = filters.dto
  if (filters.type !== defaults.type) out.type = filters.type
  if (filters.pri !== defaults.pri) out.pri = filters.pri
  if (filters.st !== defaults.st) out.st = filters.st
  if (filters.tech !== defaults.tech) out.tech = filters.tech
  if (filters.exec !== defaults.exec) out.exec = filters.exec
  if (filters.reas) out.reas = '1'
  if (filters.mine !== defaults.mine) out.mine = filters.mine ? '1' : '0'
  if (filters.cat !== defaults.cat) out.cat = filters.cat
  if (filters.loc !== defaults.loc) out.loc = filters.loc
  return out
}

function dateRange(filters: Filters): { from: Date | null; to: Date | null } {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  if (filters.dp === 'none') return { from: null, to: null }
  if (filters.dp === 'hoy') {
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    return { from, to: end }
  }
  if (filters.dp === '7' || filters.dp === '30') {
    const from = new Date(Date.now() - Number(filters.dp) * 86_400_000)
    from.setHours(0, 0, 0, 0)
    return { from, to: end }
  }
  if (filters.dp === 'custom') {
    return {
      from: filters.dfrom ? new Date(`${filters.dfrom}T00:00:00`) : null,
      to: filters.dto ? new Date(`${filters.dto}T23:59:59`) : null,
    }
  }
  return { from: null, to: null }
}

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  hoy: 'Hoy',
  '7': 'Últimos 7 días',
  '30': 'Últimos 30 días',
  custom: 'Personalizado',
  none: 'Sin límite',
}

const TAB_EMPTY_TEXT: Record<TabId, string> = {
  pendientes: 'Sin OTs pendientes.',
  completed: 'Sin OTs completadas ni cerradas.',
  cancelled: 'Sin OTs canceladas.',
  all: 'No hay OTs con los filtros aplicados.',
}

export default function Ordenes() {
  const roles = useAuth((s) => s.roles)
  const user = useAuth((s) => s.user)
  const canCreate = roles.includes('mantenimiento')
  const canExport = canCreate || roles.includes('administrador')
  const isTechnician = roles.includes('tecnico')
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const defaults = useMemo(() => defaultFilters(isTechnician), [isTechnician])
  const tab: TabId = isTabId(searchParams.get('tab')) ? (searchParams.get('tab') as TabId) : 'pendientes'
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const pageSize = PAGE_SIZES.includes(Number(searchParams.get('size'))) ? Number(searchParams.get('size')) : 20
  const [filters, setFilters] = useState<Filters>(() => readFilters(searchParams, isTechnician))

  const [rows, setRows] = useState<WoRow[]>([])
  const [technicians, setTechnicians] = useState<TechnicianLite[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [assignments, setAssignments] = useState<Map<string, Set<string>>>(new Map())
  const [planGrace, setPlanGrace] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetchWorkOrders(),
      fetchTechnicians(),
      fetchCategories(),
      fetchLocations(),
      fetchAllActiveAssignments(),
      getPlans().catch(() => []),
    ])
      .then(([woRows, techRows, categoryRows, locationRows, assignmentRows, planRows]) => {
        if (!alive) return
        setRows(woRows)
        setTechnicians(techRows)
        setCategories(categoryRows)
        setLocations(locationRows)
        setPlanGrace(new Map(planRows.map((plan) => [plan.id, plan.grace_days])))
        const map = new Map<string, Set<string>>()
        for (const entry of assignmentRows) {
          const set = map.get(entry.wo_id) ?? new Set<string>()
          set.add(entry.user_id)
          map.set(entry.wo_id, set)
        }
        setAssignments(map)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Error al cargar las OTs.')
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
  }

  function applyFilters(patch: Partial<Filters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    setSearchParams({ ...serializeFilters(next, defaults), tab }, { replace: true })
  }

  function applyTab(nextTab: TabId) {
    setSearchParams({ ...serializeFilters(filters, defaults), tab: nextTab }, { replace: true })
  }

  function applyPage(nextPage: number) {
    const params: Record<string, string> = { ...serializeFilters(filters, defaults), tab }
    if (nextPage > 1) params.page = String(nextPage)
    if (pageSize !== 20) params.size = String(pageSize)
    setSearchParams(params, { replace: true })
  }

  function applySize(nextSize: number) {
    const params: Record<string, string> = {
      ...serializeFilters(filters, defaults),
      tab,
      size: String(nextSize),
    }
    setSearchParams(params, { replace: true })
  }

  const filtered = useMemo(() => {
    const query = filters.q.trim().toLowerCase()
    const { from, to } = dateRange(filters)
    return rows.filter((row) => {
      if (
        query &&
        !row.wo_number.toLowerCase().includes(query) &&
        !(row.asset_code ?? '').toLowerCase().includes(query) &&
        !(row.asset_name ?? '').toLowerCase().includes(query) &&
        !row.description.toLowerCase().includes(query)
      ) {
        return false
      }
      if (from || to) {
        const raw = filters.df === 'scheduled_at' ? row.scheduled_at : row.reported_at
        if (!raw) return false
        const value = new Date(raw)
        if (from && value < from) return false
        if (to && value > to) return false
      }
      if (filters.type !== 'todos' && row.wo_type !== filters.type) return false
      if (filters.pri !== 'todos' && row.priority !== filters.pri) return false
      if (filters.st !== 'todos' && row.status !== filters.st) return false
      if (filters.exec !== 'todos' && row.executed_by_type !== filters.exec) return false
      if (filters.reas && !row.reassigned) return false
      if (filters.tech !== 'todos' && !assignments.get(row.id)?.has(filters.tech)) return false
      if (filters.mine && user && !assignments.get(row.id)?.has(user.id)) return false
      if (filters.cat !== 'todas') {
        const category = categories.find((entry) => entry.id === filters.cat)
        if (!category || row.category_name !== category.name) return false
      }
      if (filters.loc !== 'todas' && row.location_id !== filters.loc) return false
      return true
    })
  }, [rows, filters, assignments, user, categories])

  const counts = useMemo(() => {
    const result = {} as Record<TabId, number>
    for (const id of TAB_IDS) result[id] = filtered.filter((row) => statusInTab(row.status, id)).length
    return result
  }, [filtered])

  const tabRows = useMemo(
    () => filtered.filter((row) => statusInTab(row.status, tab)),
    [filtered, tab],
  )

  const totalPages = Math.max(1, Math.ceil(tabRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = tabRows.slice((safePage - 1) * pageSize, safePage * pageSize)
  const rangeStart = tabRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1
  const rangeEnd = Math.min(safePage * pageSize, tabRows.length)

  const locationChoices = useMemo(() => locationOptions(locations), [locations])
  const activeFilterCount =
    (filters.q ? 1 : 0) +
    (filters.dp !== defaults.dp ? 1 : 0) +
    (filters.df !== defaults.df ? 1 : 0) +
    (filters.type !== defaults.type ? 1 : 0) +
    (filters.pri !== defaults.pri ? 1 : 0) +
    (filters.st !== defaults.st ? 1 : 0) +
    (filters.tech !== defaults.tech ? 1 : 0) +
    (filters.exec !== defaults.exec ? 1 : 0) +
    (filters.reas ? 1 : 0) +
    (filters.cat !== defaults.cat ? 1 : 0) +
    (filters.loc !== defaults.loc ? 1 : 0)

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Módulo 2 · Órdenes de trabajo
            </p>
            <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
              Órdenes de trabajo
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              {rows.length} {rows.length === 1 ? 'OT registrada' : 'OTs registradas'} ·{' '}
              {technicians.length} técnicos activos
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canExport}
              title="Exportar listado (PDF/Excel): Módulo 7."
            >
              <Download />
              Exportar
            </Button>
            {isTechnician && (
              <Button variant="outline" size="sm" onClick={() => navigate('/app/reportes-dano?nuevo=1')}>
                <TriangleAlert />
                Nuevo reporte de daño
              </Button>
            )}
            <Button
              disabled={!canCreate}
              title={canCreate ? undefined : 'Solo Mantenimiento crea OTs.'}
              onClick={() =>
                navigate(`/app/ordenes/nueva?from=${encodeURIComponent(location.pathname + location.search)}`)
              }
            >
              <Plus />
              Nueva OT
            </Button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-1.5">
          {TAB_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => applyTab(id)}
              className={[
                'rounded-md px-3.5 py-1.5 text-[13.5px] font-medium transition-colors',
                tab === id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              ].join(' ')}
            >
              {TAB_LABELS[id]}
              <span
                className={[
                  'ml-2 rounded-full px-1.5 py-0.5 text-[11.5px] tabular-nums',
                  tab === id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                ].join(' ')}
              >
                {counts[id]}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar OT, activo o descripción"
              placeholder="Buscar número, activo o descripción…"
              className="pl-9"
              value={filters.q}
              onChange={(event) => applyFilters({ q: event.target.value })}
            />
          </div>

          <Select value={filters.dp} onValueChange={(value) => applyFilters({ dp: value as DatePreset })}>
            <SelectTrigger className="w-[165px]" aria-label="Filtro de fecha">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(DATE_PRESET_LABELS) as Array<[DatePreset, string]>).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.df}
            onValueChange={(value) => applyFilters({ df: value as Filters['df'] })}
          >
            <SelectTrigger className="w-[175px]" aria-label="Campo de fecha">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reported_at">Fecha de apertura</SelectItem>
              <SelectItem value="scheduled_at">Fecha programada</SelectItem>
            </SelectContent>
          </Select>

          {filters.dp === 'custom' && (
            <>
              <Input
                type="date"
                aria-label="Desde"
                className="w-[150px]"
                value={filters.dfrom}
                onChange={(event) => applyFilters({ dfrom: event.target.value })}
              />
              <Input
                type="date"
                aria-label="Hasta"
                className="w-[150px]"
                value={filters.dto}
                onChange={(event) => applyFilters({ dto: event.target.value })}
              />
            </>
          )}

          <Select value={filters.type} onValueChange={(value) => applyFilters({ type: value })}>
            <SelectTrigger className="w-[140px]" aria-label="Tipo de OT">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Tipo (todos)</SelectItem>
              {(Object.entries(TYPE_LABELS) as Array<[WoType, string]>).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.pri} onValueChange={(value) => applyFilters({ pri: value })}>
            <SelectTrigger className="w-[135px]" aria-label="Prioridad">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Prioridad (todas)</SelectItem>
              {(Object.entries(PRIORITY_LABELS) as Array<[Priority, string]>).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.st} onValueChange={(value) => applyFilters({ st: value })}>
            <SelectTrigger className="w-[175px]" aria-label="Estado puntual">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Estado (todos)</SelectItem>
              {(['open', 'assigned', 'in_progress', 'waiting_parts', 'completed', 'closed', 'cancelled'] as WoStatus[]).map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>

          <Select value={filters.tech} onValueChange={(value) => applyFilters({ tech: value })}>
            <SelectTrigger className="w-[170px]" aria-label="Técnico asignado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Técnico (cualquiera)</SelectItem>
              {technicians.map((technician) => (
                <SelectItem key={technician.id} value={technician.id}>
                  {technician.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.exec} onValueChange={(value) => applyFilters({ exec: value })}>
            <SelectTrigger className="w-[150px]" aria-label="Ejecutada por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Ejecución (todas)</SelectItem>
              <SelectItem value="internal">Personal interno</SelectItem>
              <SelectItem value="external">Contratista</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.cat} onValueChange={(value) => applyFilters({ cat: value })}>
            <SelectTrigger className="w-[175px]" aria-label="Categoría del activo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Categoría (todas)</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.loc} onValueChange={(value) => applyFilters({ loc: value })}>
            <SelectTrigger className="w-[190px]" aria-label="Ubicación del activo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Ubicación (todas)</SelectItem>
              {locationChoices.map((location_) => (
                <SelectItem key={location_.id} value={location_.id}>
                  {location_.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canCreate && (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={filters.reas}
                onChange={(event) => applyFilters({ reas: event.target.checked })}
              />
              Reasignadas
            </label>
          )}

          {isTechnician && (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={filters.mine}
                onChange={(event) => applyFilters({ mine: event.target.checked })}
              />
              Mis OTs
            </label>
          )}

          <Button variant="ghost" size="sm" onClick={refresh} aria-label="Actualizar listado">
            <RefreshCw />
            Actualizar
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-muted-foreground">
          <span>
            {tabRows.length} {tabRows.length === 1 ? 'resultado' : 'resultados'}
            {activeFilterCount > 0
              ? ` · ${activeFilterCount} ${activeFilterCount === 1 ? 'filtro' : 'filtros'}`
              : ''}
          </span>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => applyFilters(defaults)}
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-14 text-[14px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando órdenes…
            </div>
          ) : error ? (
            <div className="px-6 py-10 text-center">
              <p className="text-[14px] text-destructive">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={refresh}>
                Reintentar
              </Button>
            </div>
          ) : tabRows.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[14px] text-muted-foreground">
                {activeFilterCount > 0
                  ? 'Sin resultados con los filtros aplicados.'
                  : TAB_EMPTY_TEXT[tab]}
              </p>
              {canCreate && (
                <Button
                  className="mt-4"
                  onClick={() =>
                    navigate(
                      `/app/ordenes/nueva?from=${encodeURIComponent(location.pathname + location.search)}`,
                    )
                  }
                >
                  <Plus />
                  Nueva OT
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead className="hidden md:table-cell">Tipo</TableHead>
                  <TableHead>Prioridad</TableHead>
                  <TableHead>Activo / componente</TableHead>
                  <TableHead className="hidden xl:table-cell">Ubicación</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="hidden md:table-cell">Técnicos</TableHead>
                  <TableHead className="hidden lg:table-cell">F. programada</TableHead>
                  <TableHead className="hidden md:table-cell">F. apertura</TableHead>
                  <TableHead className="hidden lg:table-cell">Origen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => {
                  const graceMs =
                    (row.plan_id ? planGrace.get(row.plan_id) ?? 0 : 0) * 86_400_000
                  const overdue =
                    row.wo_type === 'preventive' &&
                    !['closed', 'cancelled'].includes(row.status) &&
                    Boolean(row.scheduled_at) &&
                    new Date(row.scheduled_at as string).getTime() + graceMs < LIST_LOADED_AT.getTime()
                  return (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/app/ordenes/${row.id}`)}
                    >
                      <TableCell className="font-mono text-[12.5px] font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {row.wo_number}
                          {row.reassigned && (
                            <Badge variant="outline" className="text-[11px]">
                              re-asignada
                            </Badge>
                          )}
                          {row.multi_open && (
                            <Badge variant="outline" className="text-[11px]" title="El activo tiene más de una OT abierta">
                              multi-OT
                            </Badge>
                          )}
                          {overdue && (
                            <Badge variant="destructive" className="text-[11px]">
                              vencida
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                        {TYPE_LABELS[row.wo_type]}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.priority === 'urgent' ? 'destructive' : 'outline'}>
                          {PRIORITY_LABELS[row.priority]}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-[13px]">
                        {row.asset_code ? `${row.asset_code} — ${row.asset_name}` : '—'}
                        {row.component_name && (
                          <span className="text-muted-foreground"> · {row.component_name}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden max-w-[220px] truncate text-[13px] text-muted-foreground xl:table-cell">
                        {row.location_path ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={STATUS_BADGE_CLASS[row.status]}>
                          {STATUS_LABELS[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden max-w-[180px] truncate text-[13px] text-muted-foreground md:table-cell">
                        {row.tech_names ?? 'Sin asignar'}
                      </TableCell>
                      <TableCell className="hidden text-[13px] text-muted-foreground lg:table-cell">
                        {row.scheduled_at ? new Date(row.scheduled_at).toLocaleDateString('es-ES') : '—'}
                      </TableCell>
                      <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                        {new Date(row.reported_at).toLocaleDateString('es-ES')}
                      </TableCell>
                      <TableCell className="hidden text-[13px] text-muted-foreground lg:table-cell">
                        {ORIGIN_LABELS[row.origin]}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {!loading && !error && tabRows.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
            <span className="tabular-nums">
              {rangeStart}–{rangeEnd} de {tabRows.length}
            </span>
            <div className="flex items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(value) => applySize(Number(value))}
              >
                <SelectTrigger className="w-[120px]" aria-label="Cantidad por página">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} por página
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => applyPage(safePage - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => applyPage(safePage + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
