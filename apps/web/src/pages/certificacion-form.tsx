import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Check, History, Loader2, Power, RotateCw, Upload } from 'lucide-react'
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
import { useAuth } from '@/lib/auth-store'
import { fetchProviders, type ProviderRow } from '@/lib/m5'
import { RenewDialog } from '@/components/compliance/renew-dialog'
import {
  CERT_BADGE_CLASS,
  CERT_STATUS_LABELS,
  RENEWAL_PERIOD_LABELS,
  certStatus,
  createCertification,
  fetchAssetsLite,
  fetchCertHistory,
  fetchCertification,
  fetchComplianceCategories,
  fetchEvent8Lead,
  signComplianceFileUrl,
  todayIso,
  updateCertification,
  uploadComplianceFile,
  type CertHistoryRow,
  type CertificationRow,
  type ComplianceCategoryRow,
  type RenewalPeriod,
} from '@/lib/m6'

const RENEWAL_PERIODS = Object.keys(RENEWAL_PERIOD_LABELS) as [RenewalPeriod, ...RenewalPeriod[]]

const NO_ASSET = '__hotel__'
const NO_PROVIDER = '__none__'
const NO_PERIOD = '__none__'

const schema = z
  .object({
    name: z.string().trim().min(1, 'Escribe el nombre de la certificación.'),
    asset_id: z.string(),
    compliance_category_id: z.string().min(1, 'Selecciona la categoría normativa.'),
    issuing_entity: z.string().trim(),
    certificate_number: z.string().trim(),
    issued_at: z.string(),
    expires_at: z.string().min(1, 'La fecha de vencimiento es obligatoria.'),
    renewal_period: z.string(),
    lead_days: z.string().refine((v) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= 1), {
      message: 'Usa un número entero ≥ 1 o déjalo vacío.',
    }),
    responsible_provider_id: z.string(),
    notes: z.string().trim(),
  })
  .refine((data) => data.issued_at === '' || data.expires_at > data.issued_at, {
    message: 'El vencimiento debe ser posterior a la emisión.',
    path: ['expires_at'],
  })

type FormValues = z.infer<typeof schema>

