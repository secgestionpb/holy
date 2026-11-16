import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { MODE_LABELS, updateNotificationEvent, type NotificationEvent } from '@/lib/t2'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  event: NotificationEvent | null
  globalWarrantyDays: string | null
  onSaved: () => void
}

export function EditEventDialog({ open, onOpenChange, event, globalWarrantyDays, onSaved }: Props) {
  if (!event) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <EventForm
        key={event.event_id}
        event={event}
        globalWarrantyDays={globalWarrantyDays}
        onSaved={onSaved}
        onClose={() => onOpenChange(false)}
      />
    </Dialog>
  )
}

function EventForm({
  event,
  globalWarrantyDays,
  onSaved,
  onClose,
}: {
  event: NotificationEvent
  globalWarrantyDays: string | null
  onSaved: () => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'immediate' | 'daily_digest'>(event.mode)
  const [digestTime, setDigestTime] = useState(event.digest_time.slice(0, 5))
  const [recipientsText, setRecipientsText] = useState(event.recipients.join(', '))
  const [extraParam, setExtraParam] = useState(
    event.extra_param !== null ? String(event.extra_param) : '',
  )
  const [active, setActive] = useState(event.is_active)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const hasExtraParam = event.event_id === 8 || event.event_id === 11

  async function save() {
    if (!event) return
    const recipients = recipientsText
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)

    let extra: number | null = null
    if (hasExtraParam && extraParam.trim() !== '') {
      const parsed = Number(extraParam)
      if (!Number.isInteger(parsed) || parsed < 0) {
        setServerError('El parámetro adicional debe ser un número entero ≥ 0.')
        return
      }
      extra = parsed
    }

    setSubmitting(true)
    setServerError(null)
    try {
      await updateNotificationEvent(event.event_id, {
        mode,
        digest_time: digestTime || '08:00',
        recipients,
        extra_param: hasExtraParam ? extra : null,
        is_active: active,
      })
      toast.success('Evento actualizado.')
      onSaved()
      onClose()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Evento {event.event_id} — {event.name}
          </DialogTitle>
          <DialogDescription>
            El número de evento y el canal no son editables. Los cambios quedan en el log de
            auditoría.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Modo</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">{MODE_LABELS.immediate}</SelectItem>
                <SelectItem value="daily_digest">{MODE_LABELS.daily_digest}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="digest-time">Hora del resumen (UTC)</Label>
            <Input
              id="digest-time"
              type="time"
              value={digestTime}
              disabled={mode !== 'daily_digest'}
              onChange={(event) => setDigestTime(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recipients">Destinatarios</Label>
            <Textarea
              id="recipients"
              rows={3}
              placeholder="correos separados por coma; admite externos"
              value={recipientsText}
              onChange={(event) => setRecipientsText(event.target.value)}
            />
            <p className="text-[12px] text-muted-foreground">
              Separados por coma o salto de línea. Vacío = el envío queda como fallido sin
              destinatarios.
            </p>
          </div>

          {hasExtraParam && (
            <div className="space-y-1.5">
              <Label htmlFor="extra-param">Días de anticipación (parámetro del evento)</Label>
              <Input
                id="extra-param"
                type="number"
                min={0}
                value={extraParam}
                onChange={(event) => setExtraParam(event.target.value)}
              />
            </div>
          )}
          {event.event_id === 7 && (
            <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-[12.5px] text-muted-foreground">
              Este evento usa el parámetro global de garantías
              {globalWarrantyDays !== null ? ` (hoy: ${globalWarrantyDays} días)` : ''} — edítalo
              en la pestaña Parámetros.
            </p>
          )}

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
            <div>
              <p className="text-[13px] font-medium">Evento activo</p>
              <p className="text-[12px] text-muted-foreground">
                Inactivo silencia el evento sin borrar la configuración.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Evento activo" />
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
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void save()} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="animate-spin" />
                Guardando
              </>
            ) : (
              'Guardar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
  )
}
