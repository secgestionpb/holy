import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  AUDIT_ACTION_LABELS,
  fetchAuditFor,
  formatDateTime,
  type AuditRow,
} from '@/lib/m1'
import { STATUS_BADGE_CLASS, STATUS_LABELS } from '@/lib/m2'
import { formatMoney } from '@/lib/m4'
import {
  AMOUNT_PERIOD_LABELS,
  CONTRACT_STATUS_LABELS,
  contractStatus,
  deleteProvider,
  deleteProviderFile,
  DOC_TYPE_LABELS,
  fetchContracts,
  fetchEvent11Days,
  fetchInterventions,
  fetchProvider,
  fetchProviderFiles,
  PROVIDER_TYPE_LABELS,
  signProviderFileUrl,
  updateProvider,
  uploadProviderFile,
  VISIT_FREQUENCY_LABELS,
  type ContractRow,
  type ContractStatus,
  type InterventionStats,
  type ProviderDocType,
  type ProviderFileRow,
  type ProviderRow,
} from '@/lib/m5'

const CONTRACT_STATUS_CLASS: Record<ContractStatus, string> = {
  vigente: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  por_vencer: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  vencido: 'bg-destructive/15 text-destructive',
  inactivo: 'bg-muted text-muted-foreground',
}

function formatDate(value: string): string {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function InfoPair({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-[14px] leading-snug">{value}</dd>
    </div>
  )
}

export default function ProveedorFicha() {
  const roles = useAuth((s) => s.roles)
  const canEdit = roles.includes('mantenimiento')
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab')
  const validTab = ['general', 'documentos', 'contratos', 'historial'].includes(initialTab ?? '')
    ? (initialTab as string)
    : 'general'

  const [provider, setProvider] = useState<ProviderRow | null>(null)
  const [files, setFiles] = useState<ProviderFileRow[]>([])
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [interventions, setInterventions] = useState<InterventionStats | null>(null)
  const [warnDays, setWarnDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [uploading, setUploading] = useState(false)
  const [uploadType, setUploadType] = useState<ProviderDocType>('other')
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    Promise.all([
      fetchProvider(id),
      fetchProviderFiles(id),
      fetchContracts(id),
      fetchAuditFor(id),
      fetchInterventions(id),
      fetchEvent11Days(),
    ])
      .then(([providerRow, fileRows, contractRows, auditRows, stats, days]) => {
        if (!alive) return
        if (!providerRow) {
          setError('Proveedor inexistente o sin permiso de lectura.')
          return
        }
        setProvider(providerRow)
        setFiles(fileRows)
        setContracts(contractRows)
        setAudit(auditRows)
        setInterventions(stats)
        setWarnDays(days)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'No se pudo cargar la ficha.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id, reloadKey])

  function refresh() {
    setError(null)
    setLoading(true)
    setReloadKey((key) => key + 1)
  }

  async function toggleActive() {
    if (!provider) return
    setBusy(true)
    const result = await updateProvider(provider.id, { is_active: !provider.is_active })
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success(provider.is_active ? 'Proveedor inactivado.' : 'Proveedor activado.')
    refresh()
  }

  async function handleDelete() {
    if (!provider) return
    const confirmed = window.confirm(
      `¿Eliminar «${provider.name}»? Solo es posible si no tiene OTs, contratos ni referencias; de lo contrario, inactívello.`,
    )
    if (!confirmed) return
    setBusy(true)
    const result = await deleteProvider(provider.id)
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Proveedor eliminado.')
    navigate('/app/proveedores')
  }

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !provider) return
    setUploading(true)
    const result = await uploadProviderFile(provider.id, file, uploadType)
    setUploading(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Documento subido.')
    refresh()
  }

  async function openFile(file: ProviderFileRow) {
    const url = await signProviderFileUrl(file.path)
    if (!url) {
      toast.error('No se pudo abrir el archivo.')
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  async function removeFile(file: ProviderFileRow) {
    if (!window.confirm(`¿Eliminar «${file.original_name}»? Esta acción no se puede deshacer.`)) return
    const result = await deleteProviderFile(file)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Documento eliminado.')
    refresh()
  }

  if (loading) {
    return (
      <main className="flex items-center justify-center gap-2 px-6 py-24 text-[14px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando ficha…
      </main>
    )
  }

  if (error || !provider) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-[14px] text-destructive">{error ?? 'Proveedor no encontrado.'}</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/app/proveedores')}>
            <ArrowLeft />
            Volver al listado
          </Button>
        </div>
      </main>
    )
  }

  const activeContracts = contracts.filter((row) => row.is_active)

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          onClick={() => navigate('/app/proveedores')}
        >
          <ArrowLeft className="size-3.5" />
          Volver al listado
        </button>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Módulo 5 · Ficha de proveedor
            </p>
            <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
              {provider.name}
            </h1>
            <p className="mt-1 font-mono text-[14px] text-muted-foreground">{provider.code}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{PROVIDER_TYPE_LABELS[provider.provider_type]}</Badge>
              <Badge variant="outline">
                {provider.service_category?.name ?? 'Sin categoría de servicio'}
              </Badge>
              <Badge variant={provider.is_active ? 'secondary' : 'outline'}>
                {provider.is_active ? 'Activo' : 'Inactivo'}
              </Badge>
              {activeContracts.length > 0 && (
                <Badge variant="secondary">
                  {activeContracts.length}{' '}
                  {activeContracts.length === 1 ? 'contrato vigente' : 'contratos vigentes'}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canEdit}
              title={canEdit ? undefined : 'Solo Mantenimiento gestiona proveedores.'}
              onClick={() => navigate(`/app/proveedores/${provider.id}/editar`)}
            >
              <Pencil />
              Editar
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canEdit || busy}
              title={canEdit ? undefined : 'Solo Mantenimiento gestiona proveedores.'}
              onClick={() => void toggleActive()}
            >
              <Power />
              {provider.is_active ? 'Inactivar' : 'Activar'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canEdit || busy}
              title={
                !canEdit
                  ? 'Solo Mantenimiento gestiona proveedores.'
                  : 'Eliminar solo si no tiene OTs ni contratos.'
              }
              onClick={() => void handleDelete()}
            >
              <Trash2 />
              Eliminar
            </Button>
            <Button variant="ghost" size="sm" onClick={refresh} aria-label="Actualizar ficha">
              <RefreshCw />
            </Button>
          </div>
        </div>

        <Tabs defaultValue={validTab} className="mt-8">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="documentos">Documentos ({files.length})</TabsTrigger>
            <TabsTrigger value="contratos">Contratos ({contracts.length})</TabsTrigger>
            <TabsTrigger value="historial">
              Historial de intervención ({interventions?.total ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-6 space-y-5">
            <section className="rounded-lg border border-border p-5">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                <InfoPair label="Contacto principal" value={provider.contact_name ?? '—'} />
                <InfoPair label="Teléfono" value={provider.contact_phone ?? '—'} />
                <InfoPair label="Correo" value={provider.contact_email ?? '—'} />
                <InfoPair label="Dirección" value={provider.address ?? '—'} />
                <InfoPair label="Categoría de servicio" value={provider.service_category?.name ?? '—'} />
                <InfoPair label="Creado" value={formatDateTime(provider.created_at)} />
                <InfoPair label="Última modificación" value={formatDateTime(provider.updated_at)} />
              </dl>

              {provider.notes && (
                <div className="mt-6 border-t border-border pt-5">
                  <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
                    Observaciones
                  </p>
                  <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {provider.notes}
                  </p>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border">
              <div className="border-b border-border px-5 py-4">
                <p className="text-[15px] font-semibold">
                  {audit.length} {audit.length === 1 ? 'movimiento registrado' : 'movimientos registrados'}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Historial de estado: auditoría inmutable (audit_log) de esta entidad.
                </p>
              </div>
              {audit.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-muted-foreground">
                    Todavía no hay movimientos en esta ficha.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {audit.map((row) => (
                    <li key={row.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Badge variant="outline">
                          {AUDIT_ACTION_LABELS[row.action] ?? row.action}
                        </Badge>
                        <span className="text-[13.5px] font-medium">
                          {row.actor_name ?? (row.user_id ? 'Usuario eliminado' : 'Sistema')}
                        </span>
                        <span className="text-[12.5px] text-muted-foreground">
                          {formatDateTime(row.created_at)}
                        </span>
                      </div>
                      {row.reason && (
                        <p className="mt-1.5 text-[13px] text-muted-foreground">
                          Motivo: {row.reason}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>

          <TabsContent value="documentos" className="mt-6">
            <section className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-[15px] font-semibold">
                    {files.length} {files.length === 1 ? 'documento' : 'documentos'}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Contratos marco, certificaciones y pólizas en el bucket «documentos» (enlace
                    firmado de 1 hora).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={uploadType} onValueChange={(value) => setUploadType(value as ProviderDocType)}>
                    <SelectTrigger className="w-[170px]" aria-label="Tipo de documento">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(DOC_TYPE_LABELS) as Array<[ProviderDocType, string]>).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(event) => void onPickFile(event)}
                  />
                  <Button
                    size="sm"
                    disabled={!canEdit || uploading}
                    title={canEdit ? undefined : 'Solo Mantenimiento sube documentos.'}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                    Subir documento
                  </Button>
                </div>
              </div>

              {files.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-muted-foreground">Sin documentos cargados.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {files.map((file) => (
                    <li
                      key={file.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-medium">{file.original_name}</p>
                          <p className="text-[12.5px] text-muted-foreground">
                            <Badge variant="secondary" className="mr-2 text-[11px]">
                              {DOC_TYPE_LABELS[file.doc_type]}
                            </Badge>
                            {formatDateTime(file.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => void openFile(file)}>
                          Abrir
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Eliminar ${file.original_name}`}
                          disabled={!canEdit}
                          onClick={() => void removeFile(file)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>

          <TabsContent value="contratos" className="mt-6">
            <section className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-[15px] font-semibold">
                    {contracts.length} {contracts.length === 1 ? 'contrato' : 'contratos'}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    El estado se deriva de la vigencia con {warnDays} días de anticipación (config
                    del Evento 11).
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={!canEdit}
                  title={canEdit ? undefined : 'Solo Mantenimiento gestiona contratos.'}
                  onClick={() => navigate(`/app/proveedores/${provider.id}/contratos/nuevo`)}
                >
                  <Plus />
                  Nuevo contrato
                </Button>
              </div>

              {contracts.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-muted-foreground">Sin contratos registrados.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead className="hidden lg:table-cell">Alcance</TableHead>
                        <TableHead>Vigencia</TableHead>
                        <TableHead className="hidden md:table-cell">Costo</TableHead>
                        <TableHead className="hidden xl:table-cell">Visitas</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="w-[52px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contracts.map((row) => {
                        const status = contractStatus(row, warnDays)
                        return (
                          <TableRow
                            key={row.id}
                            className="cursor-pointer"
                            onClick={() =>
                              navigate(`/app/proveedores/${provider.id}/contratos/${row.id}`)
                            }
                          >
                            <TableCell className="font-medium">{row.name}</TableCell>
                            <TableCell className="hidden max-w-[260px] truncate text-[13px] text-muted-foreground lg:table-cell">
                              {row.scope ?? '—'}
                            </TableCell>
                            <TableCell className="text-[13px] whitespace-nowrap">
                              {formatDate(row.start_date)} → {formatDate(row.end_date)}
                            </TableCell>
                            <TableCell className="hidden text-[13px] md:table-cell">
                              {row.amount !== null ? (
                                <span className="tabular-nums">
                                  {formatMoney(row.amount)}{' '}
                                  <span className="text-muted-foreground">
                                    / {AMOUNT_PERIOD_LABELS[row.amount_period].toLowerCase()}
                                  </span>
                                </span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className="hidden text-[13px] text-muted-foreground xl:table-cell">
                              {row.visit_frequency
                                ? VISIT_FREQUENCY_LABELS[row.visit_frequency]
                                : '—'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={CONTRACT_STATUS_CLASS[status]}>
                                {CONTRACT_STATUS_LABELS[status]}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Editar ${row.name}`}
                                disabled={!canEdit}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  navigate(`/app/proveedores/${provider.id}/contratos/${row.id}`)
                                }}
                              >
                                <Pencil />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="historial" className="mt-6 space-y-5">
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-5">
                <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
                  OTs totales
                </p>
                <p className="font-heading mt-1 text-[26px] font-extrabold tabular-nums">
                  {interventions?.total ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-border p-5">
                <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
                  OTs últimos 12 meses
                </p>
                <p className="font-heading mt-1 text-[26px] font-extrabold tabular-nums">
                  {interventions?.last12 ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-border p-5">
                <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
                  Costo acumulado (servicio externo)
                </p>
                <p className="font-heading mt-1 text-[26px] font-extrabold tabular-nums">
                  {formatMoney(interventions?.cost12 ?? 0)}
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-border">
              <div className="border-b border-border px-5 py-4">
                <p className="text-[15px] font-semibold">
                  {(interventions?.rows.length ?? 0)}{' '}
                  {(interventions?.rows.length ?? 0) === 1 ? 'intervención' : 'intervenciones'}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Todas las OTs ejecutadas por este tercero (F5.3). Click en una fila abre la OT.
                </p>
              </div>

              {!interventions || interventions.rows.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-muted-foreground">
                    Este proveedor aún no tiene intervenciones registradas.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>OT</TableHead>
                        <TableHead className="hidden md:table-cell">Activo / ubicación</TableHead>
                        <TableHead className="text-right">Costo externo</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {interventions.rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/app/ordenes/${row.id}`)}
                        >
                          <TableCell className="text-[13px] whitespace-nowrap">
                            {formatDate(row.created_at.slice(0, 10))}
                          </TableCell>
                          <TableCell className="font-mono text-[12.5px] font-medium">
                            {row.wo_number}
                          </TableCell>
                          <TableCell className="hidden max-w-[260px] truncate text-[13px] md:table-cell">
                            {row.asset ? (
                              <span>
                                <span className="font-mono text-[12px] text-muted-foreground">
                                  {row.asset.code}
                                </span>{' '}
                                {row.asset.name}
                                {row.asset.location && (
                                  <span className="text-muted-foreground"> · {row.asset.location.name}</span>
                                )}
                              </span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-right text-[13px] tabular-nums">
                            {row.external_cost !== null ? formatMoney(row.external_cost) : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={
                                STATUS_BADGE_CLASS[row.status as keyof typeof STATUS_BADGE_CLASS]
                              }
                            >
                              {STATUS_LABELS[row.status as keyof typeof STATUS_LABELS] ?? row.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}
