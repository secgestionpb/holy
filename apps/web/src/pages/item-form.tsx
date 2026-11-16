import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Check, ExternalLink, Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth-store'
import {
  fetchAssets,
  fetchCategories,
  signAssetFileUrl,
  type AssetRow,
  type CategoryRow,
} from '@/lib/m1'
import { fetchProvidersLite, type ProviderLite } from '@/lib/m2'
import {
  createItem,
  fetchItem,
  fetchItemAssetLinks,
  fetchItemCategories,
  fetchItemCategoryLinks,
  fetchStockCells,
  fetchWarehouses,
  formatQty,
  itemCode,
  removeItemFile,
  saveItemStockRows,
  syncItemAssetLinks,
  syncItemCategoryLinks,
  UNIT_LABELS,
  updateItem,
  uploadItemFile,
  type ItemCategoryRow,
  type ItemRow,
  type ItemUnit,
  type StockCellRow,
  type WarehouseRow,
} from '@/lib/m4'

const UNITS = Object.keys(UNIT_LABELS) as [ItemUnit, ...ItemUnit[]]

const schema = z.object({
  code: z.string().trim().min(1, 'Escribe o espera el código autogenerado.'),
  name: z.string().trim().min(1, 'Escribe el nombre del ítem.'),
  description: z.string().trim(),
  item_category_id: z.string(),
  unit: z.enum(UNITS),
  is_active: z.enum(['active', 'inactive']),
  bin_location: z.string().trim(),
  preferred_provider_id: z.string(),
})

type FormValues = z.infer<typeof schema>

type StockRowDraft = { warehouse_id: string; min_stock: string }

