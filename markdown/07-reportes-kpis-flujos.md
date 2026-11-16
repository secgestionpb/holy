# Módulo 7: Reportes y KPIs — Flujos, Interfaces y Mapeo Supabase

> Spec fuente: [07-reportes-kpis.md](07-reportes-kpis.md)
> **Tablas BD del Módulo 7:** [user_dashboard_kpis](BD/user_dashboard_kpis.md) · [scheduled_reports](BD/scheduled_reports.md) (incluye los 6 reportes semilla) · [report_send_log](BD/report_send_log.md) — **compartidas:** [system_parameters](BD/system_parameters.md) (tarifa global — T2) · [audit_log](BD/audit_log.md) (module `configuration`) — **referenciadas (otros módulos):** [users](BD/users.md) (`hourly_rate`) · [work_orders](BD/work_orders.md) · [wo_technicians](BD/wo_technicians.md) · [damage_reports](BD/damage_reports.md) · [maintenance_plans](BD/maintenance_plans.md) · [wo_checklist_entries](BD/wo_checklist_entries.md) · [stock_movements](BD/stock_movements.md) · [warehouse_stock](BD/warehouse_stock.md) · [items](BD/items.md) · [physical_counts](BD/physical_counts.md) · [contracts](BD/contracts.md) · [providers](BD/providers.md) · [certifications](BD/certifications.md) · [certification_history](BD/certifications.md) · [measurement_records](BD/measurement_records.md) · [measurement_types](BD/measurement_types.md) · [assets](BD/assets.md) · [warranties](BD/warranties.md) · [categories](BD/categories.md) · [locations](BD/locations.md)

