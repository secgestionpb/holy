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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  effect?: string
  confirmLabel: string
  onSubmit: (reason: string) => Promise<string | null>
}

export function MotiveDialog({
  open,
  onOpenChange,
  title,
  description,
  effect,
  confirmLabel,
  onSubmit,
}: Props) {
  const [reason, setReason] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!reason.trim()) return
    setServerError(null)
    setSubmitting(true)
    const error = await onSubmit(reason.trim())
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {effect && (
            <div className="flex gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-[13px] leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>{effect}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="motive-reason">Motivo (obligatorio)</Label>
            <Textarea
              id="motive-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Escribe el motivo…"
            />
            <p className="text-[12.5px] text-muted-foreground">
              Queda registrado en el log de auditoría.
            </p>
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
            Volver
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || !reason.trim()}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
