import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/m1'
import { formatMoney, formatQty, movementReference, MOVEMENT_TYPE_LABELS, UNIT_LABELS, type KardexRow } from '@/lib/m4'

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] tracking-[0.08em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 text-[14px]">{value}</dd>
    </div>
  )
}

// M4.4 — Detalle de movimiento (kardex): solo lectura, incluye el costo
// CONGELADO vs el vigente del ítem.
export function MovementDetailDialog({
  open,
  onOpenChange,
  row,
  currentUnitCost,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: KardexRow | null
  currentUnitCost?: number | null
}) {
  if (!row) return null
  const frozen = Number(row.unit_cost)
  const current = currentUnitCost ?? null
  const costDiffers = current !== null && current !== frozen
  const isTransfer = row.type === 'transferencia'
  // En transferencias la fila negativa es la salida (warehouse=origen) y la
  // positiva la entrada; la contraparte se muestra como destino/origen.
  const signedQty = Number(row.qty)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Detalle del movimiento</DialogTitle>
          <DialogDescription>
            Kardex append-only: este registro no se edita ni se borra; cualquier corrección es un
            movimiento nuevo (Ajuste).
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Badge variant="secondary">{MOVEMENT_TYPE_LABELS[row.type]}</Badge>
          {row.wo_number && (
            <Badge variant="outline">OT {row.wo_number}</Badge>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
          <Field label="Fecha y hora" value={formatDateTime(row.occurred_at)} />
          <Field
            label="Ítem"
            value={
              <Link to={`/app/inventario/item/${row.item_id}`} className="text-primary underline-offset-2 hover:underline">
                {row.item_code} — {row.item_name}
              </Link>
            }
          />
          <Field
            label={isTransfer && signedQty < 0 ? 'Bodega origen' : 'Bodega'}
            value={row.warehouse_name}
          />
          {isTransfer && (
            <Field
              label={signedQty < 0 ? 'Bodega destino' : 'Bodega origen'}
              value={row.destiny_warehouse_name ?? '—'}
            />
          )}
          <Field label="Cantidad" value={<span className="tabular-nums">{formatQty(row.qty)} {UNIT_LABELS[row.unit]}</span>} />
          <Field label="Costo unitario (congelado)" value={<span className="tabular-nums">{formatMoney(frozen)}</span>} />
          <Field label="Costo total de línea" value={<span className="tabular-nums">{formatMoney(row.line_total)}</span>} />
          {current !== null && (
            <Field
              label="Costo vigente del ítem"
              value={
                <span className="tabular-nums">
                  {formatMoney(current)}
                  {costDiffers && (
                    <span className="ml-2 text-[12.5px] text-amber-700 dark:text-amber-400">
                      difiere del congelado
                    </span>
                  )}
                </span>
              }
            />
          )}
          <Field
            label="Referencia"
            value={
              row.wo_id && row.wo_number ? (
                <Link to={`/app/ordenes/${row.wo_id}`} className="text-primary underline-offset-2 hover:underline">
                  Ver OT {row.wo_number}
                </Link>
              ) : (
                movementReference(row)
              )
            }
          />
          {row.provider_name && <Field label="Proveedor" value={row.provider_name} />}
          {row.reason && <Field label="Motivo / nota" value={<span className="whitespace-pre-wrap">{row.reason}</span>} />}
          <Field label="Usuario" value={row.user_name ?? '—'} />
          <Field label="Registrado" value={formatDateTime(row.created_at)} />
          <Field label="ID de movimiento" value={<span className="font-mono text-[12px]">{row.id}</span>} />
        </dl>
      </DialogContent>
    </Dialog>
  )
}
