import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { AssetCombobox } from '@/components/asset-combobox'
import {
  fetchAssets,
  type AssetRow,
} from '@/lib/m1'
import {
  createWo,
  fetchDamageReport,
  fetchProvidersLite,
  fetchTechnicians,
  fetchWorkOrder,
  isTerminal,
  ORIGIN_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  updateWo,
  type DamageRow,
  type ExecutedByType,
  type Priority,
  type ProviderLite,
  type TechnicianLite,
  type WoRow,
  type WoType,
} from '@/lib/m2'

const schema = z
  .object({
    asset_id: z.string().min(1, 'Selecciona el activo o componente.'),
    component_id: z.string(),
    wo_type: z.enum(['corrective', 'preventive', 'inspection']),
    priority: z.enum(['urgent', 'normal', 'low']),
    description: z.string().trim().min(1, 'La descripción del problema es obligatoria.'),
    affects_sale: z.boolean(),
    executed_by_type: z.enum(['internal', 'external']),
    provider_id: z.string(),
    external_cost: z.string().refine(
      (value) => value === '' || /^\d+(\.\d{1,2})?$/.test(value),
      'Monto inválido (solo números, ej. 150 o 150.50).',
    ),
    scheduled_at: z.string(),
    technicians: z.array(z.string()),
  })
  .superRefine((values, ctx) => {
    if (values.executed_by_type === 'external' && !values.provider_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['provider_id'],
        message: 'El proveedor es obligatorio cuando la ejecución es externa.',
      })
    }
  })

type FormValues = z.infer<typeof schema>

