import { useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
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
import { LIFE_STAGE_LABELS, type AssetRow, type LifeStage } from '@/lib/m1'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: AssetRow
  stage: LifeStage | null
  onSubmit: (reason: string | undefined) => Promise<string | null>
}

function effectText(asset: AssetRow, stage: LifeStage): string {
  switch (stage) {
    case 'decommissioned':
      return `Se asignará «${LIFE_STAGE_LABELS.decommissioned}» a ${asset.code} y el estado operativo quedará forzado a Inactivo mientras dure la baja. La baja es reversible: puedes asignar otra fase manual después.`
    case 'requires_replacement':
      return `Se asignará «${LIFE_STAGE_LABELS.requires_replacement}» y se disparará de inmediato el Evento 10 «Activo requiere reemplazo» (correo a los destinatarios configurados en T2).`
    case 'pending_repair':
      return `Se asignará «${LIFE_STAGE_LABELS.pending_repair}». El motor de garantías no tocará esta etapa hasta que vuelvas a una fase automática.`
    default:
      return `Se asignará «${LIFE_STAGE_LABELS[stage]}» a ${asset.code}.`
  }
}

export function StageDialog({ open, onOpenChange, asset, stage, onSubmit }: Props) {
  const [reason, setReason] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const requiresReason = stage === 'decommissioned'

  async function submit() {
    if (!stage) return
    if (requiresReason && !reason.trim()) return
    setServerError(null)
    setSubmitting(true)
    const error = await onSubmit(reason.trim() || undefined)
    setSubmitting(false)
    if (error) {
      setServerError(error)
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar etapa de vida</DialogTitle>
          <DialogDescription>Confirmación con efectos y auditoría (F1.3).</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-[13px] leading-snug">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>{stage ? effectText(asset, stage) : ''}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stage-reason">
              Motivo {requiresReason ? '(obligatorio para la baja)' : '(opcional)'}
            </Label>
            <Textarea
              id="stage-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                requiresReason ? 'Ej. Falla estructural sin repuesto disponible…' : 'Motivo del cambio…'
              }
            />
            {requiresReason && !reason.trim() && (
              <p className="text-[12.5px] text-muted-foreground">
                La baja exige un motivo: queda registrado en el log de auditoría.
              </p>
            )}
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
          <Button
            onClick={() => void submit()}
            disabled={submitting || (requiresReason && !reason.trim())}
          >
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Confirmar cambio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
