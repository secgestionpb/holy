import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/auth-store'
import {
  KPI_GROUPS,
  KPI_KEYS_BY_GROUP,
  KPI_TITLES,
  fetchKpiGroup,
  fetchScheduledReports,
  fetchSendLogs,
  fetchVisibleKpis,
  resendReport,
  roleSet,
  seedDashboardKpis,
  updateScheduledReport,
  upsertKpiVisible,
  type KpiRow,
  type KpiGroup as KpiGroupName,
  type ReportSendLog,
  type ScheduledReport,
} from '@/lib/m7'
import { exportExcel, exportPdf, type ExportSection } from '@/lib/export-utils'
import KpiWidget from '@/components/reports/kpi-widget'
import PersonalizeDialog from '@/components/reports/personalize-dialog'
import ScheduledReportDialog from '@/components/reports/scheduled-report-dialog'
import { FileDown, FileSpreadsheet, RotateCcw, SlidersHorizontal } from 'lucide-react'

type PeriodPreset = 'mes' | '3m' | '12m' | 'custom'

function presetRange(preset: PeriodPreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  if (preset === 'mes') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: iso(from), to: iso(now) }
  }
  if (preset === '3m' || preset === '12m') {
    const months = preset === '3m' ? 3 : 12
    const from = new Date(now.getFullYear(), now.getMonth() - months + 1, 1)
    return { from: iso(from), to: iso(now) }
  }
  return { from: customFrom || iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: customTo || iso(now) }
}

function periodLabel(preset: PeriodPreset, from: string, to: string): string {
  if (preset === 'mes') return 'Mes actual'
  if (preset === '3m') return 'Últimos 3 meses'
  if (preset === '12m') return 'Últimos 12 meses'
  return `${from} a ${to}`
}

const STATUS_LABELS: Record<string, string> = {
  sent: 'Enviado',
  failed: 'Fallido',
  skipped_no_recipients: 'Sin destinatarios',
}