export default function ItemForm() {
  const roles = useAuth((s) => s.roles)
  const canEdit = roles.includes('mantenimiento')
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [item, setItem] = useState<ItemRow | null>(null)
  const [itemCategories, setItemCategories] = useState<ItemCategoryRow[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [providers, setProviders] = useState<ProviderLite[]>([])
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [assetCategories, setAssetCategories] = useState<CategoryRow[]>([])
  const [stockCells, setStockCells] = useState<StockCellRow[]>([])
  const [stockRows, setStockRows] = useState<StockRowDraft[]>([])
  const [assetLinks, setAssetLinks] = useState<Set<string>>(new Set())
  const [categoryLinks, setCategoryLinks] = useState<Set<string>>(new Set())
  const [assetQuery, setAssetQuery] = useState('')
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [sheetPath, setSheetPath] = useState<string | null>(null)
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [pendingSheet, setPendingSheet] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [codeDirty, setCodeDirty] = useState(false)
  const [codeCheck, setCodeCheck] = useState<{ checking: boolean; available: boolean | null }>({
    checking: false,
    available: null,
  })

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '',
      name: '',
      description: '',
      item_category_id: 'none',
      unit: 'unidad',
      is_active: 'active',
      bin_location: '',
      preferred_provider_id: 'none',
    },
  })

  useEffect(() => {
    let alive = true
    Promise.all([
      fetchItemCategories(),
      fetchWarehouses(),
      fetchProvidersLite(),
      fetchAssets(),
      fetchCategories(),
      fetchStockCells(),
    ])
      .then(([categoryRows, warehouseRows, providerRows, assetRows, assetCategoryRows, cellRows]) => {
        if (!alive) return
        setItemCategories(categoryRows)
        setWarehouses(warehouseRows)
        setProviders(providerRows)
        setAssets(assetRows)
        setAssetCategories(assetCategoryRows)
        setStockCells(cellRows)
        if (!id) {
          setLoading(false)
          return
        }
        fetchItem(id)
          .then(async (row) => {
            if (!alive) return
            if (!row) {
              setLoadError('Ítem inexistente.')
              return
            }
            setItem(row)
            setImagePath(row.image_path)
            setSheetPath(row.technical_sheet_path)
            reset({
              code: row.code,
              name: row.name,
              description: row.description ?? '',
              item_category_id: row.item_category_id ?? 'none',
              unit: row.unit,
              is_active: row.is_active ? 'active' : 'inactive',
              bin_location: row.bin_location ?? '',
              preferred_provider_id: row.preferred_provider_id ?? 'none',
            })
            setStockRows(
              cellRows
                .filter((cell) => cell.item_id === row.id)
                .map((cell) => ({ warehouse_id: cell.warehouse_id, min_stock: String(cell.min_stock) })),
            )
            const [assetLinkRows, categoryLinkRows] = await Promise.all([
              fetchItemAssetLinks(row.id),
              fetchItemCategoryLinks(row.id),
            ])
            if (!alive) return
            setAssetLinks(new Set(assetLinkRows.map((link) => link.asset_id)))
            setCategoryLinks(new Set(categoryLinkRows.map((link) => link.category_id)))
          })
          .catch((err: unknown) => {
            if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el ítem.')
          })
          .finally(() => {
            if (alive) setLoading(false)
          })
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el formulario.')
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Código autogenerado REP-#### en el alta (preview sin consumir secuencia)
  useEffect(() => {
    if (isEdit || codeDirty) return
    let alive = true
    void itemCode('preview').then((result) => {
      if (alive && result.ok && result.code) setValue('code', result.code, { shouldDirty: false })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, codeDirty])

  // Unicidad en tiempo real (debounce) cuando el código es manual
  useEffect(() => {
    if (!codeDirty) return
    const code = watch('code').trim()
    if (code.length < 3) return
    let alive = true
    const timer = window.setTimeout(() => {
      setCodeCheck({ checking: true, available: null })
      void itemCode('check', code, id).then((result) => {
        if (!alive) return
        setCodeCheck({
          checking: false,
          available: result.ok && typeof result.available === 'boolean' ? result.available : null,
        })
      })
    }, 400)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeDirty, watch('code')])

  const code = watch('code')
  const activeItemCategories = useMemo(
    () => itemCategories.filter((cat) => cat.is_active || (item?.item_category_id ?? '') === cat.id),
    [itemCategories, item],
  )

  const existingCellsForItem = useMemo(
    () => (id ? stockCells.filter((cell) => cell.item_id === id) : []),
    [stockCells, id],
  )
  const existingCellByWarehouse = useMemo(
    () => new Map(existingCellsForItem.map((cell) => [cell.warehouse_id, cell])),
    [existingCellsForItem],
  )

  const chosenWarehouses = new Set(stockRows.map((row) => row.warehouse_id))
  const addableWarehouses = warehouses.filter((wh) => wh.is_active && !chosenWarehouses.has(wh.id))

  const filteredAssets = useMemo(() => {
    const query = assetQuery.trim().toLowerCase()
    const source = assets.filter((asset) => asset.life_stage !== 'decommissioned')
    const matches = query
      ? source.filter(
          (asset) =>
            asset.code.toLowerCase().includes(query) ||
            asset.name.toLowerCase().includes(query) ||
            (asset.location_path ?? '').toLowerCase().includes(query),
        )
      : source
    return matches.slice(0, 40)
  }, [assets, assetQuery])

  const selectedAssets = useMemo(
    () => assets.filter((asset) => assetLinks.has(asset.id)),
    [assets, assetLinks],
  )
  const selectedAssetCategories = useMemo(
    () => assetCategories.filter((category) => categoryLinks.has(category.id)),
    [assetCategories, categoryLinks],
  )

  function addStockRow() {
    const next = addableWarehouses[0]
    if (!next) return
    setStockRows((rows) => [...rows, { warehouse_id: next.id, min_stock: '0' }])
  }

  function onPickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (id) {
      void uploadItemFile(id, file).then((result) => {
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        setImagePath(result.path ?? null)
        toast.success('Imagen adjunta al ítem.')
      })
    } else {
      setPendingImage(file)
    }
  }

  function onPickSheet(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (id) {
      void uploadItemFile(id, file).then((result) => {
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        setSheetPath(result.path ?? null)
        toast.success('Ficha técnica adjunta al ítem.')
      })
    } else {
      setPendingSheet(file)
    }
  }

  async function openDocument(path: string) {
    const url = await signAssetFileUrl(path)
    if (!url) {
      toast.error('No se pudo abrir el documento.')
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  async function removeDocument(path: string, kind: 'image' | 'sheet') {
    if (!window.confirm('¿Eliminar este documento adjunto?')) return
    await removeItemFile(path)
    if (kind === 'image') setImagePath(null)
    else setSheetPath(null)
    if (id) await updateItem(id, kind === 'image' ? { image_path: null } : { technical_sheet_path: null })
    toast.success('Documento eliminado.')
  }

  async function onSubmit(values: FormValues) {
    setServerError(null)
    let finalCode = values.code.trim()

    if (codeDirty) {
      const check = await itemCode('check', finalCode, id)
      if (!check.ok) {
        setServerError(check.message)
        return
      }
      if (check.available === false) {
        setServerError(`El código «${finalCode}» ya existe.`)
        return
      }
    } else if (!isEdit) {
      const allocation = await itemCode('allocate')
      if (!allocation.ok) {
        setServerError(allocation.message)
        return
      }
      finalCode = allocation.code ?? finalCode
    }

    const payload = {
      code: finalCode,
      name: values.name,
      description: values.description || null,
      item_category_id: values.item_category_id === 'none' ? null : values.item_category_id,
      unit: values.unit,
      bin_location: values.bin_location || null,
      preferred_provider_id: values.preferred_provider_id === 'none' ? null : values.preferred_provider_id,
      is_active: values.is_active === 'active',
    }

    let itemId = id
    if (isEdit && item) {
      const result = await updateItem(item.id, payload)
      if (!result.ok) {
        setServerError(result.message)
        return
      }
    } else {
      const created = await createItem(payload)
      if (!created.ok) {
        setServerError(created.message)
        return
      }
      itemId = created.id
    }
    if (!itemId) {
      setServerError('No se pudo obtener el identificador del ítem.')
      return
    }

    const stockResult = await saveItemStockRows(
      itemId,
      stockRows.map((row) => ({
        warehouse_id: row.warehouse_id,
        min_stock: Number(row.min_stock) > 0 ? Number(row.min_stock) : 0,
      })),
      existingCellsForItem,
    )
    if (!stockResult.ok) {
      setServerError(stockResult.message)
      toast.warning('Ítem guardado, pero el stock por bodega no se pudo completar.')
      navigate('/app/inventario?tab=items', { replace: true })
      return
    }

    const linksResult = await syncItemAssetLinks(itemId, [...assetLinks])
    if (!linksResult.ok) {
      setServerError(linksResult.message)
      return
    }
    const categoriesResult = await syncItemCategoryLinks(itemId, [...categoryLinks])
    if (!categoriesResult.ok) {
      setServerError(categoriesResult.message)
      return
    }

    if (pendingImage) {
      const upload = await uploadItemFile(itemId, pendingImage)
      if (!upload.ok) toast.warning(upload.message)
      else setPendingImage(null)
    }
    if (pendingSheet) {
      const upload = await uploadItemFile(itemId, pendingSheet)
      if (!upload.ok) toast.warning(upload.message)
      else setPendingSheet(null)
    }

    toast.success(isEdit ? 'Ítem actualizado.' : 'Ítem creado.')
    navigate('/app/inventario?tab=items', { replace: true })
  }

  if (loading) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto flex max-w-4xl items-center justify-center gap-2 text-[14px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Cargando formulario…
        </div>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="px-6 py-14 sm:px-10">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-[15px] text-destructive">{loadError}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate('/app/inventario?tab=items')}>
            Volver al inventario
          </Button>
        </div>
      </main>
    )
  }

  const readOnly = !canEdit

  return (
    <main className="px-6 py-10 sm:px-10 lg:py-14">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/app/inventario?tab=items')}
            >
              <ArrowLeft className="size-3.5" />
              Inventario
            </button>
            <h1 className="font-heading mt-1.5 text-[clamp(1.5rem,2.4vw,2rem)] font-extrabold tracking-[-0.02em]">
              {isEdit ? (readOnly ? 'Detalle del ítem' : 'Editar ítem') : 'Nuevo ítem'}
            </h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              {readOnly
                ? 'Solo lectura (rol sin permisos de Mantenimiento).'
                : 'Catálogo con código REP-####, unidad fija, stock por bodega y vínculos N:N.'}
            </p>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => navigate('/app/inventario?tab=items')}>
                Cancelar
              </Button>
              <Button form="item-form" type="submit" disabled={isSubmitting || codeCheck.available === false}>
                {isSubmitting ? <Loader2 className="animate-spin" /> : <Check />}
                {isEdit ? 'Guardar cambios' : 'Crear ítem'}
              </Button>
            </div>
          )}
        </div>

        <form id="item-form" onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-5">
          {/* General */}
          <section className="rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">General</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="item-code">Código (REP-####)</Label>
                <div className="relative">
                  <Input
                    id="item-code"
                    className="font-mono"
                    aria-invalid={errors.code ? true : undefined}
                    disabled={readOnly}
                    {...register('code', {
                      onChange: () => {
                        setCodeDirty(true)
                        setCodeCheck({ checking: false, available: null })
                      },
                    })}
                  />
                  {codeCheck.checking && (
                    <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                  {!codeCheck.checking && codeCheck.available === true && (
                    <Check className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-emerald-600" />
                  )}
                </div>
                {errors.code && (
                  <p role="alert" className="text-[13px] text-destructive">{errors.code.message}</p>
                )}
                {!errors.code && codeCheck.available === false && (
                  <p role="alert" className="text-[13px] text-destructive">
                    El código «{code.trim()}» ya existe.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="item-name">Nombre</Label>
                <Input
                  id="item-name"
                  placeholder="Ej. Filtro de aire 20×20"
                  disabled={readOnly}
                  aria-invalid={errors.name ? true : undefined}
                  {...register('name')}
                />
                {errors.name && (
                  <p role="alert" className="text-[13px] text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Categoría de ítem</Label>
                <Select
                  value={watch('item_category_id') || 'none'}
                  disabled={readOnly}
                  onValueChange={(value) => setValue('item_category_id', value, { shouldDirty: true })}
                >
                  <SelectTrigger aria-label="Categoría de ítem" className="w-full">
                    <SelectValue placeholder="Sin categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin categoría</SelectItem>
                    {activeItemCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Unidad de medida</Label>
                <Select
                  value={watch('unit')}
                  disabled={readOnly}
                  onValueChange={(value) => setValue('unit', value as ItemUnit, { shouldDirty: true })}
                >
                  <SelectTrigger aria-label="Unidad de medida" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {UNIT_LABELS[unit]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Estado</Label>
                <Select
                  value={watch('is_active')}
                  disabled={readOnly}
                  onValueChange={(value) => setValue('is_active', value as 'active' | 'inactive', { shouldDirty: true })}
                >
                  <SelectTrigger aria-label="Estado" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Activo</SelectItem>
                    <SelectItem value="inactive">Inactivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="item-bin">Ubicación en bodega (opcional)</Label>
                <Input id="item-bin" placeholder="Ej. Estante B-3" disabled={readOnly} {...register('bin_location')} />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="item-desc">Descripción</Label>
                <Textarea id="item-desc" rows={2} disabled={readOnly} {...register('description')} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-border px-3.5 py-3">
                <p className="text-[13px] font-medium">Imagen</p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {imagePath
                    ? imagePath.split('/').pop()
                    : pendingImage
                      ? `Pendiente: ${pendingImage.name}`
                      : 'Sin imagen (bucket documentos, prefijo items/).'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!readOnly && (
                    <>
                      <input
                        id="item-image"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => onPickImage(event)}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('item-image')?.click()}>
                        <Plus />
                        {imagePath ? 'Reemplazar' : 'Adjuntar imagen'}
                      </Button>
                    </>
                  )}
                  {imagePath && (
                    <Button type="button" variant="outline" size="sm" onClick={() => void openDocument(imagePath)}>
                      <ExternalLink />
                      Abrir
                    </Button>
                  )}
                  {imagePath && !readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void removeDocument(imagePath, 'image')}
                    >
                      <X />
                      Quitar
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-border px-3.5 py-3">
                <p className="text-[13px] font-medium">Ficha técnica</p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {sheetPath
                    ? sheetPath.split('/').pop()
                    : pendingSheet
                      ? `Pendiente: ${pendingSheet.name}`
                      : 'Sin ficha técnica adjunta.'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!readOnly && (
                    <>
                      <input
                        id="item-sheet"
                        type="file"
                        className="hidden"
                        onChange={(event) => onPickSheet(event)}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('item-sheet')?.click()}>
                        <Plus />
                        {sheetPath ? 'Reemplazar' : 'Adjuntar ficha'}
                      </Button>
                    </>
                  )}
                  {sheetPath && (
                    <Button type="button" variant="outline" size="sm" onClick={() => void openDocument(sheetPath)}>
                      <ExternalLink />
                      Abrir
                    </Button>
                  )}
                  {sheetPath && !readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void removeDocument(sheetPath, 'sheet')}
                    >
                      <X />
                      Quitar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Costo y compra */}
          <section className="rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Costo y compra</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="item-cost">Costo unitario (último costo de compra)</Label>
                <Input
                  id="item-cost"
                  value={formatQty(item?.unit_cost ?? 0)}
                  disabled
                  readOnly
                  className="tabular-nums"
                />
                <p className="text-[12.5px] text-muted-foreground">
                  Solo lectura: se actualiza con cada Entrada (F4.3).
                </p>
              </div>
              <div className="space-y-2">
                <Label>Proveedor preferido</Label>
                <Select
                  value={watch('preferred_provider_id') || 'none'}
                  disabled={readOnly}
                  onValueChange={(value) => setValue('preferred_provider_id', value, { shouldDirty: true })}
                >
                  <SelectTrigger aria-label="Proveedor preferido" className="w-full">
                    <SelectValue placeholder="Sin proveedor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin proveedor</SelectItem>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Stock por bodega */}
          <section className="rounded-lg border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">Stock por bodega</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Mínimo por ítem y bodega (spec): puede pre-definirse sin existencias; la fila se
                  materializa con la primera Entrada o con guardar aquí.
                </p>
              </div>
              {!readOnly && addableWarehouses.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={addStockRow}>
                  <Plus />
                  Agregar bodega
                </Button>
              )}
            </div>

            {stockRows.length === 0 ? (
              <p className="mt-4 text-[13.5px] text-muted-foreground">
                Sin bodegas asociadas todavía{readOnly ? '.' : ': agrega una para definir el stock mínimo.'}
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border rounded-md border border-border">
                {stockRows.map((row, index) => {
                  const warehouse = warehouses.find((wh) => wh.id === row.warehouse_id)
                  const cell = existingCellByWarehouse.get(row.warehouse_id)
                  const qty = cell ? Number(cell.qty) : 0
                  return (
                    <li
                      key={row.warehouse_id}
                      className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5"
                    >
                      <div className="min-w-[140px]">
                        <p className="text-[13.5px] font-medium">{warehouse?.name ?? '—'}</p>
                        <p className="text-[12.5px] text-muted-foreground">
                          Stock actual:{' '}
                          <span className={`tabular-nums ${qty < 0 ? 'font-semibold text-destructive' : ''}`}>
                            {formatQty(qty)}
                          </span>
                          {cell?.is_low && <span className="ml-1 text-amber-600 dark:text-amber-400">· bajo mínimo</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`min-${row.warehouse_id}`} className="text-[12.5px] text-muted-foreground">
                          Mínimo
                        </Label>
                        <Input
                          id={`min-${row.warehouse_id}`}
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          className="w-[110px] tabular-nums"
                          disabled={readOnly}
                          value={row.min_stock}
                          onChange={(event) =>
                            setStockRows((rows) =>
                              rows.map((r, i) => (i === index ? { ...r, min_stock: event.target.value } : r)),
                            )
                          }
                        />
                        {!readOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Quitar bodega"
                            title={qty !== 0 ? 'Solo se quitan filas con stock 0' : 'Quitar del ítem'}
                            onClick={() =>
                              setStockRows((rows) => rows.filter((_, i) => i !== index))
                            }
                          >
                            <X />
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Vínculos con activos */}
          <section className="rounded-lg border border-border p-5">
            <h2 className="text-[15px] font-semibold">Vínculos con activos (repuestos compatibles)</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              N:N dinámico: los activos actuales y futuros de la categoría quedan vinculados. Usos:
              sugerir en la OT y checklist del Módulo 3.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div>
                <Label htmlFor="asset-search">Activos individuales (búsqueda por código/nombre/ubicación)</Label>
                <Input
                  id="asset-search"
                  className="mt-2"
                  placeholder="Ej. FC-01, Bomba…"
                  value={assetQuery}
                  disabled={readOnly}
                  onChange={(event) => setAssetQuery(event.target.value)}
                />
                <ul className="mt-2 max-h-[240px] overflow-y-auto rounded-md border border-border">
                  {filteredAssets.length === 0 ? (
                    <li className="px-3 py-4 text-center text-[13px] text-muted-foreground">
                      Sin activos que coincidan.
                    </li>
                  ) : (
                    filteredAssets.map((asset) => (
                      <li
                        key={asset.id}
                        className="flex items-center gap-2.5 px-3 py-2"
                      >
                        <Checkbox
                          id={`asset-${asset.id}`}
                          checked={assetLinks.has(asset.id)}
                          disabled={readOnly}
                          onCheckedChange={(checked) =>
                            setAssetLinks((current) => {
                              const next = new Set(current)
                              if (checked === true) next.add(asset.id)
                              else next.delete(asset.id)
                              return next
                            })
                          }
                        />
                        <label htmlFor={`asset-${asset.id}`} className="min-w-0 flex-1 cursor-pointer">
                          <span className="font-mono text-[12px]">{asset.code}</span>{' '}
                          <span className="text-[13px]">{asset.name}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {asset.location_path ?? '—'}
                          </span>
                        </label>
                      </li>
                    ))
                  )}
                </ul>
                <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                  {assetLinks.size} seleccionados
                  {filteredAssets.length >= 40 ? ' · refina la búsqueda para ver más' : ''}
                </p>
                {selectedAssets.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedAssets.map((asset) => (
                      <Badge key={asset.id} variant="secondary" className="gap-1 pr-1">
                        {asset.code}
                        {!readOnly && (
                          <button
                            type="button"
                            className="rounded-full px-1 hover:text-foreground"
                            aria-label={`Quitar ${asset.code}`}
                            onClick={() =>
                              setAssetLinks((current) => {
                                const next = new Set(current)
                                next.delete(asset.id)
                                return next
                              })
                            }
                          >
                            ×
                          </button>
                        )}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label>Categorías de activo (vínculo dinámico)</Label>
                <ul className="mt-2 max-h-[300px] overflow-y-auto rounded-md border border-border">
                  {assetCategories.length === 0 ? (
                    <li className="px-3 py-4 text-center text-[13px] text-muted-foreground">
                      Sin categorías de activo (M1).
                    </li>
                  ) : (
                    assetCategories.map((category) => (
                      <li key={category.id} className="flex items-center gap-2.5 px-3 py-2">
                        <Checkbox
                          id={`catlink-${category.id}`}
                          checked={categoryLinks.has(category.id)}
                          disabled={readOnly}
                          onCheckedChange={(checked) =>
                            setCategoryLinks((current) => {
                              const next = new Set(current)
                              if (checked === true) next.add(category.id)
                              else next.delete(category.id)
                              return next
                            })
                          }
                        />
                        <label htmlFor={`catlink-${category.id}`} className="min-w-0 flex-1 cursor-pointer">
                          <span className="text-[13px]">{category.name}</span>{' '}
                          <span className="ml-1 font-mono text-[11.5px] text-muted-foreground">
                            {category.code_prefix}
                          </span>
                        </label>
                      </li>
                    ))
                  )}
                </ul>
                {selectedAssetCategories.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedAssetCategories.map((category) => (
                      <Badge key={category.id} variant="outline" className="gap-1 pr-1">
                        {category.name}
                        {!readOnly && (
                          <button
                            type="button"
                            className="rounded-full px-1 hover:text-foreground"
                            aria-label={`Quitar ${category.name}`}
                            onClick={() =>
                              setCategoryLinks((current) => {
                                const next = new Set(current)
                                next.delete(category.id)
                                return next
                              })
                            }
                          >
                            ×
                          </button>
                        )}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {serverError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-snug text-destructive"
            >
              {serverError}
            </div>
          )}
        </form>
      </div>
    </main>
  )
}
