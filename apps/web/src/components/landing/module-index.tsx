const modules: Array<{ name: string; description: string }> = [
  {
    name: 'Activos',
    description: 'Ficha técnica, ubicación, garantías y vida útil de cada equipo.',
  },
  {
    name: 'Órdenes de trabajo',
    description: 'Correctivas y preventivas con técnicos, evidencia e historial.',
  },
  {
    name: 'Mantenimiento preventivo',
    description: 'Planes por tiempo o uso, calendario y generación automática de OTs.',
  },
  {
    name: 'Inventario',
    description: 'Repuestos, bodegas, movimientos y conteos de existencias.',
  },
  {
    name: 'Proveedores y contratistas',
    description: 'Catálogo, contratos, vigencias y proveedor preferido por activo.',
  },
  {
    name: 'Cumplimiento y mediciones',
    description: 'Certificaciones, renovaciones y alertas de medición fuera de rango.',
  },
  {
    name: 'Reportes y KPIs',
    description: 'Tablero por rol, exportes y reportes programados por correo.',
  },
]

export function ModuleIndex() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-5xl px-6 py-14 sm:px-10 lg:py-20">
        <h2 className="font-heading text-[26px] font-bold tracking-tight">Qué gestiona</h2>
        <ul className="mt-8 grid grid-cols-1 gap-x-12 md:grid-cols-2">
          {modules.map((module) => (
            <li key={module.name} className="border-t border-border py-4">
              <p className="text-[15px] font-semibold">{module.name}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
                {module.description}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[14px] text-muted-foreground">
          Además: usuarios y roles, configuración del sistema y registro de auditoría.
        </p>
      </div>
    </section>
  )
}
