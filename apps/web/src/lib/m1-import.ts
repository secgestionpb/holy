// F1.12 — Importación masiva de activos: plantilla, parseo (.xlsx),
// prevalidación en cliente, llamada a la edge function m1-import-assets y
// reporte de resultado. Alcance: solo activos raíz.
import ExcelJS from 'exceljs'
import { apiFetch } from '@/lib/auth'
import {
  CRITICALITY_LABELS,
  LIFE_STAGE_LABELS,
  LIFESPAN_UNIT_LABELS,
  OPERATIONAL_LABELS,
  type CategoryRow,
  type Criticality,
  type LifeStage,
  type LifespanUnit,
  type LocationRow,
  type OperationalStatus,
  type UserLite,
} from '@/lib/m1'

export const MAX_IMPORT_ROWS = 5000

export const TEMPLATE_HEADERS = [
  'Código',
  'Nombre',
  'Categoría',
  'Ruta de ubicación',
  'Criticidad',
  'Fecha de puesta en operación',
  'Vida útil',
  'Unidad de vida útil',
  'Responsable',
  'Estado operativo',
  'Etapa inicial',
] as const

type HeaderKey =
  | 'code'
  | 'name'
  | 'category'
  | 'path'
  | 'criticality'
  | 'date'
  | 'lifespan'
  | 'lifespanUnit'
  | 'responsible'
  | 'operational'
  | 'stage'

// Encabezados aceptados (además de los de la plantilla, sin acentos/mayúsc.)
const HEADER_ALIASES: Record<HeaderKey, string[]> = {
  code: ['codigo', 'cod'],
  name: ['nombre', 'nombre del activo'],
  category: ['categoria'],
  path: ['ruta de ubicacion', 'ubicacion', 'ruta'],
  criticality: ['criticidad'],
  date: ['fecha de puesta en operacion', 'fecha', 'fecha puesta en operacion'],
  lifespan: ['vida util', 'vida util esperada'],
  lifespanUnit: ['unidad de vida util', 'unidad'],
  responsible: ['responsable'],
  operational: ['estado operativo', 'estado'],
  stage: ['etapa inicial', 'etapa de vida', 'etapa'],
}

const REQUIRED_HEADERS: HeaderKey[] = ['name', 'category', 'path', 'criticality', 'date']

// ============ Tipos ============

export type ParsedRow = {
  excelRow: number
  code: string
  name: string
  category: string
  path: string
  criticality: string
  date: string // YYYY-MM-DD (crudo si no se pudo normalizar)
  lifespan: string
  lifespanUnit: string
  responsible: string
  operational: string
  stage: string
}

export type ImportContext = {
  categories: CategoryRow[]
  locations: LocationRow[]
  users: UserLite[]
  existingCodes: Set<string>
}

export type ValidatedRow = {
  excelRow: number
  code: string | null
  name: string
  category: string
  path: string
  criticality: Criticality
  commissioningDate: string
  lifespanValue: number | null
  lifespanUnit: LifespanUnit | null
  responsible: string | null
  operational: OperationalStatus
  stage: LifeStage
}

export type RowIssue = { excelRow: number; message: string }

export type PreviewResult = {
  valid: ValidatedRow[]
  errors: RowIssue[]
  missingPaths: string[] // rutas con nodos inexistentes (orden de aparición)
}

export type ImportRowResult = { row: number; ok: boolean; code?: string; error?: string }

export type ImportResult = {
  created: number
  failed: number
  locations_created: number
  results: ImportRowResult[]
}

// ============ Helpers de texto/valores ============

/** Mayúsculas + sin acentos + espacios simples (comparación de etiquetas). */
export function normLabel(value: string): string {
  return value
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function reverseLabels(labels: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [value, label] of Object.entries(labels)) map.set(normLabel(label), value)
  return map
}

const CRITICALITY_BY_LABEL = reverseLabels(CRITICALITY_LABELS)
const OPERATIONAL_BY_LABEL = reverseLabels(OPERATIONAL_LABELS)
const STAGE_BY_LABEL = reverseLabels(LIFE_STAGE_LABELS)
const UNIT_BY_LABEL = reverseLabels(LIFESPAN_UNIT_LABELS)

/** Acepta etiqueta ("Alta") o valor canónico ("high"). */
function matchEnum(raw: string, byLabel: Map<string, string>, allowed: Set<string>): string | null {
  const key = normLabel(raw)
  if (!key) return null
  const viaLabel = byLabel.get(key)
  if (viaLabel) return viaLabel
  return allowed.has(raw.trim()) ? raw.trim() : null
}

