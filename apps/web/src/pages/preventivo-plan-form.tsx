import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { getPlan, createPlan, updatePlan, syncPlanScope, getChecklistTemplates } from '@/lib/m3'
import { fetchAssets, fetchCategories, type AssetRow, type CategoryRow } from '@/lib/m1'

const schema = z.object({
  name: z.string().min(1, 'Nombre obligatorio'),
  description: z.string().optional(),
  frequency_type: z.enum(['time', 'usage']),
  interval_value: z.number().min(1, 'Intervalo debe ser mayor a 0'),
  checklist_template_id: z.string().optional(),
  suggested_role: z.string().optional(),
  default_priority: z.enum(['urgent', 'normal', 'low']),
  lead_days: z.number().min(0, 'Debe ser 0 o mayor'),
  grace_days: z.number().min(0, 'Margen de gracia obligatorio'),
  is_active: z.boolean(),
  next_due_at: z.string().optional(),
  last_run_counter: z.number().min(0).optional(),
})

type FormValues = z.infer<typeof schema>

// <input type="number"> entrega NaN con valor vacío; se normaliza a 0.
const numberValue =
  (onChange: (...event: any[]) => void) =>
  (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange(event.target.valueAsNumber || 0)

const PRIORITY_LABELS: Record<FormValues['default_priority'], string> = {
  urgent: 'Urgente',
  normal: 'Normal',
  low: 'Baja',
}

function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, checked: boolean) {
  setter((prev) => {
    const next = new Set(prev)
    if (checked) next.add(id)
    else next.delete(id)
    return next
  })
}

