import { useEffect, useRef, useState } from 'react'
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
import { type ProviderRow } from '@/lib/m5'
import { renewCertification, todayIso, uploadComplianceFile, type CertificationRow } from '@/lib/m6'

const NO_PROVIDER = '__none__'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  cert: CertificationRow
  providers: ProviderRow[]
  onRenewed: () => void
}

export function RenewDialog({ open, onOpenChange, cert, providers, onRenewed }: Props) {
  const [issuedAt, setIssuedAt] = useState(todayIso())
  const [expiresAt, setExpiresAt] = useState('')
  const [providerId, setProviderId] = useState(cert.responsible_provider_id ?? NO_PROVIDER)
  const [note, setNote] = useState('')
  const [docPath, setDocPath] = useState<string | null>(cert.document_path)
  const [fileName, setFileName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setIssuedAt(todayIso())
    setExpiresAt('')
    setProviderId(cert.responsible_provider_id ?? NO_PROVIDER)
    setNote('')
    setDocPath(cert.document_path)
    setFileName(null)
    setError(null)
  }, [open, cert])

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
      setError('No se pudo subir el documento.')
      return
    }
    setDocPath(res.path)
    setFileName(file.name)
  }

  async function submit() {
    setError(null)
    if (!expiresAt) {
      setError('Indica la nueva fecha de vencimiento.')
      return
    }
    if (expiresAt <= issuedAt) {
      setError('La fecha de vencimiento debe ser posterior a la emisión.')
      return
    }
    if (!docPath) {
      setError('El documento de la nueva vigencia es obligatorio.')
      return
    }
    setSubmitting(true)
    const res = await renewCertification({
      certification_id: cert.id,
      issued_at: issuedAt,
      expires_at: expiresAt,
      document_path: docPath,
      provider_id: providerId === NO_PROVIDER ? null : providerId,
      note: note.trim() || null,
    })
    setSubmitting(false)
    if (!res.ok) {
      setError(res.message ?? 'No se pudo renovar la certificación.')
      return
    }
    onRenewed()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Renovar certificación</DialogTitle>
          <DialogDescription>
            La vigencia actual se archiva en el historial antes de aplicar los nuevos datos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="renew-issued">Nueva fecha de emisión *</Label>
              <Input id="renew-issued" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="renew-expires">Nuevo vencimiento *</Label>
              <Input id="renew-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Responsable de la renovación</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger aria-label="Responsable">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROVIDER}>Sin responsable</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Nuevo documento (obligatorio)</Label>
            <input
              ref={fileRef}
              type="file"
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
                Adjuntar documento
              </Button>
              {fileName && <span className="truncate text-[12.5px] text-muted-foreground">{fileName}</span>}
              {!fileName && docPath && (
                <span className="text-[12.5px] text-muted-foreground">Se conserva el documento vigente</span>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="renew-note">Nota de renovación (opcional)</Label>
            <Textarea id="renew-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Renovar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
