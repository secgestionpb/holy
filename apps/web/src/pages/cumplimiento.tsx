import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Eye, Loader2, Plus, RefreshCw, Search } from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TrendChart } from '@/components/compliance/trend-chart'
import { MeasurementDetailDialog } from '@/components/compliance/measurement-detail-dialog'
import { RecordMeasurementDialog } from '@/components/compliance/record-measurement-dialog'
import { useAuth } from '@/lib/auth-store'
import {
  CERT_BADGE_CLASS,
  CERT_STATUS_LABELS,
  FREQUENCY_LABELS,
  RESULT_LABELS,
  UNIT_LABELS,
  certStatus,
  fetchAssetsLite,
  fetchCertifications,
  fetchComplianceCategories,
  fetchEvent8Lead,
  fetchMeasurementRecords,
  fetchMeasurementTypes,
  fetchMissingMeasurements,
  formatDateTime,
  formatNumber,
  type CertStatus,
  type CertificationRow,
  type ComplianceCategoryRow,
  type MeasurementRecordRow,
  type MeasurementResult,
  type MeasurementTypeRow,
  type MissingMeasurementRow,
} from '@/lib/m6'

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'todos', label: 'Todos los estados' },
  { value: 'valid', label: CERT_STATUS_LABELS.valid },
  { value: 'expiring', label: CERT_STATUS_LABELS.expiring },
  { value: 'expired', label: CERT_STATUS_LABELS.expired },
]

