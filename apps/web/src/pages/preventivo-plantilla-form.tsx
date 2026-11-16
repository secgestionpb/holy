import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowUp, ArrowDown, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  getChecklistTemplate,
  createTemplate,
  updateTemplate,
  replaceTemplateItems,
} from '@/lib/m3'
import { fetchCategories, type CategoryRow } from '@/lib/m1'

export default function PlantillaForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('none')
  const [isActive, setIsActive] = useState(true)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [items, setItems] = useState<string[]>([''])

  useEffect(() => {
    let alive = true
    Promise.all([fetchCategories(), isEdit ? getChecklistTemplate(id!) : Promise.resolve(null)])
      .then(([categoryRows, template]) => {
        if (!alive) return
        setCategories(categoryRows)
        if (template) {
          setName(template.name)
          setCategoryId(template.category_id ?? 'none')
          setIsActive(template.is_active)
          const texts = [...(template.checklist_items ?? [])]
            .sort((a, b) => a.position - b.position)
            .map((item) => item.text)
          setItems(texts.length > 0 ? texts : [''])
        }
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        toast.error(err instanceof Error ? err.message : 'No se pudo cargar la plantilla.')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id, isEdit])

  function moveItem(index: number, delta: number) {
    setItems((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function save() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('El nombre es obligatorio.')
      return
    }
    const cleanedItems = items.map((text) => text.trim()).filter(Boolean)
    if (cleanedItems.length === 0) {
      toast.error('La plantilla necesita al menos un ítem de checklist.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: trimmedName,
        category_id: categoryId === 'none' ? null : categoryId,
        is_active: isActive,
      }
      const template = isEdit
        ? await updateTemplate(id!, payload).then(() => ({ id: id! }))
        : await createTemplate(payload)
      await replaceTemplateItems(template.id, cleanedItems)
      toast.success('Plantilla guardada')
      navigate('/app/preventivo/plantillas')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar la plantilla.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className='p-6 max-w-3xl mx-auto flex items-center gap-2 text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Cargando plantilla…
      </main>
    )
  }

  return (
    <main className='p-6 max-w-3xl mx-auto'>
      <Button variant='ghost' onClick={() => navigate(-1)}>
        <ArrowLeft className='mr-2' />Volver
      </Button>
      <div className='mt-4 flex items-center justify-between'>
        <h1 className='text-2xl font-bold'>{isEdit ? 'Editar Plantilla' : 'Nueva Plantilla'}</h1>
        <Badge variant={isActive ? 'default' : 'secondary'}>{isActive ? 'Activa' : 'Inactiva'}</Badge>
      </div>

      <div className='space-y-6 mt-6'>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <div className='space-y-2'>
            <Label htmlFor='tpl-name'>Nombre</Label>
            <Input
              id='tpl-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='Ej. Checklist preventivo A/C'
            />
          </div>
          <div className='space-y-2'>
            <Label>Categoría (opcional)</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className='w-full'>
                <SelectValue placeholder='Sin categoría' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='none'>Sin categoría</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <label className='flex items-center gap-3 rounded-md border p-3 w-fit'>
          <Checkbox checked={isActive} onCheckedChange={(checked) => setIsActive(checked === true)} />
          <span className='text-sm font-medium'>Plantilla activa</span>
        </label>

        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <Label>Ítems del checklist ({items.filter((text) => text.trim()).length})</Label>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setItems((prev) => [...prev, ''])}
            >
              <Plus className='mr-1 h-4 w-4' />Agregar ítem
            </Button>
          </div>
          <div className='space-y-2'>
            {items.map((text, index) => (
              <div key={index} className='flex items-center gap-2'>
                <span className='w-6 text-center text-xs text-muted-foreground tabular-nums'>
                  {index + 1}
                </span>
                <Input
                  value={text}
                  placeholder={`Paso ${index + 1} del mantenimiento…`}
                  onChange={(event) =>
                    setItems((prev) => prev.map((value, i) => (i === index ? event.target.value : value)))
                  }
                />
                <div className='flex items-center'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label='Subir ítem'
                    disabled={index === 0}
                    onClick={() => moveItem(index, -1)}
                  >
                    <ArrowUp className='h-4 w-4' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label='Bajar ítem'
                    disabled={index === items.length - 1}
                    onClick={() => moveItem(index, 1)}
                  >
                    <ArrowDown className='h-4 w-4' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label='Eliminar ítem'
                    disabled={items.length === 1}
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <p className='text-[12.5px] text-muted-foreground'>
            Los ítems se copian (snapshot) a cada OT preventiva generada con esta plantilla. Marcar
            «No aplica» exige una observación.
          </p>
        </div>

        <Button type='button' className='w-full' onClick={save} disabled={saving}>
          {saving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          Guardar Plantilla
        </Button>
      </div>
    </main>
  )
}