const CRITICALITY_VALUES = new Set(['high', 'medium', 'low'])
const OPERATIONAL_VALUES = new Set(['operational', 'inactive'])
const STAGE_VALUES = new Set([
  'no_warranty',
  'under_warranty',
  'operational',
  'pending_repair',
  'requires_replacement',
  'decommissioned',
])
const UNIT_VALUES = new Set(['years', 'hours', 'cycles'])

// ============ Plantilla ============

const INSTRUCTIONS: string[] = [
  'CMMS Hotelero — Plantilla de importación masiva de activos (F1.12)',
  '',
  'COLUMNAS (fila 1 = encabezados; los datos empiezan en la fila 2):',
  '- Código: opcional. Déjalo vacío para autogenerar [Categoría]-[Ubicación]-[NNN].',
  '  Si lo escribes debe ser único en el sistema y en el archivo.',
  '- Nombre: obligatorio.',
  '- Categoría: obligatoria; escribe el nombre completo o el prefijo (ej. HVAC).',
  '  Debe existir y estar activa.',
  '- Ruta de ubicación: obligatoria, separada por "/" (ej. Torre 1/Piso 3/Habitación 301).',
  '  Puedes omitir el nombre del hotel raíz. Máximo 5 niveles.',
  '  Si la ruta tiene nodos inexistentes, la previsualización ofrece crearlos automáticamente.',
  '- Criticidad: Alta | Media | Baja.',
  '- Fecha de puesta en operación: obligatoria (dd/mm/aaaa o aaaa-mm-dd).',
  '- Vida útil: número mayor que cero; si indicas valor, también la unidad: Años | Horas | Ciclos.',
  '- Responsable: nombre completo de un usuario activo (opcional).',
  '- Estado operativo: Operativo | Inactivo (opcional; por defecto Operativo).',
  '- Etapa inicial: Sin garantía | En garantía | Operativo | Por Reparar |',
  '  Requiere reemplazo | Dado de baja (opcional; por defecto Sin garantía).',
  '',
  'REGLAS:',
  `- Máximo ${MAX_IMPORT_ROWS} filas por archivo.`,
  '- Solo activos raíz: sin componentes, garantías ni documentación.',
  '- Formato .xlsx solamente.',
  '- Las filas con error no bloquean la importación: se importan las válidas',
  '  y el reporte final lista las descartadas con su número de fila y motivo.',
]

export async function downloadImportTemplate(): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CMMS Hotelero'

  const data = wb.addWorksheet('Datos')
  data.addRow([...TEMPLATE_HEADERS])
  data.getRow(1).font = { bold: true }
  data.columns.forEach((column, index) => {
    column.width = index === 3 ? 34 : index === 0 ? 16 : 22
  })

  const info = wb.addWorksheet('Instrucciones')
  for (const line of INSTRUCTIONS) info.addRow([line])
  info.getColumn(1).width = 110

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'plantilla_importacion_activos.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}

// ============ Parseo ============

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return toIsoDate(value)
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const maybe = value as {
      richText?: Array<{ text?: string }>
      text?: unknown
      result?: unknown
      error?: unknown
    }
    if (Array.isArray(maybe.richText)) return maybe.richText.map((t) => t.text ?? '').join('').trim()
    if (maybe.text !== undefined) return String(maybe.text).trim()
    if (maybe.result !== undefined && maybe.result !== null) return String(maybe.result).trim()
    return ''
  }
  return String(value)
}

function toIsoDate(date: Date): string {
  // ExcelJS construye las fechas en UTC (medianoche Z); usar getters locales
  // correría la fecha un día atrás en zonas UTC-5.
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** dd/mm/aaaa | d/m/aa | aaaa-mm-dd → YYYY-MM-DD; si no, '' . */
function normalizeDate(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  if (match) {
    const [, y, m, d] = match
    return validYmd(y, m, d)
  }
  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value)
  if (match) {
    const [, d, m, y] = match
    return validYmd(y, m, d)
  }
  return ''
}

function validYmd(y: string, m: string, d: string): string {
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return ''
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Fecha de celda: Date de Excel, serial numérico o texto. */
function dateCellText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value instanceof Date) return toIsoDate(value)
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Serial de Excel (días desde 1899-12-30).
    const date = new Date(Math.round((value - 25569) * 86400000))
    if (!Number.isNaN(date.getTime())) {
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    }
  }
  return cellText(cell)
}

