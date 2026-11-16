import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, Pencil, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { EditEventDialog } from '@/components/configuracion/edit-event-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  EDITABLE_PARAMS,
  PARAM_LABELS,
  fetchFailedLogs,
  fetchNotificationConfig,
  fetchSystemParams,
  retryNotification,
  updateSystemParam,
  MODE_LABELS,
  type FailedLogRow,
  type NotificationEvent,
  type ParamRow,
} from '@/lib/t2'

const dateFormatter = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })

const CATALOG_LINKS: Array<{ label: string; module: string; to?: string }> = [
  { label: 'Categorías de activos', module: 'M1' },
  { label: 'Categorías de ítems', module: 'M4', to: '/app/inventario?tab=items' },
  { label: 'Bodegas', module: 'M4', to: '/app/inventario?tab=warehouses' },
  { label: 'Plantillas de checklist', module: 'M3' },
  { label: 'Categorías normativas', module: 'M6' },
  { label: 'Tipos de medición', module: 'M6' },
  { label: 'Roles (solo lectura)', module: 'T1', to: '/app/usuarios' },
]

export default function Configuracion() {
  const [events, setEvents] = useState<NotificationEvent[]>([])
  const [params, setParams] = useState<ParamRow[]>([])
  const [failed, setFailed] = useState<FailedLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState<NotificationEvent | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [editingParam, setEditingParam] = useState<string | null>(null)
  const [paramDraft, setParamDraft] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([
      fetchNotificationConfig(),
      fetchSystemParams(EDITABLE_PARAMS),
      fetchFailedLogs(),
    ])
      .then(([eventRows, paramRows, failedRows]) => {
        if (!alive) return
        setEvents(eventRows)
        setParams(paramRows)
        setFailed(failedRows)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Error al cargar la configuración.')
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

  async function onRetry(row: FailedLogRow) {
    setRetryingId(row.id)
    const result = await retryNotification(row.id)
    setRetryingId(null)
    if (result.ok) {
      toast.success('Envío reintentado correctamente.')
      refresh()
      return
    }
    toast.error(result.message ?? 'No se pudo reintentar.')
  }

  async function saveParam(key: string) {
    const value = paramDraft.trim()
    const parsed = Number(value)
    if (value === '' || Number.isNaN(parsed) || parsed < 0) {
      toast.error('El valor debe ser un número ≥ 0.')
      return
    }
    try {
      await updateSystemParam(key, value)
      toast.success('Parámetro actualizado.')
      setEditingParam(null)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar.')
    }
  }

  const globalWarrantyDays =
    params.find((row) => row.key === 'dias_anticipacion_garantia')?.value ?? null

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-6xl">
        <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
          Configuración del sistema
        </p>
        <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
          Configuración
        </h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Notificaciones, parámetros generales y accesos a catálogos · gestión exclusiva del
          Administrador.
        </p>

        {loading && events.length === 0 ? (
          <div className="mt-10 flex items-center justify-center gap-2 text-[14px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando configuración…
          </div>
        ) : error ? (
          <div
            role="alert"
            className="mt-10 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive"
          >
            {error}
          </div>
        ) : (
          <Tabs defaultValue="notificaciones" className="mt-6">
            <TabsList>
              <TabsTrigger value="notificaciones">Notificaciones</TabsTrigger>
              <TabsTrigger value="parametros">Parámetros</TabsTrigger>
              <TabsTrigger value="catalogos">Catálogos</TabsTrigger>
            </TabsList>

            <TabsContent value="notificaciones" className="mt-5 space-y-6">
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Evento</TableHead>
                      <TableHead>Canal</TableHead>
                      <TableHead>Modo</TableHead>
                      <TableHead>Hora resumen</TableHead>
                      <TableHead>Destinatarios</TableHead>
                      <TableHead>Parámetro</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((row) => (
                      <TableRow key={row.event_id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[12.5px] text-muted-foreground">
                              #{row.event_id}
                            </span>
                            <span className="text-[13px] font-medium">{row.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">
                          {row.channel}
                        </TableCell>
                        <TableCell className="text-[13px]">{MODE_LABELS[row.mode]}</TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">
                          {row.mode === 'daily_digest' ? row.digest_time.slice(0, 5) : '—'}
                        </TableCell>
                        <TableCell className="max-w-[200px] text-[13px] text-muted-foreground">
                          {row.recipients.length > 0 ? `${row.recipients.length}` : 'Sin definir'}
                        </TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">
                          {row.event_id === 7
                            ? globalWarrantyDays !== null
                              ? `Global: ${globalWarrantyDays} días`
                              : 'Global (días)'
                            : row.event_id === 8 || row.event_id === 11
                              ? row.extra_param !== null
                                ? `${row.extra_param} días`
                                : '—'
                              : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.is_active ? 'secondary' : 'outline'}>
                            {row.is_active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Editar evento ${row.event_id}`}
                            onClick={() => setEditing(row)}
                          >
                            <Pencil />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-lg border border-border px-4 py-3.5">
                <p className="text-[13px] font-semibold">Excluidos (no generan notificación)</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  OT reabierta · Conteo físico con diferencias — decisiones explícitas de la spec
                  (ya visibles para Mantenimiento en su flujo).
                </p>
              </div>

              <div className="rounded-lg border border-border px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold">Fallos recientes</p>
                  <p className="text-[12px] text-muted-foreground">Últimos 20 envíos fallidos</p>
                </div>
                {failed.length === 0 ? (
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    Sin envíos fallidos registrados.
                  </p>
                ) : (
                  <div className="mt-2 divide-y divide-border">
                    {failed.map((row) => (
                      <div
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-[13px]">
                            <span className="font-mono text-[12px] text-muted-foreground">
                              #{row.event_id}
                            </span>{' '}
                            · {dateFormatter.format(new Date(row.created_at))}
                          </p>
                          <p className="truncate text-[12px] text-muted-foreground">
                            {row.error_detail ?? 'Error desconocido.'}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={retryingId === row.id}
                          onClick={() => void onRetry(row)}
                        >
                          {retryingId === row.id ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <RotateCcw />
                          )}
                          Reintentar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-[13px] text-muted-foreground">
                <Link className="font-medium text-primary underline-offset-2 hover:underline" to="/app/reportes?tab=programados">
                  Reportes programados →
                </Link>{' '}
                se gestionan en el módulo Reportes.
              </p>
            </TabsContent>

            <TabsContent value="parametros" className="mt-5 space-y-4">
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parámetro</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {params.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>
                          <p className="text-[13px] font-medium">
                            {PARAM_LABELS[row.key] ?? row.key}
                          </p>
                          <p className="font-mono text-[11.5px] text-muted-foreground">{row.key}</p>
                        </TableCell>
                        <TableCell>
                          {editingParam === row.key ? (
                            <Input
                              type="number"
                              min={0}
                              className="h-8 w-28"
                              value={paramDraft}
                              onChange={(event) => setParamDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void saveParam(row.key)
                                if (event.key === 'Escape') setEditingParam(null)
                              }}
                            />
                          ) : (
                            <span className="text-[13px] tabular-nums">{row.value}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingParam === row.key ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Guardar ${row.key}`}
                              onClick={() => void saveParam(row.key)}
                            >
                              <Check />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Editar ${row.key}`}
                              onClick={() => {
                                setEditingParam(row.key)
                                setParamDraft(row.value)
                              }}
                            >
                              <Pencil />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell>
                        <p className="text-[13px] font-medium">Duración de tokens de sesión</p>
                        <p className="text-[12px] text-muted-foreground">
                          Gestionada por Supabase Auth (solo lectura)
                        </p>
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">
                        access corto · refresh 7 días
                      </TableCell>
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell>
                        <p className="text-[13px] font-medium">Prefijos y formato de código</p>
                        <p className="text-[12px] text-muted-foreground">
                          Gestionados en Activos — catálogo de categorías (M1)
                        </p>
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">Módulo 1</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="catalogos" className="mt-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {CATALOG_LINKS.map((item) => {
                  const content = (
                    <div className="rounded-lg border border-border px-4 py-3.5">
                      <p className="text-[13.5px] font-medium">{item.label}</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {item.to ? 'Ir al listado (solo lectura).' : `Módulo ${item.module} — pendiente.`}
                      </p>
                    </div>
                  )
                  return item.to ? (
                    <Link key={item.label} to={item.to} className="transition-colors hover:border-primary/50">
                      {content}
                    </Link>
                  ) : (
                    <div key={item.label} className="opacity-70">
                      {content}
                    </div>
                  )
                })}
              </div>
              <Separator className="my-6" />
              <p className="text-[13px] text-muted-foreground">
                Cada catálogo respeta los permisos de su módulo dueño (decisión T2.8).
              </p>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {editing && (
        <EditEventDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          event={editing}
          globalWarrantyDays={globalWarrantyDays}
          onSaved={refresh}
        />
      )}
    </main>
  )
}
