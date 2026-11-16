import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useAuth } from '@/lib/auth-store'
import {
  CRITICALITY_HELP,
  CRITICALITY_LABELS,
  OPERATIONAL_LABELS,
  allocateAssetCode,
  checkAssetCode,
  createAsset,
  createWarranty,
  fetchAsset,
  fetchCategories,
  fetchLocations,
  fetchUsersLite,
  locationOptions,
  previewAssetCode,
  updateAsset,
  warrantyEngineRecalc,
  type AssetRow,
  type CategoryRow,
  type Criticality,
  type LifespanUnit,
  type LocationRow,
  type OperationalStatus,
  type UserLite,
} from '@/lib/m1'

const today = () => new Date().toISOString().slice(0, 10)

const schema = z
  .object({
    name: z.string().trim().min(1, 'Escribe el nombre del activo.'),
    code: z.string().trim().min(1, 'Escribe o espera el código autogenerado.'),
    category_id: z.string().min(1, 'Selecciona la categoría.'),
    criticality: z.enum(['high', 'medium', 'low']),
    location_id: z.string().min(1, 'Selecciona la ubicación.'),
    commissioning_date: z.string().min(1, 'Indica la fecha de puesta en operación.'),
    expected_lifespan_value: z.string().refine(
      (value) => value === '' || /^\d+(\.\d{1,2})?$/.test(value),
      'Valor inválido (solo números, ej. 10 o 10.5).',
    ),
    lifespan_unit: z.string(),
    has_usage_counter: z.boolean(),
    responsible_user_id: z.string(),
    operational_status: z.enum(['operational', 'inactive']),
    description: z.string().trim(),
    notes: z.string().trim(),
    with_warranty: z.boolean(),
    warranty_provider: z.string().trim(),
    warranty_start: z.string(),
    warranty_end: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.expected_lifespan_value && !values.lifespan_unit) {
      ctx.addIssue({
        code: 'custom',
        path: ['lifespan_unit'],
        message: 'Elige la unidad de la vida útil.',
      })
    }
    if (values.with_warranty) {
      if (!values.warranty_start) {
        ctx.addIssue({ code: 'custom', path: ['warranty_start'], message: 'Indica el inicio de la garantía.' })
      }
      if (!values.warranty_end) {
        ctx.addIssue({ code: 'custom', path: ['warranty_end'], message: 'Indica el vencimiento de la garantía.' })
      } else if (values.warranty_start && values.warranty_end < values.warranty_start) {
        ctx.addIssue({ code: 'custom', path: ['warranty_end'], message: 'El vencimiento debe ser posterior al inicio.' })
      }
    }
  })

type FormValues = z.infer<typeof schema>

