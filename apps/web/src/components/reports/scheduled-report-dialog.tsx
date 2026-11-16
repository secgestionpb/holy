import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ScheduledReport } from '@/lib/m7'

type Props = {
  report: ScheduledReport | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (id: string, patch: { send_day: number; format: 'pdf' | 'excel'; recipients: string; is_active: boolean }) => Promise<void>
}

export default function ScheduledReportDialog({ report, open, onOpenChange, onSave }: Props) {
  const [sendDay, setSendDay] = useState(1)
  const [format, setFormat] = useState<'pdf' | 'excel'>('pdf')
  const [recipients, setRecipients] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!report) return
    setSendDay(report.send_day)
    setFormat(report.format)
    setRecipients(report.recipients)
    setIsActive(report.is_active)
    setError(null)
  }, [report])

  const emails = recipients
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0)
  const invalid = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))

  async function handleSave() {
    if (!report) return
    setSaving(true)
    setError(null)
    try {
      await onSave(report.id, { send_day: sendDay, format, recipients, is_active: isActive })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  if (!report) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar reporte programado</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-[12.5px] text-muted-foreground">Reporte</Label>
            <p className="text-[14px] font-medium">{report.report_name}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sr-day">Día de envío</Label>
              <Input
                id="sr-day"
                type="number"
                min={1}
                max={28}
                value={sendDay}
                onChange={(e) => setSendDay(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Formato adjunto</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as 'pdf' | 'excel')}>
                <SelectTrigger aria-label="Formato">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="excel">Excel</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sr-recipients">Destinatarios (correos separados por coma)</Label>
            <Textarea
              id="sr-recipients"
              rows={3}
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="gerencia@hotel.com, calidad@hotel.com"
            />
            {invalid.length > 0 && (
              <p className="text-[12px] text-amber-600">Formato inválido: {invalid.join(', ')}</p>
            )}
            {isActive && emails.length === 0 && (
              <p className="text-[12px] text-amber-600">
                Un reporte activo sin destinatarios se registrará como «sin destinatarios» en cada intento.
              </p>
            )}
          </div>
          <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-[13.5px] font-medium">Activo</span>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Activo" />
          </label>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
