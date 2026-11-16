import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Loader2, Plus, RefreshCw, Search } from 'lucide-react'
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
import { fetchCategories, type CategoryRow } from '@/lib/m1'
import {
  contractStatus,
  fetchActiveContractBadges,
  fetchEvent11Days,
  fetchProviders,
  PROVIDER_TYPE_LABELS,
  type ProviderRow,
  type ProviderType,
} from '@/lib/m5'

const PAGE_SIZES = [20, 40, 60, 100]

type Filters = {
  query: string
  type: string
  category: string
  state: string
  expiringOnly: boolean
}

const EMPTY_FILTERS: Filters = {
  query: '',
  type: 'todos',
  category: 'todas',
  state: 'todos',
  expiringOnly: false,
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

export default function Proveedores() {
  const roles = useAuth((s) => s.roles)
  const canEdit = roles.includes('mantenimiento')
  const navigate = useNavigate()

  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [badges, setBadges] = useState<Map<string, { count: number; expiring: boolean }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    let alive = true
    Promise.all([fetchProviders(), fetchCategories(), fetchEvent11Days(), fetchActiveContractBadges()])
      .then(([providerRows, categoryRows, days, contractRows]) => {
        if (!alive) return
        setProviders(providerRows)
        setCategories(categoryRows)
        const map = new Map<string, { count: number; expiring: boolean }>()
        for (const row of contractRows) {
          const entry = map.get(row.provider_id) ?? { count: 0, expiring: false }
          entry.count += 1
          if (contractStatus({ end_date: row.end_date, is_active: true }, days) === 'por_vencer') {
            entry.expiring = true
          }
          map.set(row.provider_id, entry)
        }
        setBadges(map)
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

  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase()
    return providers.filter((provider) => {
      if (
        query &&
        !provider.code.toLowerCase().includes(query) &&
        !provider.name.toLowerCase().includes(query)
      ) {
        return false
      }
      if (filters.type !== 'todos' && provider.provider_type !== filters.type) return false
      if (filters.category !== 'todas' && (provider.service_category_id ?? 'none') !== filters.category) {
        return false
      }
      if (filters.state === 'active' && !provider.is_active) return false
      if (filters.state === 'inactive' && provider.is_active) return false
      if (filters.expiringOnly && !badges.get(provider.id)?.expiring) return false
      return true
    })
  }, [providers, filters, badges])

  useEffect(() => {
    setPage(1)
  }, [filters])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const expiringTotal = useMemo(() => {
    let total = 0
    for (const entry of badges.values()) {
      if (entry.expiring) total += 1
    }
    return total
  }, [badges])

  const activeCount = providers.filter((provider) => provider.is_active).length

  if (loading) {
    return (
      <main className="flex items-center justify-center gap-2 px-6 py-24 text-[14px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando proveedores…
      </main>
    )
  }

  if (error) {
    return (
      <main className="px-6 py-24 text-center">
        <p className="text-[14px] text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={refresh}>
          Reintentar
        </Button>
      </main>
    )
  }

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">
              Módulo 5 · Proveedores y contratistas externos
            </p>
            <h1 className="font-heading mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extrabold tracking-[-0.02em]">
              Proveedores
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              {activeCount} {activeCount === 1 ? 'activo registrado' : 'activos registrados'} ·{' '}
              {badges.size} {badges.size === 1 ? 'contrato vigente' : 'contratos vigentes'} ·{' '}
              {expiringTotal} {expiringTotal === 1 ? 'por vencer' : 'por vencer'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} aria-label="Actualizar">
              <RefreshCw />
              Actualizar
            </Button>
            {canEdit && (
              <Button onClick={() => navigate('/app/proveedores/nuevo')}>
                <Plus />
                Nuevo proveedor
              </Button>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
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

          <Select value={filters.type} onValueChange={(value) => setFilters((f) => ({ ...f, type: value }))}>
            <SelectTrigger className="w-[200px]" aria-label="Filtrar por tipo">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los tipos</SelectItem>
              {(Object.entries(PROVIDER_TYPE_LABELS) as Array<[ProviderType, string]>).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>

          <Select
            value={filters.category}
            onValueChange={(value) => setFilters((f) => ({ ...f, category: value }))}
          >
            <SelectTrigger className="w-[190px]" aria-label="Filtrar por categoría de servicio">
              <SelectValue placeholder="Categoría de servicio" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las categorías</SelectItem>
              <SelectItem value="none">Sin categoría</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                  {category.is_active ? '' : ' (inactiva)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.state} onValueChange={(value) => setFilters((f) => ({ ...f, state: value }))}>
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
            variant={filters.expiringOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilters((f) => ({ ...f, expiringOnly: !f.expiringOnly }))}
          >
            Con contrato por vencer
          </Button>

          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            Limpiar
          </Button>
        </div>

        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}
        </p>

        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          {filtered.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[14px] text-muted-foreground">
                {providers.length === 0
                  ? 'Sin proveedores registrados.'
                  : 'Sin resultados con los filtros aplicados.'}
              </p>
              {canEdit && providers.length === 0 && (
                <Button className="mt-4" onClick={() => navigate('/app/proveedores/nuevo')}>
                  <Plus />
                  Nuevo proveedor
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre / razón social</TableHead>
                  <TableHead className="hidden md:table-cell">Tipo</TableHead>
                  <TableHead className="hidden lg:table-cell">Categoría de servicio</TableHead>
                  <TableHead className="hidden xl:table-cell">Contacto</TableHead>
                  <TableHead className="hidden sm:table-cell">Contratos</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-[52px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((provider) => {
                  const badge = badges.get(provider.id)
                  return (
                    <TableRow
                      key={provider.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/app/proveedores/${provider.id}`)}
                    >
                      <TableCell className="font-mono text-[12.5px] font-medium">
                        {provider.code}
                      </TableCell>
                      <TableCell className="font-medium">{provider.name}</TableCell>
                      <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                        {PROVIDER_TYPE_LABELS[provider.provider_type]}
                      </TableCell>
                      <TableCell className="hidden max-w-[180px] truncate text-[13px] text-muted-foreground lg:table-cell">
                        {provider.service_category?.name ?? '—'}
                      </TableCell>
                      <TableCell className="hidden max-w-[200px] truncate text-[13px] text-muted-foreground xl:table-cell">
                        {[provider.contact_phone, provider.contact_email]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {badge && badge.count > 0 ? (
                          <span className="flex items-center gap-1.5">
                            <Badge variant="secondary" className="text-[11px]">
                              {badge.count} {badge.count === 1 ? 'vigente' : 'vigentes'}
                            </Badge>
                            {badge.expiring && (
                              <Badge
                                variant="outline"
                                className="text-[11px] text-amber-700 dark:text-amber-400"
                              >
                                por vencer
                              </Badge>
                            )}
                          </span>
                        ) : (
                          <span className="text-[13px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={provider.is_active ? 'secondary' : 'outline'}>
                          {provider.is_active ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Ver proveedor"
                          onClick={(event) => {
                            event.stopPropagation()
                            navigate(`/app/proveedores/${provider.id}`)
                          }}
                        >
                          <Eye />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <PaginationBar
          total={filtered.length}
          page={safePage}
          pageSize={pageSize}
          onPage={setPage}
          onSize={(size) => {
            setPageSize(size)
            setPage(1)
          }}
        />
      </div>
    </main>
  )
}
