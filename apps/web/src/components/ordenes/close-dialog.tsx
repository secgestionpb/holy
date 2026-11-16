import { validateChecklist } from '@/lib/m3'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  closeWo,
  COVERAGE_LABELS,
  EXECUTED_LABELS,
  type Coverage,
  type ExecutedByType,
  type ProviderLite,
  type WoRow,
} from '@/lib/m2'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  wo: WoRow
  laborHours: number
  consumedTotal: number
  providers: ProviderLite[]
  onSaved: () => void
}

export function CloseDialog({
  open,
  onOpenChange,
  wo,
  laborHours,
  consumedTotal,
  providers,
  onSaved,
}: Props) {
  const [diagnosis, setDiagnosis] = useState('')
  const [solution, setSolution] = useState('')
  const [executedBy, setExecutedBy] = useState<ExecutedByType>(wo.executed_by_type)
  const [providerId, setProviderId] = useState(wo.provider_id ?? '')
  const [externalCost, setExternalCost] = useState(
    wo.external_cost !== null ? String(wo.external_cost) : '',
  )
  const [affectsSale, setAffectsSale] = useState<'si' | 'no'>(wo.affects_sale ? 'si' : 'no')
  const [warrantyAnswer, setWarrantyAnswer] = useState<'si' | 'no'>('no')
  const [wStart, setWStart] = useState('')
  const [wEnd, setWEnd] = useState('')
  const [wCoverage, setWCoverage] = useState<Coverage>('both')
  const [wProviderName, setWProviderName] = useState(wo.provider_name ?? '')
  const [wNotes, setWNotes] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setServerError(null)
    setLocalError(null)

    if (wo.wo_type === 'preventive') {
      const isValid = await validateChecklist(wo.id)
      if (!isValid) {
        setLocalError('Checklist incompleto: no se puede cerrar la OT.')
        return
      }
    }

    if (!diagnosis.trim() || !solution.trim()) {
      setLocalError('Diagnóstico y solución son obligatorios al cierre.')
      return
    }
    if (executedBy === 'external') {
      if (!providerId) {
        setLocalError('El proveedor es obligatorio cuando la ejecución es externa.')
        return
      }
      const cost = Number(externalCost)
      if (externalCost.trim() === '' || !Number.isFinite(cost)) {
        setLocalError('El costo del servicio externo es obligatorio al cierre.')
        return
      }
    }
    if (warrantyAnswer === 'si') {
      if (!wStart || !wEnd) {
        setLocalError('La garantía requiere fecha de inicio y vencimiento.')
        return
      }
      if (wEnd < wStart) {
        setLocalError('El vencimiento de la garantía debe ser igual o posterior al inicio.')
        return
      }
    }

    setSubmitting(true)
    const isExternal = executedBy === 'external'
    const result = await closeWo({
      wo_id: wo.id,
      diagnosis: diagnosis.trim(),
      solution: solution.trim(),
      executed_by_type: executedBy,
      provider_id: isExternal ? providerId : null,
      external_cost: isExternal ? Number(externalCost) : null,
      affects_sale: affectsSale === 'si',
      generates_warranty: warrantyAnswer === 'si',
      warranty:
        warrantyAnswer === 'si'
          ? {
              start_date: wStart,
              end_date: wEnd,
              coverage: wCoverage,
              provider_id: isExternal ? providerId : null,
              provider_name: wProviderName || null,
              notes: wNotes.trim() || null,
            }
          : null,
    })
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cierre de OT — {wo.wo_number}</DialogTitle>
          <DialogDescription>
            Cierre formal (F2.6 / M2.1). Diagnóstico y solución obligatorios; la pregunta de
            garantía Sí/No también es obligatoria (default No).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-muted/40 px-4 py-3 text-center">
            <div>
              <p className="text-[12px] text-muted-foreground">Horas de mano de obra</p>
              <p className="text-[15px] font-semibold tabular-nums">{laborHours.toFixed(2)} h</p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground">Repuestos</p>
              <p className="text-[15px] font-semibold tabular-nums">
                {consumedTotal > 0 ? `$${consumedTotal.toFixed(2)}` : '—'}
              </p>
              {consumedTotal === 0 && (
                <p className="text-[11px] text-muted-foreground">sin consumos (M4)</p>
              )}
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground">Servicio externo</p>
              <p className="text-[15px] font-semibold tabular-nums">
                {wo.external_cost !== null ? `$${Number(wo.external_cost).toFixed(2)}` : '—'}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="close-diagnosis">Diagnóstico / solución aplicada (obligatorio)</Label>
            <Textarea
              id="close-diagnosis"
              rows={3}
              value={diagnosis}
              onChange={(event) => setDiagnosis(event.target.value)}
              placeholder="Diagnóstico del problema…"
            />
            <Textarea
              rows={3}
              aria-label="Solución aplicada"
              value={solution}
              onChange={(event) => setSolution(event.target.value)}
              placeholder="Solución aplicada…"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Ejecutada por</Label>
              <Select
                value={executedBy}
                onValueChange={(value) => setExecutedBy(value as ExecutedByType)}
              >
                <SelectTrigger className="w-full" aria-label="Ejecutada por">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(EXECUTED_LABELS) as Array<[ExecutedByType, string]>).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>¿Afectó disponibilidad de venta?</Label>
              <Select
                value={affectsSale}
                onValueChange={(value) => setAffectsSale(value as 'si' | 'no')}
              >
                <SelectTrigger className="w-full" aria-label="Afectó disponibilidad">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="si">Sí — enviar Evento 1</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {executedBy === 'external' && (
              <>
                <div className="space-y-2">
                  <Label>Proveedor (obligatorio)</Label>
                  <Select value={providerId} onValueChange={setProviderId}>
                    <SelectTrigger className="w-full" aria-label="Proveedor">
                      <SelectValue placeholder="Selecciona el proveedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="close-ext-cost">Costo del servicio externo (obligatorio)</Label>
                  <Input
                    id="close-ext-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={externalCost}
                    onChange={(event) => setExternalCost(event.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label>¿Genera o extiende garantía? (obligatorio)</Label>
            <Select
              value={warrantyAnswer}
              onValueChange={(value) => setWarrantyAnswer(value as 'si' | 'no')}
            >
              <SelectTrigger className="w-full" aria-label="Genera garantía">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No — cerrar sin garantía</SelectItem>
                <SelectItem value="si">Sí — crear/editar garantía (origen = esta OT)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[12.5px] text-muted-foreground">
              Una OT correctiva no siempre tiene garantía: la respuesta queda en la OT y en la
              auditoría.
            </p>
          </div>

          {warrantyAnswer === 'si' && (
            <div className="space-y-4 rounded-md border border-border p-4">
              <p className="text-[13px] font-semibold">Sub-formulario de garantía (V1.5)</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="w-close-start">Fecha de inicio</Label>
                  <Input
                    id="w-close-start"
                    type="date"
                    value={wStart}
                    onChange={(event) => setWStart(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="w-close-end">Fecha de vencimiento</Label>
                  <Input
                    id="w-close-end"
                    type="date"
                    value={wEnd}
                    onChange={(event) => setWEnd(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cobertura</Label>
                  <Select
                    value={wCoverage}
                    onValueChange={(value) => setWCoverage(value as Coverage)}
                  >
                    <SelectTrigger className="w-full" aria-label="Cobertura de la garantía">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(COVERAGE_LABELS) as Array<[Coverage, string]>).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="w-close-provider">Proveedor otorgante (texto)</Label>
                  <Input
                    id="w-close-provider"
                    value={wProviderName}
                    onChange={(event) => setWProviderName(event.target.value)}
                    placeholder="Ej. Daikin, Taller Ordoñez…"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="w-close-notes">Observaciones</Label>
                <Textarea
                  id="w-close-notes"
                  rows={2}
                  value={wNotes}
                  onChange={(event) => setWNotes(event.target.value)}
                />
              </div>
            </div>
          )}

          {localError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
            >
              {localError}
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Cerrar OT
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