export default function CertificacionForm() {
  const { id } = useParams<{ id: string }>()
  const isCreate = id === 'nueva'
  const navigate = useNavigate()
  const roles = useAuth((s) => s.roles)
  const isQuality = roles.includes('calidad')
  const canRenew = isQuality || roles.includes('mantenimiento')

  const [cert, setCert] = useState<CertificationRow | null>(null)
  const [categories, setCategories] = useState<ComplianceCategoryRow[]>([])
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof fetchAssetsLite>>>([])
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [history, setHistory] = useState<CertHistoryRow[]>([])
  const [globalLead, setGlobalLead] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [docPath, setDocPath] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [renewOpen, setRenewOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

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
      asset_id: NO_ASSET,
      compliance_category_id: '',
      issuing_entity: '',
      certificate_number: '',
      issued_at: todayIso(),
      expires_at: '',
      renewal_period: NO_PERIOD,
      lead_days: '',
      responsible_provider_id: NO_PROVIDER,
      notes: '',
    },
  })

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      fetchComplianceCategories(),
      fetchAssetsLite(),
      fetchProviders(),
      fetchEvent8Lead(),
    ])
      .then(([catRows, assetRows, providerRows, lead]) => {
        if (!alive) return
        setCategories(catRows)
        setAssets(assetRows)
        setProviders(providerRows)
        setGlobalLead(lead)
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el formulario.')
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
    Promise.all([fetchCertification(id), fetchCertHistory(id)])
      .then(([certRow, historyRows]) => {
        if (!alive) return
        if (!certRow) {
          setLoadError('Certificación inexistente.')
          return
        }
        setCert(certRow)
        setHistory(historyRows)
        setDocPath(certRow.document_path)
        reset({
          name: certRow.name,
          asset_id: certRow.asset_id ?? NO_ASSET,
          compliance_category_id: certRow.compliance_category_id,
          issuing_entity: certRow.issuing_entity ?? '',
          certificate_number: certRow.certificate_number ?? '',
          issued_at: certRow.issued_at ?? '',
          expires_at: certRow.expires_at,
          renewal_period: certRow.renewal_period ?? NO_PERIOD,
          lead_days: certRow.lead_days === null ? '' : String(certRow.lead_days),
          responsible_provider_id: certRow.responsible_provider_id ?? NO_PROVIDER,
          notes: certRow.notes ?? '',
        })
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudo cargar la certificación.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reloadKey])

  const status = useMemo(
    () => (cert ? certStatus(cert, globalLead) : null),
    [cert, globalLead],
  )

  async function onPickFile(file: File) {
    setUploading(true)
    const result = await uploadComplianceFile(file)
    setUploading(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    if (!result.path) {
      toast.error('No se pudo subir el documento.')
      return
    }
    setDocPath(result.path)
    setFileName(file.name)
    toast.success('Documento adjunto. Recuerda guardar los cambios.')
  }

  async function openDocument() {
    if (!docPath) return
    const url = await signComplianceFileUrl(docPath)
    if (!url) {
      toast.error('No se pudo abrir el documento.')
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const payload = {
      name: values.name,
      asset_id: values.asset_id === NO_ASSET ? null : values.asset_id,
      compliance_category_id: values.compliance_category_id,
      issuing_entity: values.issuing_entity.trim() || null,
      certificate_number: values.certificate_number.trim() || null,
      issued_at: values.issued_at || null,
      expires_at: values.expires_at,
      renewal_period: values.renewal_period === NO_PERIOD ? null : (values.renewal_period as RenewalPeriod),
      lead_days: values.lead_days === '' ? null : Number(values.lead_days),
      responsible_provider_id: values.responsible_provider_id === NO_PROVIDER ? null : values.responsible_provider_id,
      document_path: docPath,
      notes: values.notes.trim() || null,
    }

    if (isCreate) {
      const created = await createCertification(payload)
      if (!created.ok) {
        setServerError(created.message)
        return
      }
      toast.success('Certificación creada.')
      navigate(`/app/cumplimiento/certificaciones/${created.id}`, { replace: true })
      return
    }

    if (!cert) return
    const updated = await updateCertification(cert.id, payload)
    if (!updated.ok) {
      setServerError(updated.message)
      return
    }
    toast.success('Certificación actualizada.')
    setReloadKey((k) => k + 1)
  }

  async function toggleActive() {
    if (!cert) return
    const next = !cert.is_active
    const label = next ? 'reactivar' : 'desactivar'
    if (!window.confirm(`¿${next === false ? 'Desactivar' : 'Reactivar'} esta certificación?`)) {
      return
    }
    const result = await updateCertification(cert.id, { is_active: next })
    if (!result.ok) {
      toast.error(result.message ?? `No se pudo ${label} la certificación.`)
      return
    }
    toast.success(next ? 'Certificación reactivada.' : 'Certificación desactivada.')
    setReloadKey((k) => k + 1)
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
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => navigate('/app/cumplimiento?tab=certificaciones')}
          >
            Volver al listado
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/app/cumplimiento?tab=certificaciones')}
            >
              <ArrowLeft className="size-3.5" />
              Cumplimiento
            </button>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-[clamp(1.5rem,2.4vw,2rem)] font-extrabold tracking-[-0.02em]">
                {isCreate ? 'Nueva certificación' : cert?.name}
              </h1>
              {status && (
                <Badge className={CERT_BADGE_CLASS[status]}>{CERT_STATUS_LABELS[status]}</Badge>
              )}
              {cert && !cert.is_active && (
                <Badge className="bg-muted text-muted-foreground">Inactiva</Badge>
              )}
            </div>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              Certificaciones, permisos y licencias · la renovación archiva la vigencia anterior en el
              historial.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isCreate && canRenew && (
              <Button variant="outline" onClick={() => setRenewOpen(true)}>
                <RotateCw className="size-4" />
                Renovar
              </Button>
            )}
            {!isCreate && isQuality && (
              <Button variant="outline" onClick={() => void toggleActive()}>
                <Power className="size-4" />
                {cert?.is_active ? 'Desactivar' : 'Reactivar'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => navigate('/app/cumplimiento?tab=certificaciones')}
            >
              Cancelar
            </Button>
            {isQuality && (
              <Button form="cert-form" type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="animate-spin" /> : <Check />}
                {isCreate ? 'Crear certificación' : 'Guardar cambios'}
              </Button>
            )}
          </div>
        </div>

        {!isQuality && (
          <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            {canRenew
              ? 'Vista de solo lectura. Puedes renovar la certificación cuando corresponda.'
              : 'Vista de solo lectura.'}
          </p>
        )}

        <form id="cert-form" onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-5">
          <section className="rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">General</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cert-name">Nombre *</Label>
                <Input
                  id="cert-name"
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
                <Label htmlFor="cert-category">Categoría normativa *</Label>
                <Select
                  value={watch('compliance_category_id')}
                  onValueChange={(v) => setValue('compliance_category_id', v)}
                  disabled={!isQuality}
                >
                  <SelectTrigger id="cert-category" aria-label="Categoría normativa">
                    <SelectValue placeholder="Selecciona la categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.compliance_category_id && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.compliance_category_id.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cert-asset">Activo (opcional)</Label>
                <Select
                  value={watch('asset_id')}
                  onValueChange={(v) => setValue('asset_id', v)}
                  disabled={!isQuality}
                >
                  <SelectTrigger id="cert-asset" aria-label="Activo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ASSET}>General — todo el hotel</SelectItem>
                    {assets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-muted-foreground">
                  Déjalo en «General» para licencias que aplican al hotel completo.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cert-entity">Entidad emisora</Label>
                <Input id="cert-entity" disabled={!isQuality} {...register('issuing_entity')} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cert-number">Nº de certificado</Label>
                <Input id="cert-number" disabled={!isQuality} {...register('certificate_number')} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cert-issued">Fecha de emisión</Label>
                <Input id="cert-issued" type="date" disabled={!isQuality} {...register('issued_at')} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cert-expires">Vencimiento *</Label>
                <Input
                  id="cert-expires"
                  type="date"
                  disabled={!isQuality}
                  aria-invalid={errors.expires_at ? true : undefined}
                  {...register('expires_at')}
                />
                {errors.expires_at && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.expires_at.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cert-period">Periodo de renovación</Label>
                <Select
                  value={watch('renewal_period')}
                  onValueChange={(v) => setValue('renewal_period', v)}
                  disabled={!isQuality}
                >
                  <SelectTrigger id="cert-period" aria-label="Periodo de renovación">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PERIOD}>Sin periodo definido</SelectItem>
                    {RENEWAL_PERIODS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {RENEWAL_PERIOD_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cert-lead">Aviso con N días previos</Label>
                <Input
                  id="cert-lead"
                  type="number"
                  min={1}
                  disabled={!isQuality}
                  placeholder={globalLead !== null ? `Global: ${globalLead}` : 'Global: 30'}
                  {...register('lead_days')}
                />
                {errors.lead_days && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.lead_days.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cert-provider">Responsable de renovación</Label>
                <Select
                  value={watch('responsible_provider_id')}
                  onValueChange={(v) => setValue('responsible_provider_id', v)}
                  disabled={!isQuality}
                >
                  <SelectTrigger id="cert-provider" aria-label="Responsable">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROVIDER}>Sin responsable</SelectItem>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cert-active">Estado</Label>
                <Select
                  value={cert?.is_active === false ? 'inactive' : 'active'}
                  onValueChange={(v) => {
                    if (!cert) return
                    void updateCertification(cert.id, { is_active: v === 'active' }).then((r) => {
                      if (r.ok) setReloadKey((k) => k + 1)
                      else toast.error(r.message ?? 'No se pudo cambiar el estado.')
                    })
                  }}
                  disabled={!isQuality || isCreate}
                >
                  <SelectTrigger id="cert-active" aria-label="Estado">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Activa</SelectItem>
                    <SelectItem value="inactive">Inactiva</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cert-notes">Observaciones</Label>
                <Textarea id="cert-notes" rows={3} disabled={!isQuality} {...register('notes')} />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">Documento de la vigencia actual</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  PDF o imagen en bucket «documentos», prefijo cumplimiento/.
                </p>
              </div>
              {isQuality && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="cert-doc"
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void onPickFile(f)
                      e.target.value = ''
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => document.getElementById('cert-doc')?.click()}
                  >
                    {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                    Adjuntar
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {docPath ? (
                <>
                  <Badge variant="secondary">Documento adjunto</Badge>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void openDocument()}>
                    Abrir documento
                  </Button>
                  {fileName && (
                    <span className="truncate text-[12.5px] text-muted-foreground">{fileName}</span>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-muted-foreground">Sin documento cargado.</p>
              )}
            </div>
          </section>

          {serverError && (
            <p role="alert" className="text-[14px] text-destructive">
              {serverError}
            </p>
          )}
        </form>

        {!isCreate && (
          <section className="mt-6 rounded-lg border border-border p-5">
            <div className="flex items-center gap-2">
              <History className="size-4 text-muted-foreground" />
              <h2 className="text-[15px] font-semibold">Historial de vigencias</h2>
            </div>
            {history.length === 0 ? (
              <p className="mt-3 text-[13.5px] text-muted-foreground">
                Sin renovaciones registradas. La vigencia actual es la primera.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-[14px] font-medium">
                        {h.issued_at} → {h.expires_at}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground">
                        Renovada el {h.renewed_at} · {h.provider?.name ?? 'sin responsable'}
                        {h.note ? ` · ${h.note}` : ''}
                      </p>
                    </div>
                    {h.document_path && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void signComplianceFileUrl(h.document_path as string).then((url) => {
                            if (url) window.open(url, '_blank', 'noopener')
                            else toast.error('No se pudo abrir el documento.')
                          })
                        }}
                      >
                        Documento
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {cert && (
        <RenewDialog
          open={renewOpen}
          onOpenChange={setRenewOpen}
          cert={cert}
          providers={providers}
          onRenewed={() => setReloadKey((k) => k + 1)}
        />
      )}
    </main>
  )
}
