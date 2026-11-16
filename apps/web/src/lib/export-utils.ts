import ExcelJS from 'exceljs'
import { jsPDF } from 'jspdf'

export type ExportSection = {
  title: string
  headers: string[]
  rows: (string | number | null)[][]
}

export type ExportMeta = {
  title: string
  periodLabel?: string
  filtersLabel?: string
}

function headerLines(meta: ExportMeta): string[] {
  const lines = ['CMMS Hotelero', meta.title]
  if (meta.periodLabel) lines.push(`Período: ${meta.periodLabel}`)
  if (meta.filtersLabel) lines.push(`Filtros: ${meta.filtersLabel}`)
  lines.push(`Exportado: ${new Date().toLocaleDateString('es-CO')}`)
  return lines
}

function sanitizeFilename(base: string): string {
  return base.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'reporte'
}

export async function exportExcel(meta: ExportMeta, sections: ExportSection[], filenameBase: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CMMS Hotelero'
  for (const sec of sections) {
    const ws = wb.addWorksheet(sec.title.slice(0, 31))
    for (const line of headerLines(meta)) ws.addRow([line])
    ws.addRow([])
    ws.addRow(sec.headers)
    for (const row of sec.rows) ws.addRow(row)
    const headerRow = ws.lastRow ? ws.lastRow.number - sec.rows.length : 4
    ws.getRow(headerRow).font = { bold: true }
  }
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitizeFilename(filenameBase)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportPdf(meta: ExportMeta, sections: ExportSection[], filenameBase: string): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  let y = 50
  const write = (text: string, size: number, bold = false) => {
    if (y > 760) {
      doc.addPage()
      y = 50
    }
    doc.setFontSize(size)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(text, 40, y)
    y += size + 6
  }
  for (const line of headerLines(meta)) write(line, line === 'CMMS Hotelero' ? 16 : 11, line === 'CMMS Hotelero')
  y += 6
  for (const sec of sections) {
    write(sec.title, 12, true)
    write(sec.headers.join(' | '), 9, true)
    for (const row of sec.rows.slice(0, 80)) {
      write(row.map((c) => (c === null ? '' : String(c))).join(' | '), 8)
    }
    y += 8
  }
  doc.save(`${sanitizeFilename(filenameBase)}.pdf`)
}
