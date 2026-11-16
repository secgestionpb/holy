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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { replaceTechnician, type TechnicianLite, type WoRow, type WoTechRow } from '@/lib/m2'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  wo: WoRow
  activeTechs: WoTechRow[]
  technicians: TechnicianLite[]
  currentUserId: string
  isMaintenance: boolean
  onSaved: () => void
}

export function ReplaceDialog({
  open,
  onOpenChange,
  wo,
  activeTechs,
  technicians,
  currentUserId,
  isMaintenance,
  onSaved,
}: Props) {
  const [outUser, setOutUser] = useState('')
  const [inUser, setInUser] = useState('')
  const [observation, setObservation] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Un Técnico solo reemplaza a OTROS técnicos (nunca a sí mismo); Mantenimiento
  // puede reemplazar a cualquiera de los asignados.
  const replaceable = activeTechs.filter((tech) => isMaintenance || tech.user_id !== currentUserId)
  const assignedIds = activeTechs.map((tech) => tech.user_id)
  const candidates = technicians.filter((technician) => !assignedIds.includes(technician.id))

  async function submit() {
    if (!outUser || !inUser || !observation.trim()) return
    setServerError(null)
    setSubmitting(true)
    const result = await replaceTechnician(wo.id, outUser, inUser, observation.trim())
    setSubmitting(false)
    if (!result.ok) {
      setServerError(result.message)
      return
    }
    onSaved()
    onOpenChange(false)
  }

  const canSubmit = Boolean(outUser && inUser && observation.trim() && outUser !== inUser)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reemplazar técnico</DialogTitle>
          <DialogDescription>
            {wo.wo_number} — es un reemplazo, no una adición: el técnico entrante sustituye al
            saliente. La observación es obligatoria y queda en el historial (F2.4).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Técnico que sale</Label>
            <Select value={outUser} onValueChange={setOutUser}>
              <SelectTrigger className="w-full" aria-label="Técnico que sale">
                <SelectValue placeholder="Selecciona el técnico a reemplazar" />
              </SelectTrigger>
              <SelectContent>
                {replaceable.map((tech) => (
                  <SelectItem key={tech.user_id} value={tech.user_id}>
                    {tech.users?.full_name ?? tech.user_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Técnico que entra</Label>
            <Select value={inUser} onValueChange={setInUser}>
              <SelectTrigger className="w-full" aria-label="Técnico que entra">
                <SelectValue placeholder="Selecciona el técnico entrante" />
              </SelectTrigger>
              <SelectContent>
                {candidates.length === 0 ? (
                  <SelectItem value="none" disabled>
                    Sin técnicos disponibles
                  </SelectItem>
                ) : (
                  candidates.map((technician) => (
                    <SelectItem key={technician.id} value={technician.id}>
                      {technician.full_name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="replace-obs">Observación (obligatoria)</Label>
            <Textarea
              id="replace-obs"
              rows={3}
              value={observation}
              onChange={(event) => setObservation(event.target.value)}
              placeholder="Motivo del reemplazo…"
            />
          </div>

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
          <Button onClick={() => void submit()} disabled={submitting || !canSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Reemplazar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
