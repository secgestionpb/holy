import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Loader2,
  Lock,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { ComponentDialog } from '@/components/activos/component-dialog'
import { QrDialog } from '@/components/activos/qr-dialog'
import { StageDialog } from '@/components/activos/stage-dialog'
import { WarrantyDialog } from '@/components/activos/warranty-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  CRITICALITY_LABELS,
  ENGINE_STAGES,
  LIFESPAN_UNIT_LABELS,
  LIFE_STAGE_LABELS,
  OPERATIONAL_LABELS,
  fetchAsset,
  fetchAssetChildren,
  fetchAssetFiles,
  fetchAuditFor,
  fetchWarranties,
  deleteAssetFile,
  formatDate,
  formatDateTime,
  setLifeStage,
  signAssetFileUrl,
  updateAsset,
  uploadAssetFile,
  warrantyBadge,
  type AssetFileRow,
  type AssetRow,
  type AuditRow,
  type LifeStage,
  type WarrantyRow,
} from '@/lib/m1'
import {
  fetchAssetWorkOrders,
  PRIORITY_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
  TYPE_LABELS,
  type WoRow,
} from '@/lib/m2'

const STAGE_BADGE_CLASS: Record<LifeStage, string> = {
  no_warranty: 'bg-muted text-muted-foreground',
  under_warranty: 'bg-primary/15 text-primary',
  operational: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  pending_repair: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  requires_replacement: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
  decommissioned: 'bg-destructive/15 text-destructive',
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  code: 'Código',
  category_id: 'Categoría',
  location_id: 'Ubicación',
  criticality: 'Criticidad',
  operational_status: 'Estado operativo',
  life_stage: 'Etapa de vida',
  commissioning_date: 'Puesta en operación',
  expected_lifespan_value: 'Vida útil',
  lifespan_unit: 'Unidad',
  has_usage_counter: 'Contador de uso',
  responsible_user_id: 'Responsable',
  description: 'Descripción',
  notes: 'Notas',
  is_active: 'Activo',
  status: 'Estado',
  start_date: 'Inicio',
  end_date: 'Vencimiento',
  provider_name: 'Proveedor',
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

function diffOf(value: unknown): { old?: unknown; new?: unknown } {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as { old?: unknown; new?: unknown }
  }
  return { new: value }
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function InfoPair({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-[14px] leading-snug">{value}</dd>
    </div>
  )
}

export default function ActivoFicha() {
  const roles = useAuth((s) => s.roles)
  const canEdit = roles.includes('mantenimiento')
  const canSeeCosts = roles.includes('mantenimiento') || roles.includes('administrador')
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()

  const [asset, setAsset] = useState<AssetRow | null>(null)
  const [children, setChildren] = useState<AssetRow[]>([])
  const [warranties, setWarranties] = useState<WarrantyRow[]>([])
  const [files, setFiles] = useState<AssetFileRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [assetWos, setAssetWos] = useState<WoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [stageTarget, setStageTarget] = useState<LifeStage | null>(null)
  const [warrantyDialog, setWarrantyDialog] = useState<{ open: boolean; warranty: WarrantyRow | null }>({
    open: false,
    warranty: null,
  })
  const [componentDialog, setComponentDialog] = useState<{ open: boolean; component: AssetRow | null }>({
    open: false,
    component: null,
  })
  const [qrOpen, setQrOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    Promise.all([
      fetchAsset(id),
      fetchAssetChildren(id),
      fetchWarranties(id),
      fetchAssetFiles(id),
      fetchAuditFor(id),
      fetchAssetWorkOrders(id),
    ])
      .then(([assetRow, childRows, warrantyRows, fileRows, auditRows, woRows]) => {
        if (!alive) return
        if (!assetRow) {
          setError('Activo inexistente o sin permiso de lectura.')
          return
        }
        setAsset(assetRow)
        setChildren(childRows)
        setWarranties(warrantyRows)
        setFiles(fileRows)
        setAudit(auditRows)
        setAssetWos(woRows)
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

  async function handleStageSubmit(reason: string | undefined): Promise<string | null> {
    if (!asset || !stageTarget) return null
    const result = await setLifeStage(asset.id, stageTarget, reason)
    if (!result.ok) return result.message
    toast.success('Etapa de vida actualizada.')
    refresh()
    return null
  }

  async function toggleOperational(checked: boolean) {
    if (!asset) return
    setBusy(true)
    const result = await updateAsset(asset.id, {
      operational_status: checked ? 'operational' : 'inactive',
    })
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Estado operativo actualizado.')
    refresh()
  }

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !asset) return
    setUploading(true)
    const result = await uploadAssetFile(asset.id, file)
    setUploading(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Documento subido.')
    refresh()
  }

  async function openFile(file: AssetFileRow) {
    const url = await signAssetFileUrl(file.storage_path)
    if (!url) {
      toast.error('No se pudo abrir el archivo.')
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  async function removeFile(file: AssetFileRow) {
    if (!window.confirm(`¿Eliminar «${file.file_name}»? Esta acción no se puede deshacer.`)) return
    const result = await deleteAssetFile(file)
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

  if (error || !asset) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-[14px] text-destructive">{error ?? 'Activo no encontrado.'}</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/app/activos')}>
            <ArrowLeft />
            Volver al explorador
          </Button>
        </div>
      </main>
    )
  }

  const warranty = warrantyBadge(asset)
  const consumed = asset.lifespan_consumed ?? 0
  const remaining = asset.lifespan_remaining ?? 0
  const lifespanTotal = consumed + remaining
  const lifespanPct = lifespanTotal > 0 ? Math.min(100, Math.round((consumed / lifespanTotal) * 100)) : 0
  const unitLabel = asset.lifespan_unit ? LIFESPAN_UNIT_LABELS[asset.lifespan_unit] : ''
  const isEngineStage = (stage: LifeStage) => ENGINE_STAGES.includes(stage)

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          onClick={() => navigate(`/app/activos?loc=${asset.location_id}`)}
        >
          <ArrowLeft className="size-3.5" />
          Volver al explorador
        </button>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Módulo 1 · Ficha de activo
            </p>
            <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
              {asset.name}
            </h1>
            <p className="mt-1 font-mono text-[14px] text-muted-foreground">{asset.code}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant={asset.criticality === 'high' ? 'destructive' : 'outline'}>
                Criticidad {CRITICALITY_LABELS[asset.criticality]}
              </Badge>
              <Badge variant="outline">{OPERATIONAL_LABELS[asset.operational_status]}</Badge>
              <Badge variant="secondary" className={STAGE_BADGE_CLASS[asset.life_stage]}>
                {LIFE_STAGE_LABELS[asset.life_stage]}
              </Badge>
              <Badge variant={warranty.variant}>{warranty.label}</Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setQrOpen(true)}>
              <QrCode />
              QR
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canEdit}
              title={canEdit ? undefined : 'Solo Mantenimiento puede editar activos.'}
              onClick={() => navigate(`/app/activos/${asset.id}/editar`)}
            >
              <Pencil />
              Editar
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canEdit || asset.life_stage === 'decommissioned'}
              title={
                !canEdit
                  ? 'Solo Mantenimiento puede dar de baja activos.'
                  : asset.life_stage === 'decommissioned'
                    ? 'El activo ya está dado de baja.'
                    : 'Dar de baja el activo (F1.3).'
              }
              onClick={() => setStageTarget('decommissioned')}
            >
              <Trash2 />
              Baja
            </Button>
            <Button variant="ghost" size="sm" onClick={refresh} aria-label="Actualizar ficha">
              <RefreshCw />
            </Button>
          </div>
        </div>

        <Tabs defaultValue="general" className="mt-8">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="estado">Estado y vida útil</TabsTrigger>
            <TabsTrigger value="componentes">Componentes ({children.length})</TabsTrigger>
            <TabsTrigger value="garantias">Garantías ({warranties.length})</TabsTrigger>
            <TabsTrigger value="documentacion">Documentación ({files.length})</TabsTrigger>
            <TabsTrigger value="ots">
              Órdenes de trabajo ({assetWos.filter((row) => !['closed', 'cancelled'].includes(row.status)).length}/
              {assetWos.length})
            </TabsTrigger>
            {canSeeCosts && <TabsTrigger value="costos">Costos</TabsTrigger>}
            <TabsTrigger value="historial">Historial</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-6">
            <section className="rounded-lg border border-border p-5">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                <InfoPair label="Código" value={<span className="font-mono">{asset.code}</span>} />
                <InfoPair label="Categoría" value={asset.category_name ?? '—'} />
                <InfoPair label="Ubicación" value={asset.location_path ?? '—'} />
                <InfoPair label="Criticidad" value={CRITICALITY_LABELS[asset.criticality]} />
                <InfoPair label="Responsable" value={asset.responsible_name ?? '—'} />
                <InfoPair label="Puesta en operación" value={formatDate(asset.commissioning_date)} />
                <InfoPair label="Estado operativo" value={OPERATIONAL_LABELS[asset.operational_status]} />
                <InfoPair label="Etapa de vida" value={LIFE_STAGE_LABELS[asset.life_stage]} />
                <InfoPair
                  label="Vida útil esperada"
                  value={
                    asset.expected_lifespan_value !== null
                      ? `${asset.expected_lifespan_value} ${asset.lifespan_unit ? LIFESPAN_UNIT_LABELS[asset.lifespan_unit].toLowerCase() : ''}`.trim()
                      : '—'
                  }
                />
                <InfoPair label="Creado" value={formatDateTime(asset.created_at)} />
                <InfoPair label="Última modificación" value={formatDateTime(asset.updated_at)} />
              </dl>

              {(asset.description || asset.notes) && (
                <div className="mt-6 space-y-4 border-t border-border pt-5">
                  {asset.description && (
                    <div>
                      <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
                        Descripción
                      </p>
                      <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap">
                        {asset.description}
                      </p>
                    </div>
                  )}
                  {asset.notes && (
                    <div>
                      <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
                        Notas internas
                      </p>
                      <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                        {asset.notes}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="estado" className="mt-6 space-y-5">
            <section className="rounded-lg border border-border p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
                    Etapa de vida
                  </p>
                  <p className="max-w-xl text-[13px] leading-snug text-muted-foreground">
                    «{LIFE_STAGE_LABELS.no_warranty}» y «{LIFE_STAGE_LABELS.under_warranty}» las
                    asigna el motor de garantías (F1.4): aquí están bloqueadas. Las fases manuales
                    pasan por confirmación con motivo y auditoría (F1.3).
                  </p>
                </div>
                <Select
                  value={asset.life_stage}
                  onValueChange={(value) => {
                    if (value !== asset.life_stage) setStageTarget(value as LifeStage)
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="w-[230px]" aria-label="Cambiar etapa de vida">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(LIFE_STAGE_LABELS) as Array<[LifeStage, string]>).map(
                      ([value, label]) => {
                        const locked = isEngineStage(value) && value !== asset.life_stage
                        return (
                          <SelectItem key={value} value={value} disabled={locked}>
                            <span className="inline-flex items-center gap-1.5">
                              {locked && <Lock className="size-3.5 text-muted-foreground" />}
                              {label}
                              {isEngineStage(value) ? ' (motor)' : ''}
                            </span>
                          </SelectItem>
                        )
                      },
                    )}
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-5">
              <div className="space-y-1">
                <p className="text-[15px] font-semibold">Estado operativo</p>
                <p className="text-[13px] text-muted-foreground">
                  {asset.life_stage === 'decommissioned'
                    ? 'Mientras el activo esté dado de baja, el estado queda forzado a Inactivo.'
                    : 'Alterna entre Operativo e Inactivo sin mover la etapa de vida.'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[13.5px] text-muted-foreground">
                  {OPERATIONAL_LABELS[asset.operational_status]}
                </span>
                <Switch
                  checked={asset.operational_status === 'operational'}
                  onCheckedChange={(checked) => void toggleOperational(checked)}
                  disabled={
                    !canEdit ||
                    busy ||
                    asset.life_stage === 'decommissioned'
                  }
                  aria-label="Estado operativo"
                />
              </div>
            </section>

            <section className="rounded-lg border border-border p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[15px] font-semibold">Avance de vida útil</p>
                {asset.eol_reached && <Badge variant="destructive">Fin de vida útil</Badge>}
              </div>
              {asset.expected_lifespan_value === null ? (
                <p className="mt-3 text-[13.5px] text-muted-foreground">
                  Este activo no tiene vida útil definida. Asigna una en la edición para seguir su
                  consumo.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${
                        asset.eol_reached ? 'bg-destructive' : 'bg-primary'
                      }`}
                      style={{ width: `${lifespanPct}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 text-[13px] text-muted-foreground">
                    <span>
                      Consumido: {consumed} {unitLabel}
                      {asset.has_usage_counter && asset.usage_counter !== null
                        ? ` · contador: ${asset.usage_counter}`
                        : ''}
                    </span>
                    <span>
                      Restante: {remaining} {unitLabel} · {lifespanPct}%
                    </span>
                  </div>
                  {asset.usage_counter_updated_at && (
                    <p className="text-[12.5px] text-muted-foreground">
                      Contador actualizado: {formatDateTime(asset.usage_counter_updated_at)}
                    </p>
                  )}
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="componentes" className="mt-6">
            <section className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-[15px] font-semibold">
                    {children.length} {children.length === 1 ? 'componente' : 'componentes'}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Los componentes heredan la ubicación y tienen mini-ficha propia.
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={!canEdit || Boolean(asset.parent_id)}
                  title={
                    !canEdit
                      ? 'Solo Mantenimiento puede crear componentes.'
                      : asset.parent_id
                        ? 'Un componente no crea subcomponentes.'
                        : undefined
                  }
                  onClick={() => setComponentDialog({ open: true, component: null })}
                >
                  <Plus />
                  Nuevo componente
                </Button>
              </div>

              {children.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-muted-foreground">
                    Este activo todavía no tiene componentes.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {children.map((child) => (
                    <li
                      key={child.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium">
                          {child.name}
                          <span className="ml-2 font-mono text-[12.5px] text-muted-foreground">
                            {child.code}
                          </span>
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className={STAGE_BADGE_CLASS[child.life_stage]}>
                            {LIFE_STAGE_LABELS[child.life_stage]}
                          </Badge>
                          <span className="text-[12.5px] text-muted-foreground">
                            {OPERATIONAL_LABELS[child.operational_status]}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Editar ${child.name}`}
                          disabled={!canEdit}
                          onClick={() => setComponentDialog({ open: true, component: child })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Abrir ficha de ${child.name}`}
                          onClick={() => navigate(`/app/activos/${child.id}`)}
                        >
                          <ChevronRight />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>

          <TabsContent value="garantias" className="mt-6">
            <section className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-[15px] font-semibold">
                    {warranties.length} {warranties.length === 1 ? 'garantía' : 'garantías'}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Guardar recalcula la etapa de vida y reagenda el aviso por vencer (Evento 7).
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={!canEdit}
                  title={canEdit ? undefined : 'Solo Mantenimiento gestiona garantías.'}
                  onClick={() => setWarrantyDialog({ open: true, warranty: null })}
                >
                  <Plus />
                  Nueva garantía
                </Button>
              </div>

              {warranties.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-muted-foreground">
                    Sin garantías registradas: la etapa de vida vive en «{LIFE_STAGE_LABELS.no_warranty}»
                    u «{LIFE_STAGE_LABELS.operational}».
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="hidden md:table-cell">Proveedor</TableHead>
                      <TableHead className="hidden lg:table-cell">Cobertura</TableHead>
                      <TableHead>Inicio</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="hidden xl:table-cell">Aviso</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {warranties.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-[13.5px]">
                          {row.warranty_type === 'purchase' ? 'Compra' : 'Reparación'}
                        </TableCell>
                        <TableCell className="hidden max-w-[200px] truncate text-[13.5px] md:table-cell">
                          {row.provider_name ?? '—'}
                        </TableCell>
                        <TableCell className="hidden text-[13.5px] lg:table-cell">
                          {row.coverage === 'both'
                            ? 'Ambas'
                            : row.coverage === 'parts'
                              ? 'Piezas'
                              : 'Mano de obra'}
                        </TableCell>
                        <TableCell className="text-[13.5px]">{formatDate(row.start_date)}</TableCell>
                        <TableCell className="text-[13.5px]">{formatDate(row.end_date)}</TableCell>
                        <TableCell>
                          <Badge variant={row.status === 'active' ? 'default' : 'destructive'}>
                            {row.status === 'active' ? 'Vigente' : 'Vencida'}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-[13px] text-muted-foreground xl:table-cell">
                          {row.notified_at ? 'Enviado' : '—'}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Editar garantía"
                            disabled={!canEdit}
                            onClick={() => setWarrantyDialog({ open: true, warranty: row })}
                          >
                            <Pencil />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </TabsContent>

          <TabsContent value="documentacion" className="mt-6">
            <section className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-[15px] font-semibold">
                    {files.length} {files.length === 1 ? 'documento' : 'documentos'}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Manuales, fotos y planos en el bucket «activos» (abrir usa enlace firmado de 1
                    hora).
                  </p>
                </div>
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

              {files.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-muted-foreground">
                    Aún no hay documentos adjuntos en esta ficha.
                  </p>
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
                          <p className="truncate text-[14px] font-medium">{file.file_name}</p>
                          <p className="text-[12.5px] text-muted-foreground">
                            {formatBytes(file.file_size_bytes)} · {formatDateTime(file.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void openFile(file)}
                        >
                          Abrir
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Eliminar ${file.file_name}`}
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

          <TabsContent value="ots" className="mt-6">
            <section className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-[15px] font-semibold">
                    {assetWos.length} {assetWos.length === 1 ? 'OT' : 'OTs'} registradas
                    {assetWos.some((row) => !['closed', 'cancelled'].includes(row.status))
                      ? ` · ${assetWos.filter((row) => !['closed', 'cancelled'].includes(row.status)).length} abiertas`
                      : ''}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Historial completo de mantenimiento de este activo (V1.3 · pestaña OTs).
                  </p>
                </div>
                <Button
                  size="sm"
                  title={canEdit ? undefined : 'Solo Mantenimiento crea OTs.'}
                  disabled={!canEdit}
                  onClick={() =>
                    navigate(
                      `/app/ordenes/nueva?asset=${id}&from=${encodeURIComponent(location.pathname)}`,
                    )
                  }
                >
                  <Plus />
                  Abrir OT
                </Button>
              </div>

              {assetWos.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <p className="text-[14.5px]">Aún no hay OTs para este activo.</p>
                  <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
                    Crea la primera desde «Abrir OT» o desde la bandeja de Reportes de Daño.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Número</TableHead>
                        <TableHead className="hidden md:table-cell">Tipo</TableHead>
                        <TableHead>Prioridad</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="hidden md:table-cell">Técnicos</TableHead>
                        <TableHead className="hidden lg:table-cell">F. apertura</TableHead>
                        <TableHead className="hidden xl:table-cell">F. programada</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assetWos.map((row) => (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/app/ordenes/${row.id}`)}
                        >
                          <TableCell className="font-mono text-[12.5px] font-medium">
                            {row.wo_number}
                          </TableCell>
                          <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                            {TYPE_LABELS[row.wo_type]}
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.priority === 'urgent' ? 'destructive' : 'outline'}>
                              {PRIORITY_LABELS[row.priority]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={STATUS_BADGE_CLASS[row.status]}>
                              {STATUS_LABELS[row.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden max-w-[180px] truncate text-[13px] text-muted-foreground md:table-cell">
                            {row.tech_names ?? 'Sin asignar'}
                          </TableCell>
                          <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                            {new Date(row.reported_at).toLocaleDateString('es-ES')}
                          </TableCell>
                          <TableCell className="hidden text-[13px] text-muted-foreground xl:table-cell">
                            {row.scheduled_at
                              ? new Date(row.scheduled_at).toLocaleDateString('es-ES')
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </TabsContent>

          {canSeeCosts && (
            <TabsContent value="costos" className="mt-6">
              <section className="rounded-lg border border-border px-5 py-12 text-center">
                <p className="text-[14.5px]">
                  Los costos de mantenimiento se calculan en el Módulo 2.
                </p>
                <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
                  Repuestos, mano de obra y depreciación de este activo aparecerán aquí cuando
                  existan OTs y consumos registrados.
                </p>
              </section>
            </TabsContent>
          )}

          <TabsContent value="historial" className="mt-6">
            <section className="rounded-lg border border-border">
              <div className="border-b border-border px-5 py-4">
                <p className="text-[15px] font-semibold">
                  {audit.length} {audit.length === 1 ? 'movimiento registrado' : 'movimientos registrados'}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Auditoría inmutable (audit_log): quién, qué, cuándo y el motivo cuando aplica.
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
                      {row.changes && Object.keys(row.changes).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                          {Object.entries(row.changes).map(([field, raw]) => {
                            const change = diffOf(raw)
                            return (
                              <span
                                key={field}
                                className="text-[12.5px] text-muted-foreground"
                              >
                                <span className="font-mono">
                                  {FIELD_LABELS[field] ?? field}
                                </span>
                                : {formatValue(change.old)} → {formatValue(change.new)}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>

      {stageTarget && (
        <StageDialog
          open
          onOpenChange={(open) => {
            if (!open) setStageTarget(null)
          }}
          asset={asset}
          stage={stageTarget}
          onSubmit={handleStageSubmit}
        />
      )}

      {warrantyDialog.open && (
        <WarrantyDialog
          open
          onOpenChange={(open) => setWarrantyDialog((state) => ({ ...state, open }))}
          assetId={asset.id}
          warranty={warrantyDialog.warranty}
          onSaved={refresh}
        />
      )}

      {componentDialog.open && (
        <ComponentDialog
          open
          onOpenChange={(open) => setComponentDialog((state) => ({ ...state, open }))}
          parent={asset}
          component={componentDialog.component}
          defaultCode={`${asset.code}-${String(children.length + 1).padStart(2, '0')}`}
          inheritedLocationPath={asset.location_path}
          onSaved={refresh}
        />
      )}

      {qrOpen && <QrDialog open onOpenChange={setQrOpen} asset={asset} />}
    </main>
  )
}
