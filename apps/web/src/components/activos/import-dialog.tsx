import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  downloadImportReport,
  downloadImportTemplate,
  fetchExistingCodes,
  importAssets,
  parseImportFile,
  validateImportRows,
  type ImportResult,
  type ParsedRow,
  type ReportFailure,
  type ReportSuccess,
} from '@/lib/m1-import'
import type { CategoryRow, LocationRow, UserLite } from '@/lib/m1'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: CategoryRow[]
  locations: LocationRow[]
  users: UserLite[]
  onImported: () => void
}

type Step = 'upload' | 'preview' | 'done'

const STEP_LABELS: Array<{ key: Step; label: string }> = [
  { key: 'upload', label: '1. Archivo' },
  { key: 'preview', label: '2. Previsualización' },
  { key: 'done', label: '3. Resultado' },
]

const MAX_VISIBLE_ERRORS = 50

export function ImportDialog({ open, onOpenChange, categories, locations, users, onImported }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [parsedRows, setParsedRows] = useState<ParsedRow[] | null>(null)
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set())
  const [createMissing, setCreateMissing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [successes, setSuccesses] = useState<ReportSuccess[]>([])
  const [failures, setFailures] = useState<ReportFailure[]>([])

  const preview = useMemo(() => {
    if (!parsedRows) return null
    return validateImportRows(
      parsedRows,
      { categories, locations, users, existingCodes },
      createMissing,
    )
  }, [parsedRows, categories, locations, users, existingCodes, createMissing])

  const nameByRow = useMemo(() => {
    const map = new Map<number, string>()
    for (const row of parsedRows ?? []) map.set(row.excelRow, row.name)
    return map
  }, [parsedRows])

  function reset() {
    setStep('upload')
    setParsing(false)
    setParseError(null)
    setFileName('')
    setParsedRows(null)
    setExistingCodes(new Set())
    setCreateMissing(false)
    setImporting(false)
    setResult(null)
    setSuccesses([])
    setFailures([])
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      onOpenChange(false)
      reset()
    }
  }

  async function handleFile(file: File) {
    setParseError(null)
    setParsing(true)
    try {
      const rows = await parseImportFile(file)
      const codes = rows.map((row) => row.code.trim()).filter(Boolean)
      const existing = codes.length > 0 ? await fetchExistingCodes(codes) : new Set<string>()
      setFileName(file.name)
      setParsedRows(rows)
      setExistingCodes(existing)
      setCreateMissing(false)
      setStep('preview')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'No se pudo leer el archivo.')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!preview || preview.valid.length === 0) return
    setImporting(true)
    // Errores detectados en cliente: viajan al reporte aunque no se envíen.
    const clientFailures: ReportFailure[] = preview.errors.map((issue) => ({
      row: issue.excelRow,
      code: parsedRows?.find((row) => row.excelRow === issue.excelRow)?.code.trim() || null,
      message: issue.message,
    }))
    try {
      const importResult = await importAssets({
        filename: fileName,
        createLocations: createMissing,
        rows: preview.valid,
      })
      const ok: ReportSuccess[] = []
      const failed: ReportFailure[] = [...clientFailures]
      for (const item of importResult.results) {
        if (item.ok) {
          ok.push({ row: item.row, code: item.code ?? '', name: nameByRow.get(item.row) ?? '' })
        } else {
          failed.push({
            row: item.row,
            code:
              item.code ??
              parsedRows?.find((row) => row.excelRow === item.row)?.code.trim() ??
              null,
            message: item.error ?? 'Error al insertar la fila.',
          })
        }
      }
      failed.sort((a, b) => a.row - b.row)
      setResult(importResult)
      setSuccesses(ok)
      setFailures(failed)
      setStep('done')
      if (importResult.created > 0) {
        toast.success(`Importación masiva: ${importResult.created} activos creados`)
      } else {
        toast.warning('No se creó ningún activo. Revisa el reporte de errores.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo ejecutar la importación.')
    } finally {
      setImporting(false)
    }
  }

  function handleDone() {
    onOpenChange(false)
    reset()
    onImported()
  }

  const missingCount = preview?.missingPaths.length ?? 0
  const canImport = Boolean(
    preview && preview.valid.length > 0 && !importing && (missingCount === 0 || createMissing),
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-primary" />
            Importar activos (F1.12)
          </DialogTitle>
          <DialogDescription>
            Carga masiva de activos raíz desde un archivo .xlsx. Sin componentes, garantías ni
            documentación.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          {STEP_LABELS.map((item, index) => (
            <span key={item.key} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden>→</span>}
              <span
                className={
                  item.key === step
                    ? 'font-semibold text-foreground'
                    : STEP_LABELS.findIndex((s) => s.key === step) > index
                      ? 'text-primary'
                      : ''
                }
              >
                {item.label}
              </span>
            </span>
          ))}
        </div>

        {step === 'upload' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-4 text-[13.5px]">
              <p className="font-medium">1. Descarga la plantilla</p>
              <p className="mt-1 text-muted-foreground">
                Trae los encabezados exactos y una hoja de instrucciones con los valores permitidos.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void downloadImportTemplate()}>
                <Download />
                Descargar plantilla .xlsx
              </Button>
            </div>

            <div className="rounded-lg border border-dashed border-border p-4 text-[13.5px]">
              <p className="font-medium">2. Sube tu archivo</p>
              <p className="mt-1 text-muted-foreground">
                Solo .xlsx, máximo 5000 filas. Se prevalida en este paso antes de importar.
              </p>
              <label className="mt-3 inline-flex">
                <input
                  type="file"
                  accept=".xlsx"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void handleFile(file)
                  }}
                />
                <span className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-[13.5px] font-medium text-primary-foreground hover:bg-primary/90">
                  {parsing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {parsing ? 'Leyendo archivo…' : 'Seleccionar archivo'}
                </span>
              </label>
              {parseError && (
                <p className="mt-3 flex items-start gap-2 text-[13px] text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {parseError}
                </p>
              )}
            </div>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 text-[13.5px]">
              <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-400">
                {preview.valid.length} fila(s) válida(s)
              </span>
              <span
                className={`rounded-md px-2.5 py-1 font-medium ${
                  preview.errors.length > 0
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {preview.errors.length} fila(s) con error
              </span>
              <span className="rounded-md bg-muted px-2.5 py-1 text-muted-foreground">
                {fileName}
              </span>
            </div>

            {missingCount > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 text-[13px]">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                  Se detectaron {missingCount} ruta(s) de ubicación con nodos inexistentes:
                </p>
                <ul className="mt-1.5 ml-6 max-h-24 list-disc overflow-y-auto text-muted-foreground">
                  {preview.missingPaths.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
                <label className="mt-3 flex cursor-pointer items-center gap-2.5">
                  <Checkbox
                    checked={createMissing}
                    onCheckedChange={(checked) => setCreateMissing(checked === true)}
                  />
                  <span>
                    Crear automáticamente los nodos que faltan siguiendo la ruta (máx. 5 niveles).
                    Si lo dejas sin marcar, esas filas quedan como error.
                  </span>
                </label>
              </div>
            )}

            {preview.errors.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Fila</TableHead>
                      <TableHead>Motivo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.errors.slice(0, MAX_VISIBLE_ERRORS).map((issue) => (
                      <TableRow key={issue.excelRow}>
                        <TableCell className="tabular-nums">{issue.excelRow}</TableCell>
                        <TableCell className="text-[13px] text-destructive">{issue.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {preview.errors.length > MAX_VISIBLE_ERRORS && (
                  <p className="px-3 py-2 text-[12.5px] text-muted-foreground">
                    …y {preview.errors.length - MAX_VISIBLE_ERRORS} error(es) más (todos aparecen en
                    el reporte descargable).
                  </p>
                )}
              </div>
            )}

            {preview.valid.length === 0 && (
              <p className="text-[13.5px] text-muted-foreground">
                No hay filas válidas para importar. Corrige el archivo y vuelve a subirlo.
              </p>
            )}

            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep('upload')}>
                Elegir otro archivo
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                  Cancelar
                </Button>
                <Button size="sm" disabled={!canImport} onClick={() => void handleImport()}>
                  {importing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  {importing ? 'Importando…' : `Importar ${preview.valid.length} activo(s)`}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-4 text-[13.5px]">
              {result.created > 0 ? (
                <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" />
                  Importación masiva: {result.created} activos creados
                </p>
              ) : (
                <p className="flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="size-4" />
                  No se creó ningún activo.
                </p>
              )}
              <p className="mt-2 text-muted-foreground">
                {successes.length} éxito(s) · {failures.length} error(es)
                {result.locations_created > 0
                  ? ` · ${result.locations_created} nodo(s) de ubicación creado(s)`
                  : ''}
              </p>
              <p className="mt-1 text-muted-foreground">
                La auditoría registra una entrada consolidada: «Importación masiva:{' '}
                {result.created} activos creados».
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void downloadImportReport({ filename: fileName, successes, failures })
              }
            >
              <Download />
              Descargar reporte (.xlsx)
            </Button>

            <DialogFooter>
              <Button size="sm" onClick={handleDone}>
                Cerrar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
