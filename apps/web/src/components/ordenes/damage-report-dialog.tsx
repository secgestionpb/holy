import { useState, type ChangeEvent } from 'react'
import { Loader2, Paperclip, X } from 'lucide-react'
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
import { createDamageReport, uploadEvidence } from '@/lib/m2'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function DamageReportDialog({ open, onOpenChange, onSaved }: Props) {
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [serverError, setServerError] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function onPickFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (picked.length > 0) setFiles((current) => [...current, ...picked])
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, position) => position !== index))
  }

  async function submit() {
    setServerError(null)
    setLocalError(null)
    if (!description.trim()) {
      setLocalError('La descripción del daño es obligatoria.')
      return
    }
    if (!location.trim()) {
      setLocalError('La localización es obligatoria.')
      return
    }
    setSubmitting(true)
    const created = await createDamageReport({
      location: location.trim(),
      description: description.trim(),
    })
    if (!created.ok || !created.id) {
      setSubmitting(false)
      setServerError(created.ok ? 'No se pudo crear el reporte.' : created.message)
      return
    }
    for (const file of files) {
      const uploaded = await uploadEvidence({
        parentId: created.id,
        file,
        kind: 'other',
        damageReport: true,
      })
      if (!uploaded.ok) {
        setSubmitting(false)
        setServerError(`El reporte se creó, pero no se pudo subir «${file.name}»: ${uploaded.message}`)
        onSaved()
        return
      }
    }
    setSubmitting(false)
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nuevo reporte de daño</DialogTitle>
          <DialogDescription>
            El reporte será revisado por el jefe de Mantenimiento: puede convertirse en Orden de Trabajo o descartarse.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dr-description">Descripción del daño (obligatoria)</Label>
            <Textarea
              id="dr-description"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe qué falló, desde cuándo, síntomas…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dr-location">Localización (obligatoria)</Label>
            <Input
              id="dr-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Ej. Piso 3, habitación 312 — aire acondicionado"
            />
          </div>

          <div className="space-y-2">
            <Label>Evidencia fotográfica (opcional)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm">
                <Paperclip />
                <label className="cursor-pointer" htmlFor="dr-files">
                  Adjuntar fotos
                </label>
              </Button>
              <input id="dr-files" type="file" accept="image/*" multiple className="hidden" onChange={(event) => onPickFiles(event)} />
              <span className="text-[12.5px] text-muted-foreground">
                {files.length > 0 ? `${files.length} archivo(s) en cola` : 'Opcional'}
              </span>
            </div>
            {files.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="truncate text-[13px]">{file.name}</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Quitar ${file.name}`}
                      onClick={() => removeFile(index)}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[12px] text-muted-foreground">
              «Reportado por» y la fecha/hora se registran automáticamente al guardar.
            </p>
          </div>

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
            Guardar reporte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
