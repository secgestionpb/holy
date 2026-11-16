import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { Loader2, Plus, RefreshCw, Search, TriangleAlert } from 'lucide-react'
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
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import {
  DAMAGE_STATUS_LABELS,
  discardDamageReport,
  fetchDamageEvidence,
  fetchDamageReports,
  type DamageRow,
  type DamageStatus,
  type WoEvidenceRow,
} from '@/lib/m2'
import { DamageDetailDialog } from '@/components/ordenes/damage-detail-dialog'
import { DamageReportDialog } from '@/components/ordenes/damage-report-dialog'

type DatePreset = 'hoy' | '7' | '30' | 'custom' | 'none'

type Filters = {
  q: string
  st: string
  dp: DatePreset
  dfrom: string
  dto: string
}

const PAGE_SIZES = [20, 40, 60, 100]

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  hoy: 'Hoy',
  '7': 'Últimos 7 días',
  '30': 'Últimos 30 días',
  custom: 'Personalizado',
  none: 'Sin límite',
}

const DR_STATUS_CLASS: Record<DamageStatus, string> = {
  pending_review: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  converted: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  discarded: 'bg-destructive/15 text-destructive',
}

function defaultFilters(): Filters {
  return { q: '', st: 'todos', dp: '30', dfrom: '', dto: '' }
}

function readFilters(params: URLSearchParams): Filters {
  const base = defaultFilters()
  const dpRaw = params.get('dp')
  return {
    q: params.get('q') ?? base.q,
    st: params.get('st') ?? base.st,
    dp:
      dpRaw && (['hoy', '7', '30', 'custom', 'none'] as string[]).includes(dpRaw)
        ? (dpRaw as DatePreset)
        : base.dp,
    dfrom: params.get('dfrom') ?? '',
    dto: params.get('dto') ?? '',
  }
}