export default function OrdenForm() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromParam = searchParams.get('from')
  const reportId = searchParams.get('report')
  const prefillAsset = searchParams.get('asset')

  const [assets, setAssets] = useState<AssetRow[]>([])
  const [technicians, setTechnicians] = useState<TechnicianLite[]>([])
  const [providers, setProviders] = useState<ProviderLite[]>([])
  const [wo, setWo] = useState<WoRow | null>(null)
  const [report, setReport] = useState<DamageRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const conversion = report !== null
  const conversionLocked = conversion && Boolean(report?.asset_id)

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      asset_id: '',
      component_id: '',
      wo_type: 'corrective',
      priority: 'normal',
      description: '',
      affects_sale: false,
      executed_by_type: 'internal',
      provider_id: '',
      external_cost: '',
      scheduled_at: '',
      technicians: [],
    },
  })

  const assetId = useWatch({ control, name: 'asset_id' })
  const componentId = useWatch({ control, name: 'component_id' })
  const woTypeValue = useWatch({ control, name: 'wo_type' })
  const priorityValue = useWatch({ control, name: 'priority' })
  const affectsSaleValue = useWatch({ control, name: 'affects_sale' })
  const executedByType = useWatch({ control, name: 'executed_by_type' })
  const providerIdValue = useWatch({ control, name: 'provider_id' })
  const techniciansValue = useWatch({ control, name: 'technicians' })

  useEffect(() => {
    let alive = true
    Promise.all([
      fetchAssets(),
      fetchTechnicians(),
      fetchProvidersLite(),
      id ? fetchWorkOrder(id) : Promise.resolve(null),
      reportId ? fetchDamageReport(reportId) : Promise.resolve(null),
    ])
      .then(([assetRows, techRows, providerRows, woRow, reportRow]) => {
        if (!alive) return
        setAssets(assetRows)
        setTechnicians(techRows)
        setProviders(providerRows)
        setWo(woRow)
        setReport(reportRow)
        if (woRow) {
          reset({
            asset_id: woRow.asset_id,
            component_id: woRow.component_id ?? '',
            wo_type: woRow.wo_type,
            priority: woRow.priority,
            description: woRow.description,
            affects_sale: woRow.affects_sale,
            executed_by_type: woRow.executed_by_type,
            provider_id: woRow.provider_id ?? '',
            external_cost: woRow.external_cost !== null ? String(woRow.external_cost) : '',
            scheduled_at: woRow.scheduled_at
              ? new Date(woRow.scheduled_at).toISOString().slice(0, 16)
              : '',
            technicians: [],
          })
        } else if (reportRow) {
          reset((current) => ({
            ...current,
            asset_id: reportRow.asset_id ?? '',
            component_id: reportRow.component_id ?? '',
            description: reportRow.description,
            wo_type: 'corrective',
          }))
        } else if (prefillAsset) {
          reset((current) => ({ ...current, asset_id: prefillAsset }))
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reportId, prefillAsset])

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === assetId) ?? null,
    [assets, assetId],
  )
  const componentOptions = useMemo(
    () => assets.filter((asset) => asset.parent_id && asset.parent_id === assetId),
    [assets, assetId],
  )

  function goBack() {
    if (fromParam) navigate(fromParam)
    else navigate(isEdit && id ? `/app/ordenes/${id}` : '/app/ordenes')
  }

  async function onSubmit(values: FormValues) {
    setServerError(null)
    if (isEdit && wo) {
      if (isTerminal(wo.status)) {
        setServerError(`La OT está ${STATUS_LABELS[wo.status]}: reabrela antes de editarla.`)
        return
      }
      const result = await updateWo(wo.id, {
        wo_type: values.wo_type,
        priority: values.priority,
        description: values.description,
        affects_sale: values.affects_sale,
        executed_by_type: values.executed_by_type,
        provider_id: values.executed_by_type === 'external' ? values.provider_id : null,
        external_cost:
          values.executed_by_type === 'external' && values.external_cost
            ? Number(values.external_cost)
            : null,
        scheduled_at: values.scheduled_at ? new Date(values.scheduled_at).toISOString() : null,
      })
      if (!result.ok) {
        setServerError(result.message)
        return
      }
      toast.success('Orden de trabajo actualizada.')
      navigate(`/app/ordenes/${wo.id}`)
      return
    }

    const result = await createWo({
      asset_id: values.asset_id,
      component_id: values.component_id || null,
      description: values.description,
      wo_type: values.wo_type,
      priority: values.priority,
      origin: conversion ? 'damage_report' : 'manual',
      damage_report_id: report?.id ?? null,
      affects_sale: values.affects_sale,
      executed_by_type: values.executed_by_type,
      provider_id: values.executed_by_type === 'external' ? values.provider_id : null,
      external_cost:
        values.executed_by_type === 'external' && values.external_cost
          ? Number(values.external_cost)
          : null,
      scheduled_at: values.scheduled_at ? new Date(values.scheduled_at).toISOString() : null,
      technicians: values.technicians,
    })
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    toast.success(`Orden de trabajo ${result.wo_number ?? ''} creada.`)
    if (result.id) navigate(`/app/ordenes/${result.id}`)
    else navigate('/app/ordenes')
  }

  function toggleTechnician(userId: string) {
    const current = techniciansValue ?? []
    setValue(
      'technicians',
      current.includes(userId)
        ? current.filter((entry) => entry !== userId)
        : [...current, userId],
      { shouldDirty: true },
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
          <Button variant="outline" className="mt-4" onClick={goBack}>
            <ArrowLeft />
            Volver
          </Button>
        </div>
      </main>
    )
  }

  const terminal = wo ? isTerminal(wo.status) : false

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          onClick={goBack}
        >
          <ArrowLeft className="size-3.5" />
          Volver
        </button>

        <div className="mt-4">
          <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
            Módulo 2 · {isEdit ? 'Editar OT' : 'Nueva OT'}
          </p>
          <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
            {isEdit && wo ? wo.wo_number : 'Alta de orden de trabajo'}
          </h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            {conversion
              ? conversionLocked
                ? 'Conversión desde Reporte de Daño: el activo, componente y descripción vienen del reporte (solo lectura).'
                : 'Conversión desde Reporte de Daño: la descripción viene del reporte. Selecciona el activo afectado.'
              : 'Secciones: origen · activo y problema · ejecución. La asignación de técnicos es opcional.'}
          </p>
        </div>

        {terminal && wo && (
          <div
            role="alert"
            className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive"
          >
            La OT está en estado «{STATUS_LABELS[wo.status]}»: no admite edición. Usa la reapertura
            formal desde el detalle.
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-8">
          <section className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="text-[15px] font-semibold">Origen</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Origen de la OT</Label>
                <Input
                  readOnly
                  value={ORIGIN_LABELS[conversion ? 'damage_report' : isEdit ? (wo?.origin ?? 'manual') : 'manual']}
                  className="bg-muted"
                />
                {conversion && report && (
                  <p className="text-[12.5px]">
                    <Link className="text-primary underline-offset-2 hover:underline" to="/app/reportes-dano">
                      {report.report_ref} — ver reporte de origen
                    </Link>
                  </p>
                )}
              </div>
              {isEdit && wo?.external_ref !== null && wo?.external_ref !== undefined && (
                <div className="space-y-2">
                  <Label htmlFor="wo-ext-ref">N° de referencia externo</Label>
                  <Input id="wo-ext-ref" readOnly defaultValue={wo.external_ref} className="bg-muted" />
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="text-[15px] font-semibold">Activo y problema</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="wo-asset">Activo o componente</Label>
                {conversionLocked && report ? (
                  <Input
                    id="wo-asset"
                    readOnly
                    className="bg-muted"
                    value={
                      componentId
                        ? (() => {
                            const comp = assets.find((a) => a.id === componentId)
                            return comp
                              ? `${selectedAsset?.code} — ${selectedAsset?.name} · ${comp.code} — ${comp.name}`
                              : `${selectedAsset?.code} — ${selectedAsset?.name}`
                          })()
                        : `${selectedAsset?.code ?? ''} — ${selectedAsset?.name ?? ''}`
                    }
                  />
                ) : (
                  <AssetCombobox
                    id="wo-asset"
                    assets={assets}
                    value={assetId}
                    aria-invalid={Boolean(errors.asset_id)}
                    onChange={(next) => {
                      setValue('asset_id', next, { shouldDirty: true })
                      setValue('component_id', '', { shouldDirty: true })
                    }}
                  />
                )}
                {conversionLocked && report && (
                  <p className="text-[12.5px] text-muted-foreground">
                    {report.location ?? report.location_path
                      ? `Localización: ${report.location ?? report.location_path}`
                      : 'Viene del reporte de daño.'}
                  </p>
                )}
                {errors.asset_id && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.asset_id.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Componente (opcional)</Label>
                <Select
                  value={componentId}
                  disabled={conversionLocked || Boolean(isEdit) || componentOptions.length === 0}
                  onValueChange={(value) => setValue('component_id', value, { shouldDirty: true })}
                >
                  <SelectTrigger className="w-full" aria-label="Componente">
                    <SelectValue placeholder="Sin componente específico" />
                  </SelectTrigger>
                  <SelectContent>
                    {componentOptions.map((component) => (
                      <SelectItem key={component.id} value={component.id}>
                        {component.code} — {component.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12.5px] text-muted-foreground">
                  Ubicación heredada: {selectedAsset?.location_path ?? '—'}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Tipo de OT</Label>
                <Select
                  value={woTypeValue}
                  onValueChange={(value) => setValue('wo_type', value as WoType, { shouldDirty: true })}
                >
                  <SelectTrigger className="w-full" aria-label="Tipo de OT">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(TYPE_LABELS) as Array<[WoType, string]>).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12.5px] text-muted-foreground"></p>
              </div>

              <div className="space-y-2">
                <Label>Prioridad (decisión manual)</Label>
                <Select
                  value={priorityValue}
                  onValueChange={(value) => setValue('priority', value as Priority, { shouldDirty: true })}
                >
                  <SelectTrigger className="w-full" aria-label="Prioridad">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(PRIORITY_LABELS) as Array<[Priority, string]>).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12.5px] text-muted-foreground"></p>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="wo-description">Descripción del problema (obligatoria)</Label>
                <Textarea
                  id="wo-description"
                  rows={4}
                  className={conversion ? 'bg-muted' : undefined}
                  placeholder="Qué falló, desde cuándo, impacto…"
                  {...register('description')}
                />
                {errors.description && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.description.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>¿Afecta disponibilidad de venta?</Label>
                <Select
                  value={affectsSaleValue ? 'si' : 'no'}
                  onValueChange={(value) =>
                    setValue('affects_sale', value === 'si', { shouldDirty: true })
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Afecta disponibilidad">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">No (default)</SelectItem>
                    <SelectItem value="si">Sí — dispara Evento 1</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[12.5px] text-muted-foreground">
                  Sin integración PMS: solo envía un correo inmediato (Evento 1). El bloqueo de venta
                  es manual fuera del CMMS.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="text-[15px] font-semibold">Ejecución</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Ejecutada por</Label>
                <Select
                  value={executedByType}
                  onValueChange={(value) =>
                    setValue('executed_by_type', value as ExecutedByType, { shouldDirty: true })
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Ejecutada por">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Personal interno (default)</SelectItem>
                    <SelectItem value="external">Contratista externo</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="wo-scheduled">Fecha programada (opcional)</Label>
                <Input id="wo-scheduled" type="datetime-local" {...register('scheduled_at')} />
              </div>

              {executedByType === 'external' && (
                <>
                  <div className="space-y-2">
                    <Label>Proveedor del catálogo (obligatorio)</Label>
                    <Select
                      value={providerIdValue}
                      onValueChange={(value) => setValue('provider_id', value, { shouldDirty: true })}
                    >
                      <SelectTrigger className="w-full" aria-label="Proveedor">
                        <SelectValue placeholder="Selecciona el proveedor" />
                      </SelectTrigger>
                      <SelectContent>
                        {providers.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.provider_id && (
                      <p role="alert" className="text-[13px] text-destructive">
                        {errors.provider_id.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wo-ext-cost">Costo del servicio externo (opcional hasta el cierre)</Label>
                    <Input
                      id="wo-ext-cost"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      {...register('external_cost')}
                    />
                    {errors.external_cost && (
                      <p role="alert" className="text-[13px] text-destructive">
                        {errors.external_cost.message}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label>Asignación de técnicos (opcional)</Label>
              {isEdit ? (
                <p className="text-[13px] text-muted-foreground">
                  Las asignaciones se gestionan desde el detalle de la OT (Asignar/Reasignar ·
                  Reemplazar).
                </p>
              ) : technicians.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  No hay usuarios con rol Técnico activos. Puedes guardar sin técnicos (caso
                  contratista).
                </p>
              ) : (
                <ul className="max-h-[260px] divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {technicians.map((technician) => (
                    <li key={technician.id} className="flex items-center gap-3 px-3.5 py-2.5">
                      <input
                        type="checkbox"
                        id={`wo-tech-${technician.id}`}
                        checked={(techniciansValue ?? []).includes(technician.id)}
                        onChange={() => toggleTechnician(technician.id)}
                        className="size-4 accent-primary"
                      />
                      <label
                        htmlFor={`wo-tech-${technician.id}`}
                        className="flex-1 cursor-pointer text-[14px]"
                      >
                        {technician.full_name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[12.5px] text-muted-foreground">
                Al guardar con técnicos se envía el push «OT asignada» a cada uno.
              </p>
            </div>
          </section>

          {serverError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
            >
              {serverError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={goBack}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || terminal}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : null}
              {isEdit ? 'Guardar cambios' : conversion ? 'Crear OT desde reporte' : 'Crear OT'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}
