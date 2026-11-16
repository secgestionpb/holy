import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
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
import { useAuth } from '@/lib/auth-store'
import { fetchCategories, type CategoryRow } from '@/lib/m1'
import {
  FREQUENCY_KEYS,
  FREQUENCY_LABELS,
  UNIT_KEYS,
  UNIT_LABELS,
  createMeasurementType,
  fetchMeasurementTypes,
  updateMeasurementType,
  type MeasFrequency,
  type MeasurementTypeRow,
  type UnitKey,
} from '@/lib/m6'

const UNITS = UNIT_KEYS as unknown as [UnitKey, ...UnitKey[]]
const FREQUENCIES = FREQUENCY_KEYS as unknown as [MeasFrequency, ...MeasFrequency[]]

const schema = z
  .object({
    name: z.string().trim().min(1, 'Escribe el nombre del tipo de medición.'),
    category_id: z.string().min(1, 'Selecciona la categoría aplicable.'),
    unit: z.enum(UNITS),
    min_value: z.number(),
    max_value: z.number(),
    frequency: z.enum(FREQUENCIES),
  })
  .refine((data) => data.max_value > data.min_value, {
    message: 'El máximo debe ser mayor que el mínimo.',
    path: ['max_value'],
  })

type FormValues = z.infer<typeof schema>

