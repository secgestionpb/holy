import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, PackageX, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  fetchItems,
  fetchProbableItems,
  fetchReturnedQty,
  fetchStockCells,
  formatMoney,
  formatQty,
  m4Consume,
  m4Return,
  UNIT_LABELS,
  type ItemRow,
  type KardexRow,
  type StockCellRow,
} from '@/lib/m4'
import { type WoRow } from '@/lib/m2'

function ServerError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
    >
      {message}
    </div>
  )
}

// ============ F2.5 — Picker de consumo en OT (F4.4) ============

const consumeSchema = z.object({
  item_id: z.string().min(1, 'Selecciona el ítem.'),
  warehouse_id: z.string().min(1, 'Selecciona la bodega de salida.'),
  qty: z.string().refine((v) => Number(v) > 0, 'La cantidad debe ser mayor a 0.'),
  note: z.string().trim(),
})

type ConsumeValues = z.infer<typeof consumeSchema>

export function ConsumeDialog({
  open,
  onOpenChange,
  wo,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  wo: WoRow
  onSaved: () => void
}) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])
  const [stockCells, setStockCells] = useState<StockCellRow[]>([])
  const [loading, setLoading] = useState(false)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ConsumeValues>({
    resolver: zodResolver(consumeSchema),
    defaultValues: { item_id: '', warehouse_id: '', qty: '', note: '' },
  })

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setServerError(null)
    reset({ item_id: '', warehouse_id: '', qty: '', note: '' })
    Promise.all([fetchItems(), fetchStockCells()])
      .then(([itemRows, cellRows]) => {
        if (!alive) return
        setItems(itemRows.filter((row) => row.is_active))
        setStockCells(cellRows)
      })
      .catch((err: unknown) => {
        if (alive) setServerError(err instanceof Error ? err.message : 'No se pudo cargar el inventario.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, reset])

  const itemId = useWatch({ control, name: 'item_id' }) ?? ''
  const warehouseId = useWatch({ control, name: 'warehouse_id' }) ?? ''
  const qtyRaw = watch('qty')

  // Ítems con al menos una fila de stock (recepcionados en alguna bodega)
  const itemsWithStock = items.filter((item) =>
    stockCells.some((cell) => cell.item_id === item.id),
  )
  const cellForWarehouse = stockCells.find(
    (cell) => cell.item_id === itemId && cell.warehouse_id === warehouseId,
  )
  const itemCells = stockCells.filter((cell) => cell.item_id === itemId)
  const qty = Number(qtyRaw) > 0 ? Number(qtyRaw) : 0
  const wouldGoNegative = cellForWarehouse !== undefined && qty > 0 && Number(cellForWarehouse.qty) - qty < 0
  const negativeMessage = wouldGoNegative && cellForWarehouse
    ? `El stock de esta bodega quedará en ${formatQty(Number(cellForWarehouse.qty) - qty)}. Se permite (el consumo nunca bloquea la OT), pero se disparará el Evento 4 «Stock negativo».`
    : null

  async function onSubmit(values: ConsumeValues) {
    setServerError(null)
    const result = await m4Consume({
      woId: wo.id,
      itemId: values.item_id,
      warehouseId: values.warehouse_id,
      qty: Number(values.qty),
      note: values.note || null,
    })
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    toast.success(`Consumo registrado · ${formatMoney(result.line_total ?? 0)} (costo congelado)`)
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar consumo de repuesto</DialogTitle>
          <DialogDescription>
            Salida por OT (F4.4) sobre <span className="font-medium">{wo.wo_number}</span>. El costo
            se congela al momento del consumo; el estado de la OT no cambia automáticamente.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[14px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando inventario…
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label>Ítem</Label>
              <Select value={itemId || ''} onValueChange={(v) => { setValue('item_id', v, { shouldDirty: true }); setValue('warehouse_id', '', { shouldDirty: true }) }}>
                <SelectTrigger aria-label="Ítem" className="w-full">
                  <SelectValue placeholder="Repuesto o suministro…" />
                </SelectTrigger>
                <SelectContent>
                  {itemsWithStock.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.code} — {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.item_id && <p role="alert" className="text-[13px] text-destructive">{errors.item_id.message}</p>}
              {itemId && itemsWithStock.length > 0 && !itemsWithStock.some((i) => i.id === itemId) && (
                <p className="text-[12.5px] text-muted-foreground">Ítem ya no disponible.</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Bodega de salida</Label>
                <Select value={warehouseId || ''} onValueChange={(v) => setValue('warehouse_id', v, { shouldDirty: true })}>
                  <SelectTrigger aria-label="Bodega de salida" className="w-full">
                    <SelectValue placeholder={itemId ? 'Bodega…' : 'Primero elige el ítem'} />
                  </SelectTrigger>
                  <SelectContent>
                    {itemCells.map((cell) => (
                      <SelectItem key={cell.warehouse_id} value={cell.warehouse_id}>
                        {cell.warehouse_name} · stock {formatQty(cell.qty)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.warehouse_id && <p role="alert" className="text-[13px] text-destructive">{errors.warehouse_id.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="consume-qty">Cantidad</Label>
                <Input id="consume-qty" type="number" min="0" step="any" inputMode="decimal" aria-invalid={errors.qty ? true : undefined} {...register('qty')} />
                {errors.qty && <p role="alert" className="text-[13px] text-destructive">{errors.qty.message}</p>}
              </div>
            </div>

            {cellForWarehouse && (
              <div className="rounded-md border border-border bg-muted/40 px-3.5 py-2.5 text-[13px]">
                Stock actual: <span className="font-medium tabular-nums">{formatQty(cellForWarehouse.qty)}</span>
                {' · '}Costo unitario: <span className="font-medium tabular-nums">{formatMoney(items.find((i) => i.id === itemId)?.unit_cost ?? 0)}</span>
                {' · '}Unidad: {UNIT_LABELS[cellForWarehouse.unit]}
              </div>
            )}

            {negativeMessage && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[13px] leading-snug text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>{negativeMessage}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="consume-note">Nota (opcional)</Label>
              <Textarea id="consume-note" rows={2} placeholder="Uso en la reparación…" {...register('note')} />
            </div>

            <ServerError message={serverError} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="animate-spin" /> : null}
                Registrar consumo
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============ V2.6 / F2.9 — Devolución a bodega por línea ============

const returnSchema = z.object({
  qty: z.string().refine((v) => Number(v) > 0, 'La cantidad a devolver debe ser mayor a 0.'),
  destiny_warehouse_id: z.string().min(1, 'Selecciona la bodega destino.'),
  reason: z.string().trim().min(1, 'El motivo de la devolución es obligatorio.'),
})

type ReturnValues = z.infer<typeof returnSchema>

export function ReturnDialog({
  open,
  onOpenChange,
  movement,
  warehouses,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  movement: KardexRow | null
  warehouses: Array<{ id: string; name: string; is_active: boolean }>
  onSaved: () => void
}) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [available, setAvailable] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ReturnValues>({
    resolver: zodResolver(returnSchema),
    defaultValues: { qty: '', destiny_warehouse_id: '', reason: '' },
  })

  useEffect(() => {
    if (!open || !movement) return
    let alive = true
    setLoading(true)
    setServerError(null)
    setValue('destiny_warehouse_id', movement.warehouse_id, { shouldDirty: false })
    fetchReturnedQty(movement.id)
      .then((returned) => {
        if (!alive) return
        setAvailable(Math.abs(Number(movement.qty)) - returned)
      })
      .catch((err: unknown) => {
        if (alive) setServerError(err instanceof Error ? err.message : 'No se pudo cargar la línea.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, movement, setValue])

  if (!movement) return null
  const destinyValue = watch('destiny_warehouse_id') || movement.warehouse_id

  async function onSubmit(values: ReturnValues) {
    if (!movement) return
    setServerError(null)
    const result = await m4Return({
      movementId: movement.id,
      qty: Number(values.qty),
      destinyWarehouseId: values.destiny_warehouse_id,
      reason: values.reason,
    })
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    toast.success(`Devolución registrada · ${formatMoney(result.line_total ?? 0)} · disponible restante: ${formatQty(result.remaining_available ?? 0)}`)
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Devolver a bodega</DialogTitle>
          <DialogDescription>
            Devolución por línea (F2.9): devuelve contra la salida original de{' '}
            <span className="font-medium">{movement.item_code} — {movement.item_name}</span>. El costo
            conserva el congelado de la OT.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[14px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Calculando lo disponible…
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 px-3.5 py-2.5 text-[13px]">
              Consumido en la línea: <span className="font-medium tabular-nums">{formatQty(Math.abs(Number(movement.qty)))}</span>
              {' · '}Ya devuelto:{' '}
              <span className="font-medium tabular-nums">
                {formatQty(Math.abs(Number(movement.qty)) - (available ?? 0))}
              </span>
              {' · '}Máximo a devolver:{' '}
              <span className="font-medium tabular-nums">{formatQty(available ?? 0)}</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ret-qty">Cantidad a devolver</Label>
                <Input
                  id="ret-qty"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  aria-invalid={errors.qty ? true : undefined}
                  {...register('qty')}
                />
                {errors.qty && <p role="alert" className="text-[13px] text-destructive">{errors.qty.message}</p>}
              </div>

              <div className="space-y-2">
                <Label>Bodega destino</Label>
                <Select value={destinyValue || ''} onValueChange={(v) => setValue('destiny_warehouse_id', v, { shouldDirty: true })}>
                  <SelectTrigger aria-label="Bodega destino" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses
                      .filter((wh) => wh.is_active)
                      .map((wh) => (
                        <SelectItem key={wh.id} value={wh.id}>
                          {wh.name}
                          {wh.id === movement.warehouse_id ? ' (origen de la salida)' : ''}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {errors.destiny_warehouse_id && <p role="alert" className="text-[13px] text-destructive">{errors.destiny_warehouse_id.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ret-reason">Motivo (obligatorio)</Label>
              <Input id="ret-reason" placeholder="Ej. No se usó, sobró material…" aria-invalid={errors.reason ? true : undefined} {...register('reason')} />
              {errors.reason && <p role="alert" className="text-[13px] text-destructive">{errors.reason.message}</p>}
            </div>

            <ServerError message={serverError} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={isSubmitting || (available ?? 0) <= 0}>
                {isSubmitting ? <Loader2 className="animate-spin" /> : null}
                Registrar devolución
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============ "Ver repuestos probables" (item_asset_links — cross M1) ============

export function ProbablesDialog({
  open,
  onOpenChange,
  assetId,
  categoryId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  assetId: string | null
  categoryId: string | null
}) {
  const [items, setItems] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !assetId) return
    let alive = true
    setLoading(true)
    setError(null)
    fetchProbableItems(assetId, categoryId)
      .then((rows) => {
        if (alive) setItems(rows)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'No se pudieron cargar los repuestos.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, assetId, categoryId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Repuestos probables</DialogTitle>
          <DialogDescription>
            Ítems vinculados a este activo o a su categoría (item_asset_links, N:N dinámico). La
            sugerencia es informativa: nunca bloquea la OT.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[14px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando repuestos…
          </div>
        ) : error ? (
          <p className="py-6 text-center text-[14px] text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <div className="py-8 text-center">
            <PackageX className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 text-[14px] text-muted-foreground">
              Sin repuestos vinculados a este activo ni a su categoría.
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Vincúlalos desde Inventario → Ítems → edición del ítem (sección de vínculos).
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="hidden sm:table-cell">Unidad</TableHead>
                  <TableHead className="text-right">Stock total</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Costo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-[12.5px] font-medium">{item.code}</TableCell>
                    <TableCell className="text-[13.5px]">
                      {item.name}
                      {item.has_negative && (
                        <Badge variant="destructive" className="ml-2 text-[11px]">negativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-[13px] text-muted-foreground sm:table-cell">
                      {UNIT_LABELS[item.unit]}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(item.stock_total)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {formatMoney(item.unit_cost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
