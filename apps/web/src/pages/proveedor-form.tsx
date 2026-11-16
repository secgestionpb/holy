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
import { fetchCategories, type CategoryRow } from '@/lib/m1'
import {
  createProvider,
  deleteProviderFile,
  DOC_TYPE_LABELS,
  fetchProvider,
  fetchProviderFiles,
  providerCode,
  PROVIDER_TYPE_LABELS,
  signProviderFileUrl,
  updateProvider,
  uploadProviderFile,
  type ProviderDocType,
  type ProviderFileRow,
  type ProviderRow,
  type ProviderType,
} from '@/lib/m5'

const PROVIDER_TYPES = Object.keys(PROVIDER_TYPE_LABELS) as [ProviderType, ...ProviderType[]]

const schema = z
  .object({
    code: z.string().trim().min(1, 'Escribe o espera el código autogenerado.'),
    name: z.string().trim().min(1, 'Escribe el nombre o razón social.'),
    provider_type: z.enum(PROVIDER_TYPES),
    service_category_id: z.string(),
    is_active: z.enum(['active', 'inactive']),
    notes: z.string().trim(),
    contact_name: z
      .string()
      .trim()
      .min(1, 'Escribe el nombre del contacto principal.')
      .regex(
        /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü\s'.-]+$/,
        'Solo letras (y espacios, puntos o guiones).',
      ),
    contact_phone: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || /^\+?[\d\s()-]{7,}$/.test(value),
        'Formato de teléfono inválido: solo números con espacios, guiones o paréntesis.',
      ),
    contact_email: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
        'Correo electrónico inválido.',
      ),
    address: z.string().trim(),
  })
  .refine((data) => data.contact_phone !== '' || data.contact_email !== '', {
    message: 'Indica al menos un teléfono o un correo de contacto.',
    path: ['contact_phone'],
  })

type FormValues = z.infer<typeof schema>