/**
 * Lee el .xlsx y devuelve las filas de datos con su número real de fila.
 * Lanza Error con mensaje en español si el archivo no es utilizable.
 */
export async function parseImportFile(file: File): Promise<ParsedRow[]> {
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error('El archivo debe ser .xlsx (Excel).')
  }
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(await file.arrayBuffer())
  } catch {
    throw new Error('No se pudo leer el archivo. Verifica que sea un .xlsx válido.')
  }
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error('El archivo no tiene hojas de datos.')

  // Encabezados (fila 1) → índice de columna.
  const headerRow = sheet.getRow(1)
  const columns = new Map<HeaderKey, number>()
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    // normLabel devuelve MAYÚSCULAS; los alias están en minúsculas → comparar en minúsculas.
    const key = normLabel(cellText(cell)).toLowerCase()
    if (!key) return
    for (const [headerKey, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && !columns.has(headerKey as HeaderKey)) {
        columns.set(headerKey as HeaderKey, colNumber)
      }
    }
  })

  const missing = REQUIRED_HEADERS.filter((key) => !columns.has(key))
  if (missing.length > 0) {
    const names = missing.map((key) => HEADER_ALIASES[key][0])
    throw new Error(`Faltan columnas obligatorias en la fila 1: ${names.join(', ')}.`)
  }

  const read = (row: ExcelJS.Row, key: HeaderKey): string => {
    const col = columns.get(key)
    if (!col) return ''
    const cell = row.getCell(col)
    return key === 'date' ? dateCellText(cell) : cellText(cell)
  }

  const rows: ParsedRow[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const parsed: ParsedRow = {
      excelRow: rowNumber,
      code: read(row, 'code'),
      name: read(row, 'name'),
      category: read(row, 'category'),
      path: read(row, 'path'),
      criticality: read(row, 'criticality'),
      date: read(row, 'date'),
      lifespan: read(row, 'lifespan'),
      lifespanUnit: read(row, 'lifespanUnit'),
      responsible: read(row, 'responsible'),
      operational: read(row, 'operational'),
      stage: read(row, 'stage'),
    }
    // Fila totalmente vacía → se ignora.
    if (
      !parsed.code &&
      !parsed.name &&
      !parsed.category &&
      !parsed.path &&
      !parsed.criticality &&
      !parsed.date
    ) {
      return
    }
    rows.push(parsed)
  })

  if (rows.length === 0) throw new Error('El archivo no tiene filas de datos.')
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Máximo ${MAX_IMPORT_ROWS} filas por importación (el archivo tiene ${rows.length}).`)
  }
  return rows
}

// ============ Resolución de ruta de ubicación ============

type PathResolution = {
  locationId: string | null // null → falta crear (o error fatal)
  missing: string[] // segmentos inexistentes desde el último existente
  error: string | null
}

export function resolveLocationPath(path: string, locations: LocationRow[]): PathResolution {
  const segments = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length === 0) return { locationId: null, missing: [], error: 'Falta la ruta de ubicación.' }

  const children = new Map<string, LocationRow[]>()
  for (const location of locations) {
    const list = children.get(location.parent_id ?? '') ?? []
    list.push(location)
    children.set(location.parent_id ?? '', list)
  }
  const roots = locations.filter((location) => location.parent_id === null)

  let best: { cursor: LocationRow; next: number } | null = null
  for (const root of roots) {
    let idx = 0
    if (normLabel(segments[0]) === normLabel(root.name)) idx = 1
    let cursor = root
    while (idx < segments.length) {
      const child = (children.get(cursor.id) ?? []).find(
        (location) => normLabel(location.name) === normLabel(segments[idx]),
      )
      if (!child) break
      if (!child.is_active) {
        return {
          locationId: null,
          missing: [],
          error: `La ubicación "${segments.slice(0, idx + 1).join(' / ')}" está desactivada.`,
        }
      }
      cursor = child
      idx += 1
    }
    if (idx === segments.length) return { locationId: cursor.id, missing: [], error: null }
    if (!best || idx > best.next) best = { cursor, next: idx }
  }

  if (!best) return { locationId: null, missing: [], error: `Ruta de ubicación no encontrada: ${path}` }

  const missing = segments.slice(best.next)
  if (best.cursor.depth + missing.length > 5) {
    return { locationId: null, missing: [], error: `La ruta "${path}" excede la profundidad máxima de 5 niveles.` }
  }
  return { locationId: null, missing, error: null }
}

// ============ Prevalidación ============

/**
 * Valida las filas parseadas contra el contexto (categorías/ubicaciones/
 * usuarios/códigos existentes). `createMissing` decide si las rutas con nodos
 * inexistentes son válidas (se crearán) o un error.
 */
export function validateImportRows(
  rows: ParsedRow[],
  ctx: ImportContext,
  createMissing: boolean,
): PreviewResult {
  const categoryByName = new Map<string, CategoryRow>()
  for (const category of ctx.categories) categoryByName.set(normLabel(category.name), category)
  // Acepta también el prefijo del código (ej. "HVAC" → "Climatización (HVAC)").
  for (const category of ctx.categories) {
    const key = normLabel(category.code_prefix)
    if (key && !categoryByName.has(key)) categoryByName.set(key, category)
  }

  const userByName = new Map<string, UserLite>()
  for (const user of ctx.users) userByName.set(normLabel(user.full_name), user)

  const valid: ValidatedRow[] = []
  const errors: RowIssue[] = []
  const missingSet = new Set<string>()
  const seenCodes = new Set<string>()

  for (const row of rows) {
    const name = row.name.trim()
    if (!name) {
      errors.push({ excelRow: row.excelRow, message: 'Falta el nombre.' })
      continue
    }

    const category = categoryByName.get(normLabel(row.category))
    if (!category) {
      errors.push({ excelRow: row.excelRow, message: `Categoría inexistente: "${row.category}".` })
      continue
    }
    if (!category.is_active) {
      errors.push({ excelRow: row.excelRow, message: `Categoría inactiva: "${row.category}".` })
      continue
    }

    const criticality = matchEnum(row.criticality, CRITICALITY_BY_LABEL, CRITICALITY_VALUES)
    if (!criticality) {
      errors.push({ excelRow: row.excelRow, message: `Criticidad inválida: "${row.criticality}".` })
      continue
    }

    const commissioningDate = normalizeDate(row.date)
    if (!commissioningDate) {
      errors.push({
        excelRow: row.excelRow,
        message: `Fecha de puesta en operación inválida: "${row.date}".`,
      })
      continue
    }

    let lifespanValue: number | null = null
    let lifespanUnit: LifespanUnit | null = null
    if (row.lifespan.trim()) {
      lifespanValue = Number(row.lifespan.replace(',', '.'))
      if (!Number.isFinite(lifespanValue) || lifespanValue <= 0) {
        errors.push({ excelRow: row.excelRow, message: 'La vida útil debe ser un número mayor que cero.' })
        continue
      }
      const unit = matchEnum(row.lifespanUnit, UNIT_BY_LABEL, UNIT_VALUES)
      if (!unit) {
        errors.push({
          excelRow: row.excelRow,
          message: `Unidad de vida útil inválida: "${row.lifespanUnit || '(vacía)'}".`,
        })
        continue
      }
      lifespanUnit = unit as LifespanUnit
    }

    let responsible: string | null = null
    if (row.responsible.trim()) {
      const user = userByName.get(normLabel(row.responsible))
      if (!user) {
        errors.push({ excelRow: row.excelRow, message: `Responsable no encontrado: "${row.responsible}".` })
        continue
      }
      if (!user.is_active) {
        errors.push({ excelRow: row.excelRow, message: `Responsable inactivo: "${row.responsible}".` })
        continue
      }
      responsible = user.full_name
    }

    let operational: OperationalStatus = 'operational'
    if (row.operational.trim()) {
      const value = matchEnum(row.operational, OPERATIONAL_BY_LABEL, OPERATIONAL_VALUES)
      if (!value) {
        errors.push({ excelRow: row.excelRow, message: `Estado operativo inválido: "${row.operational}".` })
        continue
      }
      operational = value as OperationalStatus
    }

    let stage: LifeStage = 'no_warranty'
    if (row.stage.trim()) {
      const value = matchEnum(row.stage, STAGE_BY_LABEL, STAGE_VALUES)
      if (!value) {
        errors.push({ excelRow: row.excelRow, message: `Etapa inicial inválida: "${row.stage}".` })
        continue
      }
      stage = value as LifeStage
    }

    let code: string | null = null
    if (row.code.trim()) {
      const key = normLabel(row.code)
      if (seenCodes.has(key)) {
        errors.push({ excelRow: row.excelRow, message: `Código repetido dentro del archivo: ${row.code.trim()}.` })
        continue
      }
      if (ctx.existingCodes.has(key)) {
        errors.push({ excelRow: row.excelRow, message: `El código ${row.code.trim()} ya existe en el sistema.` })
        continue
      }
      seenCodes.add(key)
      code = row.code.trim()
    }

    const resolution = resolveLocationPath(row.path, ctx.locations)
    if (resolution.error) {
      errors.push({ excelRow: row.excelRow, message: resolution.error })
      continue
    }
    if (resolution.locationId === null) {
      // Faltan nodos de la ruta.
      missingSet.add(row.path.trim())
      if (!createMissing) {
        errors.push({
          excelRow: row.excelRow,
          message: `Ubicación inexistente: ${resolution.missing.join(' / ')}`,
        })
        continue
      }
    }

    valid.push({
      excelRow: row.excelRow,
      code,
      name,
      category: category.name,
      path: row.path.trim(),
      criticality: criticality as Criticality,
      commissioningDate,
      lifespanValue,
      lifespanUnit,
      responsible,
      operational,
      stage,
    })
  }

  return { valid, errors, missingPaths: [...missingSet] }
}

// ============ Códigos existentes (unicidad vs BD en la previsualización) ============

/** Consulta en chunks los códigos del archivo que ya existen en la BD. */
export async function fetchExistingCodes(codes: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))]
  for (let i = 0; i < unique.length; i += 300) {
    const chunk = unique.slice(i, i + 300)
    const filter = chunk.map((code) => `"${code.replace(/"/g, '""')}"`).join(',')
    const response = await apiFetch(`/rest/v1/assets?select=code&code=in.(${encodeURIComponent(filter)})`)
    if (!response.ok) continue // mejor esfuerzo: el servidor re-valida igual
    const rows = (await response.json()) as Array<{ code: string }>
    for (const row of rows) out.add(normLabel(row.code))
  }
  return out
}

