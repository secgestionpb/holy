import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Download,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Tags,
} from 'lucide-react'
import { LocationDialog } from '@/components/activos/location-dialog'
import { LocationTree } from '@/components/activos/location-tree'
import { ImportDialog } from '@/components/activos/import-dialog'
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
import { useAuth } from '@/lib/auth-store'
import { exportExcel, exportPdf, type ExportSection } from '@/lib/export-utils'
import {
  CRITICALITY_LABELS,
  LIFE_STAGE_LABELS,
  OPERATIONAL_LABELS,
  fetchAssets,
  fetchCategories,
  fetchLocations,
  fetchUsersLite,
  formatDateTime,
  locationAssetCounts,
  warrantyBadge,
  type AssetRow,
  type CategoryRow,
  type Criticality,
  type LifeStage,
  type LocationRow,
  type OperationalStatus,
  type UserLite,
} from '@/lib/m1'

const STAGE_BADGE_CLASS: Record<LifeStage, string> = {
  no_warranty: 'bg-muted text-muted-foreground',
  under_warranty: 'bg-primary/15 text-primary',
  operational: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  pending_repair: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  requires_replacement: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
  decommissioned: 'bg-destructive/15 text-destructive',
}

type Filters = {
  query: string
  category: string
  criticality: string
  operational: string
  stage: string
  responsible: string
}

const EMPTY_FILTERS: Filters = {
  query: '',
  category: 'todas',
  criticality: 'todas',
  operational: 'todos',
  stage: 'todas',
  responsible: 'todos',
}