```xml
<module id="7" name="Reportes y KPIs — Flujos">

  <decisions_taken>
    <decision n="7.1">SETS DE KPIs POR ROL (user confirmó — la spec define que
      existan pero no el reparto): Técnico = 2 KPIs (Desempeño por técnico —
      calculado SOLO sobre su persona — y OTs vencidas actuales — solo sus
      OTs). Mantenimiento = 23 (los 12 operativos + 5 inventario + 3
      proveedores + 3 activos). Calidad = 6 (% cumplimiento de PM, OTs vencidas
      actuales + los 4 de Cumplimiento normativo). Administrador = 27 (todos —
      T1: "dashboard completo consolidado"). Multi-rol = UNIÓN de sus sets
      (spec).</decision>
    <decision n="7.2">NAVEGACIÓN (user confirmó): UN ítem lateral "Reportes"
      con 2 pestañas: Dashboard (default) | Programados — mismo patrón de ítem
      único + pestañas de M4/M5/M6. El ítem lo ven los 4 roles; la pestaña
      Programados es de solo lectura para no-Admin.</decision>
    <decision n="7.3">CONFIGURACIÓN DE REPORTES PROGRAMADOS = SOLO
      Administrador (user confirmó — coherente con T1: únicamente el
      Administrador tiene "CRUD completo de Configuración/Opciones"; los demás
      roles solo lectura). La sección de T2 Configuración "Reportes
      programados" queda como puntero a este módulo (spec T2: "Ver tabla
      completa en módulo 7").</decision>
    <decision n="7.4">TARIFA DE MANO DE OBRA (resuelve el pendiente abierto en
      M2/F2.6; user confirmó): columna users.hourly_rate (NUMERIC nullable,
      editable solo por Admin en la ficha de usuario) + fallback a la tarifa
      global system_parameters.labor_hourly_rate (T2 Parámetros generales).
      Costo de mano de obra = SUM(hours_worked × COALESCE(tarifa usuario,
      tarifa global)).</decision>
    <decision n="7.5">KPIs EN VIVO, SIN MATERIALIZACIÓN: los widgets se
      calculan por consulta SQL (funciones/vistas RPC kpi_*) sobre las tablas
      de origen al abrir el dashboard, con período seleccionable (default = mes
      actual). Sin cron de agregación ni tablas de cache (Supabase Free);
      si el volumen lo exige en el futuro, materializar — ver
      open_pending_items.</decision>
    <decision n="7.6">EXPORTACIÓN PDF/Excel CON FILTROS APLICADOS en cliente
      (exceljs + jsPDF — ya declarado en stack-tecnologico). Mismo utilitario
      para el dashboard, los listados/drill-down y los reportes de otros
      módulos. Resuelve los pendientes de export abiertos en M1, M4 (kardex) y
      T3.</decision>
    <decision n="7.7">REPORTES PROGRAMADOS = MECANISMO PROPIO, FUERA DEL
      CATALOGO DE EVENTOS T2: no se crean eventos 13+ ni filas en
      notification_config (la spec los separa explícitamente de las
      notificaciones). Deduplicación mensual propia vía
      report_send_log UNIQUE(report_id, period_ym). Adjuntos en bucket
      privado `reportes`; envío de correo por la misma vía transaccional
      (Brevo) del sistema.</decision>
    <decision n="7.8">DRILL-DOWN = el alcance "listados" del export: cada
      widget abre el listado de las filas subyacentes (con sus filtros) en
      panel expandible/modal, exportable a PDF/Excel. Los widgets-tabla
      (bajo mínimo, ranking, contratos por vencer…) ya muestran el listado
      embebido con "Ver todo".</decision>
    <decision n="7.9">INSTANCIAS DE REPORTE = 1 fila por report_key del
      catálogo (UNIQUE) — los 6 seeds crean las 6 filas; hoy no se duplica un
      mismo reporte con destinatarios distintos. Altas futuras solo cuando el
      catálogo crezca (migración de seeds).</decision>
  </decisions_taken>

  <implementation_notes>
    <note key="front">Front IMPLEMENTADO (V7.1–V7.3): pages/reportes.tsx
      (V7.1/V7.2: 2 pestañas ?tab=dashboard|programados — patrón de
      M4/M5/M6; selector de período mes actual/3m/12m/rango custom con
      periodLabel compartido; Personalizar (decisión 7.1) dialog con
      checkbox por KPI agrupado por categoría, persistencia optimista vía
      upsertKpiVisible; export PDF/Excel del dashboard completo con
      exceljs+jsPDF vía lib/export-utils; widgets agrupados por sección
      Operativos/Inventario/Proveedores/Cumplimiento/Activos; período
      ignorado por widgets snapshot — badge "Actual"; drill-down modal
      por widget con tabla completa + export individual). Pestaña
      Programados: tabla con 6 reportes semilla, switch Activo, Editar
      (dialog con día 1–28, formato PDF/Excel, destinatarios validados
      por regex email, aviso si activo sin destinatarios), botón Reenviar
      (POST /functions/v1/send-scheduled-report action=resend). Componentes:
      components/reports/kpi-widget.tsx (genérico: value+unit, badges
      certificación vigente/por vencer/vencida, preview de rows, link
      "Ver en el módulo →" para contractor_history, drill-down),
      personalize-dialog.tsx, scheduled-report-dialog.tsx. lib/m7.ts
      (roleSet 27/23/6/2 por unión de roles, KPI_GROUPS/KEYS/TITLES,
      fetchKpiGroup a las 5 RPCs kpi_*, seedDashboardKpis lazy,
      CRUD scheduled_reports, resendReport). lib/export-utils.ts
      (exportExcel/exportPdf compartido — header CMMS Hotelero/período/
      filtros/fecha, secciones {title,headers,rows}). Resuelve los
      pendientes de export de M1 (botones PDF/Excel en lista de activos
      sobre `filtered` con labels de criticidad/estado/etapa), M4 (kardex
      con labels MOVEMENT_TYPE + formatQty/formatMoney sobre `kardex`),
      T3 (auditoría sobre `rows` cargadas con MODULE/ACTION_LABELS) —
      los 3 placeholders disabled ahora funcionan.</note>
    <note key="permisos">Permisos: ítem nav "Reportes" (BarChart3) visible
      para los 4 roles (desktop + móvil), entre Cumplimiento y Reportes
      de Daño; tarjeta Panel "Reportes y KPIs" con to=/app/reportes
      (badge Activo); puntero T2 Configuración → link a
      /app/reportes?tab=programados. Set por rol: Técnico ve solo
      Desempeño por técnico + OTs vencidas (nota "KPIs calculados solo
      sobre tus OTs" — RPCs filtran por user_id via auth.uid()); Calidad
      6 (2 operativos + 4 cumplimiento); Mantenimiento 23; Admin 27.
      Programados: solo Admin edita (switch/día/formato/destinatarios/
      Reenviar); no-Admin ven tabla en solo lectura con nota "La edición
      corresponde al Administrador". RLS: user_dashboard_kpis own-row
      (seed vía SECURITY DEFINER m7_seed_dashboard_kpis); scheduled_reports
      UPDATE solo admin; report_send_log INSERT solo service_role (EF).
      Route /app/reportes sin guard Require* (los 4 roles tienen acceso
      al dashboard — el filtrado es por set de KPIs).</note>
    <note key="bd">BD: migraciones 20261013000007_m7_tables.sql (tablas
      user_dashboard_kpis UNIQUE(user_id,kpi_key), scheduled_reports
      UNIQUE(report_key) con 6 seeds — recipients = emails de admin
      activos —, report_send_log UNIQUE(report_id,period_ym); triggers
      updated_at + trg_audit_scheduled_reports → fn_audit_scheduled_reports
      (module 'configuration', entity_type 'scheduled_report', INSERT y
      UPDATE); RLS como en spec; bucket reportes con policy
      reportes_select_admin solo SELECT admin) · 20261013000008_m7_kpis.sql
      (m7_seed_dashboard_kpis = 27 filas filtradas por set rol vía
      user_roles con ON CONFLICT UPDATE visible; 5 RPCs SECURITY INVOKER
      retornando JSONB con keys = kpi_key, GRANT authenticated — RLS
      hereda; fixes aplicados: grace_days en pm_on_time_pct/overdue_pms,
      prefijos de tabla en aggregates anidados, subqueries para
      jsonb_agg+SUM, columnas correctas sin is_active en assets) ·
      20261013000009_m7_scheduled.sql (fn_due_scheduled_reports SECURITY
      DEFINER GRANT solo postgres/service_role + pg_cron job
      m7-scheduled-reports '0 6 * * *' → http_post por reporte activo a
      EF con period_ym = mes anterior, dedup = NOT EXISTS report_send_log).
      audit_log module='configuration' ya existía (T2); no hay eventos
      T2 nuevos (decisión 7.7).</note>
    <note key="edge">Edge Function send-scheduled-report (--no-verify-jwt)
      desplegada: actions dispatch (cron/invocación interna — sin auth,
      dedup por report_send_log) y resend (requiere JWT; valida rol admin
      vía svc.auth.getUser + user_roles check). Genera adjunto server-side
      con exceljs (xlsx) o pdf-lib (pdf) — patrón header CMMS Hotelero,
      período, 6 reportes definidos en REPORT_BUILDERS (resumen costos,
      ranking fallas, consumo inventario, %cumplimiento PM, costos
      proveedor, certificaciones) — sube a bucket reportes
      {report_key}/{period_ym}.{ext} con upsert, envía Brevo con adjunto
      base64, upsert report_send_log (onConflict report_id,period_ym).
      Estados: sent/failed/skipped_no_recipients. BREVO_API_KEY ausente
      en secrets del proyecto (infra, no código — mismo estado que
      send-notifications desde T2).</note>
    <note key="ui">Detalles de UI: sin componente skeleton (div
      animate-pulse bg-muted); Badges de certificación con String() para
      unknown de JSONB; período "mes actual" = from primer día del mes →
      hoy; widgets snapshot (assets_by_stage, remaining_life,
      warranty_status, certification_status, overdue_pms, count_history)
      ignoran fechas y se marcan badge "Actual"; contractor_history es
      widget-link a /app/proveedores; export del dashboard itera grupos
      visibles → secciones {title: grupo, headers:[KPI,Detalle]} ;
      drill-down de cada widget exporta su sección individual.
      Toast nativo del estado (mensaje tras Reenviar/Editar) — mismo
      patrón que el resto del sistema.</note>
    <note key="smoke">Verificación: BD — 3 migraciones aplicadas con
      apply-migration.ps1; smoke [{op_ok,inv_ok,prov_ok,cum_ok,act_ok}
      = true] en las 5 RPCs; sr_count 6 + trg_ok + fn_ok + bucket_ok.
      EF desplegada con supabase functions deploy --no-verify-jwt. Navegador
      4 roles: Admin (admin@holy.com) ve 27 widgets en 5 grupos con datos
      (MTTR 0h, MTBF, desempeño con Smoke Tecnico, conteos SmokeM4,
      certificado M6, mediciones fuera de rango); pestaña Programados con
      6 filas + Editar/Reenviar; Reenviar "Resumen de costos" → toast
      "Reenvío: failed (BREVO_API_KEY no configurada.)" + fila
      report_send_log Fallido con fecha ✓ (archivo generado y subido —
      solo falla el paso Brevo por secreto ausente). Mantenimiento
      (smoke-m1-mant) ve 4 grupos (op/inv/prov/act, sin Cumplimiento) ✓;
      Programados solo lectura sin botones ✓. Calidad (smoke-m2-calidad)
      6 widgets (pm_on_time_pct 0%, overdue_pms, certificaciones con
      badge Actual + cert M6, mediciones fuera de rango 2, tendencias
      con valores) ✓. Técnico (smoke-t2-tecnico) 2 widgets (OTs vencidas
      0, Desempeño por técnico) + nota "KPIs calculados solo sobre tus
      OTs" ✓. Nav "Reportes" visible en los 4 roles ✓. Export botones
      en activos/kardex/auditoría implementados y compilados.
      Typecheck/lint/build ✓.</note>
  </implementation_notes>

  <navigation>
    <menu_item module="7" label="Reportes">Menú lateral; visible para los 4
      roles (dashboard es parte de "dashboard completo consolidado" del
      Administrador y de la visión operativa de Mantenimiento/Calidad/Técnico
      según su set).</menu_item>
    <tabs>
      <tab id="dashboard" label="Dashboard" default="true">V7.1 — widgets del
        set del usuario.</tab>
      <tab id="programados" label="Programados">V7.2 — config de reportes
        mensuales (Admin edita; resto solo lectura, decisión 7.3).</tab>
    </tabs>
    <by_role>
      <tecnico>Ve el ítem (2 widgets calculados sobre sus OTs); pestaña
        Programados en solo lectura.</tecnico>
      <mantenimiento>23 widgets; Programados solo lectura.</mantenimiento>
      <calidad>6 widgets; Programados solo lectura.</calidad>
      <administrador>27 widgets; Programados con edición completa
        (día/formato/destinatarios/activo + Reenviar).</administrador>
    </by_role>
    <updated_nav_item>El ítem del menú de M2 (02-ordenes-de-trabajo-flujos:
      `module="7" label="Reportes / KPIs"` — antes "futuro") queda enlazado a
      este módulo.</updated_nav_item>
  </navigation>

  <views>
    <view id="V7.1" name="Dashboard" type="principal">
      <entry_point>Menú lateral → Reportes (pestaña Dashboard).</entry_point>
      <header>
        <filter_period>Selector de PERÍODO global: "Mes actual" (default) |
          "Últimos 3 meses" | "Últimos 12 meses" | Rango personalizado
          (date-picker). Aplica a todos los widgets; los KPIs "snapshot"
          (OTs vencidas, stock bajo mínimo, certificaciones, garantías) marcan
          "estado actual" y no dependen del período.</filter_period>
        <actions>Personalizar (→ M7.1) · Exportar PDF · Exportar Excel
          (siempre con período + filtros aplicados).</actions>
      </header>
      <layout>Secciones en ORDEN FIJO (spec widget_order): 1) Operativos de
        mantenimiento → 2) Inventario → 3) Proveedores y contratistas →
        4) Cumplimiento normativo y calidad → 5) Activos. Grid responsivo de
        widgets (2–4 columnas según viewport); solo los KPIs visibles del set
        del usuario.</layout>
      <widget_types>
        <metric>Valor grande + mini-gráfico (Recharts: línea/tendencia o
          dona) + drill-down (F7.8). Colores de series y badges según
          design_tokens de
          [stack-tecnologico](stack-tecnologico.md) (serie principal =
          azul primary; semánticos verde/ámbar/rojo).</metric>
        <list>Tablas embebidas con top-N filas (ej. Top 5 activos con más
          fallas) + "Ver todo" (expande el listado completo con filtros y
          export).</list>
        <snapshot>Badges de estado (ej. Certificaciones: vigentes / por vencer
          / vencidas) — fichas clickeables → drill-down.</snapshot>
      </widget_types>
      <states>loading (Skeleton por widget) · empty ("Sin datos en el
        período seleccionado" + sugerencia de ampliar rango) · multi-rol
        (set = unión; secciones que ningún rol del usuario tiene no se
        renderizan).</states>
      <roles>Los 4 roles (diferencia = set, decisión 7.1). El Técnico ve una
        nota en su sección: "KPIs calculados solo sobre tus OTs".</roles>
    </view>

    <modal id="M7.1" name="Personalizar dashboard">
      <trigger>Botón "Personalizar" en V7.1.</trigger>
      <content>Checkboxes agrupados por los 5 grupos del catálogo, SOLO con los
        KPIs del set del rol (unión si multi-rol). Al marcar/desmarcar: el
        widget aparece/desaparece INMEDIATAMENTE en el dashboard de fondo,
        sin navegar (spec configurability).</content>
      <persistence>Upsert en user_dashboard_kpis POR USUARIO (dos técnicos
        pueden personalizar distinto — spec). Preferencia personal: NO genera
        audit_log.</persistence>
      <order_note>El orden NO es editable (fijo por grupo — spec); solo
        visibilidad.</order_note>
      <actions>Guardar y cerrar (la persistencia ya es instantánea con el
        toggle — el botón solo cierra).</actions>
    </modal>

    <view id="V7.2" name="Reportes programados" type="principal">
      <entry_point>Menú lateral → Reportes (pestaña Programados); T2
        Configuración → sección "Reportes programados" (puntero → esta
        vista).</entry_point>
      <columns>Reporte | Frecuencia (Mensual — fija, spec) | Día de envío |
        Formato (PDF/Excel) | Destinatarios (texto libre) | Activo/Inactivo |
        Último envío (fecha + estado) | Acciones.</columns>
      <seeds>6 filas (los reportes id 1–6 de la spec) ACTIVAS POR DEFECTO,
        destinatarios sembrados con los correos de los usuarios rol
        Administrador — editable después por reporte (spec: destinatarios
        configurables independientemente).</seeds>
      <by_role>
        <administrador>Editar (→ M7.2) · activar/desactivar toggle ·
          Reenviar ahora (si el último envío falló o falta).</administrador>
        <otros>Solo lectura (decisión 7.3).</otros>
      </by_role>
      <last_run>Fuente: MAX(sent_at) + status de report_send_log por
        report_id (vacío = aún no enviado).</last_run>
    </view>

    <modal id="M7.2" name="Editar reporte programado">
      <trigger>Fila → Editar (solo Administrador, V7.2).</trigger>
      <fields>Reporte (solo lectura — identidad de la fila) · Día de envío
        (1–28; default 1) · Formato adjunto (PDF | Excel) · Destinatarios
        (textarea texto libre, correos separados por coma — con validación de
        formato y aviso si está vacío: un reporte activo sin destinatarios se
        registra como skipped) · Activo/Inactivo (silencia sin borrar la
        config — mismo patrón que notification_config).</fields>
      <save>UPDATE scheduled_reports + audit_log (module `configuration`,
        entity_type `scheduled_report`, action update, cambios
        campo-anterior→nuevo).</save>
      <reenviar>Acción "Reenviar ahora" → dispara F7.5 con force (ignora el
        dedup del período actual y sobrescribe/crea la fila de
        report_send_log con status sent).</reenviar>
    </modal>
  </views>

  <flows>

    <flow id="F7.1" name="Personalizar dashboard" actor="usuario (cualquier rol)">
      <entry>V7.1 → botón "Personalizar" → M7.1.</entry>
      <steps>
        <step>1. M7.1 lista los checkboxes del set del rol (unión si
          multi-rol), agrupados en orden fijo.</step>
        <step>2. Toggle de un KPI → upsert inmediato en
          user_dashboard_kpis (user_id, kpi_key, visible) — el widget
          aparece/desaparece en el dashboard de fondo SIN recargar.</step>
        <step>3. "Guardar y cerrar" (persistencia ya hecha).</step>
      </steps>
      <rules>Orden no editable (spec); preferencia 100% individual por
        usuario; sin audit_log (dato de UI, no de negocio).</rules>
      <tables written="[user_dashboard_kpis](BD/user_dashboard_kpis.md)" read="[user_dashboard_kpis](BD/user_dashboard_kpis.md)"/>
    </flow>

    <flow id="F7.2" name="Render del dashboard (cálculo de KPIs)" actor="sistema / frontend">
      <entry>Apertura de V7.1 o cambio del período / de un checkbox.</entry>
      <steps>
        <step>1. Set visible = filas de user_dashboard_kpis con visible=true;
          si el usuario nunca personalizó, seed LAZY: se insertan los KPIs de
          su set (decisión 7.1) como visibles. Multi-rol = unión de
          sets.</step>
        <step>2. Por cada widget visible → RPC/vista kpi_* con el rango de
          fechas (default mes actual) y los filtros globales.</step>
        <step>3. Render agrupado por las 5 secciones en orden fijo.</step>
      </steps>
      <kpi_definitions>
        <group nombre="operativos">
          mttr: AVG(closed_at − created_at) de correctivas CERRADAS en el
            período. · mtbf: AVG de días entre aperturas de correctivas
            consecutivas del MISMO activo. · pm_on_time_pct:
            preventivas cerradas dentro de (vencimiento + margen de gracia) /
            preventivas generadas en el período. · overdue_pms (snapshot):
            preventivas con vencimiento + gracia superado y status ≠
            cerrada. · avg_response_time: AVG(MIN(assigned_at) − created_at)
            por OT. · cost_per_asset / cost_per_category / cost_per_location:
            SUM(manode_obra + repuestos + external_cost) agrupado;
            manode_obra = Σ wo_technicians.hours_worked ×
            COALESCE(users.hourly_rate, system_parameters.labor_hourly_rate);
            repuestos = Σ stock_movements (salida_ot − devolucion, costo
            congelado) vía wo_id. · failure_ranking: COUNT de correctivas por
            activo DESC. · ots_by_origin: GROUP BY work_orders.origin. ·
            reassigned_ots: COUNT de acciones reassign en período (audit_log)
            + detalle. · technician_performance: OTs cerradas, tiempo
            promedio y horas registradas por técnico (wo_technicians).
        </group>
        <group nombre="inventario">
          inventory_value: Σ warehouse_stock.qty × items.unit_cost por
            bodega. · low_stock_items / negative_stock_items (snapshots):
            warehouse_stock &lt; min_stock / &lt; 0. · parts_consumption: Σ
            salidas por item y por activo (stock_movements → wo_id →
            asset_id). · count_history: physical_counts confirmados + sus
            physical_count_items.difference.
        </group>
        <group nombre="proveedores">
          provider_cost: SUM(work_orders.external_cost) GROUP BY
            provider_id. · contracts_expiring (snapshot): contracts.end_date
            − hoy, ventana = config Evento 11. · contractor_history: link a
            la ficha del Módulo 5 (V5.2 Historial).
        </group>
        <group nombre="cumplimiento">
          certification_status (snapshot): HOY vs expires_at con
            lead_days → vigente/por vencer/vencida. ·
            certification_history: barras de certification_history por
            certificación (períodos sin cobertura). ·
            out_of_range_measurements: COUNT de measurement_records con
            result='out_of_range' por punto de medición en el período. ·
            measurement_trends: series temporales de value con banda
            min/max del tipo.
        </group>
        <group nombre="activos">
          assets_by_stage (snapshot): COUNT GROUP BY assets.life_stage. ·
            remaining_life (snapshot): activos con vida útil consumida ≥ 80%
            o restante ≤ umbral, para presupuesto (fecha o odómetro según
            lifespan_unit). · warranty_status (snapshot): warranties.status vs
            hoy.
        </group>
      </kpi_definitions>
      <rules>Consultas en vivo (decisión 7.5); RLS hereda de las tablas base
        (el Técnico solo ve sus OTs — sus KPIs se calculan con
        is_assigned_wo); los "snapshot" no dependen del período.</rules>
      <tables read="[users](BD/users.md), [system_parameters](BD/system_parameters.md), [work_orders](BD/work_orders.md), [wo_technicians](BD/wo_technicians.md), [maintenance_plans](BD/maintenance_plans.md), [stock_movements](BD/stock_movements.md), [warehouse_stock](BD/warehouse_stock.md), [items](BD/items.md), [physical_counts](BD/physical_counts.md), [contracts](BD/contracts.md), [providers](BD/providers.md), [certifications](BD/certifications.md), [measurement_records](BD/measurement_records.md), [assets](BD/assets.md), [warranties](BD/warranties.md), [user_dashboard_kpis](BD/user_dashboard_kpis.md)" written="[]"/>
    </flow>

    <flow id="F7.3" name="Exportar dashboard o listado (PDF/Excel)" actor="usuario (cualquier rol con vista)">
      <entry>V7.1 "Exportar PDF/Excel" o cabecera de un listado
        (drill-down / pestaña de otro módulo).</entry>
      <steps>
        <step>1. Captura del dataset ACTUAL con todos los filtros aplicados
          (período, filtros de columnas, tab, rol).</step>
        <step>2. Generación en cliente: exceljs (libro con hoja por
          sección/tabla) y jsPDF (con encabezado: hotel, período, filtros y
          fecha de exportación) — stack-tecnologico.</step>
        <step>3. Descarga local (archivo_{período}.xlsx/.pdf). Sin
          almacenamiento en Storage.</step>
      </steps>
      <rules>Alcance total = dashboard + TODOS los listados del sistema (spec
        export scope); utilitario compartido `exportUtils` — resuelve los
        pendientes de export de M1, M4 (kardex) y T3.</rules>
      <tables read="[] (dataset ya cargado en UI)"/>
    </flow>

    <flow id="F7.4" name="Configurar reporte programado" actor="Administrador">
      <entry>V7.2 → fila → Editar → M7.2.</entry>
      <steps>
        <step>1. Edita día (1–28), formato (PDF/Excel), destinatarios (texto
          libre) y activo/inactivo.</step>
        <step>2. Validación de formato de correos (aviso, no bloquea — texto
          libre por spec; vacío + activo = se enviará como
          skipped_no_recipients).</step>
        <step>3. UPDATE scheduled_reports + audit_log (module
          `configuration`, entity_type `scheduled_report`, cambios
          campo-a-campo).</step>
      </steps>
      <rules>Solo Administrador (decisión 7.3); silenciar = activo/inactivo,
        nunca DELETE (patrón del sistema).</rules>
      <tables written="[scheduled_reports](BD/scheduled_reports.md), [audit_log](BD/audit_log.md)" read="[]"/>
    </flow>

    <flow id="F7.5" name="Envío mensual programado" actor="sistema (pg_cron + Edge Function)">
      <entry>pg_cron DIARIO 06:00 (hora del proyecto) → RPC
        fn_due_scheduled_reports().</entry>
      <steps>
        <step>1. RPC selecciona scheduled_reports con is_active=true,
          send_day = día de HOY y SIN fila en report_send_log para
          period_ym = mes natural ANTERIOR (el reporte cubre siempre el mes
          anterior completo — decisión); devuelve report_id + parámetros.</step>
        <step>2. Invoca la Edge Function `send-scheduled-report` (service
          role) por cada reporte pendiente.</step>
        <step>3. La función genera el adjunto en servidor (exceljs / pdf-lib
          con los mismos kpi_* y consultas de F7.2, acotados al período) y lo
          sube al bucket privado `reportes`
          (ruta {report_key}/{period_ym}.{pdf|xlsx}).</step>
        <step>4. Envía el correo transaccional (Brevo — misma vía que
          notification_log) con el adjunto a la lista de destinatarios.</step>
        <step>5. INSERT en report_send_log: status `sent` | `failed`
          (error_message) | `skipped_no_recipients`. La UNIQUE
          (report_id, period_ym) garantiza UN envío por reporte/mes.</step>
      </steps>
      <reenviar>V7.2 "Reenviar ahora" (Admin) → misma función con force:
        permite reintentar un `failed` reemplazando la fila del período
        actual.</reenviar>
      <rules>Sin destinatarios → skipped (visible en V7.2, no reintenta solo);
        inactivo → no se selecciona (silenciado sin perder config); los
        adjuntos se conservan (borrado lógico de filas no aplica — el
        historial de envíos es la auditoría).</rules>
      <tables written="[report_send_log](BD/report_send_log.md)" read="[scheduled_reports](BD/scheduled_reports.md), [stock_movements](BD/stock_movements.md), [work_orders](BD/work_orders.md), [wo_technicians](BD/wo_technicians.md), [certifications](BD/certifications.md), [warehouse_stock](BD/warehouse_stock.md), [assets](BD/assets.md)"/>
    </flow>

  </flows>

  <cross_module_flows>
    <from module="1">F1.4/F1.5 y la exportación de listados de activos
      (pendientes "exigido por Módulo 7") se resuelven con F7.3; los KPIs
      Activos consumen assets, warranties y categories.</from>
    <from module="2">El pendiente de tarifa de mano de obra (F2.6 pestaña
      Costos) queda RESUELTO por decisión 7.4 (users.hourly_rate +
      system_parameters.labor_hourly_rate); los KPIs operativos y de costo
      consumen work_orders, wo_technicians y audit_log (reassign).</from>
    <from module="3">% cumplimiento de PM y OTs vencidas consumen
      maintenance_plans / work_orders (origen motor preventivo) +
      wo_checklist_entries (cierres completos).</from>
    <from module="4">Pendiente "Exportación de kardex/stock a Excel —
      pendiente para Módulo 7" RESUELTO con F7.3 (utilitario compartido);
      KPIs de inventario consumen warehouse_stock, stock_movements, items y
      physical_counts.</from>
    <from module="5">KPIs de proveedores/contratistas consumen
      work_orders.provider_id/external_cost y contracts; el historial de
      intervención enlaza la ficha V5.2.</from>
    <from module="6">KPIs de cumplimiento consumen certifications,
      certification_history, measurement_records y measurement_types.</from>
    <from module="T1">users gana hourly_rate (tarifa por usuario,
      editable solo por Admin); los sets por rol usan user_roles.</from>
    <from module="T2">system_parameters nace en este módulo para la tarifa
      global y queda como contenedor de los "Parámetros generales del
      sistema" de T2 (días de garantía, prefijos, etc.); la sección T2
      "Reportes programados" es un puntero a V7.2 (ya era así en la
      spec).</from>
    <to module="T3">audit_log registra los cambios de configuración de
      reportes programados (module `configuration`); el export del log usa el
      mismo utilitario F7.3.</to>
  </cross_module_flows>

  <notifications>
    <event_changes>SIN eventos nuevos — el catálogo T2 queda intacto
      (eventos 1–12); el Módulo 7 no añade eventos ni filas en
      notification_config / notification_log.</event_changes>
    <why_not_events>Los reportes mensuales son un mecanismo propio (adjunto
      + dedup en report_send_log — decisión 7.7), no una notificación: la
      spec los separa explícitamente de las notificaciones y su "frecuencia
      (Mensual, fijo por ahora)" no encaja con los modos inmediato/resumen
      diario de T2.</why_not_events>
    <no_push>El dashboard no genera push ni correos — es consumo on-demand;
      solo F7.5 envía correo (con adjunto, transaccional).</no_push>
  </notifications>

  <supabase_mapping>
    <tables written="[user_dashboard_kpis](BD/user_dashboard_kpis.md), [scheduled_reports](BD/scheduled_reports.md), [report_send_log](BD/report_send_log.md), [system_parameters](BD/system_parameters.md), [users](BD/users.md) (hourly_rate), [audit_log](BD/audit_log.md)" read="[work_orders](BD/work_orders.md), [wo_technicians](BD/wo_technicians.md), [maintenance_plans](BD/maintenance_plans.md), [stock_movements](BD/stock_movements.md), [warehouse_stock](BD/warehouse_stock.md), [items](BD/items.md), [physical_counts](BD/physical_counts.md), [contracts](BD/contracts.md), [providers](BD/providers.md), [certifications](BD/certifications.md), [measurement_records](BD/measurement_records.md), [measurement_types](BD/measurement_types.md), [assets](BD/assets.md), [warranties](BD/warranties.md), [categories](BD/categories.md), [locations](BD/locations.md), [damage_reports](BD/damage_reports.md), [user_roles](BD/users.md)"/>
    <rls>
      user_dashboard_kpis: SELECT/INSERT/UPDATE solo del propio usuario
        (auth.uid() = user_id); DELETE = fila propia (reset opcional). ·
      scheduled_reports: SELECT (4 roles); INSERT/UPDATE = solo rol
        Administrador (decisión 7.3); DELETE prohibido. ·
      report_send_log: SELECT = Administrador + Mantenimiento; INSERT =
        solo service role (Edge Function); UPDATE/DELETE prohibidos. ·
      system_parameters: SELECT (rol que lo necesite — lectura general);
        UPDATE = solo Administrador. ·
      users.hourly_rate: UPDATE = solo Administrador (como el resto de la
        ficha); SELECT = roles que ven la ficha.
    </rls>
    <kpi_keys>Claves estables almacenadas en user_dashboard_kpis.kpi_key
      (27): operativos = mttr, mtbf, pm_on_time_pct, overdue_pms,
      avg_response_time, cost_per_asset, cost_per_category,
      cost_per_location, failure_ranking, ots_by_origin, reassigned_ots,
      technician_performance · inventario = inventory_value,
      low_stock_items, negative_stock_items, parts_consumption,
      count_history · proveedores = provider_cost, contracts_expiring,
      contractor_history · cumplimiento = certification_status,
      certification_history, out_of_range_measurements, measurement_trends ·
      activos = assets_by_stage, remaining_life, warranty_status.</kpi_keys>
    <storage>Bucket privado `reportes` (adjuntos generados por la Edge
      Function; lectura solo Admin y por URL firmada de descarga; escritura
      solo service role).</storage>
    <cron>fn_due_scheduled_reports (RPC SECURITY DEFINER) vía pg_cron
      diario 06:00 → dispara Edge Function send-scheduled-report — mismo
      patrón que los resúmenes diarios de T2.</cron>
    <edge_functions>send-scheduled-report (genera adjunto server-side con
      exceljs/pdf-lib, sube a Storage, envía correo, escribe
      report_send_log).</edge_functions>
    <sequences>Sin sequences nuevas (sin códigos autogenerados en este
      módulo).</sequences>
    <no_push>FCM no aplica (sin eventos).</no_push>
  </supabase_mapping>

  <open_pending_items>
    <item>Materialización/caché de KPIs si crece el volumen (hoy: consultas
      en vivo — decisión 7.5; en Supabase Free agregar cron+tabla de cache
      si los tiempos de carga lo exigen).</item>
    <item>Alarmas/umbrales de KPIs (alertar si MTTR supera X) — fuera de la
      spec actual; evaluar con eventos T2 si surge.</item>
    <item>Catálogo de reportes ampliable (nuevos report_key) = migración de
      seeds en scheduled_reports (decisión 7.9).</item>
    <item>Parámetros generales de T2 — RESUELTO al detallar T2:
      system_parameters con seeds (labor_hourly_rate,
      dias_anticipacion_garantia, login_attempts, lockout_minutes) +
      auth-tokens/prefijos como lectura (decisión T2.2).</item>
    <item>WhatsApp Business API como canal de envío de reportes/notas —
      futuro declarado en stack (sin impacto en este módulo).</item>
  </open_pending_items>

</module>
```
