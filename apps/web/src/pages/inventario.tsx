import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeftRight,
  Eye,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tags,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/auth-store'
import { exportExcel, exportPdf, type ExportSection } from '@/lib/export-utils'
import { fetchProvidersLite, type ProviderLite } from '@/lib/m2'
import { fetchUsersLite, formatDate, formatDateTime, type UserLite } from '@/lib/m1'
import {
  countScopeLabel,
  COUNT_STATUS_BADGE_CLASS,
  COUNT_STATUS_LABELS,
  fetchCounts,
  fetchItemCategories,
  fetchItems,
  fetchKardex,
  fetchStockCells,
  fetchWarehouses,
  formatMoney,
  formatQty,
  isTabId,
  MOVEMENT_TYPE_LABELS,
  TAB_IDS,
  TAB_LABELS,
  UNIT_LABELS,
  type CountRow,
  type ItemCategoryRow,
  type ItemRow,
  type KardexRow,
  type StockCellRow,
  type TabId,
  type WarehouseRow,
} from '@/lib/m4'
import { ItemCategoriesDialog } from '@/components/inventario/item-categories-dialog'
import { AdjustDialog, EntryDialog, TransferDialog } from '@/components/inventario/movement-dialogs'
import { MovementDetailDialog } from '@/components/inventario/movement-detail-dialog'
import { WarehouseDialog } from '@/components/inventario/warehouse-dialog'

const PAGE_SIZES = [20, 40, 60, 100]

type ItemFilters = {
  query: string
  category: string
  warehouse: string
  state: string
  lowOnly: boolean
}

const EMPTY_ITEM_FILTERS: ItemFilters = {
  query: '',
  category: 'todas',
  warehouse: 'todas',
  state: 'todos',
  lowOnly: false,
}

type StockFilters = {
  warehouse: string
  category: string
  lowOnly: boolean
  negativeOnly: boolean
}

const EMPTY_STOCK_FILTERS: StockFilters = {
  warehouse: 'todas',
  category: 'todas',
  lowOnly: false,
  negativeOnly: false,
}

type KardexPreset = 'hoy' | '7d' | '30d' | 'custom'

function shiftDate(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function presetRange(preset: KardexPreset, customFrom: string, customTo: string) {
  const today = shiftDate(0)
  if (preset === 'hoy') return { from: today, to: shiftDate(1) }
  if (preset === '7d') return { from: shiftDate(-6), to: shiftDate(1) }
  if (preset === '30d') return { from: shiftDate(-29), to: shiftDate(1) }
  // Personalizado: `to` es EXCLUSIVO (occurred_at < to) → día siguiente.
  let to: string | undefined
  if (customTo) {
    const date = new Date(`${customTo}T00:00:00`)
    date.setDate(date.getDate() + 1)
    to = date.toISOString().slice(0, 10)
  }
  return { from: customFrom || undefined, to }
}

function PaginationBar({
  total,
  page,
  pageSize,
  onPage,
  onSize,
}: {
  total: number
  page: number
  pageSize: number
  onPage: (page: number) => void
  onSize: (size: number) => void
}) {
  if (total === 0) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const rangeStart = (safePage - 1) * pageSize + 1
  const rangeEnd = Math.min(safePage * pageSize, total)
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
      <span className="tabular-nums">
        {rangeStart}–{rangeEnd} de {total}
      </span>
      <div className="flex items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(value) => onSize(Number(value))}>
          <SelectTrigger className="w-[130px]" aria-label="Cantidad por página">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} por página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => onPage(safePage - 1)}>
          Anterior
        </Button>
        <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => onPage(safePage + 1)}>
          Siguiente
        </Button>
      </div>
    </div>
  )
}

