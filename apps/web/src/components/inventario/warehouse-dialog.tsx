import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Power, PowerOff } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createWarehouse,
  updateWarehouse,
  type WarehouseRow,
} from '@/lib/m4'
import { type UserLite } from '@/lib/m1'

const schema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre de la bodega.'),
  description: z.string().trim(),
  responsible_id: z.string(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: { type: 'create' } | { type: 'edit'; warehouse: WarehouseRow }
  users: UserLite[]
  onSaved: () => void
}

export function WarehouseDialog({ open, onOpenChange, mode, users, onSaved }: Props) {
  const isEdit = mode.type === 'edit'
  const warehouse = isEdit ? mode.warehouse : null
  const [serverError, setServerError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: warehouse?.name ?? '',
      description: warehouse?.description ?? '',
      responsible_id: warehouse?.responsible_id ?? '',
    },
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const payload = {
      name: values.name,
      description: values.description || null,
      responsible_id: values.responsible_id || null,
    }
    const result = isEdit && warehouse
      ? await updateWarehouse(warehouse.id, payload)
      : await createWarehouse(payload)
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    onSaved()
    onOpenChange(false)
  }

  async function toggleActive(active: boolean) {
    if (!warehouse) return
    setServerError(null)
    setToggling(true)
    const result = await updateWarehouse(warehouse.id, { is_active: active })
    setToggling(false)
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Editar «${warehouse?.name}»` : 'Nueva bodega'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Renombra, reasigna el responsable o cambia el estado. Inactivar NO borra el stock existente: bloquea nuevas entradas; las salidas y transferencias siguen posibles.'
              : 'Depósito o zona donde se guardan repuestos y suministros (nombre único).'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="wh-name">Nombre</Label>
            <Input
              id="wh-name"
              placeholder="Ej. Bodega central, Almacén de piscina…"
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
            <Label htmlFor="wh-desc">Descripción (opcional)</Label>
            <Textarea
              id="wh-desc"
              rows={2}
              placeholder="Qué se guarda aquí…"
              {...register('description')}
            />
          </div>

          <div className="space-y-2">
            <Label>Responsable (opcional)</Label>
            <Select
              value={watch('responsible_id') || 'none'}
              onValueChange={(value) => setValue('responsible_id', value === 'none' ? '' : value, { shouldDirty: true })}
            >
              <SelectTrigger className="w-full" aria-label="Responsable de la bodega">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin responsable</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isEdit && warehouse?.is_active && (
            <div className="rounded-md border border-border bg-muted/40 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-semibold">Bodega activa</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    Admite entradas y es destino de transferencias.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={toggling}
                  onClick={() => void toggleActive(false)}
                >
                  {toggling ? <Loader2 className="animate-spin" /> : <PowerOff />}
                  Desactivar
                </Button>
              </div>
            </div>
          )}

          {isEdit && warehouse && !warehouse.is_active && (
            <div className="rounded-md border border-border bg-muted/40 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-semibold">Bodega inactiva</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    Bloquea nuevas entradas; el stock existente permanece visible y transferible.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={toggling} onClick={() => void toggleActive(true)}>
                  {toggling ? <Loader2 className="animate-spin" /> : <Power />}
                  Reactivar
                </Button>
              </div>
            </div>
          )}

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
              {isEdit ? 'Guardar cambios' : 'Crear bodega'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
