import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { OPERATIONAL_LABELS, type AssetRow } from '@/lib/m1'

type Props = {
  assets: AssetRow[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  clearable?: boolean
  id?: string
  placeholder?: string
  'aria-invalid'?: boolean
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

type Option = {
  asset: AssetRow
  haystack: string
  statusNote: string | null
}

function buildOptions(assets: AssetRow[]): Option[] {
  return assets.map((asset) => ({
    asset,
    haystack: normalize(
      `${asset.code} ${asset.name} ${asset.location_path ?? ''} ${asset.category_name ?? ''}`,
    ),
    statusNote:
      asset.operational_status !== 'operational' ||
      asset.life_stage === 'decommissioned'
        ? [
            OPERATIONAL_LABELS[asset.operational_status],
            asset.life_stage === 'decommissioned' ? 'Dado de baja' : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : null,
  }))
}

export function AssetCombobox({
  assets,
  value,
  onChange,
  disabled,
  clearable,
  id,
  placeholder = 'Buscar activo por código, nombre o ubicación…',
  'aria-invalid': ariaInvalid,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const options = useMemo(() => buildOptions(assets), [assets])
  const selected = useMemo(
    () => assets.find((asset) => asset.id === value) ?? null,
    [assets, value],
  )
  const filtered = useMemo(() => {
    if (!query.trim()) return options
    const needle = normalize(query)
    return options.filter((option) => option.haystack.includes(needle))
  }, [options, query])

  function select(id: string) {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          role="combobox"
          variant="outline"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-label="Activo"
          className="h-8 w-full justify-between rounded-lg border border-input bg-transparent px-2.5 font-normal text-base shadow-none transition-colors hover:bg-transparent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? `${selected.code} — ${selected.name}` : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            className="h-9 w-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
            placeholder="Filtrar por código, nombre o ubicación…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filtrar activos"
          />
          {clearable && selected && (
            <button
              type="button"
              className="text-[12px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                onChange('')
                setQuery('')
              }}
            >
              Limpiar
            </button>
          )}
        </div>
        <ul
          role="listbox"
          aria-label="Activos"
          className="max-h-64 overflow-y-auto overscroll-contain p-1"
        >
          {filtered.length === 0 && (
            <li className="px-2 py-6 text-center text-[13px] text-muted-foreground">
              Sin coincidencias.
            </li>
          )}
          {filtered.map(({ asset, statusNote }) => {
            const isSelected = asset.id === value
            return (
              <li key={asset.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-[13.5px] outline-none transition-colors',
                    'focus:bg-muted data-[highlighted=true]:bg-muted',
                  )}
                  onClick={() => select(asset.id)}
                >
                  <Check
                    className={cn(
                      'mt-0.5 size-4 shrink-0 text-primary',
                      isSelected ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {asset.parent_id ? '└ ' : ''}
                      {asset.code} — {asset.name}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {asset.location_path ?? 'Sin ubicación'}
                      {asset.category_name ? ` · ${asset.category_name}` : ''}
                      {statusNote ? ` · ${statusNote}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
