# Módulo T3: Log de Auditoría — Flujos, Interfaces y Mapeo Supabase

> Spec fuente: [T3-log-auditoria.md](T3-log-auditoria.md)
> **Tablas BD del Módulo T3:** [audit_log](BD/audit_log.md) (append-only, poblada por triggers PG — única tabla; diseño completo ya existente) — **referenciadas (otros módulos):** [users](BD/users.md) · [scheduled_reports](BD/scheduled_reports.md) · [notification_config](BD/notification_config.md) · [system_parameters](BD/system_parameters.md)

```xml
<module id="T3" name="Log de Auditoría — Flujos" type="transversal">

  <decisions_taken>
    <decision n="T3.1">SIN TABLAS NUEVAS: audit_log ya está diseñado como
      tabla compartida (BD/audit_log.md) — este módulo aporta SOLO vistas,
      flujos de consulta y las reglas de población/retención.</decision>
    <decision n="T3.2">POBLACIÓN DE DOBLE VÍA (ambas anti-falsificación):
      (a) TRIGGERS PG en cada tabla de negocio (INSERT/UPDATE/DELETE →
      fila con changes JSONB old/new, entity_label denormalizado) — el
      front nunca puede falsear el log; (b) RPC fn_audit (SECURITY
      DEFINER, solo service role/Edge Function) para acciones SEMÁNTICAS
      que el trigger no infiere (state_change, close, reopen, reassign,
      password_reset, count_confirm, import) y para adjuntar
      ip/user_agent cuando el backend tiene el contexto de request.</decision>
    <decision n="T3.3">IP/DISPOSITIVO opcional (spec record_fields):
      se llena en escrituras vía RPC con contexto de request; en escrituras
      puras de trigger queda NULL — es un campo "cuando
      aplique".</decision>
    <decision n="T3.4">MAPEO módulo spec → enum de audit_log.module
      (11 = 11): Activos→assets · Órdenes de Trabajo→work_orders · Reportes
      de Daño→damage_reports · Inventario→inventory · Garantías→warranties ·
      Proveedores/Contratistas→providers · Mantenimiento
      Preventivo→preventive_maintenance · Cumplimiento Normativo→compliance ·
      Mediciones→measurements · Usuarios→users · Configuración→configuration
      (el enum del CHECK ya contiene los 11 — incluye Reportes de Daño y
      Garantías que no aparecen en el listado corto de record_fields pero sí
      en events_by_module).</decision>
    <decision n="T3.5">RLS de SELECT abierta a autenticados + segmentación
      en la APP: para que la línea de tiempo embebida funcione en fichas de
      cualquier rol (spec: "un Técnico ve el historial de su propia OT
      aunque no tenga acceso al listado general"), el SELECT no puede
      bloquearse por rol; la UI decide — listado general solo Admin,
      timeline por entidad según el permiso de esa ficha. Escritura solo
      triggers/service role; UPDATE/DELETE prohibidos para TODOS los roles,
      incluido Administrador (spec immutability).</decision>
    <decision n="T3.6">RETENCIÓN indefinida sin archivado ni purga (spec);
      si el volumen lo exige en el futuro, particionado por año (pendiente).
      Los filtros del listado usan índices por module, user, entity y
      fecha.</decision>
    <decision n="T3.7">EXPORT con el MISMO utilitario F7.3 del Módulo 7
      (PDF/Excel con filtros aplicados — spec export; decisión 7.6 ya lo
      declaró para T3).</decision>
  </decisions_taken>

  <navigation>
    <lateral_menu admin_only="true">
      <item view="V-T3.1" label="Auditoría">Módulo T3 — entrada en
        admin_items
        [02-ordenes-de-trabajo-flujos](02-ordenes-de-trabajo-flujos.md)
        (Usuarios | Configuración | Auditoría — solo Admin; spec access:
        "Exclusivo del rol ADMINISTRADOR para la vista de listado
        general").</item>
    </lateral_menu>
    <embedded_entry>V-T3.2 NO es un ítem de menú: es la pestaña
      "Historial" dentro de las fichas (activos V1.3, OT V2.3,
      certificaciones M6, usuarios V-T1.1, etc.) — visible según los
      permisos de esa ficha.</embedded_entry>
    <by_role>
      <administrador>Ítem Auditoría completo.</administrador>
      <otros_roles>Sin ítem; solo ven la timeline embebida de las fichas a
        las que tienen acceso.</otros_roles>
    </by_role>
  </navigation>

  <views>
    <view id="V-T3.1" name="Auditoría — Listado general" type="principal">
      <entry_point>Menú lateral → Auditoría (solo Admin).</entry_point>
      <columns>Fecha/hora (segundos) | Usuario (o "Sistema") | Módulo |
        Entidad afectada | Acción | Detalle del cambio (campo: anterior →
        nuevo) | Motivo/observación | IP/dispositivo.</columns>
      <filters>Usuario (multi) · Módulo (select de los 11) · Entidad
        (búsqueda por entity_label) · Tipo de acción (select: create,
        update, state_change, deactivate, close, reopen, reassign, import,
        password_reset, count_confirm…) · Rango de fechas (default: últimos
        30 días).</filters>
      <pagination>Paginación por cursor (BIGSERIAL id DESC) — retención
        indefinida, nunca se carga el log completo.</pagination>
      <actions>Exportar PDF/Excel (F7.3 con filtros) · fila → expandir
        detalle JSONB.</actions>
      <readonly>100% solo lectura — sin acciones de edición/borrado en la
        UI (spec immutability).</readonly>
    </view>

    <view id="V-T3.2" name="Línea de tiempo embebida por entidad" type="component">
      <entry_point>Pestaña "Historial" en la ficha de cualquier entidad
        relevante (OT, Activo, Certificación, Usuario, Ítem, Contrato,
        Plan…).</entry_point>
      <query>MISMA tabla audit_log WHERE entity_type = X AND entity_id = Y
        ORDER BY created_at DESC — "NO es una fuente de datos aparte, es una
        vista filtrada del mismo log" (spec).</query>
      <visibility>Según los permisos propios de esa ficha (ej. Técnico ve el
        historial de su propia OT — regla is_assigned_wo; Admin ve todo;
        Calidad ve certificaciones…).</visibility>
      <timeline_ui>Línea vertical con fecha, usuario, acción (badge) y
        diff: campo anterior (tachado) → nuevo; motivo cuando
        existe.</timeline_ui>
    </view>
  </views>

  <flows>

    <flow id="F-T3.1" name="Registro de un evento de auditoría" actor="sistema (triggers / RPC)">
      <entry>Cualquier escritura de negocio en los módulos 1–7, T1 y T2.</entry>
      <steps>
        <step>1. Vía TRIGGER (base): trigger AFTER INSERT/UPDATE/DELETE en la
          tabla de negocio → construye fila (module, entity_type/entity_id,
          entity_label, action por defecto `create`/`update`/`delete_tech`…,
          changes JSONB {"campo":{"old":..,"new":..}}, user_id desde
          auth.uid()).</step>
        <step>2. Vía RPC fn_audit (acción semántica): la lógica de negocio
          (service role) llama fn_audit(module, entity, action, reason, ip,
          user_agent) cuando el cambio tiene semántica especial — bajas con
          motivo obligatorio, cierres/reaperturas, reasignaciones (con
          observación), reseteo de contraseña, confirmación de conteo,
          importación masiva (entrada consolidada).</step>
        <step>3. Resultado: fila append-only inmutable.</step>
      </steps>
      <rules>El front NUNCA inserta directo (decisión T3.2) · motivo
        obligatorio cuando el evento lo exige (bajas, cancelaciones,
        reaperturas, reasignaciones, ajustes — spec record_fields) ·
        user_id NULL = sistema (motor de garantías, pg_cron,
        importación).</rules>
      <tables written="[audit_log](BD/audit_log.md)" read="[audit_log](BD/audit_log.md)"/>
    </flow>

    <flow id="F-T3.2" name="Consulta del listado general" actor="Administrador">
      <entry>V-T3.1 → filtros → paginación → (opcional) export.</entry>
      <steps>
        <step>1. Filtros combinados → WHERE sobre índices (idx_audit_date,
          idx_audit_module, idx_audit_user, idx_audit_entity).</step>
        <step>2. Paginación por cursor (id DESC) — nunca offset sobre
          millones de filas.</step>
        <step>3. Export PDF/Excel con los filtros aplicados (utilitario
          F7.3 — M7).</step>
      </steps>
      <rules>Solo Admin (spec access) · solo lectura · retención indefinida
        (spec retention) — sin purge UI.</rules>
      <tables read="[audit_log](BD/audit_log.md)" written="[]"/>
    </flow>

    <flow id="F-T3.3" name="Línea de tiempo en la ficha (cualquier rol)" actor="usuario con acceso a la ficha">
      <entry>Pestaña "Historial" de la ficha (V-T3.2).</entry>
      <steps>
        <step>1. La app verifica el permiso de LECTURA de esa ficha (ej.
          OT → is_assigned_wo o rol Mantenimiento/Admin/Calidad).</step>
        <step>2. Query audit_log filtrada por entity_type + entity_id →
          timeline.</step>
        <step>3. Render con badges de acción y diff de cambios.</step>
      </steps>
      <rules>Misma fuente que V-T3.1 (spec: vista filtrada, no copia) · la
        verificación es de la APP (decisión T3.5 — RLS da SELECT base a
        autenticados) · export también disponible en la ficha con el
        filtro de entidad.</rules>
      <tables read="[audit_log](BD/audit_log.md)" written="[]"/>
    </flow>

  </flows>

  <cross_module_flows>
    <writers>
      M1 (assets/location/category/warranty/asset_file: create, update,
      state_change, deactivate, import) · M2 (work_orders: create, update,
      close, reopen, reassign + damage_reports: create/convert/discard) ·
      M3 (maintenance_plans: create/update/estado; reprogramaciones) ·
      M4 (inventory: entradas, salidas, ajustes con motivo, transferencias,
      count_confirm, devoluciones) · M5 (providers/contracts: CRUD) · M6
      (compliance/measurements: CRUD certificados, renovaciones con
      historial, mediciones — especialmente fuera de rango) · T1 (users:
      create/update/deactivate/password_reset + user_roles asignación) ·
      T2 (configuration: destinatarios, modo, parámetro, activo, parámetros
      generales, reportes programados) · T3 (a sí mismo no escribe).
    </writers>
    <to module="M7">Export del listado (F7.3); cambios de Configuración del
      M7 (scheduled_reports) se auditan como module
      `configuration`.</to>
    <to module="T1/V-T1.1">La ficha de usuario incluye pestaña Historial
      (F-T3.3) — cambios de perfil/roles/reset del propio usuario.</to>
    <to module="T2">T2 no tiene vista de historial propia (spec audit_note)
      — sus cambios se ven aquí.</to>
  </cross_module_flows>

  <notifications>
    <no_events>SIN eventos — auditar no notifica (el log es consulta, no
      dispara correos ni push).</no_events>
    <no_tampering>Nadie, incluido Administrador, puede editar ni borrar
      entradas (spec immutability + RLS UPDATE/DELETE prohibidos).</no_tampering>
  </notifications>

  <supabase_mapping>
    <tables written="[audit_log](BD/audit_log.md) (solo triggers/RPC)" read="[audit_log](BD/audit_log.md)"/>
    <rls>SELECT = usuarios autenticados (segmentación de UI: listado solo
      Admin, timeline por permiso de la ficha — decisión T3.5) ·
      INSERT = solo triggers (service role) · UPDATE/DELETE = PROHIBIDO a
      todos los roles (incluido Admin).</rls>
    <triggers>Un trigger AFTER por tabla de negocio (activos, ubicaciones,
      categorías, garantías, work_orders, damage_reports, planes, ítems,
      bodegas, movimientos, conteos, proveedores, contratos,
      certificaciones, mediciones, users, user_roles, notification_config,
      scheduled_reports, system_parameters…) llamando al helper común
      fn_audit_row().</triggers>
    <edge_functions>fn_audit (RPC SECURITY DEFINER) — acciones semánticas y
      adjuntar ip/user_agent; admin-users (T1) la invoca en
      password_reset.</edge_functions>
    <cron>sin pg_cron (sin purga — retención indefinida).</cron>
    <sequences>audit_log usa BIGSERIAL (orden estricto de eventos).</sequences>
    <storage>Sin buckets.</storage>
  </supabase_mapping>

  <open_pending_items>
    <item>Particionado por año / archivado en frío si el volumen crece
      (retención indefinida obliga a planearlo antes de producción muy
      activa).</item>
    <item>Export masivo (más allá de N filas) — generar en Background/
      Edge Function con link de descarga.</item>
    <item>Resaltado visual de diffs (colores old/new) y vista "por
      usuario" (qué hizo Juan en el día) — mejoras de UX sobre la misma
      tabla.</item>
    <item>Cobertura: verificar al implementar que TODAS las tablas de
      negocio tengan su trigger (checklist de migración).</item>
  </open_pending_items>

</module>
```
