import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { assignWo, type TechnicianLite, type WoRow } from '@/lib/m2'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  wo: WoRow
  technicians: TechnicianLite[]
  activeIds: string[]
  onSaved: () => void
}

export function AssignDialog({ open, onOpenChange, wo, technicians, activeIds, onSaved }: Props) {
  const [selected, setSelected] = useState<string[]>(activeIds)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )
  }

  async function submit() {
    setServerError(null)
    setSubmitting(true)
    const result = await assignWo(wo.id, selected)
    setSubmitting(false)
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Asignar / reasignar técnicos</DialogTitle>
          <DialogDescription>
            {wo.wo_number} — defines el conjunto completo de técnicos asignados. Quitar a alguien
            registra su salida en el histórico (F2.4).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {technicians.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">
              No hay usuarios con rol Técnico activos.
            </p>
          ) : (
            <ul className="max-h-[45dvh] divide-y divide-border overflow-y-auto rounded-md border border-border">
              {technicians.map((technician) => {
                const checked = selected.includes(technician.id)
                const wasActive = activeIds.includes(technician.id)
                return (
                  <li key={technician.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <input
                      type="checkbox"
                      id={`tech-${technician.id}`}
                      checked={checked}
                      onChange={() => toggle(technician.id)}
                      className="size-4 accent-primary"
                    />
                    <label htmlFor={`tech-${technician.id}`} className="flex-1 cursor-pointer text-[14px]">
                      {technician.full_name}
                      {wasActive && !checked && (
                        <span className="ml-2 text-[12.5px] text-destructive">se retirará</span>
                      )}
                      {!wasActive && checked && (
                        <span className="ml-2 text-[12.5px] text-primary">entra</span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          <p className="text-[12.5px] text-muted-foreground">
            {selected.length} {selected.length === 1 ? 'técnico seleccionado' : 'técnicos seleccionados'}.
            Puedes guardar sin técnicos (caso contratista).
          </p>

          {serverError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
            >
              {serverError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Guardar asignación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
