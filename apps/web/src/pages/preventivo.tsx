import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/auth-store'
import Ordenes from '@/pages/ordenes'
import { PreventivoCalendar } from '@/components/preventivo/preventivo-calendar'

export default function Preventivo() {
  const roles = useAuth((s) => s.roles)
  const isTechnician = roles.includes('tecnico')
  const [tab, setTab] = useState(isTechnician ? 'list' : 'calendar')

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mantenimiento Preventivo</h1>
          <p className="text-sm text-muted-foreground">
            Planes por tiempo o uso, generación automática de OTs y checklist de ejecución.
          </p>
        </div>
        <div className="flex gap-3">
          <Link to="/app/preventivo/planes" className="text-sm text-primary hover:underline">Gestionar planes</Link>
          <Link to="/app/preventivo/plantillas" className="text-sm text-primary hover:underline">Plantillas de checklist</Link>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          {!isTechnician && <TabsTrigger value="calendar">Calendario</TabsTrigger>}
          <TabsTrigger value="list">Lista</TabsTrigger>
        </TabsList>
        {!isTechnician && (
          <TabsContent value="calendar">
            <PreventivoCalendar />
          </TabsContent>
        )}
        <TabsContent value="list">
          <Ordenes />
        </TabsContent>
      </Tabs>
    </div>
  )
}