export default function ProveedorForm() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [provider, setProvider] = useState<ProviderRow | null>(null)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [files, setFiles] = useState<ProviderFileRow[]>([])
  const [uploadType, setUploadType] = useState<ProviderDocType>('other')
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [codeDirty, setCodeDirty] = useState(false)
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
      code: '',
      name: '',
      provider_type: 'supplier',
      service_category_id: 'none',
      is_active: 'active',
      notes: '',
      contact_name: '',
      contact_phone: '',
      contact_email: '',
      address: '',
    },
  })

  useEffect(() => {
    let alive = true
    fetchCategories()
      .then((rows) => {
        if (alive) setCategories(rows)
      })
      .catch(() => {
        // Categorías críticas para el dropdown; el form sigue sin ellas.
      })
      .finally(() => {
        if (!alive) return
        if (!id) {
          setLoading(false)
          return
        }
        Promise.all([fetchProvider(id), fetchProviderFiles(id)])
          .then(([providerRow, fileRows]) => {
            if (!alive) return
            if (!providerRow) {
              setLoadError('Proveedor inexistente.')
              return
            }
            setProvider(providerRow)
            setFiles(fileRows)
            reset({
              code: providerRow.code,
              name: providerRow.name,
              provider_type: providerRow.provider_type,
              service_category_id: providerRow.service_category_id ?? 'none',
              is_active: providerRow.is_active ? 'active' : 'inactive',
              notes: providerRow.notes ?? '',
              contact_name: providerRow.contact_name ?? '',
              contact_phone: providerRow.contact_phone ?? '',
              contact_email: providerRow.contact_email ?? '',
              address: providerRow.address ?? '',
            })
          })
          .catch((err: unknown) => {
            if (alive) {
              setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el proveedor.')
            }
          })
          .finally(() => {
            if (alive) setLoading(false)
          })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Código autogenerado PRO-#### en el alta (preview sin consumir secuencia)
  useEffect(() => {
    if (isEdit || codeDirty) return
    let alive = true
    void providerCode('preview').then((result) => {
      if (alive && result.ok && result.code) setValue('code', result.code, { shouldDirty: false })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, codeDirty])

  // Unicidad en tiempo real (debounce) cuando el código es manual
  useEffect(() => {
    if (!codeDirty) return
    const code = watch('code').trim()
    if (code.length < 3) return
    let alive = true
    const timer = window.setTimeout(() => {
      setCodeCheck({ checking: true, available: null })
      void providerCode('check', code, id).then((result) => {
        if (!alive) return
        setCodeCheck({
          checking: false,
          available: result.ok && typeof result.available === 'boolean' ? result.available : null,
        })
      })
    }, 400)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeDirty, watch('code')])

  async function onSubmit(values: FormValues) {
    setServerError(null)
    let finalCode = values.code.trim()

    if (codeDirty) {
      const check = await providerCode('check', finalCode, id)
      if (!check.ok) {
        setServerError(check.message)
        return
      }
      if (check.available === false) {
        setServerError(`El código «${finalCode}» ya existe.`)
        return
      }
    } else if (!isEdit) {
      const allocation = await providerCode('allocate')
      if (!allocation.ok) {
        setServerError(allocation.message)
        return
      }
      finalCode = allocation.code ?? finalCode
    }

    const payload = {
      code: finalCode,
      name: values.name,
      provider_type: values.provider_type,
      service_category_id: values.service_category_id === 'none' ? null : values.service_category_id,
      contact_name: values.contact_name.trim() || null,
      contact_phone: values.contact_phone.trim() || null,
      contact_email: values.contact_email.trim() || null,
      address: values.address.trim() || null,
      notes: values.notes.trim() || null,
      is_active: values.is_active === 'active',
    }

    let providerId = id
    if (isEdit && provider) {
      const result = await updateProvider(provider.id, payload)
      if (!result.ok) {
        setServerError(result.message)
        return
      }
    } else {
      const created = await createProvider(payload)
      if (!created.ok) {
        setServerError(created.message)
        return
      }
      providerId = created.id
    }

    if (!providerId) {
      setServerError('No se pudo obtener el identificador del proveedor.')
      return
    }

    toast.success(isEdit ? 'Proveedor actualizado.' : 'Proveedor creado.')
    navigate(`/app/proveedores/${providerId}`, { replace: true })
  }

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !id) return
    setUploading(true)
    const result = await uploadProviderFile(id, file, uploadType)
    setUploading(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Documento subido.')
    const fileRows = await fetchProviderFiles(id).catch(() => null)
    if (fileRows) setFiles(fileRows)
  }

  async function removeFile(file: ProviderFileRow) {
    if (!window.confirm(`¿Eliminar «${file.original_name}»? Esta acción no se puede deshacer.`)) return
    const result = await deleteProviderFile(file)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success('Documento eliminado.')
    setFiles((rows) => rows.filter((row) => row.id !== file.id))
  }

  async function openFile(file: ProviderFileRow) {
    const url = await signProviderFileUrl(file.path)
    if (!url) {
      toast.error('No se pudo abrir el archivo.')
      return
    }
    window.open(url, '_blank', 'noopener')
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
            onClick={() => navigate('/app/proveedores')}
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
              onClick={() => navigate(isEdit && id ? `/app/proveedores/${id}` : '/app/proveedores')}
            >
              <ArrowLeft className="size-3.5" />
              Proveedores
            </button>
            <h1 className="font-heading mt-1.5 text-[clamp(1.5rem,2.4vw,2rem)] font-extrabold tracking-[-0.02em]">
              {isEdit ? 'Editar proveedor' : 'Nuevo proveedor / contratista'}
            </h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate(isEdit && id ? `/app/proveedores/${id}` : '/app/proveedores')}
            >
              Cancelar
            </Button>
            <Button
              form="provider-form"
              type="submit"
              disabled={isSubmitting || codeCheck.available === false}
            >
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Check />}
              {isEdit ? 'Guardar cambios' : 'Guardar proveedor'}
            </Button>
          </div>
        </div>

        <form id="provider-form" onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-5">
          <section className="rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">General</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="provider-code">Código (PRO-####)</Label>
                <div className="relative">
                  <Input
                    id="provider-code"
                    className="font-mono"
                    aria-invalid={errors.code ? true : undefined}
                    {...register('code', {
                      onChange: () => {
                        setCodeDirty(true)
                        setCodeCheck({ checking: false, available: null })
                      },
                    })}
                  />
                  {codeCheck.checking && (
                    <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                  {!codeCheck.checking && codeCheck.available === true && (
                    <Check className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-emerald-600" />
                  )}
                </div>
                {errors.code && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.code.message}
                  </p>
                )}
                {!errors.code && codeCheck.available === false && (
                  <p role="alert" className="text-[13px] text-destructive">
                    Ese código ya está en uso.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="provider-name">Nombre / razón social</Label>
                <Input
                  id="provider-name"
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
                <Label htmlFor="provider-type">Tipo</Label>
                <Select
                  value={watch('provider_type')}
                  onValueChange={(value) => setValue('provider_type', value as ProviderType)}
                >
                  <SelectTrigger id="provider-type" aria-label="Tipo de tercero">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {PROVIDER_TYPE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="provider-category">Categoría de servicio</Label>
                <Select
                  value={watch('service_category_id')}
                  onValueChange={(value) => setValue('service_category_id', value)}
                >
                  <SelectTrigger id="provider-category" aria-label="Categoría de servicio">
                    <SelectValue placeholder="Categoría de servicio" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin categoría</SelectItem>
                    {categories
                      .filter(
                        (category) =>
                          category.is_active || category.id === watch('service_category_id'),
                      )
                      .map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="provider-state">Estado</Label>
                <Select
                  value={watch('is_active')}
                  onValueChange={(value) => setValue('is_active', value as 'active' | 'inactive')}
                >
                  <SelectTrigger id="provider-state" aria-label="Estado">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Activo</SelectItem>
                    <SelectItem value="inactive">Inactivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="provider-notes">Observaciones</Label>
                <Textarea id="provider-notes" rows={3} {...register('notes')} />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Contacto</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contact-name">Contacto principal (nombre)</Label>
                <Input
                  id="contact-name"
                  aria-invalid={errors.contact_name ? true : undefined}
                  {...register('contact_name')}
                />
                {errors.contact_name && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.contact_name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact-phone">Teléfono</Label>
                <Input
                  id="contact-phone"
                  type="tel"
                  aria-invalid={errors.contact_phone ? true : undefined}
                  {...register('contact_phone')}
                />
                {errors.contact_phone && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.contact_phone.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact-email">Correo</Label>
                <Input
                  id="contact-email"
                  type="email"
                  aria-invalid={errors.contact_email ? true : undefined}
                  {...register('contact_email')}
                />
                {errors.contact_email && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {errors.contact_email.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact-address">Dirección</Label>
                <Input id="contact-address" {...register('address')} />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">Documentos</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Contrato marco, certificaciones y pólizas (patrón asset_files).
                </p>
              </div>
              {!isEdit ? (
                <p className="text-[12.5px] text-muted-foreground">
                  Guarda el proveedor para subir documentos.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={uploadType} onValueChange={(value) => setUploadType(value as ProviderDocType)}>
                    <SelectTrigger className="w-[170px]" aria-label="Tipo de documento">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(DOC_TYPE_LABELS) as Array<[ProviderDocType, string]>).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  <input
                    id="provider-file"
                    type="file"
                    className="hidden"
                    onChange={(event) => void onPickFile(event)}
                  />
                  <Button
                    size="sm"
                    disabled={uploading}
                    onClick={() => document.getElementById('provider-file')?.click()}
                  >
                    {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                    Subir
                  </Button>
                </div>
              )}
            </div>

            {isEdit && (
              <div className="mt-4">
                {files.length === 0 ? (
                  <p className="text-[14px] text-muted-foreground">Sin documentos cargados.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {files.map((file) => (
                      <li
                        key={file.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-medium">{file.original_name}</p>
                            <p className="text-[12.5px] text-muted-foreground">
                              <Badge variant="secondary" className="mr-2 text-[11px]">
                                {DOC_TYPE_LABELS[file.doc_type]}
                              </Badge>
                              Subido
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => void openFile(file)}>
                            Abrir
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Eliminar ${file.original_name}`}
                            onClick={() => void removeFile(file)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {serverError && (
            <p role="alert" className="text-[14px] text-destructive">
              {serverError}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(isEdit && id ? `/app/proveedores/${id}` : '/app/proveedores')}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || codeCheck.available === false}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Check />}
              {isEdit ? 'Guardar cambios' : 'Crear proveedor'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}
