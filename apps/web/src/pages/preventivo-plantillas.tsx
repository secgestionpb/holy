import { useState, useEffect } from 'react'
import { getChecklistTemplates, type ChecklistTemplate } from '@/lib/m3'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-store'

export default function Plantillas() {
  const canEdit = useAuth((s) => s.roles).includes('mantenimiento')
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getChecklistTemplates()
      .then(setTemplates)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'No se pudieron cargar las plantillas.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className='p-6 space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold'>Plantillas de Checklist</h1>
          <p className='text-sm text-muted-foreground'>
            {canEdit ? 'Los ítems se copian (snapshot) a cada OT preventiva al generarse.' : 'Solo lectura para tu rol.'}
          </p>
        </div>
        {canEdit && (
          <Button asChild>
            <Link to='/app/preventivo/plantillas/nueva'>Nueva Plantilla</Link>
          </Button>
        )}
      </div>
      {loading ? (
        <div className='flex items-center gap-2 text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Cargando plantillas…
        </div>
      ) : templates.length === 0 ? (
        <div className='p-8 text-center text-muted-foreground border rounded-lg'>
          Aún no hay plantillas. Crea una para adjuntarla a un plan de mantenimiento.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Ítems</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell className='font-medium'>{template.name}</TableCell>
                <TableCell>{template.checklist_items?.length ?? 0}</TableCell>
                <TableCell>
                  <Badge variant={template.is_active ? 'default' : 'secondary'}>
                    {template.is_active ? 'Activa' : 'Inactiva'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <Button variant='outline' size='sm' asChild>
                      <Link to={`/app/preventivo/plantillas/${template.id}`}>Editar</Link>
                    </Button>
                  ) : (
                    <span className='text-sm text-muted-foreground'>—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
