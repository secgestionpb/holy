import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { AssetRow } from '@/lib/m1'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: AssetRow
}

export function QrDialog({ open, onOpenChange, asset }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const target = `${window.location.origin}/app/activos/${asset.id}`
    let alive = true
    void QRCode.toDataURL(target, {
      width: 512,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (alive) setDataUrl(url)
      })
      .catch(() => {
        if (alive) setError('No se pudo generar el QR.')
      })
    return () => {
      alive = false
    }
  }, [open, asset.id])

  function download() {
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `qr-${asset.code}.png`
    link.click()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Etiqueta QR</DialogTitle>
          <DialogDescription>
            Escaneable desde la PWA: abre directamente la ficha del activo.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {error ? (
            <p className="text-[13px] text-destructive">{error}</p>
          ) : dataUrl ? (
            <img src={dataUrl} alt={`QR de ${asset.code}`} className="size-56 rounded-md border border-border" />
          ) : (
            <div className="flex size-56 items-center justify-center rounded-md border border-border">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <div className="text-center">
            <p className="font-mono text-[15px] font-bold tracking-wide">{asset.code}</p>
            <p className="text-[13px] text-muted-foreground">{asset.name}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button onClick={download} disabled={!dataUrl}>
            <Download />
            Descargar PNG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
