# CMMS Hotelero — Información General del Proyecto

Contexto, alcance, stack y reglas generales del proyecto. Fuente de verdad para todas las decisiones.

```xml
<project>
  <name>CMMS Hotelero</name>
  <description>
    Sistema Computarizado de Gestión de Mantenimiento (CMMS) para uso exclusivo de
    gestión de activos y mantenimiento en un hotel. NO incluye gestión comercial de
    huéspedes, reservas ni folios. Por decisión de alcance, NO se integra con el PMS
    (Property Management System) del hotel, ya que el PMS actual es cerrado y no
    expone API. Tampoco se integra, por el momento, con un sistema externo de
    reportes de incidencias (app web ya existente), aunque el diseño debe dejar
    previsto un punto de integración futura vía API con esa app.
  </description>
  <stack>
    <architecture>Monorepo</architecture>
    <components>
      <component>API REST (backend)</component>
      <component>App Web (frontend)</component>
      <component>PWA (Progressive Web App) para instalación en dispositivos móviles de técnicos, habilita notificaciones push</component>
    </components>
  </stack>

  <explicit_scope_exclusions>
    <item>No hay integración con el PMS del hotel (es un sistema cerrado). El estado
      de habitación "fuera de servicio" (OOO/OOS) NO se gestiona ni sincroniza
      automáticamente; queda fuera del alcance de este sistema.</item>
    <item>No hay integración con BMS/BAS (Building Management System).</item>
    <item>No se gestionan órdenes de compra (OC); el módulo de inventario solo
      registra entradas ya recibidas.</item>
    <item>No hay app móvil nativa; la PWA cubre esa necesidad.</item>
    <item>No hay autenticación SSO (el hotel no usa Google Workspace ni Microsoft 365).</item>
    <item>No hay 2FA por el momento (decisión explícita, revaluable a futuro).</item>
  </explicit_scope_exclusions>

  <!-- ==================================================================== -->
  <!-- PENDIENTES ABIERTOS (3 futuros declarados; los 2 primeros del diseño  -->
  <!-- original ya fueron RESUELTOS — ver items 1 y 2 abajo)                -->
  <!-- ==================================================================== -->
  <open_pending_items>
    <item>RESUELTO — detalle completo de vistas y flujos de datos de cada
      módulo: ver los 10 entregables de flujos (índice en
      entregables_index abajo).</item>
    <item>RESUELTO — infraestructura completa (hosting, base de datos,
      arquitectura del API REST, JWT, proveedor de correos, proveedor de
      push): ver [stack-tecnologico](stack-tecnologico.md).</item>
    <item>Evaluar en el futuro: integración por API con el PMS del hotel (hoy
      cerrado) para sincronizar automáticamente estados OOO/OOS de habitaciones.</item>
    <item>Evaluar en el futuro: integración por API con la app web externa de
      reportes de incidencias ya existente.</item>
    <item>Evaluar en el futuro: integración con canal de mensajería tipo
      WhatsApp Business API como canal adicional de notificaciones (el campo
      "canal" ya está previsto en el diseño para soportarlo sin romper la lógica
      actual).</item>
    <item>Asignación de herramientas a técnicos — nuevo requerimiento del
      cliente (sin spec actual; "herramienta" no existe en el catálogo de
      activos). Diseño pendiente: catálogo de herramientas (tabla propia
      vs. assets con categoría "Herramientas"), asignación con fechas
      (préstamo/devolución) a usuarios con rol técnico, visibilidad en la
      ficha del técnico y en la OT, y reglas de disponibilidad.</item>
    <item>Backup automático local de los archivos de Storage + limpieza
      periódica — IMPLEMENTADO Y CERRADO (spec en
      [08-backup-storage-limpieza](08-backup-storage-limpieza.md) con
      implementation_notes; decisiones 8.1–8.9: retención 120d solo
      objetos ot_evidencias borrando SOLO el objeto, documentos
      permanentes intactos, enlace roto con mensaje en UI, compresión
      ≤500 KB + límite 5 MB en subidas, purga semi-manual dry-run +
      --apply, scripts/backup_storage.py Python stdlib + Task Scheduler
      + BACKUP_DIR). Smoke OK (dry-run 5/5 buckets verificados,
      incremental, --apply, compresión 12.96 MB→499 KB, placeholder
      enlace roto).</item>
  </open_pending_items>

  <entregables_index>
    <note>Formato por módulo: spec (fuente recortada de cmmsProject.md) +
      flujos/interfaces (decisions, navigation, views, flows, cross,
      notifications, supabase_mapping, open_pending) + 1 archivo BD por
      tabla. La spec cmmsProject.md es el snapshot original y NO se
      modifica.</note>
    <module n="1" name="Gestión de Activos">spec:
      [01-gestion-de-activos](01-gestion-de-activos.md) · flujos:
      [01-gestion-de-activos-flujos](01-gestion-de-activos-flujos.md) ·
      BD: 6 (assets, locations, categories, warranties, asset_files,
      code_counters)</module>
    <module n="2" name="Órdenes de Trabajo">spec:
      [02-ordenes-de-trabajo](02-ordenes-de-trabajo.md) · flujos:
      [02-ordenes-de-trabajo-flujos](02-ordenes-de-trabajo-flujos.md) ·
      BD: 6 (work_orders, damage_reports, wo_technicians,
      wo_checklist_entries, wo_evidence, wo_comments)</module>
    <module n="3" name="Mantenimiento Preventivo">spec:
      [03-mantenimiento-preventivo](03-mantenimiento-preventivo.md) ·
      flujos:
      [03-mantenimiento-preventivo-flujos](03-mantenimiento-preventivo-flujos.md)
      · BD: 2 (maintenance_plans, checklist_templates)</module>
    <module n="4" name="Inventario">spec:
      [04-inventario](04-inventario.md) · flujos:
      [04-inventario-flujos](04-inventario-flujos.md) · BD: 7 (items,
      item_categories, warehouses, warehouse_stock, stock_movements,
      physical_counts, item_asset_links)</module>
    <module n="5" name="Proveedores y Contratistas">spec:
      [05-proveedores-contratistas](05-proveedores-contratistas.md) ·
      flujos:
      [05-proveedores-contratistas-flujos](05-proveedores-contratistas-flujos.md)
      · BD: 2 (providers, contracts)</module>
    <module n="6" name="Cumplimiento y Mediciones">spec:
      [06-cumplimiento-mediciones](06-cumplimiento-mediciones.md) ·
      flujos:
      [06-cumplimiento-mediciones-flujos](06-cumplimiento-mediciones-flujos.md)
      · BD: 4 (certifications, compliance_categories, measurement_types,
      measurement_records)</module>
    <module n="7" name="Reportes y KPIs">spec:
      [07-reportes-kpis](07-reportes-kpis.md) · flujos:
      [07-reportes-kpis-flujos](07-reportes-kpis-flujos.md) · BD: 3
      (user_dashboard_kpis, scheduled_reports, report_send_log)</module>
    <module n="T1" name="Usuarios y Roles">spec:
      [T1-usuarios-y-roles](T1-usuarios-y-roles.md) · flujos:
      [T1-usuarios-y-roles-flujos](T1-usuarios-y-roles-flujos.md) · BD: 4
      (users, user_roles, user_category_assignments, failed_logins)</module>
    <module n="T2" name="Configuración/Opciones">spec:
      [T2-configuracion](T2-configuracion.md) · flujos:
      [T2-configuracion-flujos](T2-configuracion-flujos.md) · BD: 4
      (notification_config, notification_log, push_subscriptions,
      system_parameters)</module>
    <module n="T3" name="Log de Auditoría">spec:
      [T3-log-auditoria](T3-log-auditoria.md) · flujos:
      [T3-log-auditoria-flujos](T3-log-auditoria-flujos.md) · BD: 1
      (audit_log)</module>
    <stack>[stack-tecnologico](stack-tecnologico.md) (arquitectura, capas,
      tier gratuito, restricciones)</stack>
    <total_bd>39 archivos en markdown/BD/ (tablas principales +
      hermanas incluidas en su archivo padre).</total_bd>
  </entregables_index>

  <instructions_for_agent>
    <instruction>Usa esta especificación como fuente de verdad para todas las
      decisiones de modelo de datos, reglas de negocio, permisos por rol y flujos
      que ya fueron acordadas. No reinterpretes ni cambies una decisión ya tomada
      sin señalarlo explícitamente y preguntar antes de proceder.</instruction>
    <instruction>Cuando una sección quede marcada en "open_pending_items",
      pregunta antes de asumir un diseño, ya que son decisiones aún no tomadas
      por el equipo del proyecto.</instruction>
    <instruction>Respeta estrictamente las matrices de permisos por rol
      (Mantenimiento, Técnico, Administrador, Calidad) descritas en cada módulo
      al generar controladores, middlewares o validaciones de autorización.</instruction>
    <instruction>Todo evento que modifique datos relevantes (activos, OTs,
      inventario, usuarios, configuración, etc.) debe registrar una entrada en el
      Log de Auditoría (módulo T3), siguiendo la estructura de campos definida.</instruction>
    <instruction>Respeta el patrón de tabla de configuración de notificaciones
      <!-- BD: BD/notification_config.md --> (módulo T2) para cualquier nuevo evento de notificación que se agregue a
      futuro: debe quedar en esa tabla como fila editable (correo, modo de envío,
      destinatarios, parámetros), no hardcodeado en el código de negocio.</instruction>
  </instructions_for_agent>
</project>
```
