import { useMemo, useState } from 'react'
import {
  Box,
  ChevronDown,
  ChevronRight,
  Cog,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  PowerOff,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { locationAssetCounts, type AssetRow, type LocationRow } from '@/lib/m1'

type Props = {
  locations: LocationRow[]
  assets: AssetRow[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onOpenAsset: (id: string) => void
  canEdit: boolean
  onCreateRoot: () => void
  onCreateChild: (parentId: string) => void
  onEditLocation: (location: LocationRow) => void
  onDeactivateLocation: (location: LocationRow) => void
}

type TreeNode = {
  location: LocationRow
  children: TreeNode[]
  assets: AssetRow[]
}

export function LocationTree({
  locations,
  assets,
  selectedId,
  onSelect,
  onOpenAsset,
  canEdit,
  onCreateRoot,
  onCreateChild,
  onEditLocation,
  onDeactivateLocation,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(locations.filter((l) => l.depth <= 1).map((l) => l.id)))
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [hoveredAsset, setHoveredAsset] = useState<string | null>(null)

  const { nodes, counts, componentsByParent } = useMemo(() => {
    const byParent = new Map<string | null, LocationRow[]>()
    for (const location of locations) {
      const list = byParent.get(location.parent_id) ?? []
      list.push(location)
      byParent.set(location.parent_id, list)
    }
    for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'es'))

    const roots = byParent.get(null) ?? []
    const hotels = roots.filter((location) => location.kind === 'hotel')
    const base = hotels.length > 0 ? [...hotels, ...roots.filter((location) => location.kind !== 'hotel')] : roots

    const assetsByLocation = new Map<string, AssetRow[]>()
    const componentsByParent = new Map<string, AssetRow[]>()
    for (const asset of assets) {
      if (asset.parent_id) {
        const list = componentsByParent.get(asset.parent_id) ?? []
        list.push(asset)
        componentsByParent.set(asset.parent_id, list)
      } else {
        const list = assetsByLocation.get(asset.location_id) ?? []
        list.push(asset)
        assetsByLocation.set(asset.location_id, list)
      }
    }

    const build = (location: LocationRow): TreeNode => ({
      location,
      children: (byParent.get(location.id) ?? []).map(build),
      assets: (assetsByLocation.get(location.id) ?? []).sort((a, b) => a.code.localeCompare(b.code)),
    })

    return {
      nodes: base.map(build),
      counts: locationAssetCounts(locations, assets),
      componentsByParent,
    }
  }, [locations, assets])

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderAsset(asset: AssetRow, depth: number, isComponent: boolean) {
    const components = componentsByParent.get(asset.id) ?? []
    const hasChildren = components.length > 0
    const isExpanded = expanded.has(asset.id)
    const indent = Math.min(depth * 3 + 3, 14) * 4
    return (
      <div key={`a-${asset.id}`}>
        <div
          className={`group flex items-center gap-1.5 rounded-md py-1 pr-1 hover:bg-muted/70 ${
            hoveredAsset === asset.id ? 'bg-muted' : ''
          }`}
          style={{ paddingLeft: indent }}
          onMouseEnter={() => setHoveredAsset(asset.id)}
          onMouseLeave={() => setHoveredAsset(null)}
          onDoubleClick={() => onOpenAsset(asset.id)}
          title="Doble click para abrir la ficha"
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(asset.id)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={isExpanded ? `Colapsar ${asset.name}` : `Expandir ${asset.name}`}
            >
              {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <span className="w-[18px]" />
          )}
          {isComponent ? (
            <Cog className="size-3.5 shrink-0 text-muted-foreground/70" />
          ) : (
            <Box className="size-3.5 shrink-0 text-primary/80" />
          )}
          <button
            type="button"
            className="truncate text-left text-[13px] text-foreground/90 hover:text-primary"
            onClick={() => setHoveredAsset(asset.id)}
            onDoubleClick={() => onOpenAsset(asset.id)}
          >
            <span className="font-mono text-[11.5px] text-muted-foreground">{asset.code}</span>
            <span className="ml-1.5">{asset.name}</span>
          </button>
          {!isComponent && !asset.warranty_active && asset.has_warranty && (
            <Badge variant="destructive" className="ml-auto px-1.5 py-0 text-[10px]">
              Vencida
            </Badge>
          )}
        </div>
        {isExpanded &&
          components.map((component) => renderAsset(component, depth + 1, true))}
      </div>
    )
  }

  function renderNode(node: TreeNode) {
    const { location } = node
    const hasChildren = node.children.length > 0 || node.assets.length > 0
    const isExpanded = expanded.has(location.id)
    const isSelected = selectedId === location.id
    return (
      <div key={location.id}>
        <div
          className={`group flex items-center gap-1.5 rounded-md py-1 pr-1 pl-1 hover:bg-muted/70 ${
            isSelected ? 'bg-primary/10 text-primary' : ''
          } ${location.is_active ? '' : 'opacity-60'}`}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(location.id)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={isExpanded ? `Colapsar ${location.name}` : `Expandir ${location.name}`}
            >
              {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <span className="w-[18px]" />
          )}
          <MapPin className="size-3.5 shrink-0" />
          <button
            type="button"
            className={`min-w-0 flex-1 truncate text-left text-[13px] font-medium ${isSelected ? 'text-primary' : ''}`}
            onClick={() => onSelect(location.id)}
          >
            {location.name}
          </button>
          {!location.is_active && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              Inactiva
            </Badge>
          )}
          <Badge variant="secondary" className="px-1.5 py-0 text-[11px] tabular-nums">
            {counts.get(location.id) ?? 0}
          </Badge>
          {canEdit && (
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={`Acciones de ${location.name}`}
              onClick={(event) => {
                event.stopPropagation()
                setMenuFor((current) => (current === location.id ? null : location.id))
              }}
            >
              <MoreHorizontal className="size-4" />
            </button>
          )}
        </div>

        {menuFor === location.id && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
            <div className="relative z-50 ml-6 min-w-44 rounded-md border border-border bg-popover py-1 shadow-md">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-accent"
                onClick={() => {
                  setMenuFor(null)
                  onCreateChild(location.id)
                }}
              >
                <Plus className="size-3.5" />
                Agregar ubicación
              </button>
              {location.kind !== 'hotel' && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-accent"
                  onClick={() => {
                    setMenuFor(null)
                    onEditLocation(location)
                  }}
                >
                  <Pencil className="size-3.5" />
                  Editar / Reubicar
                </button>
              )}
              {location.kind !== 'hotel' && location.is_active && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-destructive hover:bg-accent"
                  onClick={() => {
                    setMenuFor(null)
                    onDeactivateLocation(location)
                  }}
                >
                  <PowerOff className="size-3.5" />
                  Desactivar
                </button>
              )}
            </div>
          </>
        )}

        {isExpanded && (
          <div className="ml-3 border-l border-border/70 pl-1">
            {node.children.map(renderNode)}
            {node.assets.map((asset) => renderAsset(asset, 0, false))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex max-h-[min(70dvh,720px)] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-[12.5px] font-semibold tracking-wide text-muted-foreground uppercase">
          Ubicaciones
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`rounded-md px-2 py-1 text-[12px] font-medium ${
              selectedId === null ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
            onClick={() => onSelect(null)}
          >
            Ver todo
          </button>
          {canEdit && (
            <button
              type="button"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onCreateRoot}
            >
              <Plus className="size-3.5" />
              Nueva ubicación
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {nodes.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
            {canEdit ? (
              <>
                Sin ubicaciones registradas.{' '}
                <button type="button" className="font-medium text-primary hover:underline" onClick={onCreateRoot}>
                  Crear la primera
                </button>
              </>
            ) : (
              'Sin ubicaciones registradas.'
            )}
          </p>
        ) : (
          nodes.map(renderNode)
        )}
      </div>
    </div>
  )
}