function serializeFilters(filters: Filters, defaults: Filters): Record<string, string> {
  const out: Record<string, string> = {}
  if (filters.q) out.q = filters.q
  if (filters.st !== defaults.st) out.st = filters.st
  if (filters.dp !== defaults.dp) out.dp = filters.dp
  if (filters.dfrom) out.dfrom = filters.dfrom
  if (filters.dto) out.dto = filters.dto
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

export default function ReportesDano() {
  const roles = useAuth((s) => s.roles)
  const isMaintenance = roles.includes('mantenimiento')
  const isAdminUser = roles.includes('administrador')
  const restrictedView = !isMaintenance && !isAdminUser
  const canCreate = !isAdminUser
  const canReview = isMaintenance
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { refreshPendingReports } = useOutletContext<{ refreshPendingReports: () => void }>()

  const defaults = useMemo(() => defaultFilters(), [])
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const pageSize = PAGE_SIZES.includes(Number(searchParams.get('size')))
    ? Number(searchParams.get('size'))
    : 20
  const [filters, setFilters] = useState<Filters>(() => readFilters(searchParams))

  const [rows, setRows] = useState<DamageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEvidence, setSelectedEvidence] = useState<WoEvidenceRow[]>([])
  const [newOpen, setNewOpen] = useState(() => searchParams.get('nuevo') === '1')

  useEffect(() => {
    let alive = true
    fetchDamageReports()
      .then((reportRows) => {
        if (!alive) return
        setRows(reportRows)
      })
      .catch((err: unknown) => {
        if (alive) {
          setLoading(false)
          setError(err instanceof Error ? err.message : 'Error al cargar los reportes.')
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  useEffect(() => {
    if (!selectedId) return
    let alive = true
    void fetchDamageEvidence(selectedId)
      .then((entries) => {
        if (alive) setSelectedEvidence(entries)
      })
      .catch(() => {
        if (alive) setSelectedEvidence([])
      })
    return () => {
      alive = false
    }
  }, [selectedId])

  function refresh() {
    setLoading(true)
    setError(null)
    setReloadKey((key) => key + 1)
    refreshPendingReports()
  }

  function applyFilters(patch: Partial<Filters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    setSearchParams({ ...serializeFilters(next, defaults) }, { replace: true })
  }

  function applyPage(nextPage: number) {
    const params = serializeFilters(filters, defaults)
    if (nextPage > 1) params.page = String(nextPage)
    if (pageSize !== 20) params.size = String(pageSize)
    setSearchParams(params, { replace: true })
  }

  function applySize(nextSize: number) {
    setSearchParams(
      { ...serializeFilters(filters, defaults), size: String(nextSize) },
      { replace: true },
    )
  }

  function openNew() {
    setNewOpen(true)
    if (searchParams.get('nuevo') !== '1') {
      setSearchParams({ ...serializeFilters(filters, defaults), nuevo: '1' }, { replace: true })
    }
  }

  const filtered = useMemo(() => {
    const query = filters.q.trim().toLowerCase()
    const { from, to } = dateRange(filters)
    return rows.filter((row) => {
      if (
        query &&
        !row.report_ref.toLowerCase().includes(query) &&
        !(row.asset_code ?? '').toLowerCase().includes(query) &&
        !(row.asset_name ?? '').toLowerCase().includes(query) &&
        !(row.location ?? '').toLowerCase().includes(query) &&
        !row.description.toLowerCase().includes(query)
      ) {
        return false
      }
      if (from || to) {
        const value = new Date(row.reported_at)
        if (from && value < from) return false
        if (to && value > to) return false
      }
      if (filters.st !== 'todos' && row.status !== filters.st) return false
      return true
    })
  }, [rows, filters])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1
  const rangeEnd = Math.min(safePage * pageSize, filtered.length)
  const pendingCount = rows.filter((row) => row.status === 'pending_review').length
  const selected = rows.find((row) => row.id === selectedId) ?? null
  const activeFilterCount = (filters.q ? 1 : 0) + (filters.st !== 'todos' ? 1 : 0) + (filters.dp !== defaults.dp ? 1 : 0)

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Módulo 2 · Reportes de daño
            </p>
            <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
              Bandeja de reportes de daño
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              {rows.length} {rows.length === 1 ? 'reporte' : 'reportes'}
              {pendingCount > 0 ? ` · ${pendingCount} pendiente${pendingCount === 1 ? '' : 's'} de revisión` : ''}
              {restrictedView ? ' · solo tus reportes' : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canCreate && (
              <Button size="sm" onClick={openNew}>
                <Plus />
                Nuevo reporte
              </Button>
            )}
          </div>
        </div>

        {restrictedView && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[12.5px] text-muted-foreground">
            <TriangleAlert className="size-3.5" />
            Ves únicamente tus propios reportes (no se puede desactivar).
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar reporte, localización o descripción"
              placeholder="Buscar referencia, localización o descripción…"
              className="pl-9"
              value={filters.q}
              onChange={(event) => applyFilters({ q: event.target.value })}
            />
          </div>

          <Select value={filters.st} onValueChange={(value) => applyFilters({ st: value })}>
            <SelectTrigger className="w-[195px]" aria-label="Estado del reporte">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Estado (todos)</SelectItem>
              {(Object.entries(DAMAGE_STATUS_LABELS) as Array<[DamageStatus, string]>).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>

          <Select value={filters.dp} onValueChange={(value) => applyFilters({ dp: value as DatePreset })}>
            <SelectTrigger className="w-[165px]" aria-label="Filtro de fecha">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(DATE_PRESET_LABELS) as Array<[DatePreset, string]>).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
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

          <Button variant="ghost" size="sm" onClick={refresh} aria-label="Actualizar listado">
            <RefreshCw />
            Actualizar
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-muted-foreground">
          <span>
            {filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}
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
              Cargando reportes…
            </div>
          ) : error ? (
            <div className="px-6 py-10 text-center">
              <p className="text-[14px] text-destructive">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={refresh}>
                Reintentar
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[14px] text-muted-foreground">
                {activeFilterCount > 0
                  ? 'Sin resultados con los filtros aplicados.'
                  : 'Aún no has reportado daños en los activos.'}
              </p>
              {canCreate && (
                <Button className="mt-4" onClick={openNew}>
                  <TriangleAlert />
                  Reportar daño
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="hidden md:table-cell">Fecha</TableHead>
                  <TableHead className="hidden lg:table-cell">Reportado por</TableHead>
                  <TableHead>Activo / componente</TableHead>
                  <TableHead className="hidden xl:table-cell">Ubicación</TableHead>
                  <TableHead className="hidden md:table-cell">Descripción</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="hidden md:table-cell">OT derivada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(row.id)}
                  >
                    <TableCell className="font-mono text-[12.5px] font-medium">
                      {row.report_ref}
                    </TableCell>
                    <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                      {new Date(row.reported_at).toLocaleDateString('es-ES')}
                    </TableCell>
                    <TableCell className="hidden text-[13px] text-muted-foreground lg:table-cell">
                      {row.reporter_name ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-[13px]">
                      {row.asset_code ? `${row.asset_code} — ${row.asset_name}` : '—'}
                      {row.component_name && (
                        <span className="text-muted-foreground"> · {row.component_name}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-[220px] truncate text-[13px] text-muted-foreground xl:table-cell">
                      {row.location ?? row.location_path ?? '—'}
                    </TableCell>
                    <TableCell className="hidden max-w-[320px] truncate text-[13px] md:table-cell">
                      {row.description}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={DR_STATUS_CLASS[row.status]}>
                        {DAMAGE_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden font-mono text-[12.5px] md:table-cell">
                      {row.wo_number ? (
                        <button
                          type="button"
                          className="text-primary underline-offset-2 hover:underline"
                          onClick={(event) => {
                            event.stopPropagation()
                            if (row.wo_id) navigate(`/app/ordenes/${row.wo_id}`)
                          }}
                        >
                          {row.wo_number}
                        </button>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {!loading && !error && filtered.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
            <span className="tabular-nums">
              {rangeStart}–{rangeEnd} de {filtered.length}
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

      {selected && (
        <DamageDetailDialog
          report={selected}
          evidence={selectedEvidence}
          canReview={canReview}
          onConvert={(report) => {
            setSelectedId(null)
            navigate(
              `/app/ordenes/nueva?report=${report.id}&from=${encodeURIComponent('/app/reportes-dano')}`,
            )
          }}
          onDiscard={async (report, reason) => {
            const result = await discardDamageReport(report.id, reason)
            if (!result.ok) return result.message
            toast.success('Reporte descartado.')
            setSelectedId(null)
            refresh()
            return null
          }}
          onClose={() => setSelectedId(null)}
        />
      )}

      {newOpen && (
        <DamageReportDialog
          open
          onOpenChange={(open) => {
            setNewOpen(open)
            if (!open && searchParams.get('nuevo') === '1') {
              const next = serializeFilters(filters, defaults)
              setSearchParams(next, { replace: true })
            }
          }}
          onSaved={() => {
            toast.success('Reporte de daño enviado a Mantenimiento.')
            refresh()
          }}
        />
      )}
    </main>
  )
}