function CertificateList({
  certs,
  globalLead,
  onOpen,
}: {
  certs: CertificationRow[]
  globalLead: number | null
  onOpen: (id: string) => void
}) {
  if (certs.length === 0) {
    return (
      <p className="py-10 text-center text-[13.5px] text-muted-foreground">Sin certificaciones registradas.</p>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Categoría normativa</TableHead>
            <TableHead>Activo</TableHead>
            <TableHead>Entidad emisora</TableHead>
            <TableHead>Nº certificado</TableHead>
            <TableHead>Vencimiento</TableHead>
            <TableHead>Responsable</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {certs.map((c) => {
            const status = certStatus(c, globalLead)
            return (
              <TableRow key={c.id} onClick={() => onOpen(c.id)} className="cursor-pointer">
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.compliance_category?.name ?? '—'}</TableCell>
                <TableCell>{c.asset ? `${c.asset.code} — ${c.asset.name}` : 'General — todo el hotel'}</TableCell>
                <TableCell>{c.issuing_entity ?? '—'}</TableCell>
                <TableCell>{c.certificate_number ?? '—'}</TableCell>
                <TableCell className="tabular-nums">{formatDateTime(c.expires_at)}</TableCell>
                <TableCell>{c.provider?.name ?? '—'}</TableCell>
                <TableCell>
                  <Badge className={CERT_BADGE_CLASS[status]}>{CERT_STATUS_LABELS[status]}</Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Ver ${c.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(c.id)
                    }}
                  >
                    <Eye className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function MissingBadge({ missing }: { missing: MissingMeasurementRow[] }) {
  const [open, setOpen] = useState(false)
  if (missing.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
        Sin mediciones faltantes
      </span>
    )
  }
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[12px] font-medium text-amber-600 dark:text-amber-400"
      >
        <AlertTriangle className="size-3.5" />
        Mediciones faltantes: {missing.length}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-2 max-h-72 w-[380px] overflow-auto rounded-lg border bg-popover p-2 shadow-lg">
          <ul className="divide-y">
            {missing.map((m) => (
              <li key={`${m.type_id}:${m.asset_id}`} className="px-2 py-1.5 text-[12.5px]">
                <p className="font-medium">
                  {m.type_name} · {m.asset_code}
                </p>
                <p className="text-muted-foreground">
                  {m.last_measured_at
                    ? `Última: ${formatDateTime(m.last_measured_at)} · atraso ~${m.days_overdue ?? 0} días`
                    : 'Nunca registrada'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function Cumplimiento() {
  const roles = useAuth((s) => s.roles)
  const isQuality = roles.includes('calidad')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const tab = searchParams.get('tab') === 'mediciones' ? 'mediciones' : 'certificaciones'
  const sub = searchParams.get('sub') === 'tipos' ? 'tipos' : 'records'

  const [certs, setCerts] = useState<CertificationRow[]>([])
  const [categories, setCategories] = useState<ComplianceCategoryRow[]>([])
  const [globalLead, setGlobalLead] = useState<number | null>(null)
  const [types, setTypes] = useState<MeasurementTypeRow[]>([])
  const [records, setRecords] = useState<MeasurementRecordRow[]>([])
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof fetchAssetsLite>>>([])
  const [missing, setMissing] = useState<MissingMeasurementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [q, setQ] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('todas')
  const [statusFilter, setStatusFilter] = useState('todos')
  const [withinDays, setWithinDays] = useState('')

  const [recTypeId, setRecTypeId] = useState('todos')
  const [recAssetId, setRecAssetId] = useState('todos')
  const [recFrom, setRecFrom] = useState('')
  const [recTo, setRecTo] = useState('')

  const [recordDialogOpen, setRecordDialogOpen] = useState(false)
  const [detailRecord, setDetailRecord] = useState<MeasurementRecordRow | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      fetchCertifications(),
      fetchComplianceCategories(),
      fetchEvent8Lead(),
      fetchMeasurementTypes(),
      fetchAssetsLite(),
      fetchMissingMeasurements(),
    ])
      .then(([certRows, catRows, lead, typeRows, assetRows, missingRows]) => {
        if (!alive) return
        setCerts(certRows)
        setCategories(catRows)
        setGlobalLead(lead)
        setTypes(typeRows)
        setAssets(assetRows)
        setMissing(missingRows)
        setError(null)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'No se pudo cargar el módulo.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  useEffect(() => {
    if (tab !== 'mediciones') return
    let alive = true
    const filters: Parameters<typeof fetchMeasurementRecords>[0] = {}
    if (recTypeId !== 'todos') filters.typeId = recTypeId
    if (recAssetId !== 'todos') filters.assetId = recAssetId
    if (recFrom) filters.from = recFrom
    if (recTo) filters.to = recTo
    fetchMeasurementRecords(filters)
      .then((rows) => {
        if (alive) setRecords(rows)
      })
      .catch(() => {
        if (alive) setRecords([])
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, recTypeId, recAssetId, recFrom, recTo, reloadKey])

  const filteredCerts = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const within = Number(withinDays) || null
    return certs.filter((c) => {
      if (categoryFilter !== 'todas' && c.compliance_category_id !== categoryFilter) return false
      if (statusFilter !== 'todos' && certStatus(c, globalLead) !== (statusFilter as CertStatus)) return false
      if (within !== null) {
        const exp = new Date(`${c.expires_at}T03:00:00`)
        const limit = new Date()
        limit.setDate(limit.getDate() + within)
        if (exp > limit) return false
      }
      if (needle) {
        const hay = `${c.name} ${c.certificate_number ?? ''} ${c.issuing_entity ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [certs, categoryFilter, globalLead, q, statusFilter, withinDays])

  const trendType = useMemo(
    () => types.find((t) => t.id === recTypeId) ?? null,
    [recTypeId, types],
  )
  const trendRecords = useMemo(() => {
    if (!trendType) return []
    return records.filter((r) => r.measurement_type_id === trendType.id)
  }, [records, trendType])

  const activeTypeAssets = useMemo(() => {
    if (!trendType) return []
    return assets.filter((a) => a.category_id === trendType.category_id)
  }, [assets, trendType])

  const certCount = filteredCerts.length

  function setTab(value: string) {
    const next = new URLSearchParams(searchParams)
    next.set('tab', value)
    if (value === 'mediciones') next.set('sub', sub)
    setSearchParams(next, { replace: true })
  }

  function setSub(value: string) {
    const next = new URLSearchParams(searchParams)
    next.set('tab', 'mediciones')
    next.set('sub', value)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted-foreground">Cumplimiento normativo y mediciones</p>
          <h1 className="text-2xl font-semibold tracking-tight">Cumplimiento</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw className="size-4" />
          Actualizar
        </Button>
      </div>

      {error && <p className="text-[13px] text-destructive">{error}</p>}
      {toast && (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-600 dark:text-emerald-400">
          {toast}
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="certificaciones">Certificaciones</TabsTrigger>
          <TabsTrigger value="mediciones">Mediciones</TabsTrigger>
        </TabsList>

        <TabsContent value="certificaciones" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar por nombre, nº o entidad…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Buscar certificaciones"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[210px]" aria-label="Categoría normativa">
                <SelectValue placeholder="Categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las categorías</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]" aria-label="Estado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={1}
              className="w-[150px]"
              placeholder="Vence en N días"
              value={withinDays}
              onChange={(e) => setWithinDays(e.target.value)}
              aria-label="Vence en los próximos N días"
            />
            {isQuality && (
              <Button onClick={() => navigate('/app/cumplimiento/certificaciones/nueva')}>
                <Plus className="size-4" />
                Nueva certificación
              </Button>
            )}
          </div>

          <p className="text-[12.5px] text-muted-foreground">
            {loading ? 'Cargando…' : `${certCount} certificacion${certCount === 1 ? '' : 'es'}`}
          </p>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : (
            <CertificateList
              certs={filteredCerts}
              globalLead={globalLead}
              onOpen={(id) => navigate(`/app/cumplimiento/certificaciones/${id}`)}
            />
          )}
        </TabsContent>

        <TabsContent value="mediciones" className="space-y-4">
          <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
            <button
              type="button"
              onClick={() => setSub('records')}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
                sub === 'records' ? 'bg-background shadow' : 'text-muted-foreground'
              }`}
            >
              Registro y Tendencias
            </button>
            <button
              type="button"
              onClick={() => setSub('tipos')}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
                sub === 'tipos' ? 'bg-background shadow' : 'text-muted-foreground'
              }`}
            >
              Tipos de medición
            </button>
          </div>

          {sub === 'records' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {isQuality && (
                  <Button onClick={() => setRecordDialogOpen(true)}>
                    <Plus className="size-4" />
                    Registrar medición
                  </Button>
                )}
                {!loading && <MissingBadge missing={missing} />}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select value={recTypeId} onValueChange={setRecTypeId}>
                  <SelectTrigger className="w-[220px]" aria-label="Tipo de medición">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los tipos</SelectItem>
                    {types.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={recAssetId} onValueChange={setRecAssetId} disabled={!trendType}>
                  <SelectTrigger className="w-[240px]" aria-label="Activo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los activos</SelectItem>
                    {activeTypeAssets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  className="w-[160px]"
                  value={recFrom}
                  onChange={(e) => setRecFrom(e.target.value)}
                  aria-label="Desde"
                />
                <Input
                  type="date"
                  className="w-[160px]"
                  value={recTo}
                  onChange={(e) => setRecTo(e.target.value)}
                  aria-label="Hasta"
                />
              </div>

              {trendType ? (
                <TrendChart
                  records={trendRecords}
                  minValue={Number(trendType.min_value)}
                  maxValue={Number(trendType.max_value)}
                  unit={UNIT_LABELS[trendType.unit]}
                />
              ) : (
                <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed text-[13px] text-muted-foreground">
                  Selecciona un tipo de medición para ver la tendencia con su rango aceptable.
                </div>
              )}

              {loading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : records.length === 0 ? (
                <p className="py-8 text-center text-[13.5px] text-muted-foreground">Sin mediciones registradas.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha y hora</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Activo</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Resultado</TableHead>
                        <TableHead>Registrado por</TableHead>
                        <TableHead>Observaciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.map((r) => (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer"
                          onClick={() => setDetailRecord(r)}
                        >
                          <TableCell className="tabular-nums">{formatDateTime(r.measured_at)}</TableCell>
                          <TableCell>{r.measurement_type?.name ?? '—'}</TableCell>
                          <TableCell>{r.asset ? `${r.asset.code} — ${r.asset.name}` : '—'}</TableCell>
                          <TableCell className="tabular-nums">
                            {formatNumber(r.value)} {r.measurement_type?.unit ?? ''}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                r.result === 'out_of_range'
                                  ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              }
                            >
                              {RESULT_LABELS[r.result]}
                            </Badge>
                          </TableCell>
                          <TableCell>{r.recorder?.full_name ?? '—'}</TableCell>
                          <TableCell className="max-w-[220px] truncate">{r.notes ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {sub === 'tipos' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[12.5px] text-muted-foreground">{types.length} tipo(s) de medición</p>
                {isQuality && (
                  <Button onClick={() => navigate('/app/cumplimiento/tipos/nuevo')}>
                    <Plus className="size-4" />
                    Nuevo tipo
                  </Button>
                )}
              </div>
              {loading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : types.length === 0 ? (
                <p className="py-8 text-center text-[13.5px] text-muted-foreground">Sin tipos de medición registrados.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Categoría aplicable</TableHead>
                        <TableHead>Unidad</TableHead>
                        <TableHead>Rango</TableHead>
                        <TableHead>Frecuencia</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Registros</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {types.map((t) => (
                        <TableRow
                          key={t.id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/app/cumplimiento/tipos/${t.id}`)}
                        >
                          <TableCell className="font-medium">{t.name}</TableCell>
                          <TableCell>{t.category?.name ?? '—'}</TableCell>
                          <TableCell>{UNIT_LABELS[t.unit]}</TableCell>
                          <TableCell className="tabular-nums">
                            {formatNumber(t.min_value)} – {formatNumber(t.max_value)}
                          </TableCell>
                          <TableCell>{FREQUENCY_LABELS[t.frequency]}</TableCell>
                          <TableCell>
                            <Badge
                              className={
                                t.is_active
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-muted text-muted-foreground'
                              }
                            >
                              {t.is_active ? 'Activo' : 'Inactivo'}
                            </Badge>
                          </TableCell>
                          <TableCell className="tabular-nums">{t.record_count ?? 0}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Ver ${t.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate(`/app/cumplimiento/tipos/${t.id}`)
                              }}
                            >
                              <Eye className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <RecordMeasurementDialog
        open={recordDialogOpen}
        onOpenChange={setRecordDialogOpen}
        types={types}
        assets={assets}
        onSaved={(result: MeasurementResult) => {
          setToast(
            result === 'out_of_range'
              ? 'Medición registrada FUERA DE RANGO — se notificó a Mantenimiento y Calidad.'
              : 'Medición registrada dentro de rango.',
          )
          setReloadKey((k) => k + 1)
        }}
      />
      <MeasurementDetailDialog record={detailRecord} onOpenChange={(open) => { if (!open) setDetailRecord(null) }} />
    </div>
  )
}
