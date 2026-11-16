import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth-store'
import { Badge } from '@/components/ui/badge'

const modules: Array<{ name: string; description: string; to?: string }> = [
  { name: 'Activos', description: 'Ficha técnica, ubicación, garantías y vida útil de cada equipo.', to: '/app/activos' },
  { name: 'Órdenes de trabajo', description: 'Correctivas y preventivas con técnicos, evidencia e historial.', to: '/app/ordenes' },
  { name: 'Mantenimiento preventivo', description: 'Planes por tiempo o uso, calendario y generación automática de OTs.', to: '/app/preventivo' },
  { name: 'Inventario', description: 'Repuestos, bodegas, movimientos y conteos de existencias.', to: '/app/inventario' },
  { name: 'Proveedores y contratistas', description: 'Catálogo, contratos, vigencias y proveedor preferido por activo.', to: '/app/proveedores' },
  { name: 'Cumplimiento y mediciones', description: 'Certificaciones, renovaciones y alertas de medición fuera de rango.', to: '/app/cumplimiento' },
  { name: 'Reportes y KPIs', description: 'Tablero por rol, exportes y reportes programados por correo.', to: '/app/reportes' },
  { name: 'Usuarios y roles', description: 'Alta, baja, roles múltiples y restablecimiento de contraseñas.', to: '/app/usuarios' },
  { name: 'Configuración del sistema', description: 'Parámetros generales, categorías y catálogos del hotel.', to: '/app/configuracion' },
  { name: 'Registro de auditoría', description: 'Historial inmutable de cada acción sobre los datos del sistema.', to: '/app/auditoria' },
]

export default function Panel() {
  const user = useAuth((s) => s.user)
  const roles = useAuth((s) => s.roles)
  const firstName = user?.full_name?.split(' ')[0] ?? 'usuario'
  const isAdmin = roles.includes('administrador')
  const technicianOnly = roles.length > 0 && roles.every((role) => role === 'tecnico')

  return (
    <main>
      <section className="blueprint border-b border-panel-border px-6 py-10 sm:px-10 lg:py-14">
        <div className="mx-auto max-w-6xl">
          <p className="text-[12.5px] font-semibold tracking-[0.14em] text-primary uppercase">Panel</p>
          <h1 className="font-heading mt-2 text-[clamp(1.7rem,3vw,2.3rem)] font-extrabold tracking-[-0.02em] text-panel-foreground">
            Hola, {firstName}
          </h1>
          <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-panel-foreground/60">
            Sesión iniciada como {user?.email}. Entra a cada módulo desde las tarjetas de abajo o
            desde el menú superior.
          </p>
        </div>
      </section>

      <section className="px-6 py-10 sm:px-10 lg:py-14">
        <div className="mx-auto max-w-6xl">
          <h2 className="font-heading text-[22px] font-bold tracking-tight">Módulos</h2>
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules
              .filter((module) => module.to !== '/app/auditoria' || isAdmin)
              .filter((module) => module.to !== '/app/proveedores' || !technicianOnly)
              .filter((module) => module.to !== '/app/cumplimiento' || !technicianOnly)
              .map((module) => {
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-heading text-[15.5px] font-bold">{module.name}</h3>
                      {module.to ? (
                        <Badge variant="outline" className="text-[11px] font-semibold text-primary">
                          Activo
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Próximamente</Badge>
                      )}
                    </div>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                      {module.description}
                    </p>
                  </>
                )
                return (
                  <li key={module.name}>
                    {module.to ? (
                      <Link
                        to={module.to}
                        className="block rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="rounded-lg border border-border bg-card p-5">{body}</div>
                    )}
                  </li>
                )
              })}
          </ul>
        </div>
      </section>
    </main>
  )
}
