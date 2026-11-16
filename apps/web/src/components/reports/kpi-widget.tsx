import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KPI_TITLES, type KpiRow } from '@/lib/m7'
import { exportExcel, exportPdf, type ExportSection } from '@/lib/export-utils'
import { FileDown, FileSpreadsheet, Maximize2 } from 'lucide-react'

type Props = {
  kpiKey: string
  loading: boolean
  data?: KpiRow
  periodLabel: string
}

function fmtValue(unit: string | undefined, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value !== 'number') return String(value)
  if (unit === 'cur') return value.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
  if (unit === '%') return `${value}%`
  if (unit === 'h') return `${value} h`
  if (unit === 'd') return `${value} d`
  return value.toLocaleString('es-CO')
}

function rowsOf(data: KpiRow | undefined): KpiRow[] {
  const rows = data?.rows
  return Array.isArray(rows) ? (rows as KpiRow[]) : []
}

function columnsOf(rows: KpiRow[]): string[] {
  if (rows.length === 0) return []
  return Object.keys(rows[0]).filter((k) => k !== 'id' && k !== 'link')
}

export default function KpiWidget({ kpiKey, loading, data, periodLabel }: Props) {
  const [drillOpen, setDrillOpen] = useState(false)
  const title = KPI_TITLES[kpiKey] ?? kpiKey
  const rows = useMemo(() => rowsOf(data), [data])
  const cols = useMemo(() => columnsOf(rows), [rows])
  const isSnapshot = data?.snapshot === true
  const value = data?.value
  const unit = typeof data?.unit === 'string' ? data?.unit : undefined
  const hasRows = rows.length > 0
  const link = typeof data?.link === 'string' ? (data.link as string) : null

  const exportSections: ExportSection[] = [
    {
      title,
      headers: cols.length > 0 ? cols : ['indicador', 'valor'],
      rows:
        cols.length > 0
          ? rows.map((r) => cols.map((c) => (r[c] === null || r[c] === undefined ? '' : typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c]))))
          : [[title, fmtValue(unit, value)]],
    },
  ]

  return (
    <>
      <Card className="relative">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <CardTitle className="text-[13.5px] font-semibold leading-snug">{title}</CardTitle>
          <div className="flex items-center gap-1">
            {isSnapshot && (
              <Badge variant="secondary" className="text-[10.5px]">Actual</Badge>
            )}
            {hasRows && (
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setDrillOpen(true)} aria-label={`Ver detalle de ${title}`}>
                <Maximize2 className="size-3.5" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
          ) : (
            <>
              {value !== undefined && value !== null && (
                <p className="text-2xl font-bold tracking-tight">{fmtValue(unit, value as number)}</p>
              )}
              {typeof data?.vigor === 'number' && (
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Vigentes {String(data.vigente ?? data.vigor)}</Badge>
                  <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">Por vencer {String(data.due)}</Badge>
                  <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">Vencidas {String(data.expired)}</Badge>
                </div>
              )}
              {typeof data?.vigente === 'number' && typeof data?.vigor !== 'number' && (
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Vigentes {String(data.vigente)}</Badge>
                  <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">Por vencer {String(data.por_vencer)}</Badge>
                  <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">Vencidas {String(data.vencida)}</Badge>
                </div>
              )}
              {hasRows && (
                <div className="space-y-1">
                  {rows.slice(0, 5).map((row, i) => (
                    <p key={i} className="truncate text-[12.5px] text-muted-foreground">
                      {cols
                        .slice(0, 3)
                        .map((c) => String(row[c] ?? ''))
                        .join(' · ')}
                    </p>
                  ))}
                </div>
              )}
              {!loading && value === undefined && !hasRows && typeof data?.vigor !== 'number' && typeof data?.vigente !== 'number' && (
                <p className="text-[13px] text-muted-foreground">Sin datos en el período.</p>
              )}
              {link && (
                <a href={link} className="inline-block text-[12.5px] font-medium text-primary hover:underline">
                  Ver en el módulo →
                </a>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={drillOpen} onOpenChange={setDrillOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void exportPdf({ title, periodLabel }, exportSections, `${kpiKey}_${periodLabel}`)}>
              <FileDown className="size-4" />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportExcel({ title, periodLabel }, exportSections, `${kpiKey}_${periodLabel}`)}>
              <FileSpreadsheet className="size-4" />
              Excel
            </Button>
            <span className="text-[12px] text-muted-foreground">Período: {periodLabel}</span>
          </div>
          {cols.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {cols.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    {cols.map((c) => (
                      <TableCell key={c} className="text-[12.5px]">
                        {row[c] === null || row[c] === undefined ? '—' : typeof row[c] === 'object' ? JSON.stringify(row[c]) : String(row[c])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-[13px] text-muted-foreground">Sin filas de detalle.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
