# Módulo 2 — Flujos de Información (Vistas y Flujos de Datos)

Detalle de pantallas y flujos de datos del Módulo 2: Órdenes de Trabajo.
Decisiones de rol y UI resueltas en esta sesión: **cancelación solo Mantenimiento**, **Reporte de Daño con menú propio y bandeja**, **Nueva OT en pantalla completa**, **4 pestañas de estado en el listado**, **garantía = pregunta Sí/No obligatoria al cierre (default No)**.

> **Tablas BD del Módulo 2:** [work_orders](BD/work_orders.md) · [damage_reports](BD/damage_reports.md) · [wo_technicians](BD/wo_technicians.md) · [wo_comments](BD/wo_comments.md) · [wo_evidence](BD/wo_evidence.md) — **compartidas:** [audit_log](BD/audit_log.md) · [notification_log](BD/notification_log.md) · [notification_config](BD/notification_config.md) — **referenciadas (otros módulos):** [assets](BD/assets.md) · [users](BD/users.md) · [providers](BD/providers.md) · [maintenance_plans](BD/maintenance_plans.md) · [item_asset_links](BD/item_asset_links.md) · [warranties](BD/warranties.md)

```xml
<module id="2" name="Órdenes de Trabajo" artifact="flujos">

  <decisions_taken>
    <decision>Cancelación de OT: SOLO el rol Mantenimiento (igual que cierre
      formal y reapertura). El Técnico solo puede llevar su OT a "Completada"
      o pedir cambios vía comentarios.</decision>
    <decision>Reporte de Daño vive en un MENÚ PROPIO del grupo lateral
      Mantenimiento ("Reportes de Daño"), con bandeja de revisión para
      Mantenimiento (convertir/descartar) y filtro "mis reportes" para los
      roles que reportan (Técnico, Calidad, Mantenimiento). NO es una pestaña
      del listado de OTs.</decision>
    <decision>"Nueva OT" (V2.1) abre V2.2 a PANTALLA COMPLETA (consistente con
      V1.2 de Activos; el formulario tiene secciones condicionales de
      contratista y asignación multi-técnico). "Cancelar" retorna a V2.1
      conservando pestaña, filtros y paginación (estado en la URL). Tras
      guardar → detalle V2.3.</decision>
    <decision>V2.1 usa 4 pestañas con contadores: Pendientes (Abierta +
      Asignada + En proceso + Pendiente de repuesto/aprobación, default) |
      Completadas (Completada + Cerrada) | Canceladas | Todas. El ciclo de
      vida se distingue dentro del detalle, no en el listado.</decision>
    <decision>V2.1 (y V2.4) incluyen filtro por FECHA — presets Hoy / Últimos
      7 días / Últimos 30 días / Personalizado, sobre fecha de apertura
      (reported_at) con alternativa a fecha programada (scheduled_at) — y
      PAGINACIÓN por cantidad: 20 (default) / 40 / 60 / 100.</decision>
    <decision>Garantía al cierre: el campo genera_o_extiende_garantia es
      OBLIGATORIO en el formulario de cierre (Sí | No, default No). Solo si
      la respuesta es "Sí" se despliega el sub-formulario de garantía y se
      crea el registro (F1.5 del Módulo 1). Una OT correctiva SIN garantía se
      cierra normalmente con "No". La respuesta queda en
      work_orders.generates_warranty + auditoría.</decision>
    <decision>Número de OT ("OT-1842"): secuencia PG propia
      (work_orders_number_seq), NO code_counters (esa tabla es por ubicación
      y es para códigos de activo).</decision>
    <decision>Horas de mano de obra: fila única por par OT↔técnico en
      wo_technicians (hours_worked + marcas started_at/finished_at por
      técnico). Múltiples sesiones por técnico = ampliación futura si se
      necesita.</decision>
    <decision>Evidencia fotográfica (OT antes/después Y reporte de daño) en
      UNA tabla wo_evidence con FKs mutuamente excluyentes (exactamente una
      entidad padre por fila), no dos tablas de archivos.</decision>
    <decision>Checklist dentro de la OT preventiva: se declara aquí como
      pestaña cross-referenced; la definición de plantillas e ítems vive en
      el Módulo 3 (03-mantenimiento-preventivo.md). Corresponde a V2.3.</decision>
    <decision>Administrador tiene SOLO LECTURA en la bandeja de Reportes de
      Daño (matriz T1: "no reportar daños" pero sí consulta general de
      módulos operativos).</decision>
    <decision>Enlace inverso reporte → OT: vive en
      work_orders.damage_report_id (evita FK circular); la bandeja resuelve
      "Ver OT" por índice sobre esa columna.</decision>
    <decision>Filtro/indicador "OTs reasignadas" (pedido por spec): flag
      denormalizado work_orders.reassigned (se marca en la operación de
      reasignación). La historia detallada (quién, cuándo, observación) vive
      en audit_log — única fuente de verdad para el timeline.</decision>
  </decisions_taken>

  <!-- ==================================================================== -->
  <!-- DECISIONES DE IMPLEMENTACIÓN (M2 — build)                             -->
  <!-- ==================================================================== -->
  <implementation_notes>
    <status>BD + EFs + Front M2 (V2.1–V2.5) implementados y validados: 6
      migraciones (20261010000000–000005), EF wo_close_engine desplegada,
      smoke de BD 144/144 PASS y E2E de navegador cubriendo ciclo completo
      (crear → asignar/reasignar con observación → iniciar → pendiente de
      repuesto → completar → cerrar con garantía), prioridad inline, horas por
      técnico (solo propio; Mantenimiento cualquiera), evidencia con subida/
      enlace firmado/eliminación, comentarios con autor embebido, historial
      audit+comentarios, costos (mant/admin), bandeja de reportes (crear,
      badge pendientes, convertir con redirección ?report=, descartar con
      motivo), reapertura y cancelación con motivo, pestaña OTs de la ficha
      del activo, badge open_wo_count en el explorador y gating por rol
      (Administrador sin acciones de estado; Técnico sin "Nueva OT"/export;
      sin "Nuevo reporte" para Administrador).</status>
    <note key="alta_y_conversion">Alta/conversión vía RPC m2_create_wo (no
      INSERT directo): valida rol, origen y técnicos, genera el número
      consecutivo (work_orders_number_seq) y, cuando origin=damage_report,
      copia activo/componente/descripción del reporte en solo lectura y marca
      el reporte "Convertido a OT" (enlace inverso por
      work_orders.damage_report_id). La UI de conversión (?report=) bloquea
      esos campos y el botón dice "Crear OT desde reporte".</note>
    <note key="cierre">Cierre formal vía EF wo_close_engine (service role,
      verify-jwt OFF) invocada por la RPC m2_close_wo: exige diagnóstico y
      solución obligatorios, pregunta Sí/No de garantía (default No), si es
      Sí crea/edita la garantía con origen en la OT (sub-formulario V1.5:
      inicio, vencimiento, cobertura, proveedor), incrementa
      assets.usage_counter +1 cuando has_usage_counter, registra
      finished_at/closed_at/closed_by y audit_log con motivo. Reapertura
      (m2_reopen_wo) revierte a En proceso, anula closed_at y marca la
      garantía existente is_origin_reopened (no la borra).</note>
    <note key="guard_estados">fn_wo_guard (triggers, refuerzo en
      20261010000004) valida transiciones: open→assigned/in_progress/
      waiting_parts/completed/cancelled; in_progress→waiting_parts/completed/
      cancelled; waiting_parts→in_progress/completed/cancelled;
      completed→closed/in_progress (devolver); desde closed/cancelled solo
      m2_reopen_wo. Cancelar y cerrar exigen rol Mantenimiento; el Técnico no
      cancela ni sus propias OTs y solo actualiza columnas de ejecución
      (description/priority/status/started_at/finished_at y sus horas).
      Prefer: return=representation en PATCH: RLS devuelve 204 con 0 filas
      cuando no hay permiso (no 403).</note>
    <note key="reemplazo">Reemplazo de técnico vía RPC
      m2_technician_replace (decisión de diseño confirmada): cualquier
      técnico asignado reemplaza a cualquier técnico ACTIVO por otro no
      asignado; observación obligatoria; audit_log conserva la historia y
      work_orders.reassigned marca el badge "re-asignada" (el detalle fino
      vive en audit_log, única fuente de verdad del timeline).</note>
    <note key="costos">Mano de obra = horas de wo_technicians ×
      (users.hourly_rate ?? system_parameters.labor_hourly_rate); pestaña
      Costos visible solo Mantenimiento/Administrador; repuestos con costo
      congelado — RESUELTO con Módulo 4 (fila "Repuestos consumidos" =
      salidas − devoluciones del kardex); servicio externo pendiente de M5
      (muestra $0.00 con nota "pendiente").</note>
    <note key="bandeja">Bandeja de reportes (V2.4): filtros en URL
      (q/st/dp/dfrom/dto/page/size), indicador fijo "solo tus reportes" para
      Técnico/Calidad, alta con ?nuevo=1 (auto-abre el diálogo), conversión
      navega a /app/ordenes/nueva?report=…&amp;from=/app/reportes-dano y
      descarte exige motivo (auditoría con estado anterior → nuevo). El
      badge ámbar de "Reportes de Daño" en el nav es global (peligrosidad de
      pendientes), el conteo del encabezado de la lista es el del usuario.</note>
    <note key="evidencia_y_storage">Bucket ot_evidencias (privado): el front
      sube vía POST /storage/v1/object (proxy Vite incluye /storage/v1) y
      registra wo_evidence; abrir usa enlace firmado de 1 hora. Las cargas se
      bloquean en estados terminales (Cerrada) — regla de la spec. Higiene
      Módulo 8: las imágenes se comprimen en cliente a ≤ 500 KB antes de
      subir (lib/upload-utils compressImage) con límite duro de 5 MB; tras
      "Preparar enlaces", la miniatura con onError muestra "Archivo no
      disponible (retención)" cuando el objeto ya no existe en Storage
      (retención 120d del Módulo 8 — solo se borra el objeto, la fila
      queda).</note>
    <note key="posts_embeds">PostgREST exige hint de FK en embeds
      ambiguos: wo_technicians tiene 3 FKs a users →
      users!wo_technicians_user_id_fkey; wo_comments expone author como
      objeto (row.author?.full_name), no como escalar. El listado V2.1 usa
      LIST_LOADED_AT (module-level) para el badge "vencida" estable entre
      renders (lint purity).</note>
    <note key="simplificaciones">Simplificaciones acordadas: "vencida" se
      evalúa sin margen de gracia (M3 añade gracia por tipo de plan); el
      filtro de ubicación es igualdad plana (no por subárbol); el filtro de
      fecha por defecto es "Últimos 30 días" en todas las pestañas; checklist
      solo como nota en General (UI de checklist llega con M3);
      work_orders.plan_id queda sin FK hasta que M3 cree la tabla de planes;
      "Mis OTs" solo se muestra para el rol Técnico.</note>
    <note key="alcances_diferidos">Diferidos: CRUD de providers (M5, la tabla
      ya existe con FK desde warranties); pestaña Repuestos con consumos
      reales y eventos M4 3/4 — RESUELTOS con el Módulo 4; Eventos 2/6 y
      generación preventiva (M3), 8 (certificaciones, M6), 12 (fin de vida
      útil); exportación de la bandeja/listados (M7, botón disabled).</note>
  </implementation_notes>

  <navigation>
    <note>La spec original no define el menú global de la aplicación; este
      bloque lo declara para el grupo operativo que rodea al Módulo 2. Es
      navegación real (ítems hermanos), NO pestañas.</note>
    <lateral_menu group="Mantenimiento">
      <item view="V1.1" label="Activos">Módulo 1 — Explorador de Activos.</item>
      <item view="V2.1" label="Órdenes de Trabajo">Módulo 2 — listado de OTs.</item>
      <item view="V2.4" label="Reportes de Daño">Módulo 2 — bandeja; badge
        "N pendientes" visible SOLO para Mantenimiento. Para Técnico/Calidad
        el ítem abre su lista filtrada a sus propios reportes.</item>
      <item module="3" label="Preventivo">Módulo 3 —
        [03-flujos](03-mantenimiento-preventivo-flujos.md).</item>
      <item module="4" label="Inventario">Módulo 4 —
        [04-inventario-flujos](04-inventario-flujos.md).</item>
      <item module="5" label="Proveedores">Módulo 5 —
        [05-proveedores-contratistas-flujos](05-proveedores-contratistas-flujos.md).</item>
      <item module="6" label="Cumplimiento / Mediciones">Módulo 6 —
        [06-cumplimiento-mediciones-flujos](06-cumplimiento-mediciones-flujos.md).</item>
      <item module="7" label="Reportes">Módulo 7 — 2 pestañas (Dashboard |
        Programados) —
        [07-reportes-kpis-flujos](07-reportes-kpis-flujos.md).</item>
    </lateral_menu>
    <admin_items>Usuarios
      ([T1-usuarios-y-roles-flujos](T1-usuarios-y-roles-flujos.md)) |
      Configuración
      ([T2-configuracion-flujos](T2-configuracion-flujos.md)) |
      Auditoría
      ([T3-log-auditoria-flujos](T3-log-auditoria-flujos.md)) (solo rol
      Administrador, entrada T1/T2/T3).</admin_items>
    <transition>Bandena → alta: "Convertir a OT" (V2.4) abre V2.2 con datos
      heredados del reporte → guardar → V2.3 de la OT creada. En V2.3, si la
      OT nació de un reporte, el header muestra "Origen: Reporte de Daño #N"
      (link a V2.4 con ese reporte seleccionado) — mismo patrón que "ver OT
      origen" de garantías en M1.</transition>
  </navigation>

  <views>

    <view id="V2.1" name="Listado de Órdenes de Trabajo" type="principal">
      <entry_point>Menú lateral → "Órdenes de Trabajo". También destino del
        "volver" desde V2.2 (conserva estado) y de V1.3 (pestaña OTs → ver
        listado general).</entry_point>
      <status_tabs default="pendientes">
        <tab id="pendientes" label="Pendientes">Abierta + Asignada + En
          proceso + Pendiente de repuesto/aprobación.</tab>
        <tab id="completed" label="Completadas">Completada (trabajo físico
          terminado, espera validación) + Cerrada (validada por
          Mantenimiento).</tab>
        <tab id="cancelled" label="Canceladas">Cancelada.</tab>
        <tab id="all" label="Todas">Sin filtro de estado (la paginación es
          por pestaña).</tab>
        <counter>Cada pestaña muestra contador de resultados (respetando los
          filtros de fecha y el resto de filtros activos).</counter>
      </status_tabs>
      <filters>
        <date>Presets: Hoy | Últimos 7 días | Últimos 30 días |
          Personalizado (rango desde/hasta). Campo: fecha de apertura
          (fecha de reporte) por defecto; opción "fecha programada" para
          preventivas. Default: últimos 30 días en pestaña Pendientes;
          "sin límite" disponible como preset.</date>
        <item>tipo (Correctiva | Preventiva | Inspección)</item>
        <item>prioridad (Urgente | Normal | Baja)</item>
        <item>categoría y ubicación del activo (árbol simplificado)</item>
        <item>estado puntual (para refinar dentro de la agrupación de la
          pestaña)</item>
        <item>técnico asignado (dropdown; Técnico ve solo el suyo)</item>
        <item>ejecutada por (Interno | Contratista)</item>
        <item>flag "Reasignadas" (solo Mantenimiento — indicador pedido en
          spec)</item>
        <item>búsqueda texto: número de OT, código/nombre de activo,
          descripción</item>
        <item>"Mis OTs" (toggle; default ON para Técnico, OFF para los
          demás)</item>
      </filters>
      <pagination>Selector de cantidad por página: 20 (default) | 40 | 60 |
        100. Navegación anterior/siguiente + indicador "x–y de z". El número
        de página vuelve a 1 al cambiar pestaña o filtros; el estado
        (pestaña, filtros, página) persiste en la URL.</pagination>
      <list>
        <columns>número | tipo | prioridad | activo/componente | ubicación
          (ruta heredada) | estado | técnicos asignados | fecha programada |
          fecha de apertura | origen (Manual | Reporte de daño | Preventiva |
          App externa-futuro) | acciones</columns>
        <badges>
          <badge name="reassigned">Indicador "re-asignada" (flag del
            historial de reasignaciones) — filtro equivalente en
            filtros.</badge>
          <badge name="multi_ot">El activo de la fila tiene más de una OT
            abierta (mismo indicador que V1.1 del Módulo 1).</badge>
          <badge name="vencida">Preventiva fuera de margen de gracia
            (scheduled_at + margen &lt; hoy).</badge>
        </badges>
        <row_click>Abre el detalle de la OT (V2.3).</row_click>
        <actions>
          <action roles="mantenimiento" to="V2.2">Nueva OT — pantalla
            completa (V2.2); si hay nodo seleccionado en un árbol de contexto
            o filtro de ubicación activo, el activo viene prellenado y
            seleccionable.</action>
          <action roles="mantenimiento">Exportar listado (PDF/Excel con
            filtros y pestaña aplicados — base de KPIs Módulo 7).</action>
          <action roles="tecnico" to="V2.4">Nuevo reporte de daño (acceso
            directo; el camino principal es el menú).</action>
        </actions>
        <empty_state>Cuando la pestaña no tiene resultados: ilustración +
          texto según pestaña ("Sin OTs pendientes" / "Sin OTs
          canceladas") + botón contextual ("Nueva OT" para
          Mantenimiento).</empty_state>
      </list>
      <roles>
        <mantenimiento>Las 4 pestañas + todos los filtros + Nueva OT + export
          + filtro Reasignadas.</mantenimiento>
        <tecnico>Las 4 pestañas pero con "Mis OTs" activo por defecto (puede
          desactivarlo para ver OTs de otros en lectura — spec: consulta
          OTs); sin Nueva OT; sin export.</tecnico>
        <administrador>Solo lectura de las 4 pestañas + export.</administrador>
        <calidad>Solo lectura de las 4 pestañas; sin Nueva OT; sin
          export.</calidad>
      </roles>
    </view>

    <view id="V2.2" name="Formulario Nueva / Editar OT" type="formulario">
      <entry_points>
        <item>V2.1 → "Nueva OT" (solo Mantenimiento).</item>
        <item>V1.3 (ficha Módulo 1) → pestaña OTs → "Abrir OT" — activo
          prellenado, botón "volver" regresa a la ficha.</item>
        <item>V2.4 → "Convertir a OT" — hereda activo/componente y
          descripción. Si el reporte trajo activo, el selector va en solo
          lectura; si solo trae localización, el técnico elige el activo en
          V2.2. Link al origen.</item>
        <item>V2.3 → "Editar" (solo campos editables según estado: todos
          antes de Completada; restringidos después).</item>
      </entry_points>
      <sections>
        <section name="Origen (solo lectura si viene de conversión)">
          <field>origen del reporte: Manual | Reporte de daño | Preventiva |
            App externa (futuro)</field>
          <field>N° de referencia externo (futuro, editable si origen =
            App externa)</field>
        </section>
        <section name="Activo y problema">
          <field>activo o componente (COMBOBOX con buscador — con muchos
            activos el desplegable es impracticable; el combobox filtra en
            vivo por código, nombre o ubicación y anida el componente tras
            elegir el activo. Componente reutilizable
            components/asset-combobox.tsx). Ubicación se HEREDA del activo
            (solo lectura, mostrada como ruta).</field>
          <field>tipo de OT: Correctiva | Preventiva | Inspección (default:
            Correctiva; Preventiva solo seleccionable vía motor M3 o
            edición por Mantenimiento)</field>
          <field>prioridad: Urgente | Normal | Baja — select MANUAL (no se
            calcula; texto de ayuda recordando que es decisión del
            usuario)</field>
          <field>descripción del problema (obligatoria)</field>
          <field>¿Afecta disponibilidad de venta? Sí | No (default No) —
            nota informativa: sin integración PMS, solo dispara correo
            Evento 1</field>
        </section>
        <section name="Ejecución">
          <field>ejecutada por: Personal interno | Contratista externo
            (default interno). Si = Externo → sub-sección con proveedor del
            catálogo Módulo 5 (obligatorio) y costo del servicio externo
            (monto único, opcional hasta el cierre)</field>
          <field>fecha programada (opcional; prellenada y sugerida si viene
            del motor preventivo M3)</field>
          <field>asignación de técnicos: Opcional — selector multi de
            usuarios rol Técnico. Al guardar con técnicos → push
            "OT asignada" a cada uno. Puede guardarse SIN técnicos (caso
            contratista)</field>
        </section>
      </sections>
      <save_actions>Validación → INSERT (RLS) → número autogenerado por
        secuencia ("OT-####") → auditoría (Crear con snapshot) → push a
        técnicos si se asignó → si afecta_disponibilidad = Sí, Edge Function
        dispara Evento 1 (correo inmediato) → navega a V2.3.</save_actions>
      <cancel>Retorna a V2.1 con pestaña, filtros y página intactos (estado
        en URL). Si se abrió desde V1.3, retorna a la ficha.</cancel>
      <roles>
        <mantenimiento>Alta y edición (los campos condicionales de
          contratista son suyos).</mantenimiento>
        <tecnico>Edición limitada de sus OTs asignadas (descripción,
          prioridad, estados de trabajo) — nunca origen ni tipo.</tecnico>
        <others>Sin acceso al formulario (los roles solo-lectura no abren
          V2.2).</others>
      </roles>
    </view>

    <view id="V2.3" name="Detalle de la OT" type="detalle">
      <entry_points>Click en fila de V2.1 | tras guardar en V2.2 | desde la
        pestaña OTs de la ficha V1.3 | desde la bandeja V2.4 ("Ver OT") |
        push de asignación (deep-link a la PWA).</entry_points>
      <header>número "OT-####" | tipo | prioridad (badge) | estado (badge
        con el ciclo de vida completo) | activo/componente (link a ficha
        V1.3) | ubicación (ruta) | técnicos asignados (avatares) | origen
        (si = Reporte de daño → link "Origen: Reporte de Daño #N") | flag
        "Reasignada" | botones de transición de estado según rol:</header>
      <state_actions>
        <action from="open|assigned|in_progress|waiting_parts"
          roles="mantenimiento">Asignar/Reasignar técnicos · cambiar
          prioridad · Cancelar (motivo obligatorio) · Cerrar (modal de
          cierre — solo si estado = Completada; Mantenimiento también puede
          cerrar directamente validando)</action>
        <action from="open|assigned|in_progress|waiting_parts"
          roles="tecnico">Iniciar trabajo (→ En proceso) · marcar Pendiente
          de repuesto · marcar Completada (solo en OTs asignadas a él) ·
          reasignar (reemplazo, con observación obligatoria)</action>
        <action from="completed" roles="mantenimiento">Cerrar (modal) ·
          devolver a En proceso (si requiere retrabajo antes de la reapertura
          formal)</action>
        <action from="closed" roles="mantenimiento">Reabrir (motivo
          obligatorio → vuelve a En proceso)</action>
        <action from="cancelled" roles="mantenimiento">Reabrir (motivo
          obligatorio → vuelve a En proceso)</action>
      </state_actions>
      <tabs>
        <tab name="General">
          <content>Todos los campos de V2.2 en modo lectura (incluye origen
            y referencia externa si aplica), fechas del ciclo (apertura,
            asignación, inicio, fin, cierre), ejecutada por + proveedor +
            costo externo, ¿afecta disponibilidad? (con link al Evento 1
            enviado si aplica), diagnóstico/solución una vez
            cerrada.</content>
        </tab>
        <tab name="Ejecución">
          <content>
            <item>Registrar inicio/fin de trabajo (botón con marca de tiempo
              del técnico que presiona; alimenta started_at/finished_at de
              la OT y las marcas propias del técnico).</item>
            <item>Horas de mano de obra POR TÉCNICO: fila por técnico con
              horas (editable por el técnico sobre sí mismo y por
              Mantenimiento sobre cualquiera); total de la OT derivado (no
              se edita a mano).</item>
            <item>Checklist (solo OTs preventivas con plan): ítems de la
              plantilla del plan (Módulo 3) con checkbox "completado +
              observación por ítem". Para correctivas: bloque con nota "sin
              checklist".</item>
            <item>Botón "Ver repuestos probables" (sugerencias de Módulo 4
              vía item_asset_links).</item>
          </content>
        </tab>
        <tab name="Repuestos consumidos">
          <content>Tabla de consumos (ítem, cantidad, bodega, costo
            CONGELADO del movimiento, técnico, fecha) con acciones:
            <action>Devolver (V2.6 modal — ver F2.9) en la línea del
              repuesto</action> · <action>Agregar consumo</action> (abre el
            picker de Módulo 4 en contexto OT; roles: técnicos asignados y
            Mantenimiento). En Cerrada la pestaña es de solo lectura (F2.9).
          </content>
        </tab>
        <tab name="Evidencia">
          <content>Grid de fotos antes/después (kind + miniatura + quién +
            cuándo). Subida: técnicos asignados y Mantenimiento; borrado:
            quien la subió o Mantenimiento, nunca en Cerrada. Descarga: los
            4 roles. Cache OFFLINE en PWA (service worker) como en
            V1.3.</content>
        </tab>
        <tab name="Historial y comentarios">
          <content>Línea de tiempo única que mezcla: (a) eventos AUTOMÁTICOS
            desde audit_log filtrado por esta OT — cambios de estado,
            reasignaciones con observación, modificaciones de campos
            (anterior → nuevo), consumos, devoluciones, cierres y
            reaperturas, reprogramaciones; y (b) COMENTARIOS manuales
            (autor, fecha, texto, adjunto opcional) desde wo_comments —
            editables/borrables NUNCA. Solo lectura de la mezcla; escriben
            técnicos asignados y Mantenimiento; Administrador solo lee. Un
            comentario nuevo NO genera push (regla T2).</content>
        </tab>
        <tab name="Costos">
          <content>Mano de obra interna (horas × tarifa si aplica) +
            repuestos consumidos (costo congelado, neto de devoluciones) +
            costo de servicio externo, con desglose por fecha y total.
            SOLO Mantenimiento y Administrador (mismo patrón que la pestaña
            Costos de V1.3); Técnico y Calidad no ven la pestaña. Base de
            los KPIs de costo del Módulo 7.</content>
        </tab>
      </tabs>
      <roles>
        <mantenimiento>Todas las pestañas con edición + todos los botones de
          transición (asignar, cancelar, cerrar, reabrir).</mantenimiento>
        <tecnico>Lectura general; edición en Ejecución (horas propias,
          checklist) y consumo/devolución en sus OTs; Comentar; marcar
          Completada; SIN pestaña Costos; Historial visible (su OT
          incluida).</tecnico>
        <administrador>Solo lectura de todas las pestañas INCLUYE Costos e
          Historial; ningún botón de transición.</administrador>
        <calidad>Lectura de todas EXCEPTO Costos; puede comentar; ningún
          botón de transición.</calidad>
      </roles>
    </view>

    <view id="V2.4" name="Bandeja de Reportes de Daño" type="principal">
      <entry_point>Menú lateral → "Reportes de Daño" (ítem hermano de
        "Órdenes de Trabajo" — ver bloque navigation).</entry_point>
      <list>
        <columns>fecha/hora | reportado por | activo/componente | descripción
          (truncada) | estado | OT derivada (link) | acciones</columns>
        <filters>presets de fecha + rango (igual patrón que V2.1) |
          estado (Pendiente de revisión | Convertido a OT | Descartado) |
          activo/categoría/ubicación | reportado por | búsqueda texto. Sin
          pestañas: la agrupación es por filtro de estado (default
          "Pendiente de revisión" para Mantenimiento, "Todos" en el filtro
          "mis reportes").</filters>
        <pagination>20 (default) | 40 | 60 | 100 — mismo patrón que
          V2.1.</pagination>
        <row_click>Abre ficha del reporte en modal (lectura completa +
          acciones para Mantenimiento).</row_click>
        <actions>
          <action roles="mantenimiento|tecnico|calidad">Nuevo reporte de daño
            → V2.5 (modal).</action>
          <action roles="mantenimiento" only_if="estado = Pendiente">
            Convertir a OT → V2.2 prefilled (hereda activo/componente,
            descripción, reportado por; campos del reporte en solo lectura
            con link) · Descartar → modal de confirmación con motivo
            obligatorio.</action>
        </actions>
        <mine_filter>Para Técnico y Calidad el listado viene filtrado a
          "mis reportes" (reported_by = usuario), no desmontable; solo ven
          sus reportes en lectura. Mantenimiento ve todos; Administrador
          todos en solo lectura (decisión tomada).</mine_filter>
        <empty_state>"Sin reportes pendientes de revisión" (Mantenimiento)
          / "No has reportado daños" (otros roles) + botón "Nuevo
          reporte".</empty_state>
      </list>
      <roles>
        <mantenimiento>Ver todos + Convertir + Descartar + badge de
          pendientes en el menú.</mantenimiento>
        <tecnico_y_calidad>Ver/crear solo los suyos, sin acciones de
          revisión.</tecnico_y_calidad>
        <administrador>Solo lectura.</administrador>
      </roles>
    </view>

    <view id="V2.5" name="Formulario Reporte de Daño" type="modal">
      <entry_point>V2.4 → "Nuevo reporte de daño" (roles: Técnico,
        Mantenimiento, Calidad — NO Administrador, NO otros).</entry_point>
      <fields>
        <field>descripción del daño (obligatoria, texto libre)</field>
        <field>localización (obligatoria, texto libre — p. ej. "Piso 3,
          habitación 312 — A/C"). El formulario NO pide activo: el reporte
          se describe por dónde ocurrió. BD: columna location + CHECK
          dr_asset_or_location (asset_id queda NULL en el alta interna).</field>
        <field>reportado por (automático) | fecha/hora (automática) — solo
          lectura</field>
        <field>evidencia fotográfica (opcional, hasta N fotos →
          wo_evidence)</field>
      </fields>
      <save_actions>INSERT (RLS por rol) → auditoría "Crear" → Edge Function
        dispara Evento 5 "Reporte de daño nuevo" (correo INMEDIATO a
        destinatarios T2) → el reporte queda en estado "Pendiente de
        revisión" en V2.4.</save_actions>
      <role_note>Calidad puede reportar pero NO crear OTs — el único camino
        de Calidad a una OT es este reporte convertido por
        Mantenimiento.</role_note>
    </view>

    <view id="V2.6" name="Modal de Devolución de Repuesto" type="modal">
      <entry_point>V2.3 → pestaña "Repuestos consumidos" → botón "Devolver"
        en la línea del repuesto (no existe pantalla independiente de
        devoluciones — spec).</entry_point>
      <fields>
        <field>repuesto y movimiento de salida original (solo lectura, con
          costo congelado visible)</field>
        <field>cantidad a devolver — validada: máx = consumido − ya
          devuelto (error legible si se excede)</field>
        <field>bodega de destino (dropdown — NO necesariamente la de
          origen)</field>
        <field>motivo (obligatorio)</field>
      </fields>
      <permissions>Desde OTs asignadas: solo ese Técnico. Desde cualquier
        OT: Mantenimiento. Administrador: sin acceso. Estados permitidos:
        En proceso, Pendiente de repuesto/aprobación, Completada; en
        Cancelada SOLO Mantenimiento; en Cerrada NO SE PERMITE (F2.9 —
        reabrir primero).</permissions>
      <save_actions>INSERT en kardex tipo "Devolución" (Módulo 4, con
        referencia a la OT) → suma stock en la bodega destino → reduce el
        costo de la OT con el costo CONGELADO del movimiento original →
        auditoría → cierra y refresca pestañas Repuestos y Costos de
        V2.3.</save_actions>
    </view>

    <modal id="M2.1" name="Cierre de OT">
      <entry_point>V2.3 → botón "Cerrar" (estado Completada; rol
        Mantenimiento).</entry_point>
      <fields>
        <field>diagnóstico / solución aplicada (texto obligatorio al
          cierre)</field>
        <field>horas totales y repuestos — resumen de solo lectura
          (derivado)</field>
        <field>ejecutada por (confirmación, editable solo Mantenimiento; si
          = Externo → proveedor obligatorio + costo del servicio
          externo)</field>
        <field name="genera_o_extiende_garantia">Sí | No — OBLIGATORIO,
          default No. Si = Sí → sub-formulario desplegado (mismos campos
          que V1.5: tipo, fechas, cobertura, proveedor, observaciones,
          documento) → al confirmar se crea la garantía con origen = esta OT
          (F1.5 del Módulo 1). Si = No → se cierra sin garantía; la
          respuesta queda en work_orders.generates_warranty + auditoría.
          (Regla de sesión: una correctiva NO siempre tiene garantía.)</field>
        <field>¿Afectó disponibilidad de venta? Sí | No (default = valor de
          la OT; si es Sí → confirma envío del Evento 1)</field>
        <field>checklist completado (solo preventivas: requisito de
          completitud de ítems o justificación de ítems no aplicables —
          regla [F3.4 — 03-flujos](03-mantenimiento-preventivo-flujos.md))</field>
      </fields>
      <effects_on_confirm>UPDATE estado → Cerrada + closed_at/closed_by →
        auditoría → (si garantía Sí) F1.5 crea garantía → (si afectó
        disponibilidad) Evento 1 correo inmediato → (si preventiva con plan)
        cálculo de próxima fecha desde la fecha PROGRAMADA (Módulo 3) → (si
        activo con contador) update assets.usage_counter → consolida costo
        → navega a V2.3 actualizada. SIN push de cierre al técnico (no
        está en el catálogo T2).</effects_on_confirm>
    </modal>

    <modal id="M2.2" name="Cancelar OT / Reabrir OT">
      <cancel>Motivo obligatorio; solo Mantenimiento; estado → Cancelada;
        auditoría con estado anterior → nuevo. Conserva consumos y evidencia
        (devoluciones posteriores solo Mantenimiento — F2.9). Sin correo ni
        push.</cancel>
      <reopen>Motivo obligatorio; solo Mantenimiento; aplica a Cerrada o
        Cancelada → vuelve a En proceso; auditoría. SIN notificación (regla
        spec: solo Mantenimiento puede reabrir, ya tiene visibilidad). Si
        existía garantía generada: NO se elimina, queda marcada "OT origen
        reabierta" (F1.5/M1); al volver a cerrar se edita el registro
        existente (nunca duplicar). No revierte la próxima fecha ya
        calculada del plan preventivo.</reopen>
    </modal>

  </views>

  <!-- ==================================================================== -->
  <!-- FLUJOS DE DATOS                                                       -->
  <!-- ==================================================================== -->
  <flows>

    <flow id="F2.1" name="Crear Reporte de Daño">
      <trigger>Técnico/Calidad/Mantenimiento → V2.4 → "Nuevo reporte de
        daño" (V2.5).</trigger>
      <steps>
        <step>1. Selección de activo o componente (catálogo filtrado) y
          descripción; fotos opcionales.</step>
        <step>2. Guardar → INSERT (damage_reports, estado "Pendiente de
          revisión") → auditoría "Crear" en entidad "Reporte de daño
          #N".</step>
        <step>3. Edge Function dispara EVENTO 5 "Reporte de daño nuevo" →
          correo INMEDIATO a destinatarios T2 (Destinatarios según
          <!-- BD: BD/notification_config.md -->).</step>
        <step>4. El reporte aparece en la bandeja V2.4 (y en el badge de
          pendientes del menú para Mantenimiento).</step>
      </steps>
      <notifications>Evento 5 (inmediato). Sin push.</notifications>
      <roles>Crear: Técnico, Mantenimiento, Calidad. NO Admin.</roles>
    </flow>

    <flow id="F2.2" name="Revisión de Reporte de Daño: convertir o descartar">
      <trigger>Mantenimiento → V2.4 → fila en "Pendiente de revisión" →
        acción.</trigger>
      <branches>
        <branch name="convertir">
          <steps>
            <step>1. "Convertir a OT" abre V2.2 con herencia + link al
              reporte. Si el reporte trae activo, el selector va en solo
              lectura; si solo trae localización (alta interna actual), el
              técnico ELIGE el activo en V2.2. El RPC m2_create_wo solo
              exige coincidencia activo↔reporte cuando el reporte tiene
              activo. Descripción y localización se muestran como contexto;
              el reporte marca "Convertido a OT" al confirmar.</step>
            <step>2. Mantenimiento completa prioridad, tipo (default
              Correctiva), ejecutada por, afecta_disponibilidad y asignación
              opcional → guardar → alta normal de OT (F2.3 con origen =
              Reporte de daño).</step>
            <step>3. Auditoría en ambas entidades: reporte "Modificar"
              (Pendiente → Convertido) y OT "Crear".</step>
          </steps>
        </branch>
        <branch name="descartar">
          <steps>
            <step>1. Confirmación con MOTIVO OBLIGATORIO.</step>
            <step>2. Estado → "Descartado" (queda como registro histórico,
              NUNCA se borra) + auditoría con motivo.</step>
          </steps>
        </branch>
      </branches>
      <permission>Solo Mantenimiento revisa (convertir/descartar).</permission>
    </flow>

    <flow id="F2.3" name="Alta de OT directa">
      <trigger>Mantenimiento → V2.1 → "Nueva OT" (o desde ficha V1.3 →
        "Abrir OT").</trigger>
      <steps>
        <step>1. V2.2 a pantalla completa; selector de activo/componente
          (prellenado si vino de la ficha o de un filtro de ubicación);
          ubicación heredada en solo lectura.</step>
        <step>2. Completa secciones (problema + ejecución); asignación de
          técnicos OPCIONAL (una OT sin técnicos es válida — caso
          contratista).</step>
        <step>3. Guardar → INSERT → número autogenerado por secuencia PG
          (work_orders_number_seq → "OT-####") → auditoría "Crear" con
          snapshot.</step>
        <step>4. Si hay técnicos asignados → push "OT asignada" a cada uno
          (mecanismo T2, destinatario dinámico).</step>
        <step>5. Si afecta_disponibilidad = Sí → Edge Function dispara
          EVENTO 1 (correo INMEDIATO a destinatarios T2). El bloqueo de
          venta en el PMS es manual fuera del CMMS (spec).</step>
        <step>6. Navega a V2.3.</step>
      </steps>
      <notifications>Evento 1 (solo si afecta_disponibilidad) + push de
        asignación.</notifications>
      <permission>Solo Mantenimiento crea OTs directamente (matriz T1:
        Calidad "NO puede crear OTs", Admin "sin capacidad de crear/modificar
        OTs", Técnico solo reporta daños).</permission>
    </flow>

    <flow id="F2.4" name="Asignación y reasignación de técnicos">
      <branches>
        <branch name="por_mantenimiento">
          <rule>Mantenimiento asigna y reasigna cualquier OT en cualquier
            momento, agregando o quitando técnicos libremente (V2.3 →
            "Asignar/Reasignar").</rule>
          <effects>Push a quienes entran y salen; audit con detalle.</effects>
        </branch>
        <branch name="por_tecnico">
          <rule>Un Técnico puede REEMPLAZAR una OT asignada a otro técnico
            — es sustitución, no adición. Observación OBLIGATORIA.</rule>
          <restrictions>Solo sus propias OTs · solo reemplazar a OTROS
            técnicos (nunca a Mantenimiento ni otros roles) · no reemplazar
            a alguien ya asignado · estados permitidos: Asignada, En
            proceso, Pendiente de repuesto/aprobación (NO Completada,
            Cerrada, Cancelada) · sin aceptación del receptor (efecto
            inmediato).</restrictions>
          <effects>
            <item>Push a los 3 polos: técnico que entra, técnico que sale,
              y los demás técnicos que permanecen en la OT.</item>
            <item>wo_technicians: UPDATE removed_at en la fila saliente +
              INSERT de la fila entrante (el histórico NO se borra).</item>
            <item>Flag work_orders.reassigned = true (alimenta badge y
              filtro de V2.1).</item>
            <item>Auditoría en la OT: observación + técnico anterior →
              nuevo (fuente del timeline de Historial).</item>
            <item>SIN correo (spec: no hay Evento de reasignación; solo
              push).</item>
          </effects>
        </branch>
      </branches>
    </flow>

    <flow id="F2.5" name="Ejecución del trabajo">
      <trigger>Técnico asignado → V2.3 → pestañas de trabajo (o PWA en
        campo).</trigger>
      <steps>
        <step>1. "Iniciar trabajo" → estado En proceso + started_at (marca
          del técnico que presiona).</step>
        <step>2. Checkpoint de trabajo: checklist (si preventiva — ítems
          marcados con observación individual, regla
          [F3.4 — 03-flujos](03-mantenimiento-preventivo-flujos.md)), consumo de
          repuestos (picker de Módulo 4 → INSERT en kardex
          ([BD: stock_movements](BD/stock_movements.md)) con costo
          CONGELADO → referenciar OT), subida de evidencia antes/después,
          comentarios (sin push).</step>
        <step>3. Horas por técnico: cada técnico registra las suyas en
          Ejecución (editable sobre sí mismo; Mantenimiento sobre
          cualquiera).</step>
        <step>4. Si falta material → estado "Pendiente de repuesto/
          aprobación" (cualquier técnico asignado o Mantenimiento).</step>
        <step>5. Cualquier técnico ASIGNADO marca "Completada" (+ fin de
          trabajo) — el trabajo físico terminó; la OT queda esperando el
          cierre formal de Mantenimiento.</step>
      </steps>
      <notifications>SIN correo. Push solo si "OT propia modificada por otro
        usuario" (regla T2: no genera push si el modificador es el propio
        técnico).</notifications>
      <cross>Consumos y devoluciones afectan Módulo 4 (Eventos 3 y 4 de
        stock los dispara Módulo 4, no este flujo).</cross>
    </flow>

    <flow id="F2.6" name="Cierre formal de la OT (Mantenimiento)">
      <trigger>V2.3 → "Cerrar" (estado Completada) → modal M2.1.</trigger>
      <steps>
        <step>1. Diagnóstico/solución obligatorios; confirmación de
          ejecutada por (si Externo → proveedor obligatorio + costo de
          servicio externo).</step>
        <step>2. Pregunta OBLIGATORIA genera_o_extiende_garantia (Sí/No,
          default No): si Sí → sub-formulario de garantía → al confirmar,
          la Edge Function de cierre crea el registro con origen = esta OT
          (F1.5 del Módulo 1 — solo en este caso). Si No → se cierra sin
          garantía (regla de sesión: la correctiva no siempre la
          tiene).</step>
        <step>3. Si afectó la disponibilidad → EVENTO 1 (correo inmediato)
          o reenvío si cambió la respuesta.</step>
        <step>4. Transición → Cerrada + closed_at/closed_by; auditoría
          (Modificar estado + snapshot de cierre con la respuesta de
          garantía).</step>
        <step>5. Si es preventiva con plan → cálculo de la PRÓXIMA fecha
          del plan desde la fecha programada (Módulo 3 — sin reversión en
          reaperturas).</step>
        <step>6. Si el activo tiene contador de uso → actualiza
          assets.usage_counter (Módulo 1 / F1.9: al llegar a fin de vida
          dispara su Evento 12).</step>
        <step>7. Consolida el costo total (mano de obra + repuestos −
          devoluciones + externo) visible en la pestaña Costos.</step>
      </steps>
      <permission>Solo Mantenimiento cierra formalmente (los técnicos solo
        llevan a Completada — spec lifecycle).</permission>
      <notifications>Evento 1 (condicional). SIN push de cierre.</notifications>
    </flow>

    <flow id="F2.7" name="Reapertura de OT">
      <trigger>Mantenimiento → V2.3 (estado Cerrada o Cancelada) →
        "Reabrir" (modal M2.2).</trigger>
      <steps>
        <step>1. MOTIVO OBLIGATORIO → estado → En proceso; auditoría
          (usuario, fecha, motivo, estado anterior → nuevo).</step>
        <step>2. SIN correo y SIN push (regla spec: solo Mantenimiento
          reabre, ya tiene visibilidad; al técnico queda a discreción
          avisar por fuera).</step>
        <step>3. Garantía existente: NO se elimina → queda "OT origen
          reabierta"; al re-cerrar se EDITA el registro existente
          (nunca duplicar) — misma regla que F1.5/M1.</step>
        <step>4. Costos: recálculo con los cambios mientras esté abierta;
          al re-cerrar se consolida de nuevo.</step>
        <step>5. Plan preventivo: la reapertura NO revierte la próxima
          fecha ya calculada.</step>
        <step>6. La pestaña Historial conserva cada cierre y reapertura
          (fechas, motivos) vía audit_log.</step>
      </steps>
    </flow>

    <flow id="F2.8" name="Cancelación de OT">
      <trigger>Mantenimiento → V2.3 → "Cancelar" (modal M2.2) — decisión
        tomada en esta sesión: SOLO Mantenimiento.</trigger>
      <steps>
        <step>1. MOTIVO OBLIGATORIO → estado → Cancelada; auditoría.</step>
        <step>2. Conserva consumos, evidencia e historial (baja lógica, sin
          DELETE); devoluciones posteriores permitidas SOLO para
          Mantenimiento en estado Cancelada (F2.9).</step>
        <step>3. Sin correo ni push.</step>
      </steps>
      <permission>El Técnico NO cancela ni siquiera sus OTs — su máximo es
        "Completada" (decisión de sesión).</permission>
    </flow>

    <flow id="F2.9" name="Devolución de repuesto dentro de una OT">
      <trigger>V2.3 → pestaña Repuestos consumidos → "Devolver" (modal
        V2.6).</trigger>
      <steps>
        <step>1. Cantidad validada (≤ consumido − ya devuelto) + bodega de
          destino + motivo.</step>
        <step>2.  movimiento tipo "Devolución" con
          referencia a la OT; suma stock en la bodega ELEGIDA (no
          necesariamente la de origen).</step>
        <step>3. Reduce el costo de la OT con el COSTO CONGELADO del
          movimiento de salida original (no el precio vigente del
          ítem).</step>
        <step>4. Auditoría; si el stock estaba negativo, lo corrige parcial
          o totalmente.</step>
      </steps>
      <states>En proceso | Pendiente de repuesto | Completada (técnicos en
        sus OTs / Mantenimiento en cualquiera). En Cancelada: solo
        Mantenimiento. En Cerrada: NO permitido — Mantenimiento debe reabrir
        primero (Opción 1 de spec).</states>
      <notifications>SIN correo; SIN push.</notifications>
    </flow>

    <flow id="F2.10" name="Entrada desde Módulo 3: OT preventiva generada">
      <trigger>Motor de planes (Módulo 3) al alcanzar fecha programada −
        anticipación (pg_cron / Edge Function).</trigger>
      <steps>
        <step>1. INSERT de OT tipo Preventiva: activo (por plan de
          categoría o activo individual), plan_id, fecha programada,
          checklist del plan, prioridad por defecto del plan, SIN técnicos
          (asignación posterior) u opcionales si el plan lo define.</step>
        <step>2. Auditoría "Crear" con usuario = sistema.</step>
        <step>3. EVENTO 2 "OT preventiva generada" → resumen diario
          agrupado por plan con la lista completa de OTs generadas.</step>
        <step>4. Si supera fecha + margen de gracia sin cerrarse → EVENTO 6
          "OT preventiva vencida" → resumen diario (lista acumulada de las
          que siguen sin cerrarse); badge "vencida" en V2.1.</step>
        <step>5. Al cerrarse (F2.6) → próxima fecha calculada desde la
          fecha programada (Módulo 3).</step>
      </steps>
      <notifications>Eventos 2 y 6 (resumen diario). Push de asignación si
        el plan trae técnicos.</notifications>
      <note>Desde este punto la OT preventiva es una OT normal: aplica todo
        lo anterior (ejecución, checklist, cierre con garantía
        Sí/No…).</note>
    </flow>

  </flows>

  <!-- ==================================================================== -->
  <!-- FLUJOS CRUZADOS CON OTROS MÓDULOS                                     -->
  <!-- ==================================================================== -->
  <cross_module_flows>

    <flow from="1" to="2" name="Activo ↔ OT">
      La OT referencia activo Y componente (selector anidado F2.3); hereda
      ubicación. V1.3 (ficha) → pestaña OTs → "Abrir OT" → V2.2 con
      contexto de vuelta. Badge "OTs abiertas" de V1.1/V1.3 = conteo de OTs
      no cerradas de este activo + sus componentes. Cierre con contador →
      update de assets.usage_counter (F2.6/step 6). Link "Ver activo" en
      V2.3 → V1.3.
    </flow>

    <flow from="2" to="3" name="OT preventiva y planes">
      Motor M3 genera OTs (F2.10); checklist del plan se ejecuta en la
      pestaña Ejecución de V2.3; al cierre se calcula la próxima fecha
      (F2.6/step 5); vencidas → Evento 6. Mantenimiento edita OTs
      preventivas desde V2.2; el calendario de planes (M3) navega a estas
      OTs ("Abrir OT completa" / proyecciones sin OT aún).
    </flow>

    <flow from="2" to="4" name="Consumos, devoluciones y stock">
      Pestaña Repuestos consumidos ↔ kardex de Módulo 4: salidas con costo
      CONGELADO al consumir (F2.5), devoluciones con movimiento inverso
      (F2.9). Repuestos probables del activo/item_asset_links se sugieren en
      Ejecución. Los Eventos 3 (stock bajo) y 4 (stock negativo) los dispara
      Módulo 4 tras cada movimiento. Técnico consume/devuelve SOLO en sus
      OTs; Mantenimiento en cualquiera (matriz T1).
    </flow>

    <flow from="2" to="5" name="Contratista externo en la OT">
      Campo "ejecutada por = Externo" (V2.2/Modal M2.1) → selector del
      catálogo de proveedores + costo único. Al cerrar con garantía Sí, el
      proveedor de la OT se usa como otorgante de la garantía (F1.5/M1
      preseleccionado). La ficha del proveedor (M5) lista sus OTs
      (historial de intervención).
    </flow>

    <flow from="2" to="T3" name="Auditoría e historial">
      Cada operación (Crear/Modificar estados, asignaciones, consumos,
      devoluciones, cierres, reaperturas, cancelaciones, reportes) escribe
      audit_log vía triggers PG. La pestaña "Historial y comentarios" de
      V2.3 es una vista filtrada de audit_log (fuente única) + wo_comments
      (manuales). V2.1 y V2.4 no escriben auditoría propia: sus operaciones
      se registran en la entidad afectada.
    </flow>

    <flow from="T1" to="2" name="Permisos">
      Mantenimiento: CRUD completo de OTs (cualquiera), cancelar, cerrar,
      reabrir, asignar, consumir/devolver en cualquier OT. Técnico: solo
      sus OTs asignadas (ejecutar, horas propias, checklist, consumos,
      devoluciones, marcar Completada, reasignar=reemplazar con obs). Admin:
      solo lectura (incluye Costos; sin transiciones, sin devoluciones, sin
      reportar daños). Calidad: lectura (sin Costos) + puede reportar
      daños, NO crear OTs.
    </flow>

  </cross_module_flows>

  <!-- ==================================================================== -->
  <!-- NOTIFICACIONES QUE TOCAN ESTE MÓDULO                                  -->
  <!-- ==================================================================== -->
  <notifications>
    <note>Configuración (destinatarios, modo, parámetros) vive en
      <!-- BD: BD/notification_config.md -->; envíos y deduplicación en
      <!-- BD: BD/notification_log.md -->. Patrón obligatorio: nada
      hardcodeado.</note>

    <events_from_this_module id="1" name="OT afecta disponibilidad de venta"
      mode="Inmediato">Dispara F2.3 (alta) y F2.6 (cierre) cuando la
      respuesta es Sí.</events_from_this_module>
    <event id="2" name="OT preventiva generada" mode="Resumen diario">Correo
      agrupado por plan con la lista completa de OTs generadas
      (F2.10).</event>
    <event id="5" name="Reporte de daño nuevo" mode="Inmediato">Cada alta
      de reporte (F2.1).</event>
    <event id="6" name="OT preventiva vencida" mode="Resumen diario">Lista
      acumulada de OTs que superaron fecha + margen y siguen sin cerrarse
      (F2.10).</event>

    <push_dynamic>
      <note>Mecanismo SEPARADO del correo (FCM, destinatario dinámico, no
        configurable en notification_config).</note>
      <triggers>
        <item>OT asignada a un técnico (F2.3/F2.4) → a cada asignado.</item>
        <item>OT reasignada (F2.4) → al que entra, al que sale y a los que
          permanecen.</item>
        <item>OT propia modificada por otro usuario (F2.5) → SIN push si el
          modificador es el propio técnico.</item>
      </triggers>
      <exclusions>
        <item>OT reabierta — sin push (F2.7).</item>
        <item>Comentario nuevo en la OT — sin push.</item>
        <item>Cierre, cancelación y reapertura — sin correo ni push (no
          existen en el catálogo).</item>
      </exclusions>
    </push_dynamic>

    <events_from_others>
      <item id="3">Stock bajo mínimo — por movimientos de esta OT (los
        dispara Módulo 4).</item>
      <item id="4">Stock negativo — ídem.</item>
      <item id="12">Activo al fin de vida útil — F2.6/step 6 puede
        mover el contador hacia ese límite (Módulo 1).</item>
    </events_from_others>
  </notifications>

  <!-- ==================================================================== -->
  <!-- MAPEO SUPABASE                                                        -->
  <!-- ==================================================================== -->
  <supabase_mapping>
    <tables>BD/work_orders.md (entidad central, ciclo de vida + cierre) |
      BD/damage_reports.md (bandeja V2.4) | BD/wo_technicians.md
      (asignaciones con histórico removed_at + horas por técnico) |
      BD/wo_comments.md (comentarios manuales, sin UPDATE/DELETE) |
      BD/wo_evidence.md (fotos de OT y de reporte, FKs excluyentes) |
      BD/audit_log.md (timeline de Historial, append-only, triggers PG) |
      BD/notification_config.md y BD/notification_log.md (Eventos 1, 2, 5,
      6) | BD/assets.md (destino de links y contador) | BD/users.md
      (técnicos/reportantes) | BD/providers.md (contratista) |
      BD/maintenance_plans.md (origen de preventivas, F2.10) |
      BD/warranties.md (destino de F1.5 si garantía = Sí) |
      BD/item_asset_links.md (repuestos probables) |
      BD/stock_movements.md y BD/warehouse_stock.md (kardex de Módulo 4 —
      diseño completo en su módulo, referenciadas por F2.5/F2.9)</tables>
    <rls>
      <select>Los 4 roles; alcance: Técnico ve todas en lectura pero su UI
        filtra "mis OTs" por defecto (spec: consulta OTs); Calidad y Admin
        leen.</select>
      <insert>OT manual: solo Mantenimiento (o Edge Function del motor
        preventivo con service role). damage_reports: Técnico, Mantenimiento,
        Calidad. wo_technicians: Mantenimiento o el propio técnico en
        reemplazo (F2.4). wo_comments/wo_evidence: técnicos asignados +
        Mantenimiento.</insert>
      <update>work_orders: Mantenimiento (cualquiera) + Técnico SOLO sobre
        OTs con fila activa en wo_technicians (función helper
        is_assigned_wo(wo_id)) — refleja la matriz T1. wo_technicians:
        horas por el propio técnico o Mantenimiento.</update>
      <delete>PROHIBIDO en todas las tablas del módulo (bajas lógicas por
        estado). wo_comments sin UPDATE (no se editan ni se borran —
        spec). audit_log sin UPDATE/DELETE.</delete>
    </rls>
    <edge_functions>wo_close_engine (valida modal M2.1: garantía condicional
      → llama F1.5, Evento 1, próxima fecha M3, contador M1) |
      damage_report_convert (transición de reporte + alta de OT en una
      transacción) | wo_dispatch_push (asignación/reasignación → FCM) |
      send_notification (genérica T2: lee notification_config →
      notification_log).</edge_functions>
    <pg_cron>Diario: detectar preventivas fuera de margen → Evento 6;
      resumen de Evento 2; limpieza de tokens FCM inválidos.</pg_cron>
    <storage_buckets>ot_evidencias (privado: fotos antes/después y de
      reportes de daño; lectura 4 roles, escritura técnicos asignados +
      Mantenimiento; misma política de cache offline PWA que activos —
      no permitido en estado Cerrada para nuevas cargas).</storage_buckets>
    <sequences>work_orders_number_seq → "OT-" || lpad(nextval, 4, '0')
      (número consecutivo de OT).</sequences>
    <push>FCM vía Edge Function; suscripciones en push_subscriptions —
      RESUELTO en T2 (mecanismo separado, F-T2.4:
      [T2-configuracion-flujos](T2-configuracion-flujos.md)).</push>
  </supabase_mapping>

  <open_pending_items>
    <item>Tablas de kardex/movimientos de Módulo 4 — resueltas:
      [stock_movements](BD/stock_movements.md) y
      [warehouse_stock](BD/warehouse_stock.md) (F4.4/F4.5, Módulo 4).</item>
    <item>Tarifa de hora de mano de obra para la pestaña Costos — RESUELTA en
      Módulo 7 (decisión 7.4): users.hourly_rate + fallback
      system_parameters.labor_hourly_rate (ver
      [07-reportes-kpis-flujos](07-reportes-kpis-flujos.md)).</item>
    <item>push_subscriptions (mecanismo de push) — RESUELTO en Módulo T2:
      [push_subscriptions](BD/push_subscriptions.md) + F-T2.4 (triggers de
      asignación/reasignación/modificación).</item>
    <item>Tab "Repuestos consumidos" con consumos reales — RESUELTO en
      Módulo 4 (F4.4/F2.5/F2.9): movimientos del kardex
      ([stock_movements](BD/stock_movements.md)) con costo congelado al
      consumo, diálogos de consumo/devolución con guardas de rol y estado
      de la OT, "Ver repuestos probables" (N:N item_asset_links /
      categorías de activo) y la fila "Repuestos consumidos" con el neto
      (salidas − devoluciones) dentro de Costos.</item>
    <impl_pending>Checklist de preventiva en la pestaña General — RESUELTO en
      Módulo 3: snapshot de plantilla en wo_checklist_entries al generar la OT
      (F3.1/F3.2) + bloqueo de cierre sin completar (validación en m2_close_wo
      y trigger trg_wo_close_recalc) y pestaña de checklist en la ficha de la
      OT.</impl_pending>
    <impl_pending>work_orders.plan_id sin FK — RESUELTA en Módulo 3 (migración
      20261012000003_m3_fixes: work_orders_plan_fkey ON DELETE SET NULL); se
      pobla al generar OTs desde planes (m3_wo_generate).</impl_pending>
    <impl_pending>CRUD de proveedores/contratistas y servicio externo con
      importe real en Costos — RESUELTO en Módulo 5 (migración
      20261013000000_m5_core: contracts/provider_files, RLS y Evento 11;
      front V5.1–V5.4); la FK desde warranties y work_orders.provider_id ya
      existían.</impl_pending>
    <impl_pending>Eventos de notificación 2/6 y generación automática de OTs
      preventivas — RESUELTOS en Módulo 3 (m3_wo_generate con fn_notify,
      pg_cron diario 02:00 y dedup por fecha); queda pendiente el Evento 12
      "Activo al fin de vida útil" (motor de vida útil de M1). M4 ya opera sus
      eventos 3 "Stock bajo mínimo" y 4 "Stock negativo".</impl_pending>
    <impl_pending>Exportación (CSV/Excel) de listado de OTs y bandeja de
      reportes (M7 — botones presentes con estado disabled).</impl_pending>
    <impl_pending>Margen de gracia para el badge "vencida" — RESUELTO en
      Módulo 3: campo grace_days por plan (F3.4), badge "vencida" del listado
      de OTs y celdas/calendario del preventivo evalúan scheduled + gracia
      (migraciones 20261012000000-000003).</impl_pending>
    <impl_pending>Imagen MANDATORIA para cerrar OT — nuevo requerimiento
      del cliente: el cierre de OT (estado Cerrada) debe exigir al menos
      1 fotografía adjunta. Hoy CloseDialog solo valida checklist en
      preventivas y no maneja fotos (la evidencia fotográfica existe solo
      en Reportes de Daño). Diseño pendiente: campo de subida en el
      diálogo de cierre (bucket ot_evidencias, patrón wo_evidence),
      validación front (≥1 imagen para habilitar "Cerrar") y server-side
      (RPC close_wo / trigger); histórico NO retroactivo (OTs ya cerradas
      no se bloquean).</impl_pending>
  </open_pending_items>

</module>
```

