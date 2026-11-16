import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Loader2, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth-store'
import {
  createCategory,
  fetchAssets,
  fetchCategories,
  updateCategory,
  type CategoryRow,
} from '@/lib/m1'

const schema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre de la categoría.'),
  code_prefix: z
    .string()
    .trim()
    .min(1, 'Escribe el prefijo de código.')
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z0-9]{1,8}$/.test(value), 'Usa de 1 a 8 caracteres A–Z o 0–9.'),
  description: z.string().trim(),
})

type FormValues = z.infer<typeof schema>

type DialogMode = { type: 'create' } | { type: 'edit'; category: CategoryRow }

function CategoryDialog({
  open,
  onOpenChange,
  mode,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: DialogMode
  onSaved: () => void
}) {
  const isEdit = mode.type === 'edit'
  const category = isEdit ? mode.category : null
  const [serverError, setServerError] = useState<string | null>(null)
  const [active, setActive] = useState(category?.is_active ?? true)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: category?.name ?? '',
      code_prefix: category?.code_prefix ?? '',
      description: category?.description ?? '',
    },
  })

  // Sin effect de reset: el padre renderiza este diálogo solo montado (condicional),
  // así que cada apertura parte del estado inicial calculado arriba.

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const payload = {
      name: values.name,
      code_prefix: values.code_prefix,
      description: values.description || null,
      is_active: active,
    }
    const result = isEdit && category
      ? await updateCategory(category.id, payload)
      : await createCategory(payload)
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar «${category?.name}»` : 'Nueva categoría'}</DialogTitle>
          <DialogDescription>
            El prefijo alimenta el código autogenerado de los activos (F1.1). Las categorías no se
            eliminan: se desactivan para que dejen de ofrecerse en el alta.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Nombre</Label>
            <Input
              id="cat-name"
              placeholder="Ej. Bombas centrífugas"
              aria-invalid={errors.name ? true : undefined}
              {...register('name')}
            />
            {errors.name && (
              <p role="alert" className="text-[13px] text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cat-prefix">Prefijo de código</Label>
              <Input
                id="cat-prefix"
                className="font-mono uppercase"
                placeholder="Ej. BOM"
                aria-invalid={errors.code_prefix ? true : undefined}
                {...register('code_prefix')}
              />
              {errors.code_prefix && (
                <p role="alert" className="text-[13px] text-destructive">
                  {errors.code_prefix.message}
                </p>
              )}
            </div>

            <div className="flex items-end gap-2.5 pb-1.5">
              <Switch
                id="cat-active"
                checked={active}
                onCheckedChange={setActive}
                aria-label="Categoría activa"
              />
              <Label htmlFor="cat-active" className="cursor-pointer">
                {active ? 'Activa' : 'Inactiva'}
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-desc">Descripción</Label>
            <Textarea id="cat-desc" rows={3} {...register('description')} />
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
              {isEdit ? 'Guardar cambios' : 'Crear categoría'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function ActivosCategorias() {
  const roles = useAuth((s) => s.roles)
  const canEdit = roles.includes('mantenimiento')
  const navigate = useNavigate()

  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [assetCountByCategory, setAssetCountByCategory] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([fetchCategories(), fetchAssets()])
      .then(([categoryRows, assetRows]) => {
        if (!alive) return
        setCategories(categoryRows)
        const counts = new Map<string, number>()
        for (const asset of assetRows) {
          if (!asset.category_id) continue
          counts.set(asset.category_id, (counts.get(asset.category_id) ?? 0) + 1)
        }
        setAssetCountByCategory(counts)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'No se pudieron cargar las categorías.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  function refresh() {
    setLoading(true)
    setError(null)
    setReloadKey((key) => key + 1)
  }

  async function toggleActive(category: CategoryRow, checked: boolean) {
    const result = await updateCategory(category.id, { is_active: checked })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success(checked ? 'Categoría reactivada.' : 'Categoría desactivada.')
    refresh()
  }

  const activeCount = categories.filter((category) => category.is_active).length
  const totalCount = assetCountByCategory.size
    ? [...assetCountByCategory.values()].reduce((sum, count) => sum + count, 0)
    : 0

  if (!canEdit) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-[14px] text-muted-foreground">
            El catálogo de categorías es operación del rol Mantenimiento.
          </p>
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
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          onClick={() => navigate('/app/activos')}
        >
          <ArrowLeft className="size-3.5" />
          Volver al explorador
        </button>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Módulo 1 · Gestión de activos
            </p>
            <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
              Categorías de activos
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              {activeCount} {activeCount === 1 ? 'categoría activa' : 'categorías activas'} ·{' '}
              {categories.length} en el catálogo
            </p>
          </div>
          <Button onClick={() => setDialogMode({ type: 'create' })}>
            <Plus />
            Nueva categoría
          </Button>
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-14 text-[14px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando categorías…
            </div>
          ) : error ? (
            <div className="px-6 py-10 text-center">
              <p className="text-[14px] text-destructive">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={refresh}>
                Reintentar
              </Button>
            </div>
          ) : categories.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[14px] text-muted-foreground">
                El catálogo está vacío: crea la primera categoría para poder dar de alta activos.
              </p>
              <Button className="mt-4" onClick={() => setDialogMode({ type: 'create' })}>
                <Plus />
                Nueva categoría
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Prefijo</TableHead>
                  <TableHead className="hidden md:table-cell">Descripción</TableHead>
                  <TableHead className="hidden sm:table-cell">Activos</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell className="font-mono text-[13px]">{category.code_prefix}</TableCell>
                    <TableCell className="hidden max-w-[320px] truncate text-[13px] text-muted-foreground md:table-cell">
                      {category.description ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-[13px] text-muted-foreground sm:table-cell">
                      {assetCountByCategory.get(category.id) ?? 0}
                    </TableCell>
                    <TableCell>
                      <Badge variant={category.is_active ? 'default' : 'secondary'}>
                        {category.is_active ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Switch
                          checked={category.is_active}
                          onCheckedChange={(checked) => void toggleActive(category, checked)}
                          aria-label={
                            category.is_active
                              ? `Desactivar ${category.name}`
                              : `Reactivar ${category.name}`
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Editar ${category.name}`}
                          onClick={() => setDialogMode({ type: 'edit', category })}
                        >
                          <Pencil />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {totalCount} activos asociados al catálogo (incluidos componentes). No hay borrado físico:
          desactivar conserva el historial.
        </p>
      </div>

      {dialogMode && (
        <CategoryDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialogMode(null)
          }}
          mode={dialogMode}
          onSaved={refresh}
        />
      )}
    </main>
  )
}
