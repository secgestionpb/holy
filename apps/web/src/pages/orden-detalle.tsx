import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  FileText,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  fetchAsset,
  fetchAuditFor,
  formatDateTime,
  signAssetFileUrl,
  type AuditRow,
} from '@/lib/m1'
import { AssignDialog } from '@/components/ordenes/assign-dialog'
import { CloseDialog } from '@/components/ordenes/close-dialog'
import { MotiveDialog } from '@/components/ordenes/motive-dialog'
import { ReplaceDialog } from '@/components/ordenes/replace-dialog'
import { ConsumeDialog, ProbablesDialog, ReturnDialog } from '@/components/inventario/ot-parts-dialogs'
import { getWoChecklist, updateChecklistEntry, type ChecklistEntry, type ChecklistStatus } from '@/lib/m3'
import { ChecklistTab } from '@/components/ordenes/checklist-tab'
import {
  fetchWarehouses,
  fetchWoMovements,
  formatMoney,
  formatQty,
  MOVEMENT_TYPE_LABELS,
  type KardexRow,
  type WarehouseRow,
} from '@/lib/m4'
import {
  addComment,
  cancelWo,
  deleteEvidence,
  EVIDENCE_KIND_LABELS,
  evidenceFileName,
  fetchLaborRate,
  fetchProvidersLite,
  fetchTechnicians,
  fetchWoComments,
  fetchWoEvidence,
  fetchWoTechnicians,
  fetchWorkOrder,
  isTerminal,
  ORIGIN_LABELS,
  PRIORITY_LABELS,
  reopenWo,
  setTechnicianHours,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
  transitionWo,
  TYPE_LABELS,
  updateWo,
  uploadEvidence,
  type EvidenceKind,
  type Priority,
  type ProviderLite,
  type TechnicianLite,
  type WoCommentRow,
  type WoEvidenceRow,
  type WoRow,
  type WoStatus,
  type WoTechRow,
} from '@/lib/m2'

const WO_FIELD_LABELS: Record<string, string> = {
  status: 'Estado',
  priority: 'Prioridad',
  description: 'Descripción',
  scheduled_at: 'Fecha programada',
  started_at: 'Inicio de trabajo',
  finished_at: 'Fin de trabajo',
  closed_at: 'Cierre',
  affects_sale: 'Afecta disponibilidad',
  executed_by_type: 'Ejecutada por',
  provider_id: 'Proveedor',
  external_cost: 'Costo externo',
  generates_warranty: 'Garantía generada',
  diagnosis: 'Diagnóstico',
  solution: 'Solución',
  wo_type: 'Tipo',
  technician: 'Técnico',
  hours_worked: 'Horas',
  asset_id: 'Activo',
  component_id: 'Componente',
}

type TimelineEntry = {
  key: string
  at: string
  kind: 'audit' | 'comment'
  actor: string | null
  title: string
  detail?: string | null
}

