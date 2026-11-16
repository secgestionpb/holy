import { useMemo } from 'react'
import type { MeasurementRecordRow } from '@/lib/m6'

type Props = {
  records: MeasurementRecordRow[]
  minValue: number
  maxValue: number
  unit: string
}

const W = 720
const H = 240
const PAD = { top: 16, right: 16, bottom: 28, left: 48 }

export function TrendChart({ records, minValue, maxValue, unit }: Props) {
  const points = useMemo(() => {
    const sorted = [...records].sort(
      (a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime(),
    )
    return sorted.map((r) => ({
      t: new Date(r.measured_at).getTime(),
      v: Number(r.value),
      out: r.result === 'out_of_range',
    }))
  }, [records])

  if (points.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed text-[13px] text-muted-foreground">
        Sin registros para los filtros seleccionados.
      </div>
    )
  }

  const tMin = points[0].t
  const tMax = points[points.length - 1].t
  const tSpan = Math.max(tMax - tMin, 1)
  const vMin = Math.min(minValue, ...points.map((p) => p.v))
  const vMax = Math.max(maxValue, ...points.map((p) => p.v))
  const vSpan = Math.max(vMax - vMin, 1e-9)

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const x = (t: number) => PAD.left + ((t - tMin) / tSpan) * innerW
  const y = (v: number) => PAD.top + (1 - (v - vMin) / vSpan) * innerH

  const bandTop = y(maxValue)
  const bandBottom = y(minValue)

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`)
    .join(' ')

  const gridValues = [vMin, vMin + vSpan / 2, vMax]
  const fmtV = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 })
  const fmtD = (t: number) =>
    new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

  return (
    <div className="overflow-x-auto rounded-lg border bg-card p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[240px] w-full min-w-[520px]" role="img"
        aria-label={`Tendencia de valores (${unit})`}>
        <rect
          x={PAD.left}
          y={bandTop}
          width={innerW}
          height={Math.max(bandBottom - bandTop, 0)}
          className="fill-emerald-500/10"
        />
        <line x1={PAD.left} y1={bandTop} x2={W - PAD.right} y2={bandTop}
          className="stroke-emerald-500/50" strokeDasharray="4 3" strokeWidth={1} />
        <line x1={PAD.left} y1={bandBottom} x2={W - PAD.right} y2={bandBottom}
          className="stroke-emerald-500/50" strokeDasharray="4 3" strokeWidth={1} />
        {gridValues.map((v) => (
          <g key={v}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)}
              className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end"
              className="fill-muted-foreground text-[10px]">{fmtV(v)}</text>
          </g>
        ))}
        <path d={path} fill="none" className="stroke-primary" strokeWidth={1.8} />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={p.out ? 4.5 : 3}
            className={p.out ? 'fill-red-500' : 'fill-primary'} />
        ))}
        <text x={PAD.left} y={H - 8} className="fill-muted-foreground text-[10px]">
          {fmtD(tMin)}
        </text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {fmtD(tMax)}
        </text>
        <text x={W - PAD.right} y={PAD.top + 10} textAnchor="end"
          className="fill-emerald-600 text-[10px] dark:fill-emerald-400">
          Rango {fmtV(minValue)}–{fmtV(maxValue)} {unit}
        </text>
      </svg>
    </div>
  )
}
