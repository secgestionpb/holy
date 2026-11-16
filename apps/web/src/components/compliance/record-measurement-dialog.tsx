import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
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
  formatNumber,
  registerMeasurement,
  uploadComplianceFile,
  type AssetLite,
  type MeasurementResult,
  type MeasurementTypeRow,
} from '@/lib/m6'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  types: MeasurementTypeRow[]
  assets: AssetLite[]
  onSaved: (result: MeasurementResult) => void
}

export function RecordMeasurementDialog({ open, onOpenChange, types, assets, onSaved }: Props) {
  const [typeId, setTypeId] = useState('')
  const [assetId, setAssetId] = useState('')
  const [measuredAt, setMeasuredAt] = useState('')
  const [value, setValue] = useState('')
  const [notes, setNotes] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [evidencePath, setEvidencePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const activeTypes = useMemo(() => types.filter((t) => t.is_active), [types])
  const selectedType = activeTypes.find((t) => t.id === typeId) ?? null
  const typeAssets = useMemo(
    () => (selectedType ? assets.filter((a) => a.category_id === selectedType.category_id) : []),
    [assets, selectedType],
  )

  useEffect(() => {
    if (open) {
      setTypeId('')
      setAssetId('')
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      setMeasuredAt(
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`,
      )
      setValue('')
      setNotes('')
      setFileName(null)
      setEvidencePath(null)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    setAssetId('')
  }, [typeId])

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    const res = await uploadComplianceFile(file)
    setUploading(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    if (!res.path) {
      setError('No se pudo subir la evidencia.')
      return
    }
    setEvidencePath(res.path)
    setFileName(file.name)
  }

  async function submit() {
    setError(null)
    if (!typeId || !assetId) {
      setError('Selecciona el tipo de medición y el activo.')
      return
    }
    const num = Number(value)
    if (value.trim() === '' || Number.isNaN(num)) {
      setError('Ingresa un valor numérico.')
      return
    }
    if (!measuredAt) {
      setError('Indica la fecha y hora de la medición.')
      return
    }
    setSubmitting(true)
    const res = await registerMeasurement({
      measurement_type_id: typeId,
      asset_id: assetId,
      value: num,
      measured_at: new Date(measuredAt).toISOString(),
      notes: notes.trim() || null,
      evidence_path: evidencePath,
    })
    setSubmitting(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    if (!res.result) {
      setError('No se pudo registrar la medición.')
      return
    }
    onSaved(res.result)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar medición</DialogTitle>
          <DialogDescription>
            El resultado (Dentro/Fuera de rango) se calcula automáticamente contra el rango del tipo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo de medición *</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger aria-label="Tipo de medición">
                <SelectValue placeholder="Selecciona un tipo" />
              </SelectTrigger>
              <SelectContent>
                {activeTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Activo (punto de medición) *</Label>
            <Select value={assetId} onValueChange={setAssetId} disabled={!selectedType}>
              <SelectTrigger aria-label="Activo">
                <SelectValue
                  placeholder={
                    selectedType
                      ? typeAssets.length > 0
                        ? 'Selecciona el activo'
                        : 'Sin activos en la categoría del tipo'
                      : 'Elige primero el tipo'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {typeAssets.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedType && (
              <p className="text-[12px] text-muted-foreground">
                Rango aceptable: {formatNumber(selectedType.min_value)} – {formatNumber(selectedType.max_value)}{' '}
                {selectedType.unit}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="measured-at">Fecha y hora *</Label>
              <Input
                id="measured-at"
                type="datetime-local"
                value={measuredAt}
                onChange={(e) => setMeasuredAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="value">Valor medido *</Label>
              <Input
                id="value"
                type="number"
                step="0.001"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={selectedType ? `${selectedType.min_value}–${selectedType.max_value}` : ''}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Observaciones (opcional)</Label>
            <Textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Evidencia fotográfica (opcional)</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
                e.target.value = ''
              }}
            />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                Adjuntar imagen
              </Button>
              {fileName && <span className="truncate text-[12.5px] text-muted-foreground">{fileName}</span>}
            </div>
          </div>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Guardar medición
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