export default function Reportes() {
  const roles = useAuth((s) => s.roles)
  const isAdmin = roles.includes('administrador')
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'programados' ? 'programados' : 'dashboard'

  const allowed = useMemo(() => new Set(roleSet(roles)), [roles])
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [loadingVis, setLoadingVis] = useState(true)
  const [personalizeOpen, setPersonalizeOpen] = useState(false)

  const [preset, setPreset] = useState<PeriodPreset>('mes')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const range = useMemo(() => presetRange(preset, customFrom, customTo), [preset, customFrom, customTo])
  const plabel = useMemo(() => periodLabel(preset, range.from, range.to), [preset, range])

  const [kpiData, setKpiData] = useState<Record<string, KpiRow>>({})
  const [loadingKpis, setLoadingKpis] = useState(true)
  const [kpiError, setKpiError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [reports, setReports] = useState<ScheduledReport[]>([])
  const [logs, setLogs] = useState<ReportSendLog[]>([])
  const [loadingReports, setLoadingReports] = useState(false)
  const [reportsError, setReportsError] = useState<string | null>(null)
  const [editReport, setEditReport] = useState<ScheduledReport | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoadingVis(true)
    void seedDashboardKpis().then(() =>
      fetchVisibleKpis().then((r) => {
        if (!alive) return
        if (r.ok) {
          const keys = r.rows.filter((row) => row.visible).map((row) => row.kpi_key)
          setVisible(new Set(keys.filter((k) => allowed.has(k))))
        }
        setLoadingVis(false)
      }),
    )
    return () => {
      alive = false
    }
  }, [allowed, reloadKey])

  useEffect(() => {
    if (tab !== 'dashboard' || loadingVis) return
    let alive = true
    setLoadingKpis(true)
    setKpiError(null)
    const groups = KPI_GROUPS.filter((g) => KPI_KEYS_BY_GROUP[g.key].some((k) => visible.has(k)))
    void Promise.all(groups.map((g) => fetchKpiGroup(g.key as KpiGroupName, range.from, range.to))).then((results) => {
      if (!alive) return
      const merged: Record<string, KpiRow> = {}
      const errors: string[] = []
      for (const r of results) {
        if (r.ok && r.data) Object.assign(merged, r.data)
        else if (!r.ok) errors.push(r.message)
      }
      setKpiData(merged)
      setKpiError(errors.length > 0 ? errors[0] : null)
      setLoadingKpis(false)
    })
    return () => {
      alive = false
    }
  }, [tab, visible, range.from, range.to, loadingVis, reloadKey])

  useEffect(() => {
    if (tab !== 'programados') return
    let alive = true
    setLoadingReports(true)
    setReportsError(null)
    void Promise.all([fetchScheduledReports(), fetchSendLogs()]).then(([sr, lg]) => {
      if (!alive) return
      if (sr.ok) setReports(sr.rows)
      else setReportsError(sr.message)
      if (lg.ok) setLogs(lg.rows)
      setLoadingReports(false)
    })
    return () => {
      alive = false
    }
  }, [tab, reloadKey])

  const onToggle = useCallback(
    (kpiKey: string, nextVisible: boolean) => {
      setVisible((prev) => {
        const s = new Set(prev)
        if (nextVisible) s.add(kpiKey)
        else s.delete(kpiKey)
        return s
      })
      void upsertKpiVisible(kpiKey, nextVisible)
    },
    [],
  )

  const handleSaveReport = useCallback(
    async (id: string, patch: { send_day: number; format: 'pdf' | 'excel'; recipients: string; is_active: boolean }) => {
      const r = await updateScheduledReport(id, patch)
      if (!r.ok) throw new Error(r.message)
      setToast('Reporte actualizado.')
      setReloadKey((k) => k + 1)
    },
    [],
  )

  const handleResend = useCallback(async (reportId: string) => {
    setResendingId(reportId)
    const r = await resendReport(reportId)
    setResendingId(null)
    setToast(r.ok ? `Reenvío: ${r.status ?? 'ok'}${r.reason ? ` (${r.reason})` : ''}` : r.message)
    setReloadKey((k) => k + 1)
  }, [])

  const lastLogByReport = useMemo(() => {
    const map = new Map<string, ReportSendLog>()
    for (const log of logs) {
      if (!map.has(log.report_id)) map.set(log.report_id, log)
    }
    return map
  }, [logs])

  const visibleOrdered = useMemo(
    () => KPI_GROUPS.flatMap((g) => KPI_KEYS_BY_GROUP[g.key].filter((k) => allowed.has(k) && visible.has(k))),
    [allowed, visible],
  )

  const dashboardExportSections: ExportSection[] = useMemo(() => {
    return KPI_GROUPS.filter((g) => KPI_KEYS_BY_GROUP[g.key].some((k) => visible.has(k))).map((g) => {
      const keys = KPI_KEYS_BY_GROUP[g.key].filter((k) => visible.has(k))
      const rows: (string | number)[][] = []
      for (const k of keys) {
        const d = kpiData[k]
        const title = KPI_TITLES[k] ?? k
        if (d && d.value !== undefined && d.value !== null) rows.push([title, String(d.value)])
        const sub = Array.isArray(d?.rows) ? (d.rows as KpiRow[]) : []
        for (const row of sub.slice(0, 20)) {
          rows.push([title, ...Object.values(row).map((v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)))])
        }
      }
      return { title: g.label, headers: ['KPI', 'Detalle'], rows }
    })
  }, [visible, kpiData])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted-foreground">Tablero de indicadores y envíos mensuales</p>
          <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
        </div>
        {tab === 'dashboard' && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPersonalizeOpen(true)}>
              <SlidersHorizontal className="size-4" />
              Personalizar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void exportPdf(
                  { title: 'Dashboard de KPIs', periodLabel: plabel },
                  dashboardExportSections,
                  `dashboard_kpis_${plabel}`,
                )
              }
            >
              <FileDown className="size-4" />
              PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void exportExcel(
                  { title: 'Dashboard de KPIs', periodLabel: plabel },
                  dashboardExportSections,
                  `dashboard_kpis_${plabel}`,
                )
              }
            >
              <FileSpreadsheet className="size-4" />
              Excel
            </Button>
          </div>
        )}
      </div>

      {kpiError && <p className="text-[13px] text-destructive">{kpiError}</p>}
      {reportsError && <p className="text-[13px] text-destructive">{reportsError}</p>}
      {toast && (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-600 dark:text-emerald-400">{toast}</p>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(searchParams)
          if (v === 'dashboard') next.delete('tab')
          else next.set('tab', v)
          setSearchParams(next, { replace: true })
        }}
      >
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="programados">Programados</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
              <SelectTrigger className="w-[190px]" aria-label="Período">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mes">Mes actual</SelectItem>
                <SelectItem value="3m">Últimos 3 meses</SelectItem>
                <SelectItem value="12m">Últimos 12 meses</SelectItem>
                <SelectItem value="custom">Rango personalizado</SelectItem>
              </SelectContent>
            </Select>
            {preset === 'custom' && (
              <>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-[150px]" aria-label="Desde" />
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-[150px]" aria-label="Hasta" />
              </>
            )}
            <Button variant="ghost" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              Recargar
            </Button>
            {roles.includes('tecnico') && (
              <span className="text-[12px] text-muted-foreground">KPIs calculados solo sobre tus OTs.</span>
            )}
          </div>

          {loadingVis ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : visibleOrdered.length === 0 ? (
            <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-[13.5px] text-muted-foreground">
              No hay KPIs visibles. Pulsa «Personalizar» para activar widgets.
            </p>
          ) : (
            <>
              {KPI_GROUPS.map((group) => {
                const keys = KPI_KEYS_BY_GROUP[group.key].filter((k) => allowed.has(k) && visible.has(k))
                if (keys.length === 0) return null
                return (
                  <section key={group.key} className="space-y-3">
                    <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {keys.map((k) => (
                        <KpiWidget key={k} kpiKey={k} loading={loadingKpis} data={kpiData[k]} periodLabel={plabel} />
                      ))}
                    </div>
                  </section>
                )
              })}
            </>
          )}
        </TabsContent>

        <TabsContent value="programados" className="space-y-4">
          {loadingReports ? (
            <div className="h-48 animate-pulse rounded-lg bg-muted" />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reporte</TableHead>
                    <TableHead>Frecuencia</TableHead>
                    <TableHead>Día</TableHead>
                    <TableHead>Formato</TableHead>
                    <TableHead>Destinatarios</TableHead>
                    <TableHead>Activo</TableHead>
                    <TableHead>Último envío</TableHead>
                    {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((row) => {
                    const last = lastLogByReport.get(row.id)
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-[13px] font-medium">{row.report_name}</TableCell>
                        <TableCell className="text-[12.5px]">Mensual</TableCell>
                        <TableCell>{row.send_day}</TableCell>
                        <TableCell className="text-[12.5px]">{row.format === 'excel' ? 'Excel' : 'PDF'}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-[12px] text-muted-foreground" title={row.recipients}>
                          {row.recipients || '—'}
                        </TableCell>
                        <TableCell>
                          {isAdmin ? (
                            <Switch
                              checked={row.is_active}
                              onCheckedChange={(checked) => void handleSaveReport(row.id, { ...row, is_active: checked, send_day: row.send_day, format: row.format, recipients: row.recipients })}
                              aria-label={`Activo ${row.report_name}`}
                            />
                          ) : (
                            <Badge variant={row.is_active ? 'default' : 'secondary'}>{row.is_active ? 'Activo' : 'Inactivo'}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-[12px]">
                          {last ? (
                            <span className="flex flex-col">
                              <span>{new Date(last.sent_at).toLocaleDateString('es-CO')}</span>
                              <Badge
                                variant="outline"
                                className={
                                  last.status === 'sent'
                                    ? 'w-fit text-emerald-600'
                                    : last.status === 'failed'
                                      ? 'w-fit text-red-600'
                                      : 'w-fit text-amber-600'
                                }
                              >
                                {STATUS_LABELS[last.status] ?? last.status}
                              </Badge>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => { setEditReport(row); setEditOpen(true) }}>
                                Editar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleResend(row.id)}
                                disabled={resendingId === row.id}
                                aria-label={`Reenviar ${row.report_name}`}
                              >
                                <RotateCcw className={resendingId === row.id ? 'size-4 animate-spin' : 'size-4'} />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                  {reports.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 8 : 7} className="text-center text-[13px] text-muted-foreground">
                        Sin reportes programados.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {!isAdmin && (
            <p className="text-[12.5px] text-muted-foreground">Solo lectura: la edición corresponde al Administrador.</p>
          )}
        </TabsContent>
      </Tabs>

      <PersonalizeDialog
        open={personalizeOpen}
        onOpenChange={setPersonalizeOpen}
        allowedKeys={allowed}
        visibleKeys={visible}
        onToggle={onToggle}
      />

      <ScheduledReportDialog
        report={editReport}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={handleSaveReport}
      />
    </div>
  )
}