export default function PlanForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const [assetLinks, setAssetLinks] = useState<Set<string>>(new Set())
  const [categoryLinks, setCategoryLinks] = useState<Set<string>>(new Set())
  const [assetQuery, setAssetQuery] = useState('')

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      description: '',
      frequency_type: 'time',
      interval_value: 30,
      checklist_template_id: 'none',
      suggested_role: '',
      default_priority: 'normal',
      lead_days: 0,
      grace_days: 1,
      is_active: true,
      next_due_at: '',
      last_run_counter: 0,
    },
  })

  useEffect(() => {
    let alive = true
    Promise.all([fetchAssets(), fetchCategories(), getChecklistTemplates()])
      .then(([assetRows, categoryRows, templateRows]) => {
        if (!alive) return
        setAssets(assetRows)
        setCategories(categoryRows)
        setTemplates(templateRows)
        if (isEdit) {
          return getPlan(id!).then((plan) => {
            if (!alive || !plan) return
            form.reset({
              name: plan.name,
              description: plan.description ?? '',
              frequency_type: plan.frequency_type,
              interval_value: plan.interval_value,
              checklist_template_id: plan.checklist_template_id ?? 'none',
              suggested_role: plan.suggested_role ?? '',
              default_priority: plan.default_priority,
              lead_days: plan.lead_days,
              grace_days: plan.grace_days,
              is_active: plan.is_active,
              next_due_at: plan.next_due_at ?? '',
              last_run_counter: plan.last_run_counter ?? 0,
            })
            setAssetLinks(new Set((plan.plan_asset_links ?? []).map((link) => link.asset_id)))
            setCategoryLinks(new Set((plan.plan_category_links ?? []).map((link) => link.category_id)))
            setLoading(false)
          })
        }
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        toast.error(err instanceof Error ? err.message : 'No se pudo cargar el formulario.')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id, isEdit, form])

  async function onSubmit(values: FormValues) {
    setSaving(true)
    try {
      const payload = {
        name: values.name.trim(),
        description: values.description?.trim() || null,
        frequency_type: values.frequency_type,
        interval_value: values.interval_value,
        checklist_template_id: values.checklist_template_id === 'none' ? null : values.checklist_template_id ?? null,
        suggested_role: values.suggested_role?.trim() || null,
        default_priority: values.default_priority,
        lead_days: values.lead_days,
        grace_days: values.grace_days,
        is_active: values.is_active,
        next_due_at: values.frequency_type === 'time' && values.next_due_at ? values.next_due_at : null,
        last_run_counter: values.frequency_type === 'usage' && values.last_run_counter ? values.last_run_counter : null,
      }
      const plan = isEdit ? await updatePlan(id!, payload).then(() => ({ id: id! })) : await createPlan(payload)
      await syncPlanScope(plan.id, [...assetLinks], [...categoryLinks])
      toast.success('Plan guardado')
      navigate('/app/preventivo/planes')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el plan.')
    } finally {
      setSaving(false)
    }
  }

  const filteredAssets = assets.filter((a) => a.name.toLowerCase().includes(assetQuery.toLowerCase()))

  if (loading) {
    return (
      <main className='p-6 max-w-4xl mx-auto flex items-center gap-2 text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Cargando plan…
      </main>
    )
  }

  return (
    <main className='p-6 max-w-4xl mx-auto'>
      <Button variant='ghost' onClick={() => navigate(-1)}>
        <ArrowLeft className='mr-2' />Volver
      </Button>
      <div className='mt-4 flex items-center justify-between'>
        <h1 className='text-2xl font-bold'>{isEdit ? 'Editar Plan' : 'Nuevo Plan'}</h1>
        <Badge variant={form.watch('is_active') ? 'default' : 'secondary'}>
          {form.watch('is_active') ? 'Activo' : 'Inactivo'}
        </Badge>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8 mt-6'>
          <section className='space-y-4'>
            <h2 className='text-sm font-semibold uppercase text-muted-foreground'>General</h2>
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input placeholder='Ej. Preventivo mensual A/C' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='default_priority'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prioridad por defecto</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className='w-full'>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(Object.entries(PRIORITY_LABELS) as Array<[FormValues['default_priority'], string]>).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='suggested_role'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Técnico sugerido (rol)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || 'none'}>
                      <FormControl>
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Sin sugerencia' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='none'>Sin sugerencia</SelectItem>
                        <SelectItem value='mantenimiento'>Mantenimiento</SelectItem>
                        <SelectItem value='tecnico'>Técnico</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='is_active'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center gap-3 rounded-md border p-3 sm:mt-7'>
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className='!mt-0'>Plan activo (participa en la generación)</FormLabel>
                  </FormItem>
                )}
              />
            </div>
          </section>

          <section className='space-y-3'>
            <h2 className='text-sm font-semibold uppercase text-muted-foreground'>Alcance</h2>
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label>Activos puntuales {assetLinks.size > 0 && <Badge variant='outline'>{assetLinks.size}</Badge>}</Label>
                <Input
                  placeholder='Buscar activo…'
                  value={assetQuery}
                  onChange={(event) => setAssetQuery(event.target.value)}
                />
                <div className='max-h-52 overflow-y-auto rounded-md border p-2 space-y-1'>
                  {filteredAssets.map((asset) => (
                    <label key={asset.id} className='flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/60'>
                      <Checkbox
                        checked={assetLinks.has(asset.id)}
                        onCheckedChange={(checked) => toggle(setAssetLinks, asset.id, checked === true)}
                      />
                      <span className='truncate'>{asset.name}</span>
                    </label>
                  ))}
                  {filteredAssets.length === 0 && (
                    <p className='text-xs text-muted-foreground px-1'>Sin resultados</p>
                  )}
                </div>
              </div>
              <div className='space-y-2'>
                <Label>Categorías (todos los activos de la categoría) {categoryLinks.size > 0 && <Badge variant='outline'>{categoryLinks.size}</Badge>}</Label>
                <div className='max-h-52 overflow-y-auto rounded-md border p-2 space-y-1'>
                  {categories.map((category) => (
                    <label key={category.id} className='flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/60'>
                      <Checkbox
                        checked={categoryLinks.has(category.id)}
                        onCheckedChange={(checked) => toggle(setCategoryLinks, category.id, checked === true)}
                      />
                      <span className='truncate'>{category.name}</span>
                    </label>
                  ))}
                  {categories.length === 0 && (
                    <p className='text-xs text-muted-foreground px-1'>Sin categorías disponibles</p>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className='space-y-4'>
            <h2 className='text-sm font-semibold uppercase text-muted-foreground'>Frecuencia</h2>
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
              <FormField
                control={form.control}
                name='frequency_type'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de frecuencia</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className='w-full'>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='time'>Tiempo</SelectItem>
                        <SelectItem value='usage'>Uso (horas/contador)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='interval_value'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {form.watch('frequency_type') === 'time' ? 'Cada (días)' : 'Cada (horas de uso)'}
                    </FormLabel>
                    <FormControl>
                      <Input type='number' min={1} {...field} onChange={numberValue(field.onChange)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='grace_days'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Margen de gracia (días)</FormLabel>
                    <FormControl>
                      <Input type='number' min={0} {...field} onChange={numberValue(field.onChange)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
              <FormField
                control={form.control}
                name='lead_days'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anticipación (días)</FormLabel>
                    <FormControl>
                      <Input type='number' min={0} {...field} onChange={numberValue(field.onChange)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {form.watch('frequency_type') === 'time' ? (
                <FormField
                  control={form.control}
                  name='next_due_at'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Próxima ejecución</FormLabel>
                      <FormControl>
                        <Input type='date' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name='last_run_counter'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contador inicial (horas)</FormLabel>
                      <FormControl>
                        <Input type='number' min={0} {...field} onChange={numberValue(field.onChange)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          </section>

          <section className='space-y-4'>
            <h2 className='text-sm font-semibold uppercase text-muted-foreground'>Generación</h2>
            <FormField
              control={form.control}
              name='checklist_template_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Plantilla de checklist (snapshot al generar la OT)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || 'none'}>
                    <FormControl>
                      <SelectTrigger className='w-full'>
                        <SelectValue placeholder='Sin checklist' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value='none'>Sin checklist</SelectItem>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className='text-[12.5px] text-muted-foreground'>
              El job diario (02:00) genera la OT cuando la próxima fecha menos la anticipación llega
              a hoy, o cuando el contador de uso alcanza el intervalo. Se omite si ya existe una OT
              abierta del mismo plan y activo.
            </p>
          </section>

          <Button type='submit' className='w-full' disabled={saving}>
            {saving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Guardar Plan
          </Button>
        </form>
      </Form>
    </main>
  )
}
