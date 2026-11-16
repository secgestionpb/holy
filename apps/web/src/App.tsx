import { useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import AppLayout from '@/pages/app'
import ActivoFicha from '@/pages/activo-ficha'
import ActivoForm from '@/pages/activo-form'
import Activos from '@/pages/activos'
import ActivosCategorias from '@/pages/activos-categorias'
import Auditoria from '@/pages/auditoria'
import ChangePassword from '@/pages/change-password'
import Configuracion from '@/pages/configuracion'
import Conteo from '@/pages/conteo'
import ContratoForm from '@/pages/contrato-form'
import Cumplimiento from '@/pages/cumplimiento'
import CertificacionForm from '@/pages/certificacion-form'
import Inventario from '@/pages/inventario'
import ItemForm from '@/pages/item-form'
import Landing from '@/pages/landing'
import OrdenDetalle from '@/pages/orden-detalle'
import OrdenForm from '@/pages/orden-form'
import Ordenes from '@/pages/ordenes'
import Preventivo from '@/pages/preventivo'
import Planes from '@/pages/preventivo-planes'
import PlanForm from '@/pages/preventivo-plan-form'
import Plantillas from '@/pages/preventivo-plantillas'
import PlantillaForm from '@/pages/preventivo-plantilla-form'
import Panel from '@/pages/panel'
import ProveedorFicha from '@/pages/proveedor-ficha'
import ProveedorForm from '@/pages/proveedor-form'
import Proveedores from '@/pages/proveedores'
import ReportesDano from '@/pages/reportes-dano'
import Reportes from '@/pages/reportes'
import TipoMedicionForm from '@/pages/tipo-medicion-form'
import Usuarios from '@/pages/usuarios'
import { refreshSession } from '@/lib/auth'
import { isAdmin, useAuth } from '@/lib/auth-store'

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-primary" aria-label="Cargando" />
    </div>
  )
}

function useRestoreSession(enabled: boolean) {
  const accessToken = useAuth((s) => s.accessToken)
  const [checking, setChecking] = useState(enabled && !accessToken)

  useEffect(() => {
    if (!enabled || accessToken) return
    let alive = true
    void refreshSession().finally(() => {
      if (alive) setChecking(false)
    })
    return () => {
      alive = false
    }
  }, [enabled, accessToken])

  return { checking, accessToken }
}

function Protected({ children, allowMustChange = false }: { children: ReactNode; allowMustChange?: boolean }) {
  const user = useAuth((s) => s.user)
  const { checking, accessToken } = useRestoreSession(true)

  if (!accessToken && checking) return <FullScreenLoader />
  if (!user) return <Navigate to="/" replace />
  if (user.must_change_password && !allowMustChange) return <Navigate to="/cambio-clave" replace />
  return children
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const roles = useAuth((s) => s.roles)
  const location = useLocation()
  if (!isAdmin(roles)) return <Navigate to="/app" replace state={{ from: location.pathname }} />
  return children
}

function RequireMaintenance({ children }: { children: ReactNode }) {
  const roles = useAuth((s) => s.roles)
  if (!roles.includes('mantenimiento')) return <Navigate to="/app/activos" replace />
  return children
}

function RequireProviderAccess({ children }: { children: ReactNode }) {
  const roles = useAuth((s) => s.roles)
  const technicianOnly = roles.length > 0 && roles.every((role) => role === 'tecnico')
  if (technicianOnly) return <Navigate to="/app" replace />
  return children
}

function RequireQuality({ children }: { children: ReactNode }) {
  const roles = useAuth((s) => s.roles)
  if (!roles.includes('calidad')) return <Navigate to="/app/cumplimiento" replace />
  return children
}

