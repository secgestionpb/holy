import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
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
import { formatQty, m4Adjust, m4Entry, m4Transfer, type ItemRow, type StockCellRow, type WarehouseRow } from '@/lib/m4'
import { type ProviderLite } from '@/lib/m2'

const today = () => new Date().toISOString().slice(0, 10)

const NONE = 'none'

type CommonProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ItemRow[]
  warehouses: WarehouseRow[]
  stockCells: StockCellRow[]
  initialItemId?: string
  initialWarehouseId?: string
  onSaved: () => void
}

function itemLabel(item: ItemRow): string {
  return `${item.code} — ${item.name}`
}

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

function Warning({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[13px] leading-snug text-amber-700 dark:text-amber-400">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

// ============ M4.1 — Registrar Entrada ============

const entrySchema = z.object({
  item_id: z.string().min(1, 'Selecciona el ítem.'),
  warehouse_id: z.string().min(1, 'Selecciona la bodega destino.'),
  qty: z.string().refine((v) => Number(v) > 0, 'La cantidad debe ser mayor a 0.'),
  unit_cost: z.string().refine((v) => Number(v) > 0, 'El costo unitario debe ser mayor a 0.'),
  occurred_at: z.string().min(1, 'Indica la fecha.'),
  provider_id: z.string(),
  document_number: z.string().trim().min(1, 'El nº de factura/documento es obligatorio.'),
  note: z.string().trim(),
})

type EntryValues = z.infer<typeof entrySchema>

export function EntryDialog({
  open,
  onOpenChange,
  items,
  warehouses,
  providers,
  initialItemId,
  initialWarehouseId,
  onSaved,
}: CommonProps & { providers?: ProviderLite[] }) {
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<EntryValues>({
    resolver: zodResolver(entrySchema),
    defaultValues: {
      item_id: initialItemId ?? '',
      warehouse_id: initialWarehouseId ?? '',
      qty: '',
      unit_cost: '',
      occurred_at: today(),
      provider_id: '',
      document_number: '',
      note: '',
    },
  })

  const itemId = useWatch({ control, name: 'item_id' }) ?? ''

  // Default: proveedor preferido del ítem (M4.1), salvo que elija otro.
  useEffect(() => {
    if (!open || !itemId) return
    const item = items.find((row) => row.id === itemId)
    if (item?.preferred_provider_id) setValue('provider_id', item.preferred_provider_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, open])

  async function onSubmit(values: EntryValues) {
    setServerError(null)
    const result = await m4Entry({
      itemId: values.item_id,
      warehouseId: values.warehouse_id,
      qty: Number(values.qty),
      unitCost: Number(values.unit_cost),
      occurredAt: values.occurred_at,
      providerId: values.provider_id || null,
      documentNumber: values.document_number,
      note: values.note || null,
    })
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    toast.success(`Entrada registrada · stock resultante: ${formatQty(result.new_qty ?? 0)}`)
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar entrada de material</DialogTitle>
          <DialogDescription>
            Material YA recepcionado (F4.3): suma stock, escribe el último costo de compra del ítem
            y registra la factura en el kardex. Sin notificaciones.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label>Ítem</Label>
            <Select value={watch('item_id') || ''} onValueChange={(v) => setValue('item_id', v, { shouldDirty: true })}>
              <SelectTrigger aria-label="Ítem" className="w-full">
                <SelectValue placeholder="Selecciona el ítem…" />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {itemLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.item_id && <p role="alert" className="text-[13px] text-destructive">{errors.item_id.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Bodega destino</Label>
              <Select value={watch('warehouse_id') || ''} onValueChange={(v) => setValue('warehouse_id', v, { shouldDirty: true })}>
                <SelectTrigger aria-label="Bodega destino" className="w-full">
                  <SelectValue placeholder="Bodega…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses
                    .filter((wh) => wh.is_active)
                    .map((wh) => (
                      <SelectItem key={wh.id} value={wh.id}>
                        {wh.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {errors.warehouse_id && <p role="alert" className="text-[13px] text-destructive">{errors.warehouse_id.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="entry-date">Fecha</Label>
              <Input id="entry-date" type="date" {...register('occurred_at')} />
              {errors.occurred_at && <p role="alert" className="text-[13px] text-destructive">{errors.occurred_at.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="entry-qty">Cantidad (&gt; 0)</Label>
              <Input id="entry-qty" type="number" min="0" step="any" inputMode="decimal" placeholder="Ej. 10" aria-invalid={errors.qty ? true : undefined} {...register('qty')} />
              {errors.qty && <p role="alert" className="text-[13px] text-destructive">{errors.qty.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="entry-cost">Costo unitario (&gt; 0)</Label>
              <Input id="entry-cost" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Ej. 12.50" aria-invalid={errors.unit_cost ? true : undefined} {...register('unit_cost')} />
              {errors.unit_cost && <p role="alert" className="text-[13px] text-destructive">{errors.unit_cost.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="entry-doc">Nº factura / documento (obligatorio)</Label>
              <Input id="entry-doc" placeholder="Ej. FAC-00123" aria-invalid={errors.document_number ? true : undefined} {...register('document_number')} />
              {errors.document_number && <p role="alert" className="text-[13px] text-destructive">{errors.document_number.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>Proveedor (opcional)</Label>
              <Select value={watch('provider_id') || NONE} onValueChange={(v) => setValue('provider_id', v === NONE ? '' : v, { shouldDirty: true })}>
                <SelectTrigger aria-label="Proveedor" className="w-full">
                  <SelectValue placeholder="Proveedor preferido del ítem" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin proveedor</SelectItem>
                  {(providers ?? []).map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="entry-note">Nota (opcional)</Label>
            <Textarea id="entry-note" rows={2} placeholder="Referencia interna…" {...register('note')} />
          </div>

          <ServerError message={serverError} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : null}
              Registrar entrada
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ============ M4.2 — Ajuste de stock ============

const adjustSchema = z.object({
  item_id: z.string().min(1, 'Selecciona el ítem.'),
  warehouse_id: z.string().min(1, 'Selecciona la bodega.'),
  direction: z.enum(['up', 'down']),
  qty: z.string().refine((v) => Number(v) > 0, 'La cantidad debe ser mayor a 0.'),
  reason: z.string().trim().min(1, 'El motivo del ajuste es obligatorio.'),
  note: z.string().trim(),
})

type AdjustValues = z.infer<typeof adjustSchema>

export function AdjustDialog({
  open,
  onOpenChange,
  items,
  warehouses,
  stockCells,
  initialItemId,
  initialWarehouseId,
  onSaved,
}: CommonProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AdjustValues>({
    resolver: zodResolver(adjustSchema),
    defaultValues: {
      item_id: initialItemId ?? '',
      warehouse_id: initialWarehouseId ?? '',
      direction: 'up',
      qty: '',
      reason: '',
      note: '',
    },
  })

  const itemId = watch('item_id')
  const warehouseId = watch('warehouse_id')
  const direction = watch('direction')
  const qtyRaw = watch('qty')

  const currentQty = stockCells.find(
    (cell) => cell.item_id === itemId && cell.warehouse_id === warehouseId,
  )?.qty ?? 0
  const qty = Number(qtyRaw) > 0 ? Number(qtyRaw) : 0
  const resultQty = direction === 'up' ? currentQty + qty : currentQty - qty
  const negativeWarning =
    qty > 0 && resultQty < 0
      ? `El stock quedará en ${formatQty(resultQty)}. Se permite (regla global), pero se disparará el Evento 4 «Stock negativo».`
      : null

  async function onSubmit(values: AdjustValues) {
    setServerError(null)
    const delta = values.direction === 'up' ? Number(values.qty) : -Number(values.qty)
    const result = await m4Adjust({
      itemId: values.item_id,
      warehouseId: values.warehouse_id,
      delta,
      reason: values.reason,
      note: values.note || null,
    })
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    toast.success(`Ajuste registrado · stock resultante: ${formatQty(result.new_qty ?? 0)}`)
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajuste de stock</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label>Ítem</Label>
            <Select value={watch('item_id') || ''} onValueChange={(v) => setValue('item_id', v, { shouldDirty: true })}>
              <SelectTrigger aria-label="Ítem" className="w-full">
                <SelectValue placeholder="Selecciona el ítem…" />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {itemLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.item_id && <p role="alert" className="text-[13px] text-destructive">{errors.item_id.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Bodega</Label>
              <Select value={watch('warehouse_id') || ''} onValueChange={(v) => setValue('warehouse_id', v, { shouldDirty: true })}>
                <SelectTrigger aria-label="Bodega" className="w-full">
                  <SelectValue placeholder="Bodega…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.warehouse_id && <p role="alert" className="text-[13px] text-destructive">{errors.warehouse_id.message}</p>}
              {itemId && warehouseId && (
                <p className="text-[12.5px] text-muted-foreground">Stock actual: {formatQty(currentQty)}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Tipo de ajuste</Label>
              <Select value={direction} onValueChange={(v) => setValue('direction', v as 'up' | 'down', { shouldDirty: true })}>
                <SelectTrigger aria-label="Tipo de ajuste" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="up">Incremento (+)</SelectItem>
                  <SelectItem value="down">Decremento (−)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adj-qty">Cantidad (&gt; 0)</Label>
              <Input id="adj-qty" type="number" min="0" step="any" inputMode="decimal" aria-invalid={errors.qty ? true : undefined} {...register('qty')} />
              {errors.qty && <p role="alert" className="text-[13px] text-destructive">{errors.qty.message}</p>}
            </div>
          </div>

          <Warning message={negativeWarning} />

          <div className="space-y-2">
            <Label htmlFor="adj-reason">Motivo (obligatorio)</Label>
            <Input id="adj-reason" placeholder="Ej. Merma, corrección de conteo, rotura…" aria-invalid={errors.reason ? true : undefined} {...register('reason')} />
            {errors.reason && <p role="alert" className="text-[13px] text-destructive">{errors.reason.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="adj-note">Nota (opcional)</Label>
            <Textarea id="adj-note" rows={2} {...register('note')} />
          </div>

          <ServerError message={serverError} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : null}
              Registrar ajuste
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ============ M4.3 — Transferencia entre bodegas ============

const transferSchema = z.object({
  item_id: z.string().min(1, 'Selecciona el ítem.'),
  origin_id: z.string().min(1, 'Selecciona la bodega origen.'),
  destiny_id: z.string().min(1, 'Selecciona la bodega destino.'),
  qty: z.string().refine((v) => Number(v) > 0, 'La cantidad debe ser mayor a 0.'),
  note: z.string().trim(),
})

type TransferValues = z.infer<typeof transferSchema>

export function TransferDialog({
  open,
  onOpenChange,
  items,
  warehouses,
  stockCells,
  initialItemId,
  initialWarehouseId,
  onSaved,
}: CommonProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TransferValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      item_id: initialItemId ?? '',
      origin_id: initialWarehouseId ?? '',
      destiny_id: '',
      qty: '',
      note: '',
    },
  })

  const itemId = watch('item_id')
  const originId = watch('origin_id')
  const destinyId = watch('destiny_id')
  const qtyRaw = watch('qty')

  const stockFor = (warehouseId: string) =>
    stockCells.find((cell) => cell.item_id === itemId && cell.warehouse_id === warehouseId)?.qty ?? 0
  const originQty = stockFor(originId)
  const qty = Number(qtyRaw) > 0 ? Number(qtyRaw) : 0
  const originResult = originQty - qty
  const insufficientWarning =
    qty > 0 && originResult < 0
      ? `La bodega origen quedará en ${formatQty(originResult)}. Se permite (se disparará el Evento 4 «Stock negativo»).`
      : null
  const sameWarehouse = originId !== '' && originId === destinyId

  async function onSubmit(values: TransferValues) {
    setServerError(null)
    const result = await m4Transfer({
      itemId: values.item_id,
      originId: values.origin_id,
      destinyId: values.destiny_id,
      qty: Number(values.qty),
      note: values.note || null,
    })
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    toast.success(
      `Transferencia registrada · origen: ${formatQty(result.origin_qty ?? 0)} · destino: ${formatQty(result.destiny_qty ?? 0)}`,
    )
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Transferencia entre bodegas</DialogTitle>
          <DialogDescription>
            Transacción única (F4.7): salida en el origen + entrada en el destino con el mismo costo
            unitario. El costo del ítem no cambia.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label>Ítem</Label>
            <Select value={watch('item_id') || ''} onValueChange={(v) => setValue('item_id', v, { shouldDirty: true })}>
              <SelectTrigger aria-label="Ítem" className="w-full">
                <SelectValue placeholder="Selecciona el ítem…" />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {itemLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.item_id && <p role="alert" className="text-[13px] text-destructive">{errors.item_id.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Bodega origen</Label>
              <Select value={watch('origin_id') || ''} onValueChange={(v) => setValue('origin_id', v, { shouldDirty: true })}>
                <SelectTrigger aria-label="Bodega origen" className="w-full">
                  <SelectValue placeholder="Origen…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                      {itemId ? ` · stock ${formatQty(stockFor(wh.id))}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.origin_id && <p role="alert" className="text-[13px] text-destructive">{errors.origin_id.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>Bodega destino</Label>
              <Select value={watch('destiny_id') || ''} onValueChange={(v) => setValue('destiny_id', v, { shouldDirty: true })}>
                <SelectTrigger aria-label="Bodega destino" className="w-full">
                  <SelectValue placeholder="Destino…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses
                    .filter((wh) => wh.is_active && wh.id !== originId)
                    .map((wh) => (
                      <SelectItem key={wh.id} value={wh.id}>
                        {wh.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {errors.destiny_id && <p role="alert" className="text-[13px] text-destructive">{errors.destiny_id.message}</p>}
              {sameWarehouse && (
                <p role="alert" className="text-[13px] text-destructive">
                  La bodega destino debe ser distinta al origen.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tr-qty">Cantidad (&gt; 0)</Label>
            <Input id="tr-qty" type="number" min="0" step="any" inputMode="decimal" aria-invalid={errors.qty ? true : undefined} {...register('qty')} />
            {errors.qty && <p role="alert" className="text-[13px] text-destructive">{errors.qty.message}</p>}
          </div>

          <Warning message={insufficientWarning} />

          <div className="space-y-2">
            <Label htmlFor="tr-note">Nota (opcional)</Label>
            <Textarea id="tr-note" rows={2} placeholder="Ej. Reabastecimiento a piscina…" {...register('note')} />
          </div>

          <ServerError message={serverError} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting || sameWarehouse}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : null}
              Registrar transferencia
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
