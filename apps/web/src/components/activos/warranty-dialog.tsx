import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  COVERAGE_LABELS,
  WARRANTY_TYPE_LABELS,
  createWarranty,
  updateWarranty,
  warrantyEngineRecalc,
  type Coverage,
  type WarrantyRow,
  type WarrantyType,
} from '@/lib/m1'

const schema = z
  .object({
    warranty_type: z.enum(['purchase', 'repair']),
    provider_name: z.string().trim(),
    start_date: z.string().min(1, 'Indica la fecha de inicio.'),
    end_date: z.string().min(1, 'Indica la fecha de vencimiento.'),
    coverage: z.enum(['parts', 'labor', 'both']),
    notes: z.string().trim(),
  })
  .refine((values) => values.end_date >= values.start_date, {
    message: 'El vencimiento debe ser igual o posterior al inicio.',
    path: ['end_date'],
  })

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  assetId: string
  warranty: WarrantyRow | null
  onSaved: () => void
}

export function WarrantyDialog({ open, onOpenChange, assetId, warranty, onSaved }: Props) {
  const isEdit = warranty !== null
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      warranty_type: warranty?.warranty_type ?? 'purchase',
      provider_name: warranty?.provider_name ?? '',
      start_date: warranty?.start_date ?? '',
      end_date: warranty?.end_date ?? '',
      coverage: warranty?.coverage ?? 'both',
      notes: warranty?.notes ?? '',
    },
  })

  const warrantyType = useWatch({ control, name: 'warranty_type' })
  const coverageValue = useWatch({ control, name: 'coverage' })

  // Sin effect de reset: los padres lo montan condicionalmente, así que cada
  // apertura reconstruye defaultValues desde `warranty`.

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const payload = {
      asset_id: assetId,
      warranty_type: values.warranty_type as WarrantyType,
      provider_name: values.provider_name || null,
      start_date: values.start_date,
      end_date: values.end_date,
      coverage: values.coverage as Coverage,
      notes: values.notes || null,
    }
    let warrantyId: string | undefined
    if (isEdit && warranty) {
      const result = await updateWarranty(warranty.id, payload)
      if (!result.ok) {
        setServerError(result.message)
        return
      }
      warrantyId = warranty.id
    } else {
      const result = await createWarranty(payload)
      if (!result.ok) {
        setServerError(result.message)
        return
      }
      warrantyId = result.id
    }
    // F1.4: recálculo de estado + etapa de vida + reagende del Evento 7.
    await warrantyEngineRecalc(warrantyId)
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar garantía' : 'Nueva garantía'}</DialogTitle>
          <DialogDescription>
            El estado (Vigente/Vencida) se calcula solo según las fechas. Al guardar se recalcula la
            etapa de vida del activo y el aviso por vencer (Evento 7).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
                <Select
                  value={warrantyType ?? 'purchase'}
                  onValueChange={(value) => setValue('warranty_type', value as WarrantyType, { shouldDirty: true })}
                >
                <SelectTrigger className="w-full" aria-label="Tipo de garantía">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(WARRANTY_TYPE_LABELS) as Array<[WarrantyType, string]>).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cobertura</Label>
                <Select
                  value={coverageValue ?? 'both'}
                  onValueChange={(value) => setValue('coverage', value as Coverage, { shouldDirty: true })}
                >
                <SelectTrigger className="w-full" aria-label="Cobertura">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(COVERAGE_LABELS) as Array<[Coverage, string]>).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="w-provider">Proveedor otorgante (texto libre)</Label>
              <Input
                id="w-provider"
                placeholder="Ej. Daikin, Taller Ordoñez… (catálogo de proveedores: Módulo 5)"
                {...register('provider_name')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="w-start">Fecha de inicio</Label>
              <Input
                id="w-start"
                type="date"
                aria-invalid={errors.start_date ? true : undefined}
                {...register('start_date')}
              />
              {errors.start_date && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.start_date.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="w-end">Fecha de vencimiento</Label>
              <Input
                id="w-end"
                type="date"
                aria-invalid={errors.end_date ? true : undefined}
                {...register('end_date')}
              />
              {errors.end_date && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.end_date.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="w-notes">Observaciones</Label>
            <Textarea id="w-notes" rows={3} {...register('notes')} />
          </div>

          {serverError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
            >
              {serverError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : null}
              {isEdit ? 'Guardar cambios' : 'Crear garantía'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
