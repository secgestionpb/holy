import { useState } from 'react'
import { Ban, Check, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { type ChecklistEntry, type ChecklistStatus } from '@/lib/m3'

const STATUS_LABELS: Record<ChecklistStatus, string> = {
  pending: 'Pendiente',
  done: 'Hecho',
  not_applicable: 'No aplica',
}

const STATUS_CLASS: Record<ChecklistStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  not_applicable: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

type Props = {
  entries: ChecklistEntry[]
  editable: boolean
  onUpdate: (entry: ChecklistEntry, status: ChecklistStatus, note: string | null) => Promise<void>
}

export function ChecklistTab({ entries, editable, onUpdate }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [naTarget, setNaTarget] = useState<string | null>(null)
  const [naNote, setNaNote] = useState('')

  async function apply(entry: ChecklistEntry, status: ChecklistStatus, note: string | null = null) {
    setBusyId(entry.id)
    try {
      await onUpdate(entry, status, note)
      if (naTarget === entry.id) {
        setNaTarget(null)
        setNaNote('')
      }
    } finally {
      setBusyId(null)
    }
  }

  async function confirmNotApplicable(entry: ChecklistEntry) {
    const note = naNote.trim()
    if (!note) {
      toast.error('Marcar «No aplica» requiere una observación.')
      return
    }
    await apply(entry, 'not_applicable', note)
  }

  const completed = entries.filter((entry) => entry.status !== 'pending').length

  return (
    <section className="rounded-lg border border-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Checklist Preventivo</h2>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {completed} / {entries.length} completados
        </span>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {editable
          ? 'Marca cada paso al ejecutar el mantenimiento. «No aplica» exige observación; el cierre de la OT exige checklist completo (F3.4 / m3_wo_checklist_validate).'
          : 'Solo lectura: pueden marcar los técnicos asignados y Mantenimiento.'}
      </p>

      <div className="mt-4 space-y-3">
        {entries.map((entry) => {
          const busy = busyId === entry.id
          const noting = naTarget === entry.id
          return (
            <div key={entry.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-6 text-center text-[12px] text-muted-foreground tabular-nums">
                  {entry.position}
                </span>
                <span
                  className={`flex-1 text-[14px] ${
                    entry.status === 'done' ? 'text-muted-foreground line-through' : ''
                  }`}
                >
                  {entry.item_text}
                </span>
                <Badge variant="secondary" className={STATUS_CLASS[entry.status]}>
                  {STATUS_LABELS[entry.status]}
                </Badge>
                {editable && (
                  <div className="flex items-center gap-1.5">
                    {entry.status !== 'done' && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void apply(entry, 'done')}
                      >
                        {busy && busyId === entry.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1 h-3.5 w-3.5" />
                        )}
                        Hecho
                      </Button>
                    )}
                    {entry.status !== 'not_applicable' && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setNaTarget(noting ? null : entry.id)
                          setNaNote(entry.note ?? '')
                        }}
                      >
                        <Ban className="mr-1 h-3.5 w-3.5" />
                        No aplica
                      </Button>
                    )}
                    {entry.status !== 'pending' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        title="Volver a pendiente"
                        onClick={() => void apply(entry, 'pending')}
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        Deshacer
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {entry.status === 'not_applicable' && entry.note && !noting && (
                <p className="mt-2 pl-9 text-[12.5px] text-muted-foreground">
                  Observación: {entry.note}
                </p>
              )}

              {editable && noting && (
                <div className="mt-3 space-y-2 pl-9">
                  <Textarea
                    rows={2}
                    autoFocus
                    value={naNote}
                    onChange={(event) => setNaNote(event.target.value)}
                    placeholder="Observación obligatoria: ¿por qué no aplica este paso?"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy || !naNote.trim()}
                      onClick={() => void confirmNotApplicable(entry)}
                    >
                      {busy && busyId === entry.id && (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      )}
                      Confirmar «No aplica»
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setNaTarget(null)
                        setNaNote('')
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
