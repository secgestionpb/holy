import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Check, FileText, Loader2, Trash2, Upload } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/lib/auth'
import { formatMoney } from '@/lib/m4'
import { fileSizeError } from '@/lib/upload-utils'
import {
  AMOUNT_PERIOD_LABELS,
  amountPeriodKeys,
  CONTRACT_STATUS_LABELS,
  contractStatus,
  createContract,
  fetchContract,
  fetchEvent11Days,
  fetchProvider,
  signProviderFileUrl,
  updateContract,
  VISIT_FREQUENCY_LABELS,
  visitFrequencyKeys,
  type AmountPeriod,
  type ContractRow,
  type ContractStatus,
  type ProviderRow,
  type VisitFrequency,
} from '@/lib/m5'

const NO_FREQUENCY = 'none'

const CONTRACT_STATUS_CLASS: Record<ContractStatus, string> = {
  vigente: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  por_vencer: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  vencido: 'bg-destructive/15 text-destructive',
  inactivo: 'bg-muted text-muted-foreground',
}

function formatDate(value: string): string {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

const schema = z
  .object({
    name: z.string().trim().min(1, 'Escribe el nombre o descripción del contrato.'),
    scope: z.string().trim(),
    start_date: z.string().min(1, 'Indica la fecha de inicio.'),
    end_date: z.string().min(1, 'Indica la fecha de vencimiento.'),
    visit_frequency: z.string(),
    amount: z
      .string()
      .trim()
      .refine(
        (value) => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0,
        'Indica un monto válido (≥ 0).',
      ),
    amount_period: z.enum(amountPeriodKeys),
    notes: z.string().trim(),
  })
  .refine((data) => data.end_date > data.start_date, {
    message: 'El vencimiento debe ser posterior al inicio.',
    path: ['end_date'],
  })

type FormValues = z.infer<typeof schema>

export default function ContratoForm() {
  const { id: providerId, contractId } = useParams<{ id: string; contractId: string }>()
  const isEdit = Boolean(contractId)
  const navigate = useNavigate()

  const [provider, setProvider] = useState<ProviderRow | null>(null)
  const [contract, setContract] = useState<ContractRow | null>(null)
  const [warnDays, setWarnDays] = useState(30)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
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
      scope: '',
      start_date: '',
      end_date: '',
      visit_frequency: NO_FREQUENCY,
      amount: '',
      amount_period: 'once',
      notes: '',
    },
  })

  const backTo = `/app/proveedores/${providerId ?? ''}?tab=contratos`

  useEffect(() => {
    if (!providerId) {
      setLoadError('Falta el proveedor.')
      setLoading(false)
      return
    }
    let alive = true
    Promise.all([fetchProvider(providerId), fetchEvent11Days()])
      .then(([providerRow, days]) => {
        if (!alive) return
        if (!providerRow) {
          setLoadError('Proveedor inexistente.')
          return
        }
        setProvider(providerRow)
        setWarnDays(days)
        if (!contractId) {
          setLoading(false)
          return
        }
        fetchContract(contractId)
          .then((contractRow) => {
            if (!alive) return
            if (!contractRow || contractRow.provider_id !== providerId) {
              setLoadError('Contrato inexistente.')
              return
            }
            setContract(contractRow)
            reset({
              name: contractRow.name,
              scope: contractRow.scope ?? '',
              start_date: contractRow.start_date,
              end_date: contractRow.end_date,
              visit_frequency: contractRow.visit_frequency ?? NO_FREQUENCY,
              amount: contractRow.amount !== null ? String(contractRow.amount) : '',
              amount_period: contractRow.amount_period,
              notes: contractRow.notes ?? '',
            })
          })
          .catch((err: unknown) => {
            if (alive) {
              setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el contrato.')
            }
          })
          .finally(() => {
            if (alive) setLoading(false)
          })
      })
      .catch((err: unknown) => {
        if (alive) {
          setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el formulario.')
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, contractId])

  async function uploadAttachment(provider: string, file: File): Promise<string | null> {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const objectPath = `proveedores/${provider}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
    const upload = await apiFetch(`/storage/v1/object/documentos/${objectPath}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!upload.ok) return null
    return `documentos/${objectPath}`
  }

  async function onSubmit(values: FormValues) {
    if (!providerId) return
    setServerError(null)

    const payload = {
      provider_id: providerId,
      name: values.name,
      scope: values.scope.trim() || null,
      start_date: values.start_date,
      end_date: values.end_date,
      visit_frequency:
        values.visit_frequency === NO_FREQUENCY ? null : (values.visit_frequency as VisitFrequency),
      amount: Number(values.amount),
      amount_period: values.amount_period as AmountPeriod,
      notes: values.notes.trim() || null,
      is_active: contract ? contract.is_active : true,
    }

    let contractTarget = contractId
    if (isEdit && contract) {
      const result = await updateContract(contract.id, payload)
      if (!result.ok) {
        setServerError(result.message)
        return
      }
    } else {
      const created = await createContract({ ...payload, document_path: null })
      if (!created.ok) {
        setServerError(created.message)
        return
      }
      contractTarget = created.id
    }

    if (pendingFile && contractTarget) {
      const sizeError = fileSizeError(pendingFile)
      if (sizeError) {
        toast.error(sizeError)
        setUploading(false)
      } else {
        setUploading(true)
        const path = await uploadAttachment(providerId, pendingFile)
        if (!path) {
          toast.warning('Contrato guardado, pero el adjunto no se pudo subir.')
        } else {
          const patch = await updateContract(contractTarget, { document_path: path })
          if (!patch.ok) toast.warning(patch.message)
          else setPendingFile(null)
        }
        setUploading(false)
      }
    }

    toast.success(isEdit ? 'Contrato actualizado.' : 'Contrato creado.')
    navigate(backTo, { replace: true })
  }

  async function openAttachment() {
    if (!contract?.document_path) return
    const url = await signProviderFileUrl(contract.document_path)
    if (!url) {
      toast.error('No se pudo abrir el adjunto.')
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  async function removeAttachment() {
    if (!contract?.document_path) return
    if (!window.confirm('¿Quitar el adjunto del contrato?')) return
    await apiFetch(`/storage/v1/object/${contract.document_path}`, { method: 'DELETE' })
    const result = await updateContract(contract.id, { document_path: null })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Adjunto quitado.')
    setContract({ ...contract, document_path: null })
  }

  function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) setPendingFile(file)
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
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate('/app/proveedores')}>
            Volver al listado
          </Button>
        </div>
      </main>
    )
  }

  const status = contract ? contractStatus(contract, warnDays) : null

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
              onClick={() => navigate(backTo)}
            >
              <ArrowLeft className="size-3.5" />
              Contratos del proveedor
            </button>
            <h1 className="font-heading mt-1.5 text-[clamp(1.5rem,2.4vw,2rem)] font-extrabold tracking-[-0.02em]">
              {isEdit ? 'Editar contrato' : 'Nuevo contrato'}
            </h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              Vigencia con vencimiento posterior al inicio · estado derivado (config Evento 11:{' '}
              {warnDays} días).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate(backTo)}>
              Cancelar
            </Button>
            <Button form="contract-form" type="submit" disabled={isSubmitting || uploading}>
              {isSubmitting || uploading ? <Loader2 className="animate-spin" /> : <Check />}
              {isEdit ? 'Guardar cambios' : 'Crear contrato'}
            </Button>
          </div>
        </div>

        <form id="contract-form" onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-5">
          <section className="rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Vínculo</h2>
            <div className="mt-4 rounded-md border border-border bg-muted/40 px-4 py-3">
              <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
                Proveedor / contratista
              </p>
              <p className="mt-0.5 text-[14px] font-medium">
                {provider?.name}
                <span className="ml-2 font-mono text-[13px] text-muted-foreground">
                  {provider?.code}
                </span>
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contract-name">Nombre / descripción del contrato</Label>
                <Input
                  id="contract-name"
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
                <Label htmlFor="contract-scope">Alcance del servicio</Label>
                <Textarea id="contract-scope" rows={3} {...register('scope')} />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Vigencia</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="contract-start">Fecha de inicio</Label>
                <Input
                  id="contract-start"
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
                <Label htmlFor="contract-end">Fecha de vencimiento</Label>
                <Input
                  id="contract-end"
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

              <div className="space-y-2">
                <Label htmlFor="contract-frequency">Frecuencia de visitas pactadas</Label>
                <Select
                  value={watch('visit_frequency')}
                  onValueChange={(value) => setValue('visit_frequency', value)}
                >
                  <SelectTrigger id="contract-frequency" aria-label="Frecuencia de visitas">
                    <SelectValue placeholder="Frecuencia" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FREQUENCY}>Sin frecuencia</SelectItem>
                    {visitFrequencyKeys.map((value) => (
                      <SelectItem key={value} value={value}>
                        {VISIT_FREQUENCY_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Costo</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contract-amount">Monto del contrato</Label>
                <Input
                  id="contract-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  aria-invalid={errors.amount ? true : undefined}
                  {...register('amount')}
                />
                {errors.amount && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.amount.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="contract-period">Periodicidad del monto</Label>
                <Select
                  value={watch('amount_period')}
                  onValueChange={(value) => setValue('amount_period', value as AmountPeriod)}
                >
                  <SelectTrigger id="contract-period" aria-label="Periodicidad del monto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {amountPeriodKeys.map((value) => (
                      <SelectItem key={value} value={value}>
                        {AMOUNT_PERIOD_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">Extras</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Contrato firmado (adjunto, opcional) y observaciones.
                </p>
              </div>
              {status && (
                <div className="space-y-1 text-right">
                  <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
                    Estado (derivado)
                  </p>
                  <Badge variant="outline" className={CONTRACT_STATUS_CLASS[status]}>
                    {CONTRACT_STATUS_LABELS[status]}
                  </Badge>
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contract-file">Documento adjunto</Label>
                <input id="contract-file" type="file" className="hidden" onChange={onPickFile} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('contract-file')?.click()}
                  >
                    <Upload />
                    {contract?.document_path || pendingFile ? 'Reemplazar adjunto' : 'Elegir adjunto'}
                  </Button>
                  {pendingFile && (
                    <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                      <FileText className="size-4" />
                      {pendingFile.name}
                    </span>
                  )}
                  {!pendingFile && contract?.document_path && (
                    <span className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => void openAttachment()}>
                        <FileText />
                        Abrir adjunto
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Quitar adjunto"
                        onClick={() => void removeAttachment()}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contract-notes">Observaciones</Label>
                <Textarea id="contract-notes" rows={3} {...register('notes')} />
              </div>

              {contract && (
                <p className="text-[13px] text-muted-foreground">
                  Vigencia actual: {formatDate(contract.start_date)} → {formatDate(contract.end_date)} ·{' '}
                  {contract.amount !== null ? formatMoney(contract.amount) : '—'} /{' '}
                  {AMOUNT_PERIOD_LABELS[contract.amount_period].toLowerCase()} · periodo de costo no
                  editable afecta OTs ya emitidas.
                </p>
              )}
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
