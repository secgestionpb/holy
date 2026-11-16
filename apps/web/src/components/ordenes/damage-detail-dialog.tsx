import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, signAssetFileUrl } from '@/lib/m1'
import {
  DAMAGE_STATUS_LABELS,
  evidenceFileName,
  type DamageRow,
  type WoEvidenceRow,
} from '@/lib/m2'
import { MotiveDialog } from '@/components/ordenes/motive-dialog'

type Props = {
  report: DamageRow
  evidence: WoEvidenceRow[]
  canReview: boolean
  onConvert: (report: DamageRow) => void
  onDiscard: (report: DamageRow, reason: string) => Promise<string | null>
  onClose: () => void
}

const DR_STATUS_CLASS: Record<DamageRow['status'], string> = {
  pending_review: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  converted: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  discarded: 'bg-destructive/15 text-destructive',
}

export function DamageDetailDialog({ report, evidence, canReview, onConvert, onDiscard, onClose }: Props) {
  const [discardOpen, setDiscardOpen] = useState(false)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [broken, setBroken] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let alive = true
    void Promise.all(
      evidence.map(async (row) => [row.id, await signAssetFileUrl(row.storage_path)] as const),
    ).then((entries) => {
      if (!alive) return
      const next: Record<string, string> = {}
      const failed: Record<string, boolean> = {}
      for (const [id, url] of entries) {
        if (url) next[id] = url
        else failed[id] = true
      }
      setPreviews(next)
      setBroken(failed)
    })
    return () => {
      alive = false
    }
  }, [evidence])

  const pending = report.status === 'pending_review'
  const reviewable = canReview && pending

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {report.report_ref}
              <Badge variant="secondary" className={DR_STATUS_CLASS[report.status]}>
                {DAMAGE_STATUS_LABELS[report.status]}
              </Badge>
            </DialogTitle>
            <DialogDescription>Ficha del reporte de daño (V2.4).</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-[12.5px] text-muted-foreground">Fecha / hora</dt>
                <dd className="text-[14px]">{formatDateTime(report.reported_at)}</dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-muted-foreground">Reportado por</dt>
                <dd className="text-[14px]">{report.reporter_name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-muted-foreground">Activo</dt>
                <dd className="text-[14px]">
                  {report.asset_code ? `${report.asset_code} — ${report.asset_name}` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-muted-foreground">Componente</dt>
                <dd className="text-[14px]">
                  {report.component_code ? `${report.component_code} — ${report.component_name}` : '—'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[12.5px] text-muted-foreground">Localización</dt>
                <dd className="text-[14px]">
                  {report.location ?? report.location_path ?? '—'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[12.5px] text-muted-foreground">Descripción del daño</dt>
                <dd className="whitespace-pre-wrap text-[14px]">{report.description}</dd>
              </div>
              {report.status === 'discarded' && report.discard_reason && (
                <div className="sm:col-span-2">
                  <dt className="text-[12.5px] text-muted-foreground">Motivo de descarte</dt>
                  <dd className="text-[14px] text-destructive">{report.discard_reason}</dd>
                </div>
              )}
              {report.wo_id && report.wo_number && (
                <div className="sm:col-span-2">
                  <dt className="text-[12.5px] text-muted-foreground">OT derivada</dt>
                  <dd className="text-[14px] font-medium">{report.wo_number}</dd>
                </div>
              )}
            </dl>

            <div className="space-y-2">
              <p className="text-[12.5px] text-muted-foreground">Evidencia fotográfica</p>
              {evidence.length === 0 ? (
                <p className="text-[13.5px] text-muted-foreground">Sin fotografías adjuntas.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {evidence.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {previews[row.id] && !broken[row.id] ? (
                          <img
                            src={previews[row.id]}
                            alt=""
                            className="size-9 shrink-0 rounded-md object-cover"
                            onError={() => setBroken((current) => ({ ...current, [row.id]: true }))}
                          />
                        ) : (
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                            <FileText className="size-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px]">{evidenceFileName(row)}</p>
                          <p className="text-[12px] text-muted-foreground">
                            {formatDateTime(row.uploaded_at)}
                          </p>
                          {broken[row.id] && (
                            <p className="text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
                              Archivo no disponible (retención)
                            </p>
                          )}
                        </div>
                      </div>
                      {previews[row.id] && !broken[row.id] && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(previews[row.id], '_blank', 'noopener')}
                        >
                          Abrir
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cerrar
            </Button>
            {reviewable && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setDiscardOpen(true)}
                >
                  Descartar
                </Button>
                <Button onClick={() => onConvert(report)}>Convertir a OT</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {discardOpen && (
        <MotiveDialog
          open
          onOpenChange={setDiscardOpen}
          title="Descartar reporte de daño"
          description={`${report.report_ref}.`}
          effect="El reporte pasará a Descartado ingrese el motivo."
          confirmLabel="Descartar reporte"
          onSubmit={(reason) => onDiscard(report, reason)}
        />
      )}
    </>
  )
}