export default function Activos() {
  const roles = useAuth((s) => s.roles)
  const canEdit = roles.includes('mantenimiento')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [locations, setLocations] = useState<LocationRow[]>([])
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selectedLocation, setSelectedLocation] = useState<string | null>(searchParams.get('loc'))
  const [dialogMode, setDialogMode] = useState<
    { type: 'create'; parentId: string | null } | { type: 'edit'; location: LocationRow } | null
  >(null)
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([fetchLocations(), fetchAssets(), fetchCategories(), fetchUsersLite()])
      .then(([locationRows, assetRows, categoryRows, userRows]) => {
        if (!alive) return
        setLocations(locationRows)
        setAssets(assetRows)
        setCategories(categoryRows)
        setUsers(userRows)
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

  const counts = useMemo(() => locationAssetCounts(locations, assets), [locations, assets])

  const childLocationIds = useMemo(() => {
    if (!selectedLocation) return null
    const childrenOf = new Map<string | null, string[]>()
    for (const location of locations) {
      const list = childrenOf.get(location.parent_id) ?? []
      list.push(location.id)
      childrenOf.set(location.parent_id, list)
    }
    const out = new Set<string>([selectedLocation])
    const walk = (id: string) => {
      for (const childId of childrenOf.get(id) ?? []) {
        out.add(childId)
        walk(childId)
      }
    }
    walk(selectedLocation)
    return out
  }, [locations, selectedLocation])

  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase()
    return assets.filter((asset) => {
      if (childLocationIds && !childLocationIds.has(asset.location_id)) return false
      if (query && !asset.code.toLowerCase().includes(query) && !asset.name.toLowerCase().includes(query)) {
        return false
      }
      if (filters.category !== 'todas' && asset.category_id !== filters.category) return false
      if (filters.criticality !== 'todas' && asset.criticality !== filters.criticality) return false
      if (filters.operational !== 'todos' && asset.operational_status !== filters.operational) return false
      if (filters.stage !== 'todas' && asset.life_stage !== filters.stage) return false
      if (filters.responsible !== 'todos' && asset.responsible_user_id !== filters.responsible) return false
      return true
    })
  }, [assets, childLocationIds, filters])

  function selectLocation(id: string | null) {
    setSelectedLocation(id)
    if (id) setSearchParams({ loc: id }, { replace: true })
    else setSearchParams({}, { replace: true })
  }

  const activeFilterCount =
    (filters.query ? 1 : 0) +
    (filters.category !== 'todas' ? 1 : 0) +
    (filters.criticality !== 'todas' ? 1 : 0) +
    (filters.operational !== 'todos' ? 1 : 0) +
    (filters.stage !== 'todas' ? 1 : 0) +
    (filters.responsible !== 'todos' ? 1 : 0)

  function exportAssets(format: 'pdf' | 'excel') {
    const section: ExportSection = {
      title: 'Listado de activos',
      headers: [
        'Código',
        'Nombre',
        'Categoría',
        'Ubicación',
        'Criticidad',
        'Estado operativo',
        'Etapa de vida',
        'Garantía',
        'OTs abiertas',
        'Responsable',
        'Últ. modificación',
      ],
      rows: filtered.map((a) => [
        a.code,
        a.name,
        a.category_name ?? '',
        a.location_path ?? '',
        CRITICALITY_LABELS[a.criticality] ?? a.criticality,
        OPERATIONAL_LABELS[a.operational_status] ?? a.operational_status,
        LIFE_STAGE_LABELS[a.life_stage] ?? a.life_stage,
        a.warranty_active ? 'Sí' : 'No',
        a.open_wo_count,
        a.responsible_name ?? '',
        formatDateTime(a.updated_at),
      ]),
    }
    const meta = {
      title: 'Listado de activos',
      filtersLabel: activeFilterCount > 0 ? `${activeFilterCount} filtro(s) activo(s)` : 'Sin filtros',
    }
    if (format === 'pdf') void exportPdf(meta, [section], 'activos')
    else void exportExcel(meta, [section], 'activos')
  }

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Módulo 1 · Gestión de activos
            </p>
            <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
              Explorador de activos
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              {assets.length} {assets.length === 1 ? 'activo registrado' : 'activos registrados'} ·{' '}
              {categories.filter((category) => category.is_active).length} categorías activas
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canEdit}
              title={
                canEdit
                  ? 'Importación masiva desde .xlsx (F1.12).'
                  : 'Requiere rol Mantenimiento.'
              }
              onClick={() => setImportOpen(true)}
            >
              <FileSpreadsheet />
              Importar
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filtered.length === 0}
              title="Exportar el listado filtrado a PDF."
              onClick={() => exportAssets('pdf')}
            >
              <Download />
              PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filtered.length === 0}
              title="Exportar el listado filtrado a Excel."
              onClick={() => exportAssets('excel')}
            >
              <Download />
              Excel
            </Button>
            <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => navigate('/app/activos/categorias')}>
              <Tags />
              Categorías
            </Button>
            <Button disabled={!canEdit} onClick={() => navigate('/app/activos/nuevo')}>
              <Plus />
              Nuevo activo
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-[14px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando árbol…
              </div>
            ) : (
              <LocationTree
                locations={locations}
                assets={assets}
                selectedId={selectedLocation}
                onSelect={selectLocation}
                onOpenAsset={(id) => navigate(`/app/activos/${id}`)}
                canEdit={canEdit}
                onCreateRoot={() => setDialogMode({ type: 'create', parentId: null })}
                onCreateChild={(parentId) => setDialogMode({ type: 'create', parentId })}
                onEditLocation={(location) => setDialogMode({ type: 'edit', location })}
                onDeactivateLocation={(location) => setDialogMode({ type: 'edit', location })}
              />
            )}
          </section>

          <section className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Buscar por código o nombre"
                  placeholder="Buscar código o nombre…"
                  className="pl-9"
                  value={filters.query}
                  onChange={(event) => setFilters((f) => ({ ...f, query: event.target.value }))}
                />
              </div>

              <Select
                value={filters.category}
                onValueChange={(value) => setFilters((f) => ({ ...f, category: value }))}
              >
                <SelectTrigger className="w-[165px]" aria-label="Filtrar por categoría">
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
                value={filters.criticality}
                onValueChange={(value) => setFilters((f) => ({ ...f, criticality: value }))}
              >
                <SelectTrigger className="w-[130px]" aria-label="Filtrar por criticidad">
                  <SelectValue placeholder="Criticidad" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Criticidad</SelectItem>
                  {(Object.entries(CRITICALITY_LABELS) as Array<[Criticality, string]>).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>

              <Select
                value={filters.operational}
                onValueChange={(value) => setFilters((f) => ({ ...f, operational: value }))}
              >
                <SelectTrigger className="w-[140px]" aria-label="Filtrar por estado operativo">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Estado operativo</SelectItem>
                  {(Object.entries(OPERATIONAL_LABELS) as Array<[OperationalStatus, string]>).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>

              <Select
                value={filters.stage}
                onValueChange={(value) => setFilters((f) => ({ ...f, stage: value }))}
              >
                <SelectTrigger className="w-[175px]" aria-label="Filtrar por etapa de vida">
                  <SelectValue placeholder="Etapa" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Etapa de vida</SelectItem>
                  {(Object.entries(LIFE_STAGE_LABELS) as Array<[LifeStage, string]>).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>

              <Select
                value={filters.responsible}
                onValueChange={(value) => setFilters((f) => ({ ...f, responsible: value }))}
              >
                <SelectTrigger className="w-[160px]" aria-label="Filtrar por responsable">
                  <SelectValue placeholder="Responsable" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Responsable</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="ghost"
                size="sm"
                onClick={refresh}
                aria-label="Actualizar listado"
              >
                <RefreshCw />
                Actualizar
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
              {selectedLocation && (
                <Badge variant="outline" className="gap-1.5 pr-1.5">
                  <MapPin className="size-3" />
                  {locations.find((location) => location.id === selectedLocation)?.name ?? 'Ubicación'}
                  <button
                    type="button"
                    className="rounded-full px-1 hover:text-foreground"
                    aria-label="Quitar filtro de ubicación"
                    onClick={() => selectLocation(null)}
                  >
                    ×
                  </button>
                </Badge>
              )}
              <span>
                {filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}
                {activeFilterCount > 0 ? ` · ${activeFilterCount} ${activeFilterCount === 1 ? 'filtro' : 'filtros'}` : ''}
              </span>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-border">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-6 py-14 text-[14px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Cargando activos…
                </div>
              ) : error ? (
                <div className="px-6 py-10 text-center">
                  <p className="text-[14px] text-destructive">{error}</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={refresh}>
                    Reintentar
                  </Button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <p className="text-[14px] text-muted-foreground">
                    Sin resultados con los filtros aplicados.
                  </p>
                  {canEdit && (
                    <Button className="mt-4" onClick={() => navigate('/app/activos/nuevo')}>
                      <Plus />
                      Nuevo activo
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
                      <TableHead className="hidden xl:table-cell">Ubicación</TableHead>
                      <TableHead className="hidden md:table-cell">Criticidad</TableHead>
                      <TableHead className="hidden md:table-cell">Estado</TableHead>
                      <TableHead>Etapa de vida</TableHead>
                      <TableHead className="hidden sm:table-cell">Garantía</TableHead>
                      <TableHead className="hidden xl:table-cell">OTs</TableHead>
                      <TableHead className="hidden 2xl:table-cell">Responsable</TableHead>
                      <TableHead className="hidden 2xl:table-cell">Últ. modificación</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((asset) => {
                      const warranty = warrantyBadge(asset)
                      return (
                        <TableRow
                          key={asset.id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/app/activos/${asset.id}`)}
                        >
                          <TableCell className="font-mono text-[12.5px] font-medium">
                            {asset.parent_id && (
                              <span className="mr-1 text-muted-foreground" title="Componente">
                                └
                              </span>
                            )}
                            {asset.code}
                          </TableCell>
                          <TableCell className="font-medium">{asset.name}</TableCell>
                          <TableCell className="hidden text-[13px] text-muted-foreground lg:table-cell">
                            {asset.category_name ?? '—'}
                          </TableCell>
                          <TableCell className="hidden max-w-[220px] truncate text-[13px] text-muted-foreground xl:table-cell">
                            {asset.location_path ?? '—'}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge
                              variant={asset.criticality === 'high' ? 'destructive' : 'outline'}
                            >
                              {CRITICALITY_LABELS[asset.criticality]}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                            {OPERATIONAL_LABELS[asset.operational_status]}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={STAGE_BADGE_CLASS[asset.life_stage]}>
                              {LIFE_STAGE_LABELS[asset.life_stage]}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <Badge variant={warranty.variant}>{warranty.label}</Badge>
                          </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <Badge
                          variant={asset.open_wo_count > 0 ? 'secondary' : 'outline'}
                          className="tabular-nums"
                          title="OTs abiertas de este activo (Módulo 2)"
                        >
                          {asset.open_wo_count}
                        </Badge>
                      </TableCell>
                          <TableCell className="hidden text-[13px] text-muted-foreground xl:table-cell">
                            {asset.responsible_name ?? '—'}
                          </TableCell>
                          <TableCell className="hidden text-[13px] text-muted-foreground 2xl:table-cell">
                            {formatDateTime(asset.updated_at)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </section>
        </div>
      </div>

      {importOpen && (
        <ImportDialog
          open
          onOpenChange={(open) => {
            if (!open) setImportOpen(false)
          }}
          categories={categories}
          locations={locations}
          users={users}
          onImported={refresh}
        />
      )}

      {dialogMode && (
        <LocationDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialogMode(null)
          }}
          mode={dialogMode}
          locations={locations}
          assetCount={
            dialogMode.type === 'edit' ? (counts.get(dialogMode.location.id) ?? 0) : 0
          }
          onSaved={refresh}
        />
      )}
    </main>
  )
}
