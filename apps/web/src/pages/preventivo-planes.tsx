import { useState, useEffect } from 'react'
import { getPlans, type MaintenancePlan } from '@/lib/m3'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-store'

const FREQUENCY_LABELS: Record<MaintenancePlan['frequency_type'], string> = {
  time: 'Tiempo',
  usage: 'Uso',
}

export default function Planes() {
  const canEdit = useAuth((s) => s.roles).includes('mantenimiento')
  const [plans, setPlans] = useState<MaintenancePlan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPlans()
      .then(setPlans)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'No se pudieron cargar los planes.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className='p-6 space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold'>Planes de Mantenimiento</h1>
          <p className='text-sm text-muted-foreground'>
            {canEdit ? 'Crea y edita planes; el job diario (02:00) genera las OTs.' : 'Solo lectura para tu rol.'}
          </p>
        </div>
        {canEdit && (
          <Button asChild>
            <Link to='/app/preventivo/planes/nuevo'>Nuevo Plan</Link>
          </Button>
        )}
      </div>
      {loading ? (
        <div className='flex items-center gap-2 text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Cargando planes…
        </div>
      ) : plans.length === 0 ? (
        <div className='p-8 text-center text-muted-foreground border rounded-lg'>
          Aún no hay planes. Crea el primero para que el job diario genere OTs preventivas.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Frecuencia</TableHead>
              <TableHead>Alcance</TableHead>
              <TableHead>Próx. Ejecución</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell className='font-medium'>{plan.name}</TableCell>
                <TableCell>
                  {FREQUENCY_LABELS[plan.frequency_type]} · cada {plan.interval_value}
                </TableCell>
                <TableCell>
                  {(plan.plan_asset_links?.length ?? 0) + (plan.plan_category_links?.length ?? 0) || '—'}
                </TableCell>
                <TableCell>{plan.next_due_at ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={plan.is_active ? 'default' : 'secondary'}>
                    {plan.is_active ? 'Activo' : 'Inactivo'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <Button variant='outline' size='sm' asChild>
                      <Link to={`/app/preventivo/planes/${plan.id}`}>Editar</Link>
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
