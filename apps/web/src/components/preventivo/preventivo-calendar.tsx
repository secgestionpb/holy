import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth-store'
import { fetchWorkOrders, isTerminal, STATUS_LABELS, updateWo, type WoRow } from '@/lib/m2'
import { getPlans, type MaintenancePlan } from '@/lib/m3'

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const STATUS_DOT: Record<string, string> = {
  open: 'bg-blue-500',
  assigned: 'bg-violet-500',
  in_progress: 'bg-amber-500',
  waiting_parts: 'bg-orange-600',
  completed: 'bg-teal-500',
  closed: 'bg-emerald-600',
  cancelled: 'bg-rose-500',
}

function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}

type Projection = { key: string; label: string; planId: string }

export function PreventivoCalendar() {
  const navigate = useNavigate()
  const roles = useAuth((s) => s.roles)
  const canEdit = roles.includes('mantenimiento')

  const [today] = useState(() => new Date())
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [rows, setRows] = useState<WoRow[]>([])
  const [plans, setPlans] = useState<MaintenancePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([fetchWorkOrders(), getPlans()])
      .then(([woRows, planRows]) => {
        setRows(woRows)
        setPlans(planRows)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar el calendario.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const byDay = useMemo(() => {
    const map = new Map<string, WoRow[]>()
    for (const row of rows) {
      if (!row.scheduled_at) continue
      const key = dayKey(new Date(row.scheduled_at))
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return map
  }, [rows])

  const projections = useMemo(() => {
    const result = new Map<string, Projection[]>()
    const monthStart = new Date(cursor.y, cursor.m, 1)
    const monthEnd = new Date(cursor.y, cursor.m + 1, 1)
    for (const plan of plans) {
      if (!plan.is_active || plan.frequency_type !== 'time' || !plan.next_due_at || !plan.interval_value) continue
      const date = new Date(`${plan.next_due_at}T00:00:00`)
      const step = plan.interval_value
      let guard = 0
      while (date < monthStart && guard < 400) {
        date.setDate(date.getDate() + step)
        guard += 1
      }
      guard = 0
      while (date < monthEnd && guard < 400) {
        const key = dayKey(date)
        const list = result.get(key) ?? []
        list.push({ key: `${plan.id}:${key}`, label: plan.name, planId: plan.id })
        result.set(key, list)
        date.setDate(date.getDate() + step)
        guard += 1
      }
    }
    return result
  }, [plans, cursor])

  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1)
    const offset = (first.getDay() + 6) % 7
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
    const out: Array<{ key: string; day: number; inMonth: boolean }> = []
    for (let i = 0; i < offset; i += 1) {
      const d = new Date(cursor.y, cursor.m, 1 - (offset - i))
      out.push({ key: dayKey(d), day: d.getDate(), inMonth: false })
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      out.push({ key: dayKey(new Date(cursor.y, cursor.m, d)), day: d, inMonth: true })
    }
    const remaining = (7 - (out.length % 7)) % 7
    for (let i = 1; i <= remaining; i += 1) {
      const d = new Date(cursor.y, cursor.m, daysInMonth + i)
      out.push({ key: dayKey(d), day: d.getDate(), inMonth: false })
    }
    return out
  }, [cursor])

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const next = new Date(c.y, c.m + delta, 1)
      return { y: next.getFullYear(), m: next.getMonth() }
    })
  }

  async function dropOn(key: string) {
    setDragOver(null)
    if (!dragging || !canEdit) return
    const row = rows.find((r) => r.id === dragging)
    setDragging(null)
    if (!row) return
    const previous = row.scheduled_at ? dayKey(new Date(row.scheduled_at)) : null
    if (previous === key) return
    const original = row.scheduled_at ? new Date(row.scheduled_at) : null
    const time = original
      ? `${String(original.getHours()).padStart(2, '0')}:${String(original.getMinutes()).padStart(2, '0')}`
      : '09:00'
    const nextIso = new Date(`${key}T${time}:00`).toISOString()
    const result = await updateWo(row.id, { scheduled_at: nextIso })
    if (!result.ok) {
      toast.error(result.message || 'No se pudo reprogramar la OT.')
      return
    }
    toast.success(`${row.wo_number} reprogramada al ${key}.`)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[150px] text-center text-[15px] font-semibold capitalize">
            {monthLabel(cursor.y, cursor.m)}
          </span>
          <Button variant="outline" size="sm" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>
            Hoy
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> Abierta</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> En curso</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-teal-500" /> Completada</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-600" /> Cerrada</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-primary" /> Proyección de plan</span>
          <Button variant="ghost" size="sm" onClick={load} aria-label="Actualizar calendario">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {canEdit && (
        <p className="text-[12.5px] text-muted-foreground">
          Arrastra una OT a otro día para reprogramarla (se mueve su fecha programada; queda en el historial de la OT).
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando calendario…
        </div>
      ) : error ? (
        <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <span className="flex items-center gap-2"><TriangleAlert className="h-4 w-4 text-destructive" /> {error}</span>
          <Button variant="outline" size="sm" onClick={load}>Reintentar</Button>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="px-1 pb-1 text-center text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              {wd}
            </div>
          ))}
          {cells.map((cell) => {
            const dayRows = byDay.get(cell.key) ?? []
            const dayProjections = projections.get(cell.key) ?? []
            const isToday = cell.key === dayKey(today)
            const isDropTarget = dragOver === cell.key && canEdit
            return (
              <div
                key={cell.key}
                onDragOver={(e) => {
                  if (!canEdit || !dragging) return
                  e.preventDefault()
                  setDragOver(cell.key)
                }}
                onDragLeave={() => setDragOver((k) => (k === cell.key ? null : k))}
                onDrop={(e) => {
                  e.preventDefault()
                  void dropOn(cell.key)
                }}
                className={[
                  'min-h-[92px] rounded-md border p-1.5 transition-colors',
                  cell.inMonth ? 'bg-card' : 'bg-muted/40',
                  isToday ? 'border-primary ring-1 ring-primary/40' : 'border-border',
                  isDropTarget ? 'border-primary bg-primary/10' : '',
                ].join(' ')}
              >
                <div className={['mb-1 text-right text-[11.5px] font-medium', cell.inMonth ? 'text-foreground' : 'text-muted-foreground/60'].join(' ')}>
                  {cell.day}
                </div>
                <div className="space-y-1">
                  {dayRows.map((row) => {
                    const overdue =
                      row.scheduled_at && !isTerminal(row.status) && dayKey(new Date(row.scheduled_at)) < dayKey(today)
                    const draggable = canEdit && !isTerminal(row.status)
                    return (
                      <div
                        key={row.id}
                        draggable={draggable}
                        onDragStart={() => setDragging(row.id)}
                        onDragEnd={() => {
                          setDragging(null)
                          setDragOver(null)
                        }}
                        onClick={() => navigate(`/app/ordenes/${row.id}`)}
                        title={`${row.wo_number} · ${STATUS_LABELS[row.status]} · ${row.asset_name ?? ''}`}
                        className={[
                          'flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight',
                          'border border-border bg-background hover:bg-accent',
                          draggable ? 'cursor-grab active:cursor-grabbing' : '',
                          dragging === row.id ? 'opacity-50' : '',
                          overdue ? 'border-l-2 border-l-red-500' : '',
                        ].join(' ')}
                      >
                        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[row.status] ?? 'bg-gray-400'}`} />
                        <span className="truncate font-medium">{row.wo_number}</span>
                        <span className="truncate text-muted-foreground">{row.asset_code ?? ''}</span>
                      </div>
                    )
                  })}
                  {dayProjections.map((proj) => (
                    <div
                      key={proj.key}
                      title={`Proyección del plan «${proj.label}» (aún sin OT)`}
                      className="flex items-center gap-1 rounded border border-dashed border-primary/50 px-1 py-0.5 text-[11px] leading-tight text-muted-foreground"
                    >
                      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-sm border border-primary" />
                      <span className="truncate">{proj.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
