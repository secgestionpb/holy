import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { fetchUsersLite, type UserLite } from '@/lib/m1'
import {
  COUNT_STATUS_BADGE_CLASS,
  COUNT_STATUS_LABELS,
  countScopeLabel,
  COUNT_SCOPE_LABELS,
  fetchCount,
  fetchCountItems,
  fetchItemCategories,
  fetchWarehouses,
  formatQty,
  m4CountCancel,
  m4CountConfirm,
  m4CountCreate,
  saveCountItem,
  type CountItemRow,
  type CountRow,
  type ItemCategoryRow,
  type WarehouseRow,
} from '@/lib/m4'

function today() {
  return new Date().toISOString().slice(0, 10)
}

// V4.4 — Crear (`/conteo/nuevo`) y levantar (`/conteo/:id`) conteos físicos.
export default function Conteo() {
  const { id } = useParams<{ id: string }>()
  return id ? <CountDetail id={id} /> : <CountCreate />
}

// ============ Crear conteo ============

function CountCreate() {
  const navigate = useNavigate()
  const roles = useAuth((s) => s.roles)
  const currentUser = useAuth((s) => s.user)
  const canEdit = roles.includes('mantenimiento')

  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [categories, setCategories] = useState<ItemCategoryRow[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [warehouseId, setWarehouseId] = useState('')
  const [scopeType, setScopeType] = useState<'warehouse' | 'category'>('warehouse')
  const [categoryId, setCategoryId] = useState('')
  const [countDate, setCountDate] = useState(today())
  const [responsibleId, setResponsibleId] = useState('')

  useEffect(() => {
    if (!canEdit) {
      setLoading(false)
      return
    }
    let alive = true
    Promise.all([fetchWarehouses(), fetchItemCategories(), fetchUsersLite()])
      .then(([warehouseRows, categoryRows, userRows]) => {
        if (!alive) return
        setWarehouses(warehouseRows.filter((wh) => wh.is_active))
        setCategories(categoryRows.filter((cat) => cat.is_active))
        setUsers(userRows.filter((user) => user.is_active))
        setResponsibleId(currentUser?.id ?? '')
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el formulario.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [canEdit, currentUser])

  async function onSubmit() {
    if (!warehouseId) {
      setServerError('Selecciona la bodega a contar.')
      return
    }
    if (scopeType === 'category' && !categoryId) {
      setServerError('Selecciona la categoría a contar.')
      return
    }
    setServerError(null)
    setSubmitting(true)
    try {
      const result = await m4CountCreate({
        warehouseId,
        scopeType,
        scopeCategoryId: scopeType === 'category' ? categoryId : null,
        countDate,
        responsibleId: responsibleId || null,
      })
      if (!result.ok) {
        setServerError(result.message)
        return
      }
      if (!result.id) {
        setServerError('El conteo se creó sin identificador; recarga e inténtalo de nuevo.')
        return
      }
      toast.success('Conteo iniciado.')
      navigate(`/app/inventario/conteo/${result.id}`, { replace: true })
    } finally {
      setSubmitting(false)
    }
  }

  if (!canEdit) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-[15px] text-muted-foreground">
            Solo el rol Mantenimiento puede iniciar conteos físicos.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate('/app/inventario?tab=counts')}>
            Volver a conteos
          </Button>
        </div>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto flex max-w-4xl items-center justify-center gap-2 text-[14px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Cargando formulario…
        </div>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-[15px] text-destructive">{loadError}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate('/app/inventario?tab=counts')}>
            Volver a conteos
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          onClick={() => navigate('/app/inventario?tab=counts')}
        >
          <ArrowLeft className="size-3.5" />
          Conteo físico
        </button>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-heading text-[clamp(1.5rem,2.4vw,2rem)] font-extrabold tracking-[-0.02em]">
              Nuevo conteo físico
            </h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              El sistema copia el stock teórico al iniciar; luego se levanta el conteo y se
              confirman los ajustes (F4.8).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/app/inventario?tab=counts')}>
              Cancelar
            </Button>
            <Button onClick={() => void onSubmit()} disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Check />}
              Iniciar conteo
            </Button>
          </div>
        </div>

        <div className="mt-6 space-y-5 rounded-lg border border-border p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Bodega</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger aria-label="Bodega" className="w-full">
                  <SelectValue placeholder="Selecciona la bodega" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Alcance</Label>
              <Select
                value={scopeType}
                onValueChange={(value) => {
                  setScopeType(value as 'warehouse' | 'category')
                  setCategoryId('')
                }}
              >
                <SelectTrigger aria-label="Alcance" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warehouse">{COUNT_SCOPE_LABELS.warehouse}</SelectItem>
                  <SelectItem value="category">{COUNT_SCOPE_LABELS.category}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scopeType === 'category' && (
              <div className="space-y-2">
                <Label>Categoría de ítem</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger aria-label="Categoría de ítem" className="w-full">
                    <SelectValue placeholder="Selecciona la categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="count-date">Fecha del conteo</Label>
              <Input
                id="count-date"
                type="date"
                value={countDate}
                max={today()}
                onChange={(event) => setCountDate(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Responsable</Label>
              <Select value={responsibleId} onValueChange={setResponsibleId}>
                <SelectTrigger aria-label="Responsable" className="w-full">
                  <SelectValue placeholder="Selecciona el responsable" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {serverError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
            >
              {serverError}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

// ============ Levantar conteo ============

type RowDraft = {
  counted: string
  observation: string
}

function CountDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const roles = useAuth((s) => s.roles)
  const canEdit = roles.includes('mantenimiento')

  const [count, setCount] = useState<CountRow | null>(null)
  const [rows, setRows] = useState<CountItemRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [actionBusy, setActionBusy] = useState(false)

  const reload = useCallback(async () => {
    const [countRow, itemRows] = await Promise.all([fetchCount(id), fetchCountItems(id)])
    if (!countRow) throw new Error('Conteo inexistente.')
    setCount(countRow)
    setRows(itemRows)
    setDrafts(
      Object.fromEntries(
        itemRows.map((row) => [
          row.item_id,
          {
            counted: row.counted === null || row.counted === undefined ? '' : String(row.counted),
            observation: row.observation ?? '',
          },
        ]),
      ),
    )
    return { countRow, itemRows }
  }, [id])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(null)
    reload()
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el conteo.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reload])

  const editable = canEdit && count?.status === 'in_progress'

  const countedCount = useMemo(
    () => rows.filter((row) => row.counted !== null && row.counted !== undefined).length,
    [rows],
  )
  const diffCount = useMemo(
    () =>
      rows.filter((row) => {
        if (row.counted === null || row.counted === undefined) return false
        return Number(row.counted) !== Number(row.theoretical)
      }).length,
    [rows],
  )

  function onDraftChange(itemId: string, patch: Partial<RowDraft>) {
    setDrafts((current) => {
      const base = current[itemId] ?? { counted: '', observation: '' }
      return { ...current, [itemId]: { ...base, ...patch } }
    })
  }

  async function persistRow(itemId: string) {
    if (!editable) return
    const draft = drafts[itemId]
    if (!draft) return
    const countedRaw = draft.counted.trim()
    const counted = countedRaw === '' ? null : Number(countedRaw)
    if (counted !== null && !Number.isFinite(counted)) {
      toast.error('El conteo debe ser numérico.')
      return
    }
    const original = rows.find((row) => row.item_id === itemId)
    if (!original) return
    const originalCounted = original.counted
    const originalObservation = original.observation ?? ''
    if (counted === originalCounted && draft.observation === originalObservation) return

    setSavingIds((current) => new Set(current).add(itemId))
    try {
      const result = await saveCountItem(id, itemId, {
        counted,
        observation: draft.observation.trim() || null,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setRows((current) =>
        current.map((row) =>
          row.item_id === itemId
            ? {
                ...row,
                counted,
                observation: draft.observation.trim() || null,
                difference: counted === null ? null : counted - Number(row.theoretical),
              }
            : row,
        ),
      )
    } finally {
      setSavingIds((current) => {
        const next = new Set(current)
        next.delete(itemId)
        return next
      })
    }
  }

  async function onConfirm() {
    if (!window.confirm('¿Confirmar el conteo? Se generarán los ajustes de stock correspondientes.')) return
    setActionBusy(true)
    try {
      const result = await m4CountConfirm(id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(
        `Conteo confirmado${typeof result.adjustments === 'number' ? ` · ${result.adjustments} ajuste(s)` : ''}.`,
      )
      await reload()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'No se pudo confirmar el conteo.')
    } finally {
      setActionBusy(false)
    }
  }

  async function onCancelCount() {
    const reason = window.prompt('Motivo de cancelación del conteo:')
    if (reason === null) return
    if (!reason.trim()) {
      toast.error('El motivo es obligatorio.')
      return
    }
    setActionBusy(true)
    try {
      const result = await m4CountCancel(id, reason.trim())
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Conteo cancelado.')
      await reload()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cancelar el conteo.')
    } finally {
      setActionBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto flex max-w-5xl items-center justify-center gap-2 text-[14px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Cargando conteo…
        </div>
      </main>
    )
  }

  if (loadError || !count) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-[15px] text-destructive">{loadError ?? 'Conteo inexistente.'}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate('/app/inventario?tab=counts')}>
            Volver a conteos
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          onClick={() => navigate('/app/inventario?tab=counts')}
        >
          <ArrowLeft className="size-3.5" />
          Conteo físico
        </button>

        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-heading text-[clamp(1.5rem,2.4vw,2rem)] font-extrabold tracking-[-0.02em]">
                {count.warehouse_name}
              </h1>
              <Badge variant="secondary" className={COUNT_STATUS_BADGE_CLASS[count.status]}>
                {COUNT_STATUS_LABELS[count.status]}
              </Badge>
            </div>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              {countScopeLabel(count)} · {count.count_date} · {count.responsible_name ?? '—'}
            </p>
          </div>

          {editable && (
            <div className="flex items-center gap-2">
              <Button variant="outline" disabled={actionBusy} onClick={() => void onCancelCount()}>
                {actionBusy ? <Loader2 className="animate-spin" /> : <X />}
                Cancelar conteo
              </Button>
              <Button disabled={actionBusy} onClick={() => void onConfirm()}>
                {actionBusy ? <Loader2 className="animate-spin" /> : <Check />}
                Confirmar conteo
              </Button>
            </div>
          )}
        </div>

        {!editable && (
          <p className="mt-3 text-[13.5px] text-muted-foreground">
            {count.status === 'confirmed' &&
              `Confirmado${count.confirmed_by_name ? ` por ${count.confirmed_by_name}` : ''}${count.confirmed_at ? ` el ${count.confirmed_at}` : ''}.`}
            {count.status === 'cancelled' &&
              `Cancelado${count.cancel_reason ? `: ${count.cancel_reason}` : '.'}`}
            {count.status === 'in_progress' && !canEdit && 'En proceso (solo lectura para tu rol).'}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border px-3.5 py-3">
            <p className="text-[12.5px] text-muted-foreground">Ítems en el conteo</p>
            <p className="mt-0.5 text-[20px] font-semibold tabular-nums">{rows.length}</p>
          </div>
          <div className="rounded-lg border border-border px-3.5 py-3">
            <p className="text-[12.5px] text-muted-foreground">Contados</p>
            <p className="mt-0.5 text-[20px] font-semibold tabular-nums">{countedCount}</p>
          </div>
          <div className="rounded-lg border border-border px-3.5 py-3">
            <p className="text-[12.5px] text-muted-foreground">Con diferencia</p>
            <p className="mt-0.5 text-[20px] font-semibold tabular-nums">{diffCount}</p>
          </div>
          <div className="rounded-lg border border-border px-3.5 py-3">
            <p className="text-[12.5px] text-muted-foreground">Ajustes (DB)</p>
            <p className="mt-0.5 text-[20px] font-semibold tabular-nums">{count.counted_items}</p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[130px]">Código</TableHead>
                <TableHead>Ítem</TableHead>
                <TableHead className="hidden sm:table-cell">Unidad</TableHead>
                <TableHead className="text-right">Teórico</TableHead>
                <TableHead className="text-right">Contado</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                <TableHead className="hidden md:table-cell">Observación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-[13.5px] text-muted-foreground">
                    El conteo no incluye ítems (bodega vacía o alcance por categoría sin stock).
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const draft = drafts[row.item_id] ?? { counted: '', observation: '' }
                  const counted = draft.counted.trim()
                  const countedNum = counted === '' ? null : Number(counted)
                  const diff =
                    countedNum !== null && Number.isFinite(countedNum)
                      ? countedNum - Number(row.theoretical)
                      : null
                  const isSaving = savingIds.has(row.item_id)
                  return (
                    <TableRow key={row.item_id}>
                      <TableCell className="font-mono text-[12.5px]">{row.item_code}</TableCell>
                      <TableCell className="text-[13.5px]">{row.item_name}</TableCell>
                      <TableCell className="hidden sm:table-cell text-[13px] text-muted-foreground">
                        {row.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[13.5px]">
                        {formatQty(row.theoretical)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isSaving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            min="0"
                            className="h-8 w-[104px] text-right tabular-nums"
                            aria-label={`Contado ${row.item_code}`}
                            disabled={!editable}
                            value={draft.counted}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              onDraftChange(row.item_id, { counted: event.target.value })
                            }
                            onBlur={() => void persistRow(row.item_id)}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[13.5px]">
                        {diff === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={
                              diff === 0
                                ? 'text-muted-foreground'
                                : diff < 0
                                  ? 'font-semibold text-destructive'
                                  : 'font-semibold text-amber-600 dark:text-amber-400'
                            }
                          >
                            {diff > 0 ? '+' : ''}
                            {formatQty(diff)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Input
                          className="h-8 min-w-[160px] text-[13px]"
                          aria-label={`Observación ${row.item_code}`}
                          placeholder="Opcional"
                          disabled={!editable}
                          value={draft.observation}
                          onChange={(event) =>
                            onDraftChange(row.item_id, { observation: event.target.value })
                          }
                          onBlur={() => void persistRow(row.item_id)}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        <p className="mt-3 text-[13px] text-muted-foreground">
          El avance se guarda al salir del campo. Al confirmar, cada diferencia genera un Ajuste
          con motivo «Conteo físico» y auditoría M4.
        </p>
      </div>
    </main>
  )
}
