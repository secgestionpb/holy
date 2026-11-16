import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
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
import {
  KIND_LABELS,
  ZONE_SUBTYPE_LABELS,
  createLocation,
  updateLocation,
  type LocationRow,
  type ZoneSubtype,
} from '@/lib/m1'

const NON_ROOT_KINDS = ['building', 'floor', 'zone'] as const

const schema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre de la ubicación.'),
  kind: z.enum(NON_ROOT_KINDS),
  zone_subtype: z.string(),
  room_code: z.string().trim(),
  parent_id: z.string(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: { type: 'create'; parentId: string | null } | { type: 'edit'; location: LocationRow }
  locations: LocationRow[]
  assetCount: number
  onSaved: () => void
}

function descendantsOf(locations: LocationRow[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const location of locations) {
    const list = childrenOf.get(location.parent_id ?? '') ?? []
    list.push(location.id)
    childrenOf.set(location.parent_id ?? '', list)
  }
  const out = new Set<string>()
  const walk = (id: string) => {
    for (const childId of childrenOf.get(id) ?? []) {
      out.add(childId)
      walk(childId)
    }
  }
  walk(rootId)
  return out
}

export function LocationDialog({ open, onOpenChange, mode, locations, assetCount, onSaved }: Props) {
  const isEdit = mode.type === 'edit'
  const location = isEdit ? mode.location : null
  const [serverError, setServerError] = useState<string | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: location?.name ?? '',
      kind: location && location.kind !== 'hotel' ? location.kind : 'zone',
      zone_subtype: location?.zone_subtype ?? '',
      room_code: location?.room_code ?? '',
      parent_id: location?.parent_id ?? (mode.type === 'create' ? (mode.parentId ?? '') : ''),
    },
  })

  const kind = useWatch({ control, name: 'kind' }) ?? 'zone'
  const zoneSubtype = useWatch({ control, name: 'zone_subtype' })
  const parentIdValue = useWatch({ control, name: 'parent_id' })

  // Sin effect de reset: el padre lo monta condicionalmente, así que cada
  // apertura reconstruye defaultValues desde `mode` y `locations`.

  const parentOptions = useMemo(() => {
    if (!isEdit || !location) return []
    const excluded = descendantsOf(locations, location.id)
    return locations
      .filter(
        (candidate) =>
          candidate.id !== location.id &&
          !excluded.has(candidate.id) &&
          candidate.is_active &&
          candidate.depth < 5,
      )
      .map((candidate) => ({
        id: candidate.id,
        label: `${'— '.repeat(candidate.depth)}${candidate.name}`,
      }))
  }, [locations, location, isEdit])

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const payload = {
      name: values.name,
      kind: values.kind,
      zone_subtype: values.kind === 'zone' && values.zone_subtype ? (values.zone_subtype as ZoneSubtype) : null,
      room_code: values.room_code || null,
    }
    const result = isEdit && location
      ? await updateLocation(location.id, { ...payload, parent_id: values.parent_id || location.parent_id })
      : await createLocation({ ...payload, parent_id: values.parent_id || null })
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    onSaved()
    onOpenChange(false)
  }

  async function toggleActive(checked: boolean) {
    if (!location) return
    setServerError(null)
    setDeactivating(true)
    const result = await updateLocation(location.id, { is_active: checked })
    setDeactivating(false)
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
            {isEdit ? `Editar «${location?.name}»` : 'Nueva ubicación'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Renombra, cambia el tipo o reubica el nodo. Al moverlo, sus activos y sub-ubicaciones descienden con él.'
              : mode.type === 'create' && mode.parentId === null
                ? 'Se creará en la raíz del árbol (sin ubicación padre). Después puedes agregar nodos bajo ella con su menú ⋮.'
                : 'Jerarquía libre por contención espacial. Profundidad máxima: 5 niveles desde el hotel.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="loc-name">Nombre</Label>
            <Input
              id="loc-name"
              placeholder="Ej. Pasillo Piso 1, Habitación 101…"
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
              <Label>Tipo de etiqueta</Label>
              <Select value={kind} onValueChange={(value) => setValue('kind', value as FormValues['kind'], { shouldDirty: true })}>
                <SelectTrigger className="w-full" aria-label="Tipo de ubicación">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NON_ROOT_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {KIND_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {kind === 'zone' && (
              <div className="space-y-2">
                <Label>Etiqueta (opcional)</Label>
                <Select
                  value={zoneSubtype || 'none'}
                  onValueChange={(value) =>
                    setValue('zone_subtype', value === 'none' ? '' : value, { shouldDirty: true })
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Etiqueta de ubicación">
                    <SelectValue placeholder="Sin etiqueta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin etiqueta</SelectItem>
                    {(
                      Object.entries(ZONE_SUBTYPE_LABELS) as Array<[ZoneSubtype, string]>
                    ).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {kind === 'zone' && zoneSubtype === 'room' && (
            <div className="space-y-2">
              <Label htmlFor="loc-room">Código de habitación (si aplica)</Label>
              <Input id="loc-room" placeholder="Ej. 101" {...register('room_code')} />
            </div>
          )}

          {isEdit && parentOptions.length > 0 && (
            <div className="space-y-2">
              <Label>Reubicar bajo</Label>
              <Select
                value={parentIdValue || location?.parent_id || ''}
                onValueChange={(value) => setValue('parent_id', value, { shouldDirty: true })}
              >
                <SelectTrigger className="w-full" aria-label="Nueva ubicación padre">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {parentOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isEdit && location?.is_active && (
            <div className="rounded-md border border-border bg-muted/40 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-semibold">Ubicación activa</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {assetCount > 0
                      ? `Contiene ${assetCount} ${assetCount === 1 ? 'activo' : 'activos'} (incluidos en sub-ubicaciones).`
                      : 'Sin activos asociados.'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={assetCount > 0 || deactivating}
                  onClick={() => void toggleActive(false)}
                >
                  {deactivating ? <Loader2 className="animate-spin" /> : <PowerOff />}
                  Desactivar
                </Button>
              </div>
              {assetCount > 0 && (
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  Para desactivar esta ubicación primero reubica sus activos en otra parte del árbol.
                </p>
              )}
            </div>
          )}

          {isEdit && location && !location.is_active && (
            <div className="rounded-md border border-border bg-muted/40 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-semibold">Ubicación inactiva</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    No admite nuevos activos ni como destino de reubicación hasta que se reactive.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={deactivating} onClick={() => void toggleActive(true)}>
                  {deactivating ? <Loader2 className="animate-spin" /> : <Power />}
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
              {isEdit ? 'Guardar cambios' : 'Crear ubicación'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
