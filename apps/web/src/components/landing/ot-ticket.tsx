import { Badge } from '@/components/ui/badge'

const steps = [
  { label: 'Abierta', state: 'done' },
  { label: 'Asignada', state: 'done' },
  { label: 'En proceso', state: 'current' },
  { label: 'Cerrada', state: 'pending' },
] as const

function dotClass(state: (typeof steps)[number]['state']) {
  if (state === 'done') return 'bg-ok'
  if (state === 'current') return 'bg-primary ring-4 ring-primary/30'
  return 'bg-panel-border ring-1 ring-white/10'
}

function lineClass(state: (typeof steps)[number]['state']) {
  return state === 'done' ? 'bg-ok/70' : 'bg-panel-border'
}

export function OtTicket() {
  return (
    <figure
      className="ticket-in w-full max-w-sm rounded-lg border border-panel-border bg-white/[0.04] shadow-[0_24px_60px_-24px_rgb(0_0_0_/_0.65)] backdrop-blur-sm"
      aria-label="Ejemplo de orden de trabajo"
    >
      <header className="flex items-center justify-between border-b border-dashed border-panel-border px-5 py-3.5">
        <span className="font-mono text-[13px] font-medium text-panel-foreground/85">OT-1842</span>
        <Badge>En proceso</Badge>
      </header>

      <div className="space-y-1 px-5 pt-4">
        <p className="font-heading text-lg font-bold tracking-tight text-panel-foreground">
          Cambio de filtro
        </p>
        <p className="text-[13px] text-panel-foreground/60">
          <span className="font-mono">FCU-305</span> · Habitación 305 · Plan preventivo
        </p>
        <p className="text-[13px] text-panel-foreground/60">Programada: 14 de marzo, 09:00</p>
      </div>

      <ol className="flex px-5 pt-5 pb-1">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="flex items-center">
              <span className={`size-2.5 shrink-0 rounded-full ${dotClass(step.state)}`} />
              {index < steps.length - 1 && (
                <span className={`h-px flex-1 ${lineClass(step.state)}`} />
              )}
            </span>
            <span
              className={`text-[11px] leading-tight ${
                step.state === 'pending' ? 'text-panel-foreground/40' : 'text-panel-foreground/75'
              }`}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>

      <figcaption className="mt-3 border-t border-panel-border px-5 py-3 text-[12px] text-panel-foreground/55">
        Asignada a J. Ramírez · Técnico
      </figcaption>
    </figure>
  )
}