// ============ Commit ============

/**
 * Envía las filas válidas a la edge function (re-valida, crea ubicaciones
 * faltantes si aplica, inserta por lotes y escribe la auditoría consolidada).
 */
export async function importAssets(input: {
  filename: string
  createLocations: boolean
  rows: ValidatedRow[]
}): Promise<ImportResult> {
  const response = await apiFetch('/functions/v1/m1-import-assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: input.filename,
      create_locations: input.createLocations,
      rows: input.rows.map((row) => ({
        row: row.excelRow,
        code: row.code,
        name: row.name,
        category: row.category,
        path: row.path,
        criticality: row.criticality,
        commissioning_date: row.commissioningDate,
        lifespan_value: row.lifespanValue,
        lifespan_unit: row.lifespanUnit,
        responsible: row.responsible,
        operational_status: row.operational,
        life_stage: row.stage,
      })),
    }),
  })
  const data = (await response.json().catch(() => null)) as (ImportResult & { message?: string }) | null
  if (!response.ok) {
    throw new Error(data?.message ?? 'No se pudo ejecutar la importación.')
  }
  return data as ImportResult
}

// ============ Reporte de resultado ============

export type ReportSuccess = { row: number; code: string; name: string }
export type ReportFailure = { row: number; code: string | null; message: string }

/** Descarga el reporte .xlsx final: hoja Éxitos + hoja Errores. */
export async function downloadImportReport(input: {
  filename: string
  successes: ReportSuccess[]
  failures: ReportFailure[]
}): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CMMS Hotelero'

  const okSheet = wb.addWorksheet('Éxitos')
  okSheet.addRow(['Fila', 'Código', 'Nombre'])
  okSheet.getRow(1).font = { bold: true }
  for (const item of input.successes) okSheet.addRow([item.row, item.code, item.name])
  okSheet.columns.forEach((column, index) => {
    column.width = index === 2 ? 40 : 14
  })

  const errSheet = wb.addWorksheet('Errores')
  errSheet.addRow(['Fila', 'Código', 'Motivo'])
  errSheet.getRow(1).font = { bold: true }
  for (const item of input.failures) errSheet.addRow([item.row, item.code ?? '', item.message])
  errSheet.columns.forEach((column, index) => {
    column.width = index === 2 ? 70 : 16
  })

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = input.filename.replace(/\.xlsx$/i, '') + '_resultado.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}