export default function ActivoForm() {
  const roles = useAuth((s) => s.roles)
  const canEdit = roles.includes('mantenimiento')
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillLocation = searchParams.get('loc') ?? ''

  const [locations, setLocations] = useState<LocationRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [asset, setAsset] = useState<AssetRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [codeDirty, setCodeDirty] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [codeCheck, setCodeCheck] = useState<{ checking: boolean; available: boolean | null }>({
    checking: false,
    available: null,
  })

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
      code: '',
      category_id: '',
      criticality: 'medium',
      location_id: prefillLocation,
      commissioning_date: today(),
      expected_lifespan_value: '',
      lifespan_unit: 'years',
      has_usage_counter: false,
      responsible_user_id: '',
      operational_status: 'operational',
      description: '',
      notes: '',
      with_warranty: false,
      warranty_provider: '',
      warranty_start: today(),
      warranty_end: '',
    },
  })

  useEffect(() => {
    let alive = true
    Promise.all([fetchLocations(), fetchCategories(), fetchUsersLite()])
      .then(([locationRows, categoryRows, userRows]) => {
        if (!alive) return
        setLocations(locationRows)
        setCategories(categoryRows)
        setUsers(userRows)
        if (id) {
          fetchAsset(id)
            .then((row) => {
              if (!alive) return
              if (!row) {
                setLoadError('Activo inexistente.')
                return
              }
              setAsset(row)
              reset({
                name: row.name,
                code: row.code,
                category_id: row.category_id ?? '',
                criticality: row.criticality,
                location_id: row.location_id,
                commissioning_date: row.commissioning_date,
                expected_lifespan_value:
                  row.expected_lifespan_value !== null ? String(row.expected_lifespan_value) : '',
                lifespan_unit: row.lifespan_unit ?? 'years',
                has_usage_counter: row.has_usage_counter,
                responsible_user_id: row.responsible_user_id ?? '',
                operational_status: row.operational_status,
                description: row.description ?? '',
                notes: row.notes ?? '',
                with_warranty: false,
                warranty_provider: '',
                warranty_start: today(),
                warranty_end: '',
              })
              setCodeDirty(false)
            })
            .catch((err: unknown) => {
              if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el activo.')
            })
            .finally(() => {
              if (alive) setLoading(false)
            })
        } else {
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el formulario.')
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const categoryId = watch('category_id')
  const locationId = watch('location_id')
  const code = watch('code')
  const withWarranty = watch('with_warranty')

  const activeCategories = useMemo(
    () => categories.filter((category) => category.is_active || category.id === asset?.category_id),
    [categories, asset],
  )
  const locationChoice = useMemo(() => locationOptions(locations), [locations])

  // F1.1 paso 1: preview del código al elegir categoría + ubicación.
  useEffect(() => {
    if (isEdit || codeDirty || !categoryId || !locationId) return
    let alive = true
    const timer = window.setTimeout(() => {
      void previewAssetCode(categoryId, locationId).then((result) => {
        if (!alive) return
        if (result.ok && result.code) {
          setPreview(result.code)
          setValue('code', result.code, { shouldDirty: false })
        }
      })
    }, 350)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [categoryId, locationId, codeDirty, isEdit, setValue])

  // F1.1 paso 3: unicidad en tiempo real (debounce) cuando el código es manual.
  // El estado se limpia en el onChange del input (nunca síncrono dentro del effect).
  useEffect(() => {
    if (!codeDirty || !code || code.trim().length < 3) return
    let alive = true
    const timer = window.setTimeout(() => {
      setCodeCheck({ checking: true, available: null })
      void checkAssetCode(code.trim(), id).then((result) => {
        if (!alive) return
        setCodeCheck({
          checking: false,
          available:
            result.ok && typeof result.available === 'boolean' ? result.available : null,
        })
      })
    }, 400)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [code, codeDirty, id])

  async function onSubmit(values: FormValues) {
    setServerError(null)
    let finalCode = values.code.trim()

    if (!isEdit && !codeDirty) {
      const allocation = await allocateAssetCode(values.category_id, values.location_id)
      if (!allocation.ok) {
        setServerError(allocation.message)
        return
      }
      finalCode = allocation.code ?? finalCode
    }

    const payload = {
      code: finalCode,
      name: values.name,
      category_id: values.category_id,
      location_id: values.location_id,
      criticality: values.criticality as Criticality,
      commissioning_date: values.commissioning_date,
      description: values.description || null,
      notes: values.notes || null,
      expected_lifespan_value: values.expected_lifespan_value
        ? Number(values.expected_lifespan_value)
        : null,
      lifespan_unit: values.expected_lifespan_value
        ? (values.lifespan_unit as LifespanUnit)
        : null,
      has_usage_counter: values.has_usage_counter,
      responsible_user_id: values.responsible_user_id || null,
      operational_status: values.operational_status as OperationalStatus,
    }

    if (isEdit && asset) {
      const result = await updateAsset(asset.id, payload)
      if (!result.ok) {
        setServerError(result.message)
        return
      }
      toast.success('Activo actualizado.')
      navigate(`/app/activos/${asset.id}`, { replace: true })
      return
    }

    const created = await createAsset(payload)
    if (!created.ok) {
      setServerError(created.message)
      return
    }

    if (values.with_warranty && created.id) {
      const warranty = await createWarranty({
        asset_id: created.id,
        warranty_type: 'purchase',
        provider_name: values.warranty_provider || null,
        start_date: values.warranty_start,
        end_date: values.warranty_end,
        coverage: 'both',
        notes: 'Registrada en el alta del activo (F1.1).',
      })
      if (warranty.ok) {
        await warrantyEngineRecalc(warranty.id)
      } else {
        toast.warning(`Activo creado, pero la garantía no: ${warranty.message}`)
      }
    }

    navigate(`/app/activos/${created.id}`, { replace: true })
  }

  if (!canEdit) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-[14px] text-muted-foreground">
            El alta y edición de activos es una operación del rol Mantenimiento.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/app/activos')}>
            <ArrowLeft />
            Volver al explorador
          </Button>
        </div>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="flex items-center justify-center gap-2 px-6 py-24 text-[14px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando formulario…
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-[14px] text-destructive">{loadError}</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/app/activos')}>
            <ArrowLeft />
            Volver al explorador
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          onClick={() => navigate(isEdit && asset ? `/app/activos/${asset.id}` : '/app/activos')}
        >
          <ArrowLeft className="size-3.5" />
          {isEdit ? 'Volver a la ficha' : 'Volver al explorador'}
        </button>

        <p className="mt-4 text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
          {isEdit ? 'Editar activo' : 'Alta de activo'}
        </p>
        <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
          {isEdit ? asset?.name : 'Nuevo activo'}
        </h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          La etapa de vida no se elige aquí: la asigna el motor de garantías o Mantenimiento desde la
          ficha (F1.1 · F1.3).
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-8">
          <section className="space-y-4 rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Identificación</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="a-name">Nombre</Label>
                <Input
                  id="a-name"
                  placeholder="Ej. Chiller Torre 1"
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
                <Label htmlFor="a-code">Código único</Label>
                <Input
                  id="a-code"
                  className="font-mono"
                  aria-invalid={errors.code ? true : undefined}
                  {...register('code', {
                    onChange: () => {
                      if (!codeDirty) setCodeDirty(true)
                      setCodeCheck({ checking: false, available: null })
                    },
                  })}
                />
                <div className="min-h-[18px] text-[12.5px]">
                  {errors.code ? (
                    <p role="alert" className="text-destructive">
                      {errors.code.message}
                    </p>
                  ) : codeCheck.checking ? (
                    <span className="text-muted-foreground">Verificando unicidad…</span>
                  ) : codeCheck.available === true ? (
                    <span className="text-emerald-600 dark:text-emerald-400">Código disponible.</span>
                  ) : codeCheck.available === false ? (
                    <span className="text-destructive">Ese código ya está en uso.</span>
                  ) : preview && !codeDirty ? (
                    <span className="text-muted-foreground">Autogenerado: selección de categoría y ubicación.</span>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Clasificación</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Categoría (define el prefijo del código)</Label>
                <Select
                  value={categoryId}
                  onValueChange={(value) => setValue('category_id', value, { shouldDirty: true })}
                >
                  <SelectTrigger className="w-full" aria-label="Categoría">
                    <SelectValue placeholder="Selecciona…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name} ({category.code_prefix})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category_id && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.category_id.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Criticidad</Label>
                <Select
                  value={watch('criticality')}
                  onValueChange={(value) =>
                    setValue('criticality', value as Criticality, { shouldDirty: true })
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Criticidad">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(CRITICALITY_LABELS) as Array<[Criticality, string]>).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[12.5px] text-muted-foreground">
                  {CRITICALITY_HELP[watch('criticality') as Criticality]}
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Ubicación</h2>
            <div className="space-y-2">
              <Label>Ruta (Hotel → … → ubicación destino)</Label>
              <Select
                value={locationId}
                onValueChange={(value) => setValue('location_id', value, { shouldDirty: true })}
              >
                <SelectTrigger className="w-full" aria-label="Ubicación">
                  <SelectValue placeholder="Selecciona la ubicación…" />
                </SelectTrigger>
                <SelectContent>
                  {locationChoice.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.location_id && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.location_id.message}
                </p>
              )}
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Vida útil y operación</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="a-date">Puesta en operación</Label>
                <Input
                  id="a-date"
                  type="date"
                  aria-invalid={errors.commissioning_date ? true : undefined}
                  {...register('commissioning_date')}
                />
                {errors.commissioning_date && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.commissioning_date.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Estado operativo</Label>
                <Select
                  value={watch('operational_status')}
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
                <Label htmlFor="a-life">Vida útil esperada (opcional)</Label>
                <Input
                  id="a-life"
                  inputMode="decimal"
                  placeholder="Ej. 15"
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
                  value={watch('lifespan_unit')}
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
                {errors.lifespan_unit && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.lifespan_unit.message}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2.5 pt-6 sm:col-span-1">
                <Checkbox
                  id="a-counter"
                  checked={watch('has_usage_counter')}
                  onCheckedChange={(checked) =>
                    setValue('has_usage_counter', checked === true, { shouldDirty: true })
                  }
                />
                <Label htmlFor="a-counter" className="cursor-pointer">
                  Tiene contador de uso (horas/ciclos)
                </Label>
              </div>

              <div className="space-y-2">
                <Label>Responsable (opcional)</Label>
                <Select
                  value={watch('responsible_user_id') || 'none'}
                  onValueChange={(value) =>
                    setValue('responsible_user_id', value === 'none' ? '' : value, { shouldDirty: true })
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Responsable">
                    <SelectValue placeholder="Sin responsable" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin responsable</SelectItem>
                    {users
                      .filter((user) => user.is_active)
                      .map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.full_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="a-desc">Descripción</Label>
                <Textarea id="a-desc" rows={3} {...register('description')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="a-notes">Notas internas</Label>
                <Textarea id="a-notes" rows={3} {...register('notes')} />
              </div>
            </div>
          </section>

          {!isEdit && (
            <section className="space-y-4 rounded-lg border border-border p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-[15px] font-semibold">Garantía de compra (opcional)</h2>
                  <p className="text-[13px] text-muted-foreground">
                    Si la registras ahora, la etapa de vida arranca como «En garantía» vía motor F1.4.
                  </p>
                </div>
                <Checkbox
                  id="a-warranty"
                  checked={withWarranty}
                  onCheckedChange={(checked) =>
                    setValue('with_warranty', checked === true, { shouldDirty: true })
                  }
                />
              </div>

              {withWarranty && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2 sm:col-span-3">
                    <Label htmlFor="a-wprov">Proveedor otorgante</Label>
                    <Input id="a-wprov" placeholder="Ej. Daikin…" {...register('warranty_provider')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="a-wstart">Inicio</Label>
                    <Input
                      id="a-wstart"
                      type="date"
                      aria-invalid={errors.warranty_start ? true : undefined}
                      {...register('warranty_start')}
                    />
                    {errors.warranty_start && (
                      <p role="alert" className="text-[13px] text-destructive">
                        {errors.warranty_start.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="a-wend">Vencimiento</Label>
                    <Input
                      id="a-wend"
                      type="date"
                      aria-invalid={errors.warranty_end ? true : undefined}
                      {...register('warranty_end')}
                    />
                    {errors.warranty_end && (
                      <p role="alert" className="text-[13px] text-destructive">
                        {errors.warranty_end.message}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {serverError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
            >
              {serverError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(isEdit && asset ? `/app/activos/${asset.id}` : '/app/activos')}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || codeCheck.available === false}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : isEdit ? <Check /> : null}
              {isEdit ? 'Guardar cambios' : 'Crear activo'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}
