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
  OPERATIONAL_LABELS,
  createAsset,
  updateAsset,
  type AssetRow,
  type OperationalStatus,
} from '@/lib/m1'

const schema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre del componente.'),
  code: z.string().trim().min(1, 'Escribe el código del componente.'),
  operational_status: z.enum(['operational', 'inactive']),
  commissioning_date: z.string().optional(),
  expected_lifespan_value: z.string().refine(
    (value) => value === '' || /^\d+(\.\d{1,2})?$/.test(value),
    'Valor inválido (solo números, ej. 10 o 10.5).',
  ),
  lifespan_unit: z.string(),
  description: z.string().trim(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  parent: AssetRow
  component: AssetRow | null
  defaultCode: string
  inheritedLocationPath: string | null
  onSaved: () => void
}

export function ComponentDialog({
  open,
  onOpenChange,
  parent,
  component,
  defaultCode,
  inheritedLocationPath,
  onSaved,
}: Props) {
  const isEdit = component !== null
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
      name: component?.name ?? '',
      code: component?.code ?? defaultCode,
      operational_status: component?.operational_status ?? 'operational',
      commissioning_date: component?.commissioning_date ?? '',
      expected_lifespan_value:
        component?.expected_lifespan_value !== null && component?.expected_lifespan_value !== undefined
          ? String(component.expected_lifespan_value)
          : '',
      lifespan_unit: component?.lifespan_unit ?? 'years',
      description: component?.description ?? '',
    },
  })

  const operationalStatus = useWatch({ control, name: 'operational_status' })
  const lifespanUnit = useWatch({ control, name: 'lifespan_unit' })

  // Sin effect de reset: el padre lo monta condicionalmente, así que cada
  // apertura reconstruye defaultValues desde `component` y `defaultCode`.

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const payload = {
      code: values.code,
      name: values.name,
      description: values.description || null,
      operational_status: values.operational_status as OperationalStatus,
      commissioning_date: values.commissioning_date || parent.commissioning_date,
      expected_lifespan_value: values.expected_lifespan_value ? Number(values.expected_lifespan_value) : null,
      lifespan_unit: values.expected_lifespan_value
        ? (values.lifespan_unit as 'years' | 'hours' | 'cycles')
        : null,
      has_usage_counter: false,
    }
    const result = isEdit && component
      ? await updateAsset(component.id, payload)
      : await createAsset({
          ...payload,
          parent_id: parent.id,
          location_id: parent.location_id,
          category_id: parent.category_id,
          criticality: parent.criticality,
        })
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar componente' : 'Nuevo componente'}</DialogTitle>
          <DialogDescription>
            Los componentes cuelgan del activo <span className="font-mono">{parent.code}</span> y
            heredan su ubicación (solo lectura). Tienen mini-ficha propia con garantías, documentos e
            historial.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-name">Nombre</Label>
              <Input
                id="c-name"
                placeholder="Ej. Compresor, Bomba A…"
                aria-invalid={errors.name ? true : undefined}
                {...register('name')}
              />
              {errors.name && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="c-code">Código (autogenerado, editable)</Label>
              <Input
                id="c-code"
                className="font-mono"
                aria-invalid={errors.code ? true : undefined}
                {...register('code')}
              />
              {errors.code && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.code.message}
                </p>
              )}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Ubicación (heredada del activo)</Label>
              <Input
                value={inheritedLocationPath ?? '—'}
                readOnly
                disabled
                className="text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label>Estado operativo</Label>
                <Select
                  value={operationalStatus ?? 'operational'}
                onValueChange={(value) =>
                  setValue('operational_status', value as OperationalStatus, { shouldDirty: true })
                }
              >
                <SelectTrigger className="w-full" aria-label="Estado operativo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(OPERATIONAL_LABELS) as Array<[OperationalStatus, string]>).map(
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
              <Label htmlFor="c-date">Puesta en operación</Label>
              <Input id="c-date" type="date" {...register('commissioning_date')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="c-life">Vida útil (opcional)</Label>
              <Input
                id="c-life"
                inputMode="decimal"
                placeholder="Ej. 10"
                aria-invalid={errors.expected_lifespan_value ? true : undefined}
                {...register('expected_lifespan_value')}
              />
              {errors.expected_lifespan_value && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.expected_lifespan_value.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Unidad</Label>
                <Select
                  value={lifespanUnit ?? 'years'}
                onValueChange={(value) => setValue('lifespan_unit', value, { shouldDirty: true })}
              >
                <SelectTrigger className="w-full" aria-label="Unidad de vida útil">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="years">Años</SelectItem>
                  <SelectItem value="hours">Horas</SelectItem>
                  <SelectItem value="cycles">Ciclos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="c-desc">Descripción</Label>
            <Textarea id="c-desc" rows={3} {...register('description')} />
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
              {isEdit ? 'Guardar cambios' : 'Crear componente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
