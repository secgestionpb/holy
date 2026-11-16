# Módulo T3: Log de Auditoría (Transversal)

> **Entregables:** spec (abajo) · **Flujos/Interfaces:** [T3-log-auditoria-flujos.md](T3-log-auditoria-flujos.md)
> **Tablas BD:** [audit_log](BD/audit_log.md) (append-only, poblado por triggers PG — única tabla) — **referenciadas:** [users](BD/users.md) · [notification_config](BD/notification_config.md) · [scheduled_reports](BD/scheduled_reports.md) · [system_parameters](BD/system_parameters.md)

```xml
<module id="T3" name="Log de Auditoría" type="transversal">
  <access>Exclusivo del rol ADMINISTRADOR para la vista de listado general.</access>
  <retention>INDEFINIDA — sin archivado ni purga automática.</retention>
  <immutability>Solo lectura — nadie edita ni elimina entradas, ni siquiera
    Administrador.</immutability>
  <export>Exportable a PDF y Excel, con los filtros aplicados.</export>

  <record_fields> <!-- BD: audit_log -->
    <field>fecha/hora (automática, precisión de segundos)</field>
    <field>usuario (sin distinguir bajo qué rol actuó, aun si el usuario tiene
      múltiples roles)</field>
    <field>módulo (Activos / OTs / Inventario / Proveedores / PM / Cumplimiento
      / Mediciones / Usuarios / Configuración)</field>
    <field>entidad afectada (ej. OT #1842, Activo FCU-305, Ítem F-0021, Usuario
      Juan Pérez)</field>
    <field>acción (Crear / Modificar / Desactivar / Cambio de estado / Cierre /
      Reapertura / Reasignación / Reseteo de contraseña, etc.)</field>
    <field>detalle del cambio (campo, valor anterior → valor nuevo, cuando
      aplique)</field>
    <field>motivo/observación (cuando el evento lo exige: ajustes de
      inventario, cancelaciones, reaperturas, reasignaciones)</field>
    <field>IP/dispositivo (opcional)</field>
  </record_fields>

  <events_by_module>
    <item module="Activos">Creación, modificación, cambio de estado operativo y
      etapa de vida, baja</item>
    <item module="Órdenes de Trabajo">Creación, modificación, cambio de estado,
      asignación/reasignación (con observación), consumo y devolución de
      repuestos, cierre, reapertura (con motivo), cancelación</item>
    <item module="Reportes de Daño">Creación, conversión a OT, descarte <!-- BD: BD/damage_reports.md --></item>
    <item module="Inventario">Entradas, salidas, ajustes (con motivo),
      transferencias, conteos confirmados, devoluciones</item>
    <item module="Garantías">Creación, extensión/renovación</item>
    <item module="Proveedores/Contratistas">CRUD de ficha, CRUD de contratos</item>
    <item module="Mantenimiento Preventivo">CRUD de planes, reprogramación de
      fechas (puntual o de plan completo)</item>
    <item module="Cumplimiento Normativo">CRUD de certificaciones, renovaciones
      (historial de vigencias)</item>
    <item module="Mediciones">Registro de mediciones (especialmente las fuera de
      rango)</item>
    <item module="Usuarios">Creación, modificación, asignación de roles,
      desactivación, reseteo de contraseña</item>
    <item module="Configuración">Cambios en destinatarios, parámetros,
      activación/desactivación de eventos y reportes programados
      <!-- BD: notification_config, scheduled_reports, system_parameters --></item>
  </events_by_module>

  <views>
    <view name="Listado general">
      Pantalla propia del módulo, solo Administrador. Filtros: usuario, módulo,
      entidad, tipo de acción, rango de fechas. Exportable.
    </view>
    <view name="Línea de tiempo embebida por entidad">
      Pestaña "Historial" dentro de la ficha de cualquier entidad relevante
      (OT, Activo, Certificación, Usuario, etc.) — muestra los mismos datos del
      log, filtrados automáticamente por esa entidad. Visible según los
      permisos propios de esa ficha (ej. un Técnico ve el historial de su
      propia OT aunque no tenga acceso al listado general del log). NO es una
      fuente de datos aparte, es una vista filtrada del mismo log.
    </view>
  </views>
</module>
```