export default function Inventario() {
  const roles = useAuth((s) => s.roles)
  const canEdit = roles.includes('mantenimiento')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'items')
  const [segment, setSegment] = useState<'stock' | 'kardex'>('stock')

  const [items, setItems] = useState<ItemRow[]>([])
  const [categories, setCategories] = useState<ItemCategoryRow[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [stockCells, setStockCells] = useState<StockCellRow[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [providers, setProviders] = useState<ProviderLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [itemFilters, setItemFilters] = useState<ItemFilters>(EMPTY_ITEM_FILTERS)
  const [itemPage, setItemPage] = useState(1)
  const [itemPageSize, setItemPageSize] = useState(20)

  const [stockFilters, setStockFilters] = useState<StockFilters>(EMPTY_STOCK_FILTERS)
  const [kardexPreset, setKardexPreset] = useState<KardexPreset>('30d')
  const [kardexFrom, setKardexFrom] = useState('')
  const [kardexTo, setKardexTo] = useState('')
  const [kardexWarehouse, setKardexWarehouse] = useState('todas')
  const [kardexItem, setKardexItem] = useState('todos')
  const [kardexType, setKardexType] = useState('todos')
  const [kardexWo, setKardexWo] = useState('')
  const [kardex, setKardex] = useState<KardexRow[]>([])
  const [kardexLoading, setKardexLoading] = useState(false)
  const [kardexError, setKardexError] = useState<string | null>(null)
  const [kardexKey, setKardexKey] = useState(0)

  const [warehouseDialog, setWarehouseDialog] = useState<
    { type: 'create' } | { type: 'edit'; warehouse: WarehouseRow } | null
  >(null)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [entryOpen, setEntryOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [preselect, setPreselect] = useState<{ itemId?: string; warehouseId?: string }>({})
  const [detailRow, setDetailRow] = useState<KardexRow | null>(null)

  function exportKardex(format: 'pdf' | 'excel') {
    const section: ExportSection = {
      title: 'Kardex de inventario',
      headers: ['Fecha/hora', 'Tipo', 'Ítem', 'Bodega', 'Cantidad', 'Costo unit.', 'Total', 'Referencia', 'Usuario'],
      rows: kardex.map((row) => [
        formatDateTime(row.occurred_at),
        MOVEMENT_TYPE_LABELS[row.type] ?? row.type,
        `${row.item_code} — ${row.item_name}`,
        row.destiny_warehouse_name ? `${row.warehouse_name} → ${row.destiny_warehouse_name}` : row.warehouse_name,
        formatQty(row.qty),
        formatMoney(row.unit_cost),
        formatMoney(row.line_total),
        row.wo_number ?? row.document_number ?? row.reason ?? '',
        row.user_name ?? '',
      ]),
    }
    const meta = { title: 'Kardex de inventario', filtersLabel: `${kardex.length} movimiento(s)` }
    if (format === 'pdf') void exportPdf(meta, [section], 'kardex')
    else void exportExcel(meta, [section], 'kardex')
  }

  useEffect(() => {
    let alive = true
    Promise.all([
      fetchItems(),
      fetchItemCategories(),
      fetchWarehouses(),
      fetchStockCells(),
      fetchCounts(),
      fetchUsersLite(),
      fetchProvidersLite(),
    ])
      .then(([itemRows, categoryRows, warehouseRows, cellRows, countRows, userRows, providerRows]) => {
        if (!alive) return
        setItems(itemRows)
        setCategories(categoryRows)
        setWarehouses(warehouseRows)
        setStockCells(cellRows)
        setCounts(countRows)
        setUsers(userRows)
        setProviders(providerRows)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Error al cargar el módulo.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  function refresh() {
    setLoading(true)
    setError(null)
    setReloadKey((key) => key + 1)
  }

  function changeTab(next: TabId) {
    setTab(next)
    setItemPage(1)
    const params = new URLSearchParams(searchParams)
    params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  function openEntry(itemId?: string, warehouseId?: string) {
    setPreselect({ itemId, warehouseId })
    setEntryOpen(true)
  }

  function openAdjust(itemId?: string, warehouseId?: string) {
    setPreselect({ itemId, warehouseId })
    setAdjustOpen(true)
  }

  function openTransfer(itemId?: string, warehouseId?: string) {
    setPreselect({ itemId, warehouseId })
    setTransferOpen(true)
  }

  // ============ Pestaña Ítems ============

  const filteredItems = useMemo(() => {
    const query = itemFilters.query.trim().toLowerCase()
    const warehouseFilter = itemFilters.warehouse
    const itemWarehouses = new Map<string, StockCellRow[]>()
    for (const cell of stockCells) {
      const list = itemWarehouses.get(cell.item_id) ?? []
      list.push(cell)
      itemWarehouses.set(cell.item_id, list)
    }
    return items.filter((item) => {
      if (query && !item.code.toLowerCase().includes(query) && !item.name.toLowerCase().includes(query)) {
        return false
      }
      if (itemFilters.category !== 'todas' && item.item_category_id !== itemFilters.category) return false
      if (itemFilters.state === 'active' && !item.is_active) return false
      if (itemFilters.state === 'inactive' && item.is_active) return false
      if (itemFilters.lowOnly && !item.has_low) return false
      if (warehouseFilter !== 'todas') {
        const cells = itemWarehouses.get(item.id) ?? []
        if (!cells.some((cell) => cell.warehouse_id === warehouseFilter)) return false
      }
      return true
    })
  }, [items, stockCells, itemFilters])

  useEffect(() => {
    setItemPage(1)
  }, [itemFilters])

  const itemTotalPages = Math.max(1, Math.ceil(filteredItems.length / itemPageSize))
  const safeItemPage = Math.min(itemPage, itemTotalPages)
  const pageItems = filteredItems.slice(
    (safeItemPage - 1) * itemPageSize,
    safeItemPage * itemPageSize,
  )

  // ============ Pestaña Bodegas ============

  const stockCountByWarehouse = useMemo(() => {
    const map = new Map<string, number>()
    for (const cell of stockCells) {
      if (Number(cell.qty) !== 0) {
        map.set(cell.warehouse_id, (map.get(cell.warehouse_id) ?? 0) + 1)
      }
    }
    return map
  }, [stockCells])

  // ============ Segmento Stock ============

  const stockMatrix = useMemo(() => {
    const visibleWarehouses = warehouses.filter(
      (wh) => stockFilters.warehouse === 'todas' || wh.id === stockFilters.warehouse,
    )
    const warehouseIds = new Set(visibleWarehouses.map((wh) => wh.id))
    const byItem = new Map<string, { item: ItemRow; cells: Map<string, StockCellRow> }>()
    for (const cell of stockCells) {
      if (!warehouseIds.has(cell.warehouse_id)) continue
      if (stockFilters.category !== 'todas' && cell.item_category_id !== stockFilters.category) continue
      if (stockFilters.negativeOnly && !cell.is_negative) continue
      let entry = byItem.get(cell.item_id)
      if (!entry) {
        const item = items.find((row) => row.id === cell.item_id)
        if (!item) continue
        entry = { item, cells: new Map() }
        byItem.set(cell.item_id, entry)
      }
      entry.cells.set(cell.warehouse_id, cell)
    }
    const rows = [...byItem.values()].filter((entry) => {
      if (stockFilters.lowOnly) {
        return [...entry.cells.values()].some((cell) => cell.is_low)
      }
      return true
    })
    rows.sort((a, b) => a.item.code.localeCompare(b.item.code, 'es'))
    return { visibleWarehouses, rows }
  }, [stockCells, items, warehouses, stockFilters])

  // ============ Segmento Kardex (fetch con filtros) ============

  useEffect(() => {
    if (tab !== 'stock_kardex' || segment !== 'kardex') return
    let alive = true
    setKardexLoading(true)
    setKardexError(null)
    const range = presetRange(kardexPreset, kardexFrom, kardexTo)
    fetchKardex({
      from: range.from,
      to: range.to,
      warehouseId: kardexWarehouse !== 'todas' ? kardexWarehouse : undefined,
      itemId: kardexItem !== 'todos' ? kardexItem : undefined,
      type: kardexType !== 'todos' ? kardexType : undefined,
      woNumber: kardexWo.trim() || undefined,
    })
      .then((rows) => {
        if (alive) setKardex(rows)
      })
      .catch((err: unknown) => {
        if (alive) setKardexError(err instanceof Error ? err.message : 'No se pudo cargar el kardex.')
      })
      .finally(() => {
        if (alive) setKardexLoading(false)
      })
    return () => {
      alive = false
    }
  }, [
    tab,
    segment,
    kardexKey,
    kardexPreset,
    kardexFrom,
    kardexTo,
    kardexWarehouse,
    kardexItem,
    kardexType,
    kardexWo,
  ])

  const itemCostById = useMemo(() => new Map(items.map((row) => [row.id, row.unit_cost])), [items])

  const headerActions = canEdit && (
    <>
      <Button variant="outline" size="sm" onClick={() => setCategoriesOpen(true)}>
        <Tags />
        Categorías
      </Button>
      <Button variant="outline" size="sm" onClick={() => openAdjust()}>
        <SlidersHorizontal />
        Ajustar
      </Button>
      <Button variant="outline" size="sm" onClick={() => openTransfer()}>
        <ArrowLeftRight />
        Transferir
      </Button>
      <Button variant="outline" size="sm" onClick={() => openEntry()}>
        <PackagePlus />
        Registrar entrada
      </Button>
      <Button onClick={() => navigate('/app/inventario/item/nuevo')}>
        <Plus />
        Nuevo ítem
      </Button>
    </>
  )

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Módulo 4 · Inventario de repuestos
            </p>
            <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
              Inventario
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              {items.length} {items.length === 1 ? 'ítem registrado' : 'ítems registrados'} ·{' '}
              {warehouses.filter((wh) => wh.is_active).length} bodegas activas ·{' '}
              {counts.filter((count) => count.status === 'in_progress').length} conteos en proceso
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} aria-label="Actualizar">
              <RefreshCw />
              Actualizar
            </Button>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/app/inventario/conteo/nuevo')}
              >
                Conteo físico
              </Button>
            )}
            {headerActions}
          </div>
        </div>

        <div className="mt-6">
          <Tabs value={tab} onValueChange={(value) => changeTab(value as TabId)}>
            <TabsList>
              {TAB_IDS.map((id) => (
                <TabsTrigger key={id} value={id}>
                  {TAB_LABELS[id]}
                  {id === 'counts' &&
                    counts.filter((count) => count.status === 'in_progress').length > 0 && (
                      <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[11.5px] font-semibold text-primary">
                        {counts.filter((count) => count.status === 'in_progress').length}
                      </span>
                    )}
                </TabsTrigger>
              ))}
            </TabsList>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[14px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando inventario…
              </div>
            ) : error ? (
              <div className="py-16 text-center">
                <p className="text-[14px] text-destructive">{error}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={refresh}>
                  Reintentar
                </Button>
              </div>
            ) : (
              <>
                {/* ============ Ítems ============ */}
                <TabsContent value="items" className="mt-5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        aria-label="Buscar por código o nombre"
                        placeholder="Buscar código o nombre…"
                        className="pl-9"
                        value={itemFilters.query}
                        onChange={(event) =>
                          setItemFilters((f) => ({ ...f, query: event.target.value }))
                        }
                      />
                    </div>

                    <Select
                      value={itemFilters.category}
                      onValueChange={(value) => setItemFilters((f) => ({ ...f, category: value }))}
                    >
                      <SelectTrigger className="w-[175px]" aria-label="Filtrar por categoría">
                        <SelectValue placeholder="Categoría" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas las categorías</SelectItem>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                            {category.is_active ? '' : ' (inactiva)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={itemFilters.warehouse}
                      onValueChange={(value) => setItemFilters((f) => ({ ...f, warehouse: value }))}
                    >
                      <SelectTrigger className="w-[165px]" aria-label="Filtrar por bodega">
                        <SelectValue placeholder="Bodega" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas las bodegas</SelectItem>
                        {warehouses.map((wh) => (
                          <SelectItem key={wh.id} value={wh.id}>
                            {wh.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={itemFilters.state}
                      onValueChange={(value) => setItemFilters((f) => ({ ...f, state: value }))}
                    >
                      <SelectTrigger className="w-[130px]" aria-label="Filtrar por estado">
                        <SelectValue placeholder="Estado" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="active">Activo</SelectItem>
                        <SelectItem value="inactive">Inactivo</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      variant={itemFilters.lowOnly ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setItemFilters((f) => ({ ...f, lowOnly: !f.lowOnly }))}
                    >
                      Bajo mínimo
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setItemFilters(EMPTY_ITEM_FILTERS)}
                    >
                      Limpiar
                    </Button>
                  </div>

                  <p className="mt-3 text-[12.5px] text-muted-foreground">
                    {filteredItems.length} {filteredItems.length === 1 ? 'resultado' : 'resultados'}
                  </p>

                  <div className="mt-3 overflow-hidden rounded-lg border border-border">
                    {filteredItems.length === 0 ? (
                      <div className="px-6 py-14 text-center">
                        <p className="text-[14px] text-muted-foreground">
                          {items.length === 0 ? 'Sin ítems registrados.' : 'Sin resultados con los filtros aplicados.'}
                        </p>
                        {canEdit && items.length === 0 && (
                          <Button className="mt-4" onClick={() => navigate('/app/inventario/item/nuevo')}>
                            <Plus />
                            Nuevo ítem
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Código</TableHead>
                            <TableHead>Nombre</TableHead>
                            <TableHead className="hidden lg:table-cell">Categoría</TableHead>
                            <TableHead className="hidden md:table-cell">Unidad</TableHead>
                            <TableHead className="hidden md:table-cell text-right">Costo unit.</TableHead>
                            <TableHead>Stock total</TableHead>
                            <TableHead className="hidden xl:table-cell text-right">Mín. total</TableHead>
                            <TableHead className="hidden xl:table-cell">Proveedor</TableHead>
                            <TableHead className="hidden sm:table-cell">Estado</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pageItems.map((item) => (
                            <TableRow
                              key={item.id}
                              className="cursor-pointer"
                              onClick={() => navigate(`/app/inventario/item/${item.id}`)}
                            >
                              <TableCell className="font-mono text-[12.5px] font-medium">
                                {item.code}
                              </TableCell>
                              <TableCell className="font-medium">{item.name}</TableCell>
                              <TableCell className="hidden text-[13px] text-muted-foreground lg:table-cell">
                                {item.category_name ?? '—'}
                              </TableCell>
                              <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                                {UNIT_LABELS[item.unit]}
                              </TableCell>
                              <TableCell className="hidden text-right text-[13px] tabular-nums md:table-cell">
                                {formatMoney(item.unit_cost)}
                              </TableCell>
                              <TableCell>
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className={`tabular-nums ${item.has_negative ? 'font-semibold text-destructive' : ''}`}
                                  >
                                    {formatQty(item.stock_total)}
                                  </span>
                                  {item.has_negative && (
                                    <Badge variant="destructive" className="text-[11px]">
                                      negativo
                                    </Badge>
                                  )}
                                  {!item.has_negative && item.has_low && item.warehouse_count > 0 && (
                                    <Badge variant="outline" className="text-[11px] text-amber-700 dark:text-amber-400">
                                      bajo mínimo
                                    </Badge>
                                  )}
                                </span>
                              </TableCell>
                              <TableCell className="hidden text-right text-[13px] text-muted-foreground tabular-nums xl:table-cell">
                                {formatQty(item.min_total)}
                              </TableCell>
                              <TableCell className="hidden max-w-[160px] truncate text-[13px] text-muted-foreground xl:table-cell">
                                {item.preferred_provider_name ?? '—'}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                <Badge variant={item.is_active ? 'secondary' : 'outline'}>
                                  {item.is_active ? 'Activo' : 'Inactivo'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>

                  <PaginationBar
                    total={filteredItems.length}
                    page={safeItemPage}
                    pageSize={itemPageSize}
                    onPage={setItemPage}
                    onSize={(size) => {
                      setItemPageSize(size)
                      setItemPage(1)
                    }}
                  />
                </TabsContent>

                {/* ============ Bodegas ============ */}
                <TabsContent value="warehouses" className="mt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[13px] text-muted-foreground">
                      {warehouses.length} {warehouses.length === 1 ? 'bodega' : 'bodegas'} · el
                      nombre es único; sin borrado físico (baja lógica).
                    </p>
                    {canEdit && (
                      <Button size="sm" onClick={() => setWarehouseDialog({ type: 'create' })}>
                        <Plus />
                        Nueva bodega
                      </Button>
                    )}
                  </div>

                  <div className="mt-3 overflow-hidden rounded-lg border border-border">
                    {warehouses.length === 0 ? (
                      <div className="px-6 py-14 text-center">
                        <p className="text-[14px] text-muted-foreground">Sin bodegas registradas.</p>
                        {canEdit && (
                          <Button className="mt-4" onClick={() => setWarehouseDialog({ type: 'create' })}>
                            <Plus />
                            Nueva bodega
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nombre</TableHead>
                            <TableHead className="hidden lg:table-cell">Descripción</TableHead>
                            <TableHead className="hidden md:table-cell">Responsable</TableHead>
                            <TableHead className="text-right">Ítems con stock</TableHead>
                            <TableHead>Estado</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {warehouses.map((wh) => (
                            <TableRow
                              key={wh.id}
                              className={canEdit ? 'cursor-pointer' : undefined}
                              onClick={() => {
                                if (canEdit) setWarehouseDialog({ type: 'edit', warehouse: wh })
                              }}
                            >
                              <TableCell className="font-medium">{wh.name}</TableCell>
                              <TableCell className="hidden max-w-[280px] truncate text-[13px] text-muted-foreground lg:table-cell">
                                {wh.description ?? '—'}
                              </TableCell>
                              <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                                {wh.responsible_name ?? '—'}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {stockCountByWarehouse.get(wh.id) ?? 0}
                              </TableCell>
                              <TableCell>
                                <Badge variant={wh.is_active ? 'secondary' : 'outline'}>
                                  {wh.is_active ? 'Activa' : 'Inactiva'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </TabsContent>

                {/* ============ Stock y Kardex ============ */}
                <TabsContent value="stock_kardex" className="mt-5">
                  <Tabs
                    value={segment}
                    onValueChange={(value) => setSegment(value as 'stock' | 'kardex')}
                  >
                    <TabsList variant="line">
                      <TabsTrigger value="stock">Stock actual</TabsTrigger>
                      <TabsTrigger value="kardex">Kardex</TabsTrigger>
                    </TabsList>

                    <TabsContent value="stock" className="mt-4">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Select
                          value={stockFilters.warehouse}
                          onValueChange={(value) => setStockFilters((f) => ({ ...f, warehouse: value }))}
                        >
                          <SelectTrigger className="w-[165px]" aria-label="Filtrar bodega">
                            <SelectValue placeholder="Bodega" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todas">Todas las bodegas</SelectItem>
                            {warehouses.map((wh) => (
                              <SelectItem key={wh.id} value={wh.id}>
                                {wh.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={stockFilters.category}
                          onValueChange={(value) => setStockFilters((f) => ({ ...f, category: value }))}
                        >
                          <SelectTrigger className="w-[175px]" aria-label="Filtrar categoría">
                            <SelectValue placeholder="Categoría" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todas">Todas las categorías</SelectItem>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Button
                          variant={stockFilters.lowOnly ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setStockFilters((f) => ({ ...f, lowOnly: !f.lowOnly }))}
                        >
                          Bajo mínimo
                        </Button>
                        <Button
                          variant={stockFilters.negativeOnly ? 'destructive' : 'outline'}
                          size="sm"
                          onClick={() => setStockFilters((f) => ({ ...f, negativeOnly: !f.negativeOnly }))}
                        >
                          Negativos
                        </Button>
                      </div>

                      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Ítem</TableHead>
                              {stockMatrix.visibleWarehouses.map((wh) => (
                                <TableHead key={wh.id} className="text-right">
                                  {wh.name}
                                </TableHead>
                              ))}
                              <TableHead className="w-[150px]" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {stockMatrix.rows.length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={stockMatrix.visibleWarehouses.length + 2}
                                  className="py-10 text-center text-[13px] text-muted-foreground"
                                >
                                  Sin existencias ni mínimos definidos con los filtros aplicados.
                                </TableCell>
                              </TableRow>
                            ) : (
                              stockMatrix.rows.map(({ item, cells }) => (
                                <TableRow key={item.id}>
                                  <TableCell className="cursor-pointer" onClick={() => navigate(`/app/inventario/item/${item.id}`)}>
                                    <span className="font-mono text-[12px]">{item.code}</span>{' '}
                                    <span className="font-medium">{item.name}</span>
                                  </TableCell>
                                  {stockMatrix.visibleWarehouses.map((wh) => {
                                    const cell = cells.get(wh.id)
                                    if (!cell) {
                                      return <TableCell key={wh.id} className="text-right text-muted-foreground">—</TableCell>
                                    }
                                    return (
                                      <TableCell
                                        key={wh.id}
                                        className="text-right tabular-nums"
                                        title={`Mínimo: ${formatQty(cell.min_stock)}`}
                                      >
                                        <span className={cell.is_negative ? 'font-semibold text-destructive' : ''}>
                                          {formatQty(cell.qty)}
                                        </span>
                                        {cell.is_low && (
                                          <span className="ml-1 text-amber-600 dark:text-amber-400" title="Bajo mínimo">
                                            ⚠
                                          </span>
                                        )}
                                      </TableCell>
                                    )
                                  })}
                                  <TableCell>
                                    <div className="flex items-center justify-end gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Ver ítem"
                                        onClick={() => navigate(`/app/inventario/item/${item.id}`)}
                                      >
                                        <Eye />
                                      </Button>
                                      {canEdit && (
                                        <>
                                          <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label="Registrar entrada"
                                            onClick={() => openEntry(item.id)}
                                          >
                                            <PackagePlus />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label="Ajustar"
                                            onClick={() => openAdjust(item.id)}
                                          >
                                            <SlidersHorizontal />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label="Transferir"
                                            onClick={() => openTransfer(item.id)}
                                          >
                                            <ArrowLeftRight />
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </TabsContent>

                    <TabsContent value="kardex" className="mt-4">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Select value={kardexPreset} onValueChange={(value) => setKardexPreset(value as KardexPreset)}>
                          <SelectTrigger className="w-[150px]" aria-label="Rango de fechas">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hoy">Hoy</SelectItem>
                            <SelectItem value="7d">Últimos 7 días</SelectItem>
                            <SelectItem value="30d">Últimos 30 días</SelectItem>
                            <SelectItem value="custom">Personalizado</SelectItem>
                          </SelectContent>
                        </Select>

                        {kardexPreset === 'custom' && (
                          <>
                            <Input
                              type="date"
                              aria-label="Desde"
                              className="w-[150px]"
                              value={kardexFrom}
                              onChange={(event) => setKardexFrom(event.target.value)}
                            />
                            <Input
                              type="date"
                              aria-label="Hasta"
                              className="w-[150px]"
                              value={kardexTo}
                              onChange={(event) => setKardexTo(event.target.value)}
                            />
                          </>
                        )}

                        <Select value={kardexWarehouse} onValueChange={setKardexWarehouse}>
                          <SelectTrigger className="w-[160px]" aria-label="Filtrar bodega">
                            <SelectValue placeholder="Bodega" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todas">Todas las bodegas</SelectItem>
                            {warehouses.map((wh) => (
                              <SelectItem key={wh.id} value={wh.id}>
                                {wh.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select value={kardexItem} onValueChange={setKardexItem}>
                          <SelectTrigger className="w-[190px]" aria-label="Filtrar ítem">
                            <SelectValue placeholder="Ítem" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todos">Todos los ítems</SelectItem>
                            {items.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.code} — {item.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select value={kardexType} onValueChange={setKardexType}>
                          <SelectTrigger className="w-[185px]" aria-label="Filtrar tipo">
                            <SelectValue placeholder="Tipo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todos">Todos los tipos</SelectItem>
                            {(Object.entries(MOVEMENT_TYPE_LABELS) as Array<[string, string]>).map(
                              ([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>

                        <Input
                          aria-label="Nº de OT"
                          placeholder="Nº de OT…"
                          className="w-[130px]"
                          value={kardexWo}
                          onChange={(event) => setKardexWo(event.target.value)}
                        />

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setKardexKey((key) => key + 1)}
                          aria-label="Recargar kardex"
                        >
                          <RefreshCw />
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          disabled={kardex.length === 0}
                          title="Exportar el kardex filtrado a PDF."
                          onClick={() => exportKardex('pdf')}
                        >
                          PDF
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={kardex.length === 0}
                          title="Exportar el kardex filtrado a Excel."
                          onClick={() => exportKardex('excel')}
                        >
                          Excel
                        </Button>
                      </div>

                      <div className="mt-3 overflow-hidden rounded-lg border border-border">
                        {kardexLoading ? (
                          <div className="flex items-center justify-center gap-2 py-14 text-[14px] text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Cargando kardex…
                          </div>
                        ) : kardexError ? (
                          <div className="px-6 py-10 text-center">
                            <p className="text-[14px] text-destructive">{kardexError}</p>
                          </div>
                        ) : kardex.length === 0 ? (
                          <div className="px-6 py-14 text-center">
                            <p className="text-[14px] text-muted-foreground">
                              Sin movimientos con los filtros aplicados.
                            </p>
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Fecha / hora</TableHead>
                                <TableHead>Tipo</TableHead>
                                <TableHead className="hidden md:table-cell">Ítem</TableHead>
                                <TableHead className="hidden sm:table-cell">Bodega</TableHead>
                                <TableHead className="text-right">Cantidad</TableHead>
                                <TableHead className="hidden lg:table-cell text-right">Costo unit.</TableHead>
                                <TableHead className="hidden lg:table-cell text-right">Total</TableHead>
                                <TableHead className="hidden xl:table-cell">Referencia</TableHead>
                                <TableHead className="hidden 2xl:table-cell">Usuario</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {kardex.map((row) => (
                                <TableRow
                                  key={row.id}
                                  className="cursor-pointer"
                                  onClick={() => setDetailRow(row)}
                                >
                                  <TableCell className="text-[13px]">
                                    {formatDateTime(row.occurred_at)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        row.type === 'entrada'
                                          ? 'secondary'
                                          : row.type === 'salida_ot'
                                            ? 'outline'
                                            : row.type === 'ajuste'
                                              ? 'default'
                                              : 'outline'
                                      }
                                    >
                                      {MOVEMENT_TYPE_LABELS[row.type]}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="hidden max-w-[220px] truncate text-[13px] md:table-cell">
                                    <span className="font-mono text-[12px]">{row.item_code}</span>{' '}
                                    {row.item_name}
                                  </TableCell>
                                  <TableCell className="hidden max-w-[180px] truncate text-[13px] text-muted-foreground sm:table-cell">
                                    {row.warehouse_name}
                                    {row.destiny_warehouse_name && (
                                      <span> → {row.destiny_warehouse_name}</span>
                                    )}
                                  </TableCell>
                                  <TableCell
                                    className={`text-right tabular-nums ${Number(row.qty) < 0 ? 'text-destructive' : ''}`}
                                  >
                                    {formatQty(row.qty)}
                                  </TableCell>
                                  <TableCell className="hidden text-right text-[13px] tabular-nums lg:table-cell">
                                    {formatMoney(row.unit_cost)}
                                  </TableCell>
                                  <TableCell className="hidden text-right text-[13px] tabular-nums lg:table-cell">
                                    {formatMoney(row.line_total)}
                                  </TableCell>
                                  <TableCell className="hidden max-w-[160px] truncate text-[13px] text-muted-foreground xl:table-cell">
                                    {row.wo_number ?? row.document_number ?? row.reason ?? '—'}
                                  </TableCell>
                                  <TableCell className="hidden text-[13px] text-muted-foreground 2xl:table-cell">
                                    {row.user_name ?? '—'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                      <p className="mt-3 text-[12.5px] text-muted-foreground">
                        {kardex.length} movimientos · el kardex es append-only: una corrección es un
                        nuevo Ajuste.
                      </p>
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                {/* ============ Conteo físico ============ */}
                <TabsContent value="counts" className="mt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[13px] text-muted-foreground">
                      Toma de inventario por bodega (F4.8). Al confirmar se generan los Ajustes con
                      motivo «Conteo físico».
                    </p>
                    {canEdit && (
                      <Button size="sm" onClick={() => navigate('/app/inventario/conteo/nuevo')}>
                        <Plus />
                        Nuevo conteo
                      </Button>
                    )}
                  </div>

                  <div className="mt-3 overflow-hidden rounded-lg border border-border">
                    {counts.length === 0 ? (
                      <div className="px-6 py-14 text-center">
                        <p className="text-[14px] text-muted-foreground">Sin conteos registrados.</p>
                        {canEdit && (
                          <Button className="mt-4" onClick={() => navigate('/app/inventario/conteo/nuevo')}>
                            <Plus />
                            Nuevo conteo
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Bodega</TableHead>
                            <TableHead className="hidden md:table-cell">Alcance</TableHead>
                            <TableHead className="hidden md:table-cell">Responsable</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="text-right">Con diferencia</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {counts.map((count) => (
                            <TableRow
                              key={count.id}
                              className="cursor-pointer"
                              onClick={() => navigate(`/app/inventario/conteo/${count.id}`)}
                            >
                              <TableCell className="text-[13px]">{formatDate(count.count_date)}</TableCell>
                              <TableCell className="font-medium">{count.warehouse_name}</TableCell>
                              <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                                {countScopeLabel(count)}
                              </TableCell>
                              <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                                {count.responsible_name ?? '—'}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary" className={COUNT_STATUS_BADGE_CLASS[count.status]}>
                                  {COUNT_STATUS_LABELS[count.status]}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {count.status === 'in_progress' ? (
                                  <span className="text-muted-foreground">
                                    {count.counted_items}/{count.total_items} contados
                                  </span>
                                ) : (
                                  count.diff_items
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
      </div>

      {warehouseDialog && (
        <WarehouseDialog
          open
          onOpenChange={(open) => {
            if (!open) setWarehouseDialog(null)
          }}
          mode={warehouseDialog}
          users={users}
          onSaved={refresh}
        />
      )}

      {categoriesOpen && (
        <ItemCategoriesDialog
          open
          onOpenChange={setCategoriesOpen}
          categories={categories}
          onSaved={refresh}
        />
      )}

      {entryOpen && (
        <EntryDialog
          open
          onOpenChange={setEntryOpen}
          items={items.filter((item) => item.is_active)}
          warehouses={warehouses}
          providers={providers}
          stockCells={stockCells}
          initialItemId={preselect.itemId}
          initialWarehouseId={preselect.warehouseId}
          onSaved={refresh}
        />
      )}

      {adjustOpen && (
        <AdjustDialog
          open
          onOpenChange={setAdjustOpen}
          items={items}
          warehouses={warehouses}
          stockCells={stockCells}
          initialItemId={preselect.itemId}
          initialWarehouseId={preselect.warehouseId}
          onSaved={refresh}
        />
      )}

      {transferOpen && (
        <TransferDialog
          open
          onOpenChange={setTransferOpen}
          items={items}
          warehouses={warehouses}
          stockCells={stockCells}
          initialItemId={preselect.itemId}
          initialWarehouseId={preselect.warehouseId}
          onSaved={refresh}
        />
      )}

      <MovementDetailDialog
        open={detailRow !== null}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null)
        }}
        row={detailRow}
        currentUnitCost={detailRow ? (itemCostById.get(detailRow.item_id) ?? null) : null}
      />
    </main>
  )
}