function changesSummary(changes: AuditRow['changes']): string | null {
  if (!changes) return null
  const parts: string[] = []
  for (const [field, diff] of Object.entries(changes)) {
    const label = WO_FIELD_LABELS[field] ?? field
    const oldValue = diff.old === null || diff.old === undefined ? '—' : String(diff.old)
    const newValue = diff.new === null || diff.new === undefined ? '—' : String(diff.new)
    parts.push(`${label}: ${oldValue} → ${newValue}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export default function OrdenDetalle() {
  const roles = useAuth((s) => s.roles)
  const user = useAuth((s) => s.user)
  const isMaintenance = roles.includes('mantenimiento')
  const isTechnician = roles.includes('tecnico')
  const canSeeCosts = isMaintenance || roles.includes('administrador')
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const backTab = searchParams.get('back') ?? '/app/ordenes'

  const [wo, setWo] = useState<WoRow | null>(null)
  const [techRows, setTechRows] = useState<WoTechRow[]>([])
  const [comments, setComments] = useState<WoCommentRow[]>([])
  const [evidence, setEvidence] = useState<WoEvidenceRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [technicians, setTechnicians] = useState<TechnicianLite[]>([])
  const [providers, setProviders] = useState<ProviderLite[]>([])
  const [laborRate, setLaborRate] = useState(0)
  const [detailTab, setDetailTab] = useState('general')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)

  const [assignOpen, setAssignOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)

  const [commentText, setCommentText] = useState('')
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind>('before')
  const [uploading, setUploading] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [brokenEvidence, setBrokenEvidence] = useState<Record<string, boolean>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [woMovements, setWoMovements] = useState<KardexRow[]>([])
  const [checklist, setChecklist] = useState<ChecklistEntry[]>([])
  const [m4Warehouses, setM4Warehouses] = useState<WarehouseRow[]>([])
  const [assetCategoryId, setAssetCategoryId] = useState<string | null>(null)
  const [consumeOpen, setConsumeOpen] = useState(false)
  const [returnMovement, setReturnMovement] = useState<KardexRow | null>(null)
  const [probablesOpen, setProbablesOpen] = useState(false)

  useEffect(() => {
    if (!id) return
    let alive = true
    Promise.all([
      fetchWorkOrder(id),
      fetchWoTechnicians(id),
      fetchWoComments(id),
      fetchWoEvidence(id),
      fetchAuditFor(id),
      fetchTechnicians(),
      fetchProvidersLite(),
      fetchLaborRate(),
      fetchWoMovements(id),
      fetchWarehouses(),
      getWoChecklist(id),
    ])
      .then(
        ([woRow, techList, commentRows, evidenceRows, auditRows, techUsers, providerRows, rate, movementRows, warehouseRows, checklistRows]) => {
          if (!alive) return
          if (!woRow) {
            setError('OT inexistente o sin permiso de lectura.')
            return
          }
          setWo(woRow)
          setTechRows(techList)
          setComments(commentRows)
          setEvidence(evidenceRows)
          setAudit(auditRows)
          setTechnicians(techUsers)
          setProviders(providerRows)
          setLaborRate(rate)
          setWoMovements(movementRows)
          setM4Warehouses(warehouseRows)
          setChecklist(checklistRows)
        },
      )
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'No se pudo cargar la OT.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id, reloadKey])

  function refresh() {
    setLoading(true)
    setError(null)
    setReloadKey((key) => key + 1)
  }

  // Categoría del activo de la OT (para "repuestos probables" N:N)
  useEffect(() => {
    if (!wo?.asset_id) return
    let alive = true
    void fetchAsset(wo.asset_id).then((asset) => {
      if (alive) setAssetCategoryId(asset?.category_id ?? null)
    })
    return () => {
      alive = false
    }
  }, [wo?.asset_id])

  const activeTechs = useMemo(() => techRows.filter((row) => !row.removed_at), [techRows])
  const assignedToMe = Boolean(user && activeTechs.some((row) => row.user_id === user.id))
  const laborHours = activeTechs.reduce((sum, row) => sum + Number(row.hours_worked), 0)
  const laborCost = activeTechs.reduce(
    (sum, row) => sum + Number(row.hours_worked) * (row.users?.hourly_rate ?? laborRate),
    0,
  )

  const canComment = isMaintenance || roles.includes('calidad') || assignedToMe
  const openStates: WoStatus[] = ['open', 'assigned', 'in_progress', 'waiting_parts']

  async function runTransition(status: WoStatus, successMessage: string) {
    if (!wo) return
    setBusy(true)
    const result = await transitionWo(wo.id, status)
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success(successMessage)
    refresh()
  }

  async function submitComment() {
    if (!wo || !commentText.trim()) return
    setBusy(true)
    const result = await addComment(wo.id, commentText.trim())
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    setCommentText('')
    toast.success('Comentario publicado.')
    refresh()
  }

  async function onPickEvidence(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !wo) return
    setUploading(true)
    const result = await uploadEvidence({ parentId: wo.id, file, kind: evidenceKind })
    setUploading(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Evidencia subida.')
    refresh()
  }

  async function openEvidence(row: WoEvidenceRow) {
    if (brokenEvidence[row.id]) {
      toast.error('Archivo no disponible (retención).')
      return
    }
    const url = signedUrls[row.id] ?? (await signAssetFileUrl(row.storage_path))
    if (!url) {
      setBrokenEvidence((current) => ({ ...current, [row.id]: true }))
      toast.error('Archivo no disponible (retención).')
      return
    }
    setSignedUrls((current) => ({ ...current, [row.id]: url }))
    window.open(url, '_blank', 'noopener')
  }

  async function removeEvidence(row: WoEvidenceRow) {
    if (!wo || isTerminal(wo.status)) {
      toast.error('No se puede borrar evidencia de una OT Cerrada.')
      return
    }
    if (!window.confirm('¿Eliminar esta evidencia?')) return
    const result = await deleteEvidence(row)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Evidencia eliminada.')
    refresh()
  }

  async function onUploadSign() {
    setSigning(true)
    const urls: Record<string, string> = {}
    const broken: Record<string, boolean> = {}
    for (const row of evidence) {
      const url = await signAssetFileUrl(row.storage_path)
      if (url) urls[row.id] = url
      else broken[row.id] = true
    }
    setSigning(false)
    setSignedUrls(urls)
    setBrokenEvidence(broken)
  }

  async function changePriority(priority: Priority) {
    if (!wo) return
    const result = await updateWo(wo.id, { priority })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Prioridad actualizada.')
    refresh()
  }

  async function saveHours(row: WoTechRow, rawValue: string) {
    const hours = Number(rawValue)
    if (!Number.isFinite(hours) || hours < 0) {
      toast.error('Horas inválidas.')
      return
    }
    setBusy(true)
    const result = await setTechnicianHours(row.wo_id, row.user_id, hours)
    setBusy(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Horas guardadas.')
    refresh()
  }

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = []
    for (const row of audit) {
      entries.push({
        key: `a-${row.id}`,
        at: row.created_at,
        kind: 'audit',
        actor: row.actor_name ?? null,
        title: AUDIT_ACTION_LABELS[row.action] ?? row.action,
        detail: changesSummary(row.changes) ?? row.reason,
      })
    }
    for (const row of comments) {
      entries.push({
        key: `c-${row.id}`,
        at: row.created_at,
        kind: 'comment',
        actor: row.author?.full_name ?? null,
        title: 'Comentario',
        detail: row.body,
      })
    }
    return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [audit, comments])

  if (loading && !wo) {
    return (
      <main className="flex items-center justify-center gap-2 px-6 py-24 text-[14px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando OT…
      </main>
    )
  }

  if (error || !wo) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-[14px] text-destructive">{error ?? 'OT no encontrada.'}</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/app/ordenes')}>
            <ArrowLeft />
            Volver al listado
          </Button>
        </div>
      </main>
    )
  }

  const status = wo.status
  const terminal = isTerminal(status)
  const canManageParts = !terminal && (isMaintenance || assignedToMe)

  const partsNet = woMovements.reduce((sum, row) => {
    const amount = Math.abs(Number(row.line_total ?? 0))
    return row.type === 'devolucion' ? sum - amount : sum + amount
  }, 0)
  const salidaCount = woMovements.filter((row) => row.type === 'salida_ot').length
  const devolucionCount = woMovements.filter((row) => row.type === 'devolucion').length

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
            onClick={() => navigate(backTab)}
          >
            <ArrowLeft className="size-3.5" />
            Volver a órdenes
          </button>
          <Button variant="ghost" size="sm" onClick={refresh} aria-label="Actualizar OT">
            <RefreshCw />
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Módulo 2 · Detalle de OT
            </p>
            <h1 className="font-heading mt-2 flex flex-wrap items-center gap-3 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
              {wo.wo_number}
              <Badge variant="secondary" className={STATUS_BADGE_CLASS[status]}>
                {STATUS_LABELS[status]}
              </Badge>
              <Badge variant={wo.priority === 'urgent' ? 'destructive' : 'outline'}>
                {PRIORITY_LABELS[wo.priority]}
              </Badge>
              <Badge variant="outline">{TYPE_LABELS[wo.wo_type]}</Badge>
              {wo.reassigned && <Badge variant="outline">re-asignada</Badge>}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted-foreground">
              <Link
                className="text-foreground underline-offset-2 hover:underline"
                to={`/app/activos/${wo.asset_id}`}
              >
                {wo.asset_code ? `${wo.asset_code} — ${wo.asset_name}` : 'Activo'}
              </Link>
              {wo.component_name && <span>· {wo.component_name}</span>}
              <span>· {wo.location_path ?? '—'}</span>
              <span>· {wo.tech_names ?? 'Sin técnicos asignados'}</span>
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Origen:{' '}
              {wo.damage_report_ref ? (
                <Link className="text-primary underline-offset-2 hover:underline" to="/app/reportes-dano">
                  Reporte de Daño {wo.damage_report_ref}
                </Link>
              ) : (
                ORIGIN_LABELS[wo.origin]
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isMaintenance && (
              <div className="flex items-center gap-1.5">
                <Label className="text-[12.5px] text-muted-foreground">Prioridad</Label>
                <Select value={wo.priority} onValueChange={(value) => void changePriority(value as Priority)}>
                  <SelectTrigger className="w-[120px]" aria-label="Cambiar prioridad">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(PRIORITY_LABELS) as Array<[Priority, string]>).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {isMaintenance && !terminal && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/app/ordenes/${wo.id}/editar`)}>
                <Pencil />
                Editar
              </Button>
            )}

            {isMaintenance && !terminal && (
              <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                Asignar / Reasignar
              </Button>
            )}

            {isMaintenance && openStates.includes(status) && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setCancelOpen(true)}>
                Cancelar
              </Button>
            )}

            {isMaintenance && status === 'completed' && (
              <>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void runTransition('in_progress', 'OT devuelta a En proceso.')}>
                  Devolver a En proceso
                </Button>
                <Button size="sm" disabled={busy} onClick={() => setCloseOpen(true)}>
                  Cerrar OT
                </Button>
              </>
            )}

            {isMaintenance && terminal && (
              <Button size="sm" disabled={busy} onClick={() => setReopenOpen(true)}>
                Reabrir
              </Button>
            )}

            {isTechnician && assignedToMe && openStates.includes(status) && (
              <>
                {status !== 'in_progress' && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void runTransition('in_progress', 'Trabajo iniciado.')}
                  >
                    Iniciar trabajo
                  </Button>
                )}
                {status !== 'waiting_parts' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void runTransition('waiting_parts', 'Marcada como Pendiente de repuesto.')}
                  >
                    Pendiente de repuesto
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void runTransition('completed', 'Trabajo completado: espera el cierre formal de Mantenimiento.')}
                >
                  Marcar Completada
                </Button>
                {['assigned', 'in_progress', 'waiting_parts'].includes(status) && (
                  <Button variant="outline" size="sm" onClick={() => setReplaceOpen(true)}>
                    Reemplazar técnico
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <Tabs value={detailTab} onValueChange={setDetailTab} className="mt-8">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="ejecucion">Ejecución</TabsTrigger>
            <TabsTrigger value="repuestos">Repuestos consumidos</TabsTrigger>
            {checklist.length > 0 && <TabsTrigger value="checklist">Checklist</TabsTrigger>}
            <TabsTrigger value="evidencia">Evidencia ({evidence.length})</TabsTrigger>
            <TabsTrigger value="historial">
              Historial y comentarios ({timeline.length})
            </TabsTrigger>
            {canSeeCosts && <TabsTrigger value="costos">Costos</TabsTrigger>}
          </TabsList>

          <TabsContent value="general" className="mt-6">
            <section className="rounded-lg border border-border p-5">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-[12.5px] text-muted-foreground">Descripción del problema</dt>
                  <dd className="whitespace-pre-wrap text-[14.5px]">{wo.description}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Origen</dt>
                  <dd className="text-[14px]">
                    {wo.damage_report_ref
                      ? `Reporte de Daño ${wo.damage_report_ref}`
                      : ORIGIN_LABELS[wo.origin]}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Reportado por</dt>
                  <dd className="text-[14px]">{wo.reported_by_name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Fecha de apertura</dt>
                  <dd className="text-[14px]">{formatDateTime(wo.reported_at)}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Fecha programada</dt>
                  <dd className="text-[14px]">{formatDateTime(wo.scheduled_at)}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Asignación</dt>
                  <dd className="text-[14px]">{formatDateTime(wo.assigned_at)}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Inicio de trabajo</dt>
                  <dd className="text-[14px]">{formatDateTime(wo.started_at)}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Fin de trabajo</dt>
                  <dd className="text-[14px]">{formatDateTime(wo.finished_at)}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Cierre</dt>
                  <dd className="text-[14px]">
                    {formatDateTime(wo.closed_at)}
                    {wo.closed_by_name ? ` · ${wo.closed_by_name}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Ejecutada por</dt>
                  <dd className="text-[14px]">
                    {wo.executed_by_type === 'external' ? 'Contratista externo' : 'Personal interno'}
                    {wo.provider_name ? ` · ${wo.provider_name}` : ''}
                    {wo.external_cost !== null ? ` · $${Number(wo.external_cost).toFixed(2)}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">
                    ¿Afectó disponibilidad de venta?
                  </dt>
                  <dd className="text-[14px]">
                    {wo.affects_sale ? 'Sí — Evento 1 (correo inmediato)' : 'No'}
                  </dd>
                </div>
                {status === 'closed' && (
                  <>
                    <div className="sm:col-span-2">
                      <dt className="text-[12.5px] text-muted-foreground">Diagnóstico</dt>
                      <dd className="whitespace-pre-wrap text-[14.5px]">{wo.diagnosis ?? '—'}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-[12.5px] text-muted-foreground">Solución aplicada</dt>
                      <dd className="whitespace-pre-wrap text-[14.5px]">{wo.solution ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[12.5px] text-muted-foreground">Garantía generada</dt>
                      <dd className="text-[14px]">
                        {wo.generates_warranty === null
                          ? '—'
                          : wo.generates_warranty
                            ? 'Sí — ver Garantías en la ficha del activo'
                            : 'No'}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </section>
          </TabsContent>

          <TabsContent value="ejecucion" className="mt-6 space-y-5">
            <section className="rounded-lg border border-border p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold">Horas de mano de obra por técnico</h2>
                  <p className="text-[13px] text-muted-foreground">
                    Cada técnico registra las suyas (editable sobre sí mismo); Mantenimiento sobre
                    cualquiera. El total de la OT es derivado, no se edita a mano.
                  </p>
                </div>
                <Badge variant="outline" className="tabular-nums">
                  Total: {laborHours.toFixed(2)} h
                </Badge>
              </div>

              {activeTechs.length === 0 ? (
                <p className="mt-4 text-[13.5px] text-muted-foreground">
                  Sin técnicos asignados (caso contratista o pendiente de asignación).
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Técnico</TableHead>
                        <TableHead>Inicio</TableHead>
                        <TableHead>Fin</TableHead>
                        <TableHead>Horas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeTechs.map((row) => {
                        const editable = isMaintenance || row.user_id === user?.id
                        return (
                          <TableRow key={row.user_id}>
                            <TableCell className="text-[14px] font-medium">
                              {row.users?.full_name ?? '—'}
                            </TableCell>
                            <TableCell className="text-[13px] text-muted-foreground">
                              {formatDateTime(row.started_at)}
                            </TableCell>
                            <TableCell className="text-[13px] text-muted-foreground">
                              {formatDateTime(row.finished_at)}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min="0"
                                step="0.25"
                                className="w-[110px] tabular-nums"
                                aria-label={`Horas de ${row.users?.full_name ?? row.user_id}`}
                                defaultValue={Number(row.hours_worked)}
                                disabled={!editable || busy}
                                onBlur={(event) => {
                                  const value = Number(event.target.value)
                                  if (value !== Number(row.hours_worked)) {
                                    void saveHours(row, event.target.value)
                                  }
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border p-5">
              <h2 className="text-[15px] font-semibold">Checklist</h2>
              <p className="mt-1 text-[13.5px] text-muted-foreground">
                {wo.wo_type === 'preventive'
                  ? checklist.length > 0
                    ? `${
                        checklist.filter((entry) => entry.status !== 'pending').length
                      } de ${checklist.length} ítems completados — gestionalos en la pestaña «Checklist».`
                    : 'OT preventiva sin plantilla de checklist asociada al plan.'
                  : 'Las OTs correctivas no llevan checklist.'}
              </p>
            </section>

            <section className="rounded-lg border border-border p-5">
              <h2 className="text-[15px] font-semibold">Repuestos probables</h2>
              <p className="mt-1 text-[13.5px] text-muted-foreground">
                Ítems vinculados al activo o a su categoría (M4): úsalos como referencia antes de
                consumir.
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setProbablesOpen(true)}>
                Ver repuestos probables
              </Button>
            </section>
          </TabsContent>

          <TabsContent value="repuestos" className="mt-6">
            <section className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-[15px] font-semibold">
                    {woMovements.length} {woMovements.length === 1 ? 'movimiento' : 'movimientos'} de
                    repuestos
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Kardex Módulo 4: {salidaCount} salida(s) − {devolucionCount} devolución(es), con
                    costo congelado al consumo.
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={!canManageParts}
                  title={
                    terminal
                      ? 'La OT está Cerrada: no se consumen más repuestos.'
                      : canManageParts
                        ? undefined
                        : 'Solo técnicos asignados y Mantenimiento consumen repuestos.'
                  }
                  onClick={() => setConsumeOpen(true)}
                >
                  <Plus />
                  Agregar consumo
                </Button>
              </div>

              {woMovements.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14.5px]">Sin consumos registrados.</p>
                  <p className="mx-auto mt-2 max-w-md text-[13px] text-muted-foreground">
                    Usa «Agregar consumo» para descontar repuestos de una bodega con costo congelado;
                    en Cerrada la pestaña queda de solo lectura.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Ítem</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="hidden sm:table-cell">Bodega</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="hidden md:table-cell text-right">Costo unit.</TableHead>
                        <TableHead className="text-right">Importe</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {woMovements.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-[13px] text-muted-foreground">
                            {formatDateTime(row.occurred_at)}
                          </TableCell>
                          <TableCell className="text-[13.5px]">
                            <span className="font-mono text-[12px]">{row.item_code}</span>{' '}
                            {row.item_name}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={
                                row.type === 'devolucion'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-primary/15 text-primary'
                              }
                            >
                              {MOVEMENT_TYPE_LABELS[row.type]}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-[13px] text-muted-foreground">
                            {row.warehouse_name}
                          </TableCell>
                          <TableCell className="text-right text-[13.5px] tabular-nums">
                            {row.type === 'devolucion' ? '+' : '−'}
                            {formatQty(Math.abs(Number(row.qty)))}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-right text-[13px] tabular-nums text-muted-foreground">
                            {formatMoney(row.unit_cost)}
                          </TableCell>
                          <TableCell className="text-right text-[13.5px] tabular-nums">
                            {row.type === 'devolucion' ? '+' : '−'}
                            {formatMoney(Math.abs(Number(row.line_total ?? 0)))}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.type === 'salida_ot' && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!canManageParts}
                                title={
                                  canManageParts
                                    ? 'Devolver sobrante a bodega (F2.9).'
                                    : 'Solo técnicos asignados y Mantenimiento devuelven repuestos.'
                                }
                                onClick={() => setReturnMovement(row)}
                              >
                                Devolver
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </TabsContent>

          {checklist.length > 0 && (
            <TabsContent value="checklist" className="mt-6">
              <ChecklistTab
                entries={checklist}
                editable={!terminal && (isMaintenance || assignedToMe)}
                onUpdate={async (entry, status: ChecklistStatus, note) => {
                  try {
                    await updateChecklistEntry(entry.id, { status, note })
                    setChecklist((prev) =>
                      prev.map((row) =>
                        row.id === entry.id ? { ...row, status, note: note ?? null } : row,
                      ),
                    )
                    toast.success('Checklist actualizado')
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : 'No se pudo actualizar el checklist.',
                    )
                  }
                }}
              />
            </TabsContent>
          )}

          <TabsContent value="evidencia" className="mt-6">
            <section className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-[15px] font-semibold">
                    {evidence.length} {evidence.length === 1 ? 'foto' : 'fotos'}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Fotos antes/después en el bucket «ot_evidencias» (abrir usa enlace firmado de 1
                    hora).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={evidenceKind} onValueChange={(value) => setEvidenceKind(value as EvidenceKind)}>
                    <SelectTrigger className="w-[130px]" aria-label="Tipo de evidencia">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(EVIDENCE_KIND_LABELS) as Array<[EvidenceKind, string]>).map(
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
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void onPickEvidence(event)}
                  />
                  <Button
                    size="sm"
                    disabled={
                      uploading ||
                      terminal ||
                      !(isMaintenance || assignedToMe)
                    }
                    title={
                      terminal
                        ? 'La OT está Cerrada: no se aceptan nuevas cargas.'
                        : isMaintenance || assignedToMe
                          ? undefined
                          : 'Solo técnicos asignados y Mantenimiento suben evidencia.'
                    }
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                    Subir foto
                  </Button>
                  <Button variant="outline" size="sm" disabled={signing} onClick={() => void onUploadSign()}>
                    <Camera />
                    {signing ? 'Preparando…' : 'Preparar enlaces'}
                  </Button>
                </div>
              </div>

              {evidence.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-muted-foreground">Sin evidencia fotográfica aún.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {evidence.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {signedUrls[row.id] && !brokenEvidence[row.id] ? (
                          <img
                            src={signedUrls[row.id]}
                            alt=""
                            className="size-10 shrink-0 rounded-md object-cover"
                            onError={() =>
                              setBrokenEvidence((current) => ({ ...current, [row.id]: true }))
                            }
                          />
                        ) : (
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                            <FileText className="size-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-medium">
                            {EVIDENCE_KIND_LABELS[row.kind]} · {evidenceFileName(row)}
                          </p>
                          <p className="text-[12.5px] text-muted-foreground">
                            {formatDateTime(row.uploaded_at)}
                          </p>
                          {brokenEvidence[row.id] && (
                            <p className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
                              Archivo no disponible (retención)
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => void openEvidence(row)}>
                          {signedUrls[row.id] ? 'Abrir' : 'Firmar y abrir'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Eliminar evidencia"
                          disabled={terminal || (!isMaintenance && row.uploaded_by !== user?.id)}
                          title={
                            terminal
                              ? 'No se puede borrar evidencia de una OT Cerrada.'
                              : undefined
                          }
                          onClick={() => void removeEvidence(row)}
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

          <TabsContent value="historial" className="mt-6 space-y-5">
            {canComment && (
              <section className="rounded-lg border border-border p-4">
                <Label htmlFor="wo-comment">Nuevo comentario</Label>
                <Textarea
                  id="wo-comment"
                  rows={3}
                  className="mt-2"
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder="Comentario para el equipo… (no genera push)"
                />
                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    disabled={!commentText.trim() || busy}
                    onClick={() => void submitComment()}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <MessageSquare />}
                    Publicar
                  </Button>
                </div>
              </section>
            )}

            <section className="rounded-lg border border-border">
              <div className="border-b border-border px-5 py-4">
                <p className="text-[15px] font-semibold">Línea de tiempo</p>
                <p className="text-[13px] text-muted-foreground">
                  Auditoría automática (fuente única) + comentarios manuales. Los comentarios no se
                  editan ni se borran.
                </p>
              </div>
              {timeline.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[14px] text-muted-foreground">Sin eventos registrados.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {timeline.map((entry) => (
                    <li key={entry.key} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={entry.kind === 'comment' ? 'outline' : 'secondary'}>
                          {entry.kind === 'comment' ? <MessageSquare className="size-3" /> : null}
                          {entry.title}
                        </Badge>
                        <span className="text-[12.5px] text-muted-foreground">
                          {formatDateTime(entry.at)}
                          {entry.actor ? ` · ${entry.actor}` : ''}
                        </span>
                      </div>
                      {entry.detail && (
                        <p className="mt-1.5 whitespace-pre-wrap text-[13.5px]">{entry.detail}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>

          {canSeeCosts && (
            <TabsContent value="costos" className="mt-6">
              <section className="rounded-lg border border-border p-5">
                <h2 className="text-[15px] font-semibold">Costos de la OT</h2>
                <p className="text-[13px] text-muted-foreground">
                  Mano de obra (horas × tarifa) + repuestos (costo congelado) + servicio externo.
                  Solo Mantenimiento y Administrador (base de KPIs del Módulo 7).
                </p>
                <div className="mt-4 overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Concepto</TableHead>
                        <TableHead className="text-right">Detalle</TableHead>
                        <TableHead className="text-right">Importe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeTechs.map((row) => {
                        const rate = Number(row.users?.hourly_rate ?? laborRate)
                        const amount = Number(row.hours_worked) * rate
                        return (
                          <TableRow key={row.user_id}>
                            <TableCell className="text-[14px]">
                              Mano de obra — {row.users?.full_name ?? '—'}
                            </TableCell>
                            <TableCell className="text-right text-[13px] text-muted-foreground tabular-nums">
                              {Number(row.hours_worked).toFixed(2)} h × ${rate.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right text-[14px] tabular-nums">
                              ${amount.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      <TableRow>
                        <TableCell className="text-[14px]">Repuestos consumidos</TableCell>
                        <TableCell className="text-right text-[13px] text-muted-foreground">
                          {salidaCount} salida(s) − {devolucionCount} devolución(es)
                        </TableCell>
                        <TableCell className="text-right text-[14px] tabular-nums">
                          {formatMoney(partsNet)}
                        </TableCell>
                      </TableRow>
                      {wo.external_cost !== null && (
                        <TableRow>
                          <TableCell className="text-[14px]">Servicio externo</TableCell>
                          <TableCell className="text-right text-[13px] text-muted-foreground">
                            {wo.provider_name ?? '—'}
                          </TableCell>
                          <TableCell className="text-right text-[14px] tabular-nums">
                            ${Number(wo.external_cost).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow>
                        <TableCell className="text-[14px] font-semibold">Total</TableCell>
                        <TableCell />
                        <TableCell className="text-right text-[15px] font-semibold tabular-nums">
                          {formatMoney(laborCost + partsNet + Number(wo.external_cost ?? 0))}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </section>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {assignOpen && (
        <AssignDialog
          open
          onOpenChange={setAssignOpen}
          wo={wo}
          technicians={technicians}
          activeIds={activeTechs.map((row) => row.user_id)}
          onSaved={refresh}
        />
      )}

      {replaceOpen && (
        <ReplaceDialog
          open
          onOpenChange={setReplaceOpen}
          wo={wo}
          activeTechs={activeTechs}
          technicians={technicians}
          currentUserId={user?.id ?? ''}
          isMaintenance={isMaintenance}
          onSaved={refresh}
        />
      )}

      {closeOpen && (
        <CloseDialog
          open
          onOpenChange={setCloseOpen}
          wo={wo}
          laborHours={laborHours}
          consumedTotal={partsNet}
          providers={providers}
          onSaved={refresh}
        />
      )}

      {consumeOpen && (
        <ConsumeDialog open onOpenChange={setConsumeOpen} wo={wo} onSaved={refresh} />
      )}

      {returnMovement && (
        <ReturnDialog
          open
          onOpenChange={(open) => {
            if (!open) setReturnMovement(null)
          }}
          movement={returnMovement}
          warehouses={m4Warehouses}
          onSaved={refresh}
        />
      )}

      {probablesOpen && (
        <ProbablesDialog
          open
          onOpenChange={setProbablesOpen}
          assetId={wo.asset_id}
          categoryId={assetCategoryId}
        />
      )}

      {cancelOpen && (
        <MotiveDialog
          open
          onOpenChange={setCancelOpen}
          title="Cancelar OT"
          description={`${wo.wo_number} — decisión de Mantenimiento (F2.8).`}
          effect="Estado → Cancelada. Conserva consumos, evidencia e historial; sin correo ni push. El Técnico no cancela ni sus propias OTs."
          confirmLabel="Cancelar OT"
          onSubmit={async (reason) => {
            const result = await cancelWo(wo.id, reason)
            if (!result.ok) return result.message
            toast.success('OT cancelada.')
            refresh()
            return null
          }}
        />
      )}

      {reopenOpen && (
        <MotiveDialog
          open
          onOpenChange={setReopenOpen}
          title="Reabrir OT"
          description={`${wo.wo_number} — reapertura formal (F2.7).`}
          effect="Estado → En proceso. Sin correo ni push. Si ya generó garantía, no se elimina: al re-cerrar se edita el registro existente."
          confirmLabel="Reabrir OT"
          onSubmit={async (reason) => {
            const result = await reopenWo(wo.id, reason)
            if (!result.ok) return result.message
            toast.success('OT reabierta: En proceso.')
            refresh()
            return null
          }}
        />
      )}
    </main>
  )
}
