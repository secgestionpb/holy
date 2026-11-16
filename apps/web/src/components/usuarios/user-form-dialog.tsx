import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, Copy, ImagePlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Switch } from '@/components/ui/switch'
import {
  ROLES,
  ROLE_LABELS,
  type AdminUserRow,
  createUser,
  fetchCategories,
  signAvatarUrl,
  updateUser,
  uploadAvatar,
  type CategoryOption,
} from '@/lib/admin-users'

const schema = z.object({
  full_name: z.string().trim().min(1, 'Escribe el nombre completo.'),
  email: z
    .string()
    .trim()
    .min(1, 'Escribe el correo.')
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Escribe un correo válido.'),
  phone: z.string().trim(),
  hourly_rate: z.string().trim().refine(
    (value) => value === '' || /^\d+(\.\d{1,2})?$/.test(value),
    'Tarifa inválida (solo números, ej. 18.50).',
  ),
  roles: z.array(z.string()).min(1, 'Selecciona al menos un rol.'),
  category_ids: z.array(z.string()),
  is_active: z.boolean(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AdminUserRow | null
  onSaved: () => void
}

export function UserFormDialog({ open, onOpenChange, user, onSaved }: Props) {
  const isEdit = user !== null
  const [serverError, setServerError] = useState<string | null>(null)
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [newFile, setNewFile] = useState<File | null>(null)
  const [avatarCleared, setAvatarCleared] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues:
      isEdit && user
        ? {
            full_name: user.full_name,
            email: user.email,
            phone: user.phone ?? '',
            hourly_rate: user.hourly_rate !== null ? String(user.hourly_rate) : '',
            roles: user.user_roles.map((r) => r.role),
            category_ids: user.user_category_assignments.map((a) => a.category_id),
            is_active: user.is_active,
          }
        : {
            full_name: '',
            email: '',
            phone: '',
            hourly_rate: '',
            roles: [],
            category_ids: [],
            is_active: true,
          },
  })

  const roles = useWatch({ control, name: 'roles' })
  const categoryIds = useWatch({ control, name: 'category_ids' })
  const isActive = useWatch({ control, name: 'is_active' })
  const showCategories = roles.includes('tecnico')

  useEffect(() => {
    let alive = true
    void fetchCategories().then((rows) => {
      if (alive) setCategories(rows)
    })
    if (isEdit && user?.avatar_path) {
      void signAvatarUrl(user.avatar_path).then((url) => {
        if (alive) setAvatarUrl(url)
      })
    }
    return () => {
      alive = false
    }
  }, [isEdit, user])

  const roleError = useMemo(() => errors.roles?.message, [errors.roles])

  function toggleRole(role: string, checked: boolean) {
    const next = checked ? [...roles, role] : roles.filter((r) => r !== role)
    setValue('roles', next, { shouldValidate: true, shouldDirty: true })
  }

  function toggleCategory(id: string, checked: boolean) {
    const next = checked ? [...categoryIds, id] : categoryIds.filter((c) => c !== id)
    setValue('category_ids', next, { shouldValidate: true, shouldDirty: true })
  }

  function onPickFile(file: File | null) {
    if (file) {
      setNewFile(file)
      setAvatarCleared(false)
      setAvatarUrl(URL.createObjectURL(file))
      return
    }
    setNewFile(null)
    setAvatarCleared(true)
    setAvatarUrl(null)
  }

  async function copyPassword() {
    if (!tempPassword) return
    try {
      await navigator.clipboard.writeText(tempPassword)
      toast.success('Clave copiada al portapapeles.')
    } catch {
      toast.error('No se pudo copiar. Selecciona la clave manualmente.')
    }
  }

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const input = {
      email: values.email.toLowerCase(),
      full_name: values.full_name,
      phone: values.phone || null,
      hourly_rate: values.hourly_rate ? Number(values.hourly_rate) : null,
      roles: values.roles,
      category_ids: values.category_ids,
    }

    if (!isEdit || !user) {
      const result = await createUser(input)
      if (result.ok) {
        setTempPassword(result.temp_password)
        onSaved()
        return
      }
      setServerError(result.message)
      return
    }

    let avatarPath = user.avatar_path
    if (newFile) {
      try {
        avatarPath = await uploadAvatar(newFile, user.id)
      } catch (error) {
        setServerError(error instanceof Error ? error.message : 'No se pudo subir la imagen.')
        return
      }
    } else if (avatarCleared) {
      avatarPath = null
    }

    const result = await updateUser(user.id, input, {
      is_active: values.is_active,
      avatar_path: avatarPath,
    })
    if (result.ok) {
      toast.success('Cambios guardados.')
      onSaved()
      onOpenChange(false)
      return
    }
    setServerError(result.message)
  }

  if (tempPassword) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Usuario creado</DialogTitle>
            <DialogDescription>
              Contraseña inicial predeterminada. Transmítela al usuario por el canal que prefiera;
              deberá cambiarla en su primer inicio de sesión.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2.5">
              <code className="font-mono text-[15px] font-semibold tracking-wide select-all">
                {tempPassword}
              </code>
              <Button variant="outline" size="sm" onClick={() => void copyPassword()}>
                <Copy />
                Copiar
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                onOpenChange(false)
              }}
            >
              <Check />
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Actualiza el perfil, roles y asignaciones del usuario.'
              : 'Completa el perfil y asigna al menos un rol. Se asignará la contraseña inicial predeterminada (se muestra tras crear).'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="full_name">Nombre completo</Label>
              <Input
                id="full_name"
                aria-invalid={errors.full_name ? true : undefined}
                {...register('full_name')}
              />
              {errors.full_name && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.full_name.message}
                </p>
              )}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                type="email"
                placeholder="nombre@hotel.com"
                aria-invalid={errors.email ? true : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono (opcional)</Label>
              <Input id="phone" placeholder="600 000 000" {...register('phone')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hourly_rate">Tarifa por hora (USD/h)</Label>
              <Input
                id="hourly_rate"
                inputMode="decimal"
                placeholder="Vacío = tarifa global"
                aria-invalid={errors.hourly_rate ? true : undefined}
                {...register('hourly_rate')}
              />
              {errors.hourly_rate && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.hourly_rate.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Rol(es)</Label>
            <div className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
              {ROLES.map((role) => (
                <label
                  key={role}
                  className="flex cursor-pointer items-center gap-2.5 text-[14px]"
                  htmlFor={`role-${role}`}
                >
                  <Checkbox
                    id={`role-${role}`}
                    checked={roles.includes(role)}
                    onCheckedChange={(checked) => toggleRole(role, checked === true)}
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
            {roleError && (
              <p role="alert" className="text-[13px] text-destructive">
                {roleError}
              </p>
            )}
          </div>

          {showCategories && (
            <div className="space-y-2">
              <Label>Categorías asignadas (especialidad del técnico)</Label>
              <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-md border border-border p-3">
                {categories.length === 0 && (
                  <p className="text-[13px] text-muted-foreground">No hay categorías disponibles.</p>
                )}
                {categories.map((category) => (
                  <label
                    key={category.id}
                    className="flex cursor-pointer items-center gap-2.5 text-[14px]"
                    htmlFor={`cat-${category.id}`}
                  >
                    <Checkbox
                      id={`cat-${category.id}`}
                      checked={categoryIds.includes(category.id)}
                      onCheckedChange={(checked) => toggleCategory(category.id, checked === true)}
                    />
                    {category.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {isEdit && (
                <div className="flex items-center gap-3">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Foto de perfil"
                      className="size-10 rounded-full border border-border object-cover"
                    />
                  ) : (
                    <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <ImagePlus className="size-4" />
                    </div>
                  )}
                  <label className="cursor-pointer text-[13px] font-medium text-primary underline-offset-4 hover:underline">
                    {avatarUrl ? 'Cambiar foto' : 'Subir foto'}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  {!avatarCleared && (avatarUrl || user?.avatar_path) && (
                    <button
                      type="button"
                      className="text-[13px] text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => onPickFile(null)}
                    >
                      Quitar
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2.5">
                <Switch
                  id="is_active"
                  checked={isActive}
                  onCheckedChange={(checked) => setValue('is_active', checked, { shouldDirty: true })}
                />
                <Label htmlFor="is_active" className="cursor-pointer">
                  {isActive ? 'Activo' : 'Inactivo'}
                </Label>
              </div>
            </div>
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
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Guardando
                </>
              ) : isEdit ? (
                'Guardar cambios'
              ) : (
                'Crear usuario'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