export default function TipoMedicionForm() {
  const { id } = useParams<{ id: string }>()
  const isCreate = id === 'nuevo'
  const navigate = useNavigate()
  const isQuality = useAuth((s) => s.roles).includes('calidad')

  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [type, setType] = useState<MeasurementTypeRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      category_id: '',
      unit: 'unidad',
      min_value: 0,
      max_value: 1,
      frequency: 'weekly',
    },
  })

  useEffect(() => {
    let alive = true
    fetchCategories()
      .then((rows) => {
        if (alive) setCategories(rows)
      })
      .catch(() => {
        // El dropdown queda vacío; el form muestra el error al guardar.
      })
      .finally(() => {
        if (alive && isCreate) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isCreate || !id) return
    let alive = true
    setLoading(true)
    fetchMeasurementTypes()
      .then((rows) => {
        if (!alive) return
        const found = rows.find((r) => r.id === id) ?? null
        if (!found) {
          setLoadError('Tipo de medición inexistente.')
          return
        }
        setType(found)
        reset({
          name: found.name,
          category_id: found.category_id,
          unit: found.unit,
          min_value: Number(found.min_value),
          max_value: Number(found.max_value),
          frequency: found.frequency,
        })
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el tipo.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const payload = {
      name: values.name,
      category_id: values.category_id,
      unit: values.unit,
      min_value: values.min_value,
      max_value: values.max_value,
      frequency: values.frequency,
    }

    if (isCreate) {
      const created = await createMeasurementType(payload)
      if (!created.ok) {
        setServerError(created.message)
        return
      }
      toast.success('Tipo de medición creado.')
      navigate(`/app/cumplimiento?tab=mediciones&sub=tipos`, { replace: true })
      return
    }

    if (!type) return
    const updated = await updateMeasurementType(type.id, payload)
    if (!updated.ok) {
      setServerError(updated.message)
      return
    }
    toast.success('Tipo de medición actualizado.')
    navigate('/app/cumplimiento?tab=mediciones&sub=tipos', { replace: true })
  }

  async function toggleActive() {
    if (!type) return
    const next = !type.is_active
    if (!window.confirm(next ? '¿Reactivar este tipo?' : '¿Desactivar este tipo?')) return
    const result = await updateMeasurementType(type.id, { is_active: next })
    if (!result.ok) {
      toast.error(result.message ?? 'No se pudo cambiar el estado.')
      return
    }
    toast.success(next ? 'Tipo reactivado.' : 'Tipo desactivado.')
    setType((t) => (t ? { ...t, is_active: next } : t))
  }

  if (loading) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 text-[14px] text-muted-foreground">
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
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => navigate('/app/cumplimiento?tab=mediciones&sub=tipos')}
          >
            Volver al listado
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/app/cumplimiento?tab=mediciones&sub=tipos')}
            >
              <ArrowLeft className="size-3.5" />
              Tipos de medición
            </button>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-[clamp(1.5rem,2.4vw,2rem)] font-extrabold tracking-[-0.02em]">
                {isCreate ? 'Nuevo tipo de medición' : type?.name}
              </h1>
              {type && (
                <Badge
                  className={
                    type.is_active
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground'
                  }
                >
                  {type.is_active ? 'Activo' : 'Inactivo'}
                </Badge>
              )}
              {type && (
                <span className="text-[13px] text-muted-foreground">
                  {type.record_count ?? 0} registro(s)
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              El rango define «Dentro/Fuera de rango» al registrar mediciones.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isCreate && isQuality && (
              <Button variant="outline" onClick={() => void toggleActive()}>
                {type?.is_active ? 'Desactivar' : 'Reactivar'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => navigate('/app/cumplimiento?tab=mediciones&sub=tipos')}
            >
              Cancelar
            </Button>
            {isQuality && (
              <Button form="type-form" type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="animate-spin" /> : <Check />}
                {isCreate ? 'Crear tipo' : 'Guardar cambios'}
              </Button>
            )}
          </div>
        </div>

        {!isQuality && (
          <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            Vista de solo lectura. Solo Calidad administra los tipos de medición.
          </p>
        )}

        <form id="type-form" onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-5">
          <section className="rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Definición</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="type-name">Nombre *</Label>
                <Input
                  id="type-name"
                  placeholder="Ej.: Agua fría piscina — cloro"
                  disabled={!isQuality}
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
                <Label htmlFor="type-category">Categoría aplicable *</Label>
                <Select
                  value={watch('category_id')}
                  onValueChange={(v) => setValue('category_id', v)}
                  disabled={!isQuality}
                >
                  <SelectTrigger id="type-category" aria-label="Categoría aplicable">
                    <SelectValue placeholder="Selecciona la categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories
                      .filter((c) => c.is_active || c.id === watch('category_id'))
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {errors.category_id && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.category_id.message}
                  </p>
                )}
                <p className="text-[12px] text-muted-foreground">
                  Solo admite mediciones sobre activos de esta categoría.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="type-unit">Unidad *</Label>
                <Select
                  value={watch('unit')}
                  onValueChange={(v) => setValue('unit', v as UnitKey)}
                  disabled={!isQuality}
                >
                  <SelectTrigger id="type-unit" aria-label="Unidad">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {UNIT_LABELS[u]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="type-min">Valor mínimo aceptable *</Label>
                <Input
                  id="type-min"
                  type="number"
                  step="0.001"
                  disabled={!isQuality}
                  aria-invalid={errors.min_value ? true : undefined}
                  {...register('min_value', { valueAsNumber: true })}
                />
                {errors.min_value && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.min_value.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="type-max">Valor máximo aceptable *</Label>
                <Input
                  id="type-max"
                  type="number"
                  step="0.001"
                  disabled={!isQuality}
                  aria-invalid={errors.max_value ? true : undefined}
                  {...register('max_value', { valueAsNumber: true })}
                />
                {errors.max_value && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.max_value.message}
                  </p>
                )}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="type-frequency">Frecuencia *</Label>
                <Select
                  value={watch('frequency')}
                  onValueChange={(v) => setValue('frequency', v as MeasFrequency)}
                  disabled={!isQuality}
                >
                  <SelectTrigger id="type-frequency" aria-label="Frecuencia">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f} value={f}>
                        {FREQUENCY_LABELS[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-muted-foreground">
                  Define cuándo una medición se considera «faltante» en el tablero.
                </p>
              </div>
            </div>
          </section>

          {serverError && (
            <p role="alert" className="text-[14px] text-destructive">
              {serverError}
            </p>
          )}
        </form>
      </div>
    </main>
  )
}