function Home() {
  const user = useAuth((s) => s.user)
  const { checking, accessToken } = useRestoreSession(true)

  if (!accessToken && checking) return <FullScreenLoader />
  if (user) return <Navigate to="/app" replace />
  return <Landing />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/app"
          element={
            <Protected>
              <AppLayout />
            </Protected>
          }
        >
          <Route index element={<Panel />} />
          <Route path="activos" element={<Activos />} />
          <Route
            path="activos/nuevo"
            element={
              <RequireMaintenance>
                <ActivoForm />
              </RequireMaintenance>
            }
          />
          <Route
            path="activos/categorias"
            element={
              <RequireMaintenance>
                <ActivosCategorias />
              </RequireMaintenance>
            }
          />
          <Route path="activos/:id" element={<ActivoFicha />} />
          <Route
            path="activos/:id/editar"
            element={
              <RequireMaintenance>
                <ActivoForm />
              </RequireMaintenance>
            }
          />
          <Route path="ordenes" element={<Ordenes />} />
          <Route
            path="ordenes/nueva"
            element={
              <RequireMaintenance>
                <OrdenForm />
              </RequireMaintenance>
            }
          />
          <Route path="ordenes/:id" element={<OrdenDetalle />} />
          <Route path="preventivo" element={<Preventivo />} />
          <Route path="preventivo/planes" element={<Planes />} />
          <Route
            path="preventivo/planes/nuevo"
            element={
              <RequireMaintenance>
                <PlanForm />
              </RequireMaintenance>
            }
          />
          <Route
            path="preventivo/planes/:id"
            element={
              <RequireMaintenance>
                <PlanForm />
              </RequireMaintenance>
            }
          />
          <Route path="preventivo/plantillas" element={<Plantillas />} />
          <Route
            path="preventivo/plantillas/nueva"
            element={
              <RequireMaintenance>
                <PlantillaForm />
              </RequireMaintenance>
            }
          />
          <Route
            path="preventivo/plantillas/:id"
            element={
              <RequireMaintenance>
                <PlantillaForm />
              </RequireMaintenance>
            }
          />
          <Route
            path="ordenes/:id/editar"
            element={
              <RequireMaintenance>
                <OrdenForm />
              </RequireMaintenance>
            }
          />
          <Route
            path="reportes-dano"
            element={<ReportesDano />}
          />
          <Route path="reportes" element={<Reportes />} />
          <Route path="inventario" element={<Inventario />} />
          <Route
            path="inventario/item/nuevo"
            element={
              <RequireMaintenance>
                <ItemForm />
              </RequireMaintenance>
            }
          />
          <Route path="inventario/item/:id" element={<ItemForm />} />
          <Route
            path="inventario/conteo/nuevo"
            element={
              <RequireMaintenance>
                <Conteo />
              </RequireMaintenance>
            }
          />
          <Route path="inventario/conteo/:id" element={<Conteo />} />
          <Route
            path="proveedores"
            element={
              <RequireProviderAccess>
                <Proveedores />
              </RequireProviderAccess>
            }
          />
          <Route
            path="proveedores/nuevo"
            element={
              <RequireMaintenance>
                <ProveedorForm />
              </RequireMaintenance>
            }
          />
          <Route
            path="proveedores/:id"
            element={
              <RequireProviderAccess>
                <ProveedorFicha />
              </RequireProviderAccess>
            }
          />
          <Route
            path="proveedores/:id/editar"
            element={
              <RequireMaintenance>
                <ProveedorForm />
              </RequireMaintenance>
            }
          />
          <Route
            path="proveedores/:id/contratos/nuevo"
            element={
              <RequireMaintenance>
                <ContratoForm />
              </RequireMaintenance>
            }
          />
          <Route
            path="proveedores/:id/contratos/:contractId"
            element={
              <RequireMaintenance>
                <ContratoForm />
              </RequireMaintenance>
            }
          />
          <Route
            path="cumplimiento"
            element={
              <RequireProviderAccess>
                <Cumplimiento />
              </RequireProviderAccess>
            }
          />
          <Route
            path="cumplimiento/certificaciones/nueva"
            element={
              <RequireQuality>
                <CertificacionForm />
              </RequireQuality>
            }
          />
          <Route
            path="cumplimiento/certificaciones/:id"
            element={
              <RequireProviderAccess>
                <CertificacionForm />
              </RequireProviderAccess>
            }
          />
          <Route
            path="cumplimiento/tipos/nuevo"
            element={
              <RequireQuality>
                <TipoMedicionForm />
              </RequireQuality>
            }
          />
          <Route
            path="cumplimiento/tipos/:id"
            element={
              <RequireQuality>
                <TipoMedicionForm />
              </RequireQuality>
            }
          />
          <Route
            path="usuarios"
            element={
              <RequireAdmin>
                <Usuarios />
              </RequireAdmin>
            }
          />
          <Route
            path="configuracion"
            element={
              <RequireAdmin>
                <Configuracion />
              </RequireAdmin>
            }
          />
          <Route
            path="auditoria"
            element={
              <RequireAdmin>
                <Auditoria />
              </RequireAdmin>
            }
          />
        </Route>
        <Route
          path="/cambio-clave"
          element={
            <Protected allowMustChange>
              <ChangePassword />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
