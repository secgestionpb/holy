import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  createItemCategory,
  updateItemCategory,
  type ItemCategoryRow,
} from '@/lib/m4'

const schema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre de la categoría.'),
  description: z.string().trim(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: ItemCategoryRow[]
  onSaved: () => void
}

export function ItemCategoriesDialog({ open, onOpenChange, categories, onSaved }: Props) {
  const [editing, setEditing] = useState<ItemCategoryRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  })

  const formVisible = creating || editing !== null

  function startCreate() {
    setEditing(null)
    setCreating(true)
    setServerError(null)
    reset({ name: '', description: '' })
  }

  function startEdit(row: ItemCategoryRow) {
    setCreating(false)
    setEditing(row)
    setServerError(null)
    reset({ name: row.name, description: row.description ?? '' })
  }

  function closeForm() {
    setCreating(false)
    setEditing(null)
    setServerError(null)
  }

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const payload = { name: values.name, description: values.description || null }
    const result = editing
      ? await updateItemCategory(editing.id, payload)
      : await createItemCategory(payload)
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    closeForm()
    onSaved()
  }

  async function toggleActive(row: ItemCategoryRow) {
    setServerError(null)
    setTogglingId(row.id)
    const result = await updateItemCategory(row.id, { is_active: !row.is_active })
    setTogglingId(null)
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Categorías de ítem</DialogTitle>
          <DialogDescription>
            Catálogo plano propio del Módulo 4 (baja lógica, sin borrado físico). Agrupa los
            repuestos en el dropdown del ítem y el alcance de los conteos físicos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">
            {categories.length} {categories.length === 1 ? 'categoría' : 'categorías'}
          </p>
          {!formVisible && (
            <Button size="sm" onClick={startCreate}>
              <Plus />
              Nueva categoría
            </Button>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="hidden sm:table-cell">Descripción</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-[70px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-[13px] text-muted-foreground">
                    Sin categorías registradas.
                  </TableCell>
                </TableRow>
              ) : (
                categories.map((row) => (
                  <TableRow key={row.id} className={editing?.id === row.id ? 'bg-muted/40' : undefined}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="hidden max-w-[240px] truncate text-[13px] text-muted-foreground sm:table-cell">
                      {row.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.is_active ? 'secondary' : 'outline'}>
                        {row.is_active ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Editar categoría"
                          onClick={() => startEdit(row)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={row.is_active ? 'Desactivar categoría' : 'Reactivar categoría'}
                          disabled={togglingId === row.id}
                          onClick={() => void toggleActive(row)}
                        >
                          {togglingId === row.id ? <Loader2 className="animate-spin" /> : row.is_active ? '↓' : '↑'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {formVisible && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 rounded-lg border border-border p-4">
            <p className="text-[14px] font-semibold">{editing ? `Editar «${editing.name}»` : 'Nueva categoría'}</p>
            <div className="space-y-2">
              <Label htmlFor="cat-name">Nombre</Label>
              <Input
                id="cat-name"
                placeholder="Ej. Repuestos HVAC…"
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
              <Label htmlFor="cat-desc">Descripción (opcional)</Label>
              <Textarea id="cat-desc" rows={2} {...register('description')} />
            </div>
            {serverError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
              >
                {serverError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={closeForm}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="animate-spin" /> : null}
                {editing ? 'Guardar cambios' : 'Crear categoría'}
              </Button>
            </div>
          </form>
        )}

        {serverError && !formVisible && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
          >
            {serverError}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
