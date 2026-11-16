import { useEffect, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  RESULT_LABELS,
  formatDateTime,
  formatNumber,
  signComplianceFileUrl,
  type MeasurementRecordRow,
} from '@/lib/m6'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="text-right text-[13px]">{value}</span>
    </div>
  )
}

export function MeasurementDetailDialog({
  record,
  onOpenChange,
}: {
  record: MeasurementRecordRow | null
  onOpenChange: (open: boolean) => void
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)

  useEffect(() => {
    setSignedUrl(null)
    if (!record?.evidence_path) return
    setSigning(true)
    void signComplianceFileUrl(record.evidence_path).then((url) => {
      setSignedUrl(url)
      setSigning(false)
    })
  }, [record])

  if (!record) return null
  const type = record.measurement_type
  const out = record.result === 'out_of_range'

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Detalle de medición</DialogTitle>
          <DialogDescription>
            {type?.name ?? '—'} · {record.asset ? `${record.asset.code} — ${record.asset.name}` : '—'}
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y">
          <Row label="Fecha y hora" value={formatDateTime(record.measured_at)} />
          <Row
            label="Valor"
            value={
              <span className="tabular-nums">
                {formatNumber(record.value)} {type?.unit ?? ''}
              </span>
            }
          />
          {type && (
            <Row
              label="Rango aceptable"
              value={
                <span className="tabular-nums">
                  {formatNumber(type.min_value)} – {formatNumber(type.max_value)}
                </span>
              }
            />
          )}
          <Row
            label="Resultado"
            value={
              <Badge className={out ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'}>
                {RESULT_LABELS[record.result]}
              </Badge>
            }
          />
          <Row label="Registrado por" value={record.recorder?.full_name ?? '—'} />
          <Row label="Observaciones" value={record.notes || '—'} />
          <Row
            label="Evidencia"
            value={
              record.evidence_path ? (
                signedUrl ? (
                  <a
                    href={signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Abrir imagen <ExternalLink className="size-3.5" />
                  </a>
                ) : signing ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  'No disponible'
                )
              ) : (
                'Sin evidencia'
              )
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
