# Módulo 5 — Flujos de Información (Vistas y Flujos de Datos)

Detalle de pantallas y flujos de datos del Módulo 5: Proveedores y Contratistas Externos (nivel 3: catálogo + historial + contratos con vigencia).
Decisiones de UI resueltas en esta sesión: **1 ítem "Proveedores" con ficha de 4 pestañas**, **código `PRO-0001` vía `code_counters`**, **frecuencia de visitas = enum fijo**.

> **Tablas BD del Módulo 5:** [providers](BD/providers.md) (incluye provider_files) · [contracts](BD/contracts.md) — **compartidas:** [code_counters](BD/code_counters.md) · [audit_log](BD/audit_log.md) · [notification_log](BD/notification_log.md) · [notification_config](BD/notification_config.md) — **referenciadas (otros módulos):** [work_orders](BD/work_orders.md) · [warranties](BD/warranties.md) · [items](BD/items.md) · [categories](BD/categories.md) · [users](BD/users.md)

```xml
<module id="5" name="Proveedores y Contratistas Externos" artifact="flujos">

  <decisions_taken>
    <decision>Navegación: UN ítem "Proveedores" en el grupo lateral →
      V5.1 (listado, filtro por tipo) → click en fila abre V5.2 FICHA con
      4 pestañas: General | Documentos | Contratos | Historial de
      intervención (decisión de sesión).</decision>
    <decision>Código de proveedor: autogenerado editable PRO-0001
      reutilizando code_counters (fila prefix='PRO', location_id NULL —
      mismo patrón que REP- de inventario y los activos).</decision>
    <decision>Frecuencia de visitas pactadas: ENUM FIJO opcional
      (semanal | quincenal | mensual | bimestral | trimestral |
      semestral | anual) — decisión de sesión sobre el campo opcional de
      contracts.</decision>
    <decision>Documentos del proveedor: tabla hermana provider_files
      (Storage — bucket compartido `documentos`, prefijo `proveedores/`,
      patrón asset_files) con tipo: contrato_marco |
      certificacion | poliza | otro — soporta "documentos (contrato
      marco, certificaciones, pólizas)" de la spec.</decision>
    <decision>estado_calculado de contratos: DERIVADO en consulta/vista
      (NO es columna): Vencido si hoy &gt; fin; Por vencer si hoy &gt; fin −
      días_anticipación (config Evento 11); si no → Vigente. Contrato
      aún no iniciado se muestra "Vigente" (la spec solo define 3
      estados).</decision>
    <decision>Categoría de servicio del proveedor: FK ÚNICA al árbol de
      categorías de activo (M1) — un proveedor se especializa en una
      categoría (spec: ej. contratista de "Elevadores/Verticales").</decision>
    <decision>Historial de intervención: consulta directa sobre
      work_orders.provider_id (ya diseñado en M2) — lista fecha, activo,
      costo externo, estado + contadores rápidos (OTs totales / costo
      acumulado); click en fila → V2.3. Sin tabla propia ni reporte
      aparte (spec intervention_history).</decision>
    <decision>Formularios en PANTALLA COMPLETA (V5.3 proveedor con
      documentos múltiples; V5.4 contrato con fechas/costo/adjunto),
      consistente con el patrón de formularios con secciones de los
      módulos 1–4.</decision>
    <decision>Permisos (spec permissions): Mantenimiento CRUD completo
      (proveedores, contratistas, contratos); Administrador y Calidad
      solo consulta; Técnico SIN acceso al catálogo (solo ve "Ejecutado
      por" dentro de una OT).</decision>
    <decision>Alta de contrato SOLO desde la ficha del proveedor (V5.2
      → pestaña Contratos) — no hay listado global de contratos fuera
      del catálogo (la spec los define como entidad vinculada).</decision>
  </decisions_taken>

  <implementation_notes>
    <note key="front">Front IMPLEMENTADO (V5.1–V5.4): pages/proveedores.tsx
      (V5.1: filtros búsqueda/tipo/categoría/estado + toggle "por vencer",
      tabla 7 columnas con badges de contratos vigentes/por vencer,
      paginación local 20|40|60|100, conteos de header), pages/proveedor-ficha.tsx
      (V5.2: header con badges y acciones por rol, 4 pestañas con ?tab= —
      General con audit_log vía fetchAuditFor, Documentos con upload
      (tipo+fecha) / firma firmada / delete, Contratos con estado derivado,
      Historial con contadores OTs/totales/costo 12 meses y fila → V2.3),
      pages/proveedor-form.tsx (V5.3: zod contacto con ≥1 medio, código
      PRO-#### con preview/check-debounce/allocate vía RPC
      m5_provider_code, alta redirige a la ficha), pages/contrato-form.tsx
      (V5.4: zod fin&gt;inicio y monto≥0, NO_FREQUENCY='none' para
      visit_frequency NULL, estado derivado read-only, adjunto opcional al
      bucket documentos, redirige a ficha ?tab=contratos), navegación
      "Proveedores" (ícono Truck, oculta al técnico puro) y accesos desde
      el Panel (tarjeta visible solo a roles distintos de técnico).</note>
    <note key="permisos">Permisos: RequireProviderAccess en App.tsx
      redirige a /app cuando roles es [tecnico] puro (V5.1 oculto en nav,
      panel y ruta); RequireMaintenance envuelve los formularios V5.3/V5.4;
      ficha deshabilita Editar/Activar/Eliminar para Administrador y
      Calidad (solo lectura, sin "Nuevo proveedor" ni "Nuevo contrato");
      RLS: INSERT/UPDATE/DELETE de providers/contracts/provider_files
      restringidos a Mantenimiento, sin DELETE de contracts (spec: el
      vencimiento se deriva), delete de providers bloqueado por
      trg_provider_delete_guard cuando tiene contratos.</note>
    <note key="bd">BD: migración 20261013000000_m5_core.sql aplicada en
      hosted — tablas contracts y provider_files, código PRO-#### en
      code_counters (m5_provider_code check/preview/allocate), triggers de
      audit_log (providers/contracts/provider_files) y set_updated_at,
      delete guard, policies (providers SELECT abierto a authenticated;
      segmentación por app), Evento 11 "Contrato por vencer" con
      notification_config id=11 extra_param=30 y pg_cron jobid 6
      ('10 2 * * *' → fn_m5_contract_jobs) con dedup_key
      contract-window:&lt;fecha&gt;.</note>
    <note key="ui">Detalles de UI: PostgREST shorthand is_active=true es
      inválido → filtros usan is_active=eq.true; embeds con FK explícita
      cuando hay 2 relaciones (work_orders → assets!work_orders_asset_id_fkey);
      visit_frequency es nullable (VisitFrequency | null); la categoría de
      servicio apunta a categories (catálogo M1, fetchCategories); los
      helpers postJson normalizan la respuesta array con Prefer:
      return=representation (patrón m4).</note>
    <note key="smoke">Verificación: Evento 11 con contrato de prueba
      (end_date=hoy+15) → fn_m5_contract_jobs genera notification_log con
      dedup_key y payload items; audit_log module 'providers' registra
      create; storage en documentos/proveedores/&lt;id&gt;/…; delete guard
      ambas ramas (proveedor sin contratos OK, con contratos → 400);
      navegador V5.1–V5.4 como admin/mantenimiento/calidad/tecnico — alta
      de proveedor PRO-0003, contrato "Por vencer", upload de documento,
      edición de contrato, redirect de técnico a /app, botones disabled de
      calidad; typecheck/lint/build ✓.</note>
  </implementation_notes>

  <navigation>
    <lateral_menu group="Mantenimiento">
      <item view="V1.1" label="Activos">Módulo 1.</item>
      <item view="V2.1" label="Órdenes de Trabajo">Módulo 2.</item>
      <item view="V2.4" label="Reportes de Daño">Módulo 2.</item>
      <item view="V3.1" label="Preventivo">Módulo 3.</item>
      <item view="V4.1" label="Inventario">Módulo 4.</item>
      <item view="V5.1" label="Proveedores" active="true">Módulo 5 — abre
        V5.1; fila → V5.2 ficha (4 pestañas); formularios V5.3
        (proveedor) y V5.4 (contrato).</item>
    </lateral_menu>
    <access_by_role>
      <mantenimiento>CRUD completo de proveedores, contratistas y
        contratos (spec permissions).</mantenimiento>
      <administrador>Solo consulta (spec).</administrador>
      <calidad>Solo consulta (spec).</calidad>
      <tecnico>SIN acceso al catálogo — solo ve "Ejecutado por" y el
        nombre del contratista dentro de una OT (spec).</tecnico>
    </access_by_role>
  </navigation>

  <views>

    <view id="V5.1" name="Listado de Proveedores y Contratistas" type="catalogo">
      <entry_point>Menú lateral → "Proveedores".</entry_point>
      <list>
        <columns>código (PRO-####) · nombre / razón social · tipo
          (Proveedor de materiales | Contratista de servicio | Ambos) ·
          categoría de servicio · contacto (teléfono / correo) · contratos
          vigentes (badge) · estado · acciones</columns>
        <filters>tipo, categoría de servicio, estado, con contrato por
          vencer, búsqueda texto (código/nombre).</filters>
        <pagination>20 | 40 | 60 | 100 (patrón del sistema).</pagination>
        <row_click>V5.2 (ficha — pestaña General).</row_click>
        <actions>
          <action roles="mantenimiento" to="V5.3">Nuevo proveedor /
            contratista</action>
        </actions>
        <empty_state>"Sin proveedores registrados" + "Nuevo proveedor"
          (Mantenimiento).</empty_state>
      </list>
      <roles>
        <mantenimiento>CRUD (spec permissions).</mantenimiento>
        <administrador_y_calidad>Solo lectura.</administrador_y_calidad>
        <tecnico>SIN ACCESO (spec).</tecnico>
      </roles>
    </view>

    <view id="V5.2" name="Ficha del proveedor/contratista" type="ficha">
      <entry_point>Click en fila de V5.1 (o link desde OT/garantía).</entry_point>
      <header>código · nombre · tipo · categoría de servicio · estado ·
        acciones: Editar (V5.3) · Activar/Inactivar · Eliminar SOLO si no
        tiene OTs ni contratos (si no, inactivar — patrón del
        sistema).</header>
      <tab id="general" label="General">
        <content>contacto principal (nombre, teléfono, correo) · dirección
          · observaciones · historial de estado · pestaña embebida de
          audit_log de la entidad (patrón "Historial").</content>
      </tab>
      <tab id="documents" label="Documentos">
        <content>lista de archivos con tipo (Contrato marco |
          Certificación | Póliza | Otro), fecha y descarga; subida/baja
          (Storage, patrón asset_files) — SOLO Mantenimiento
          modifica.</content>
        <empty_state>"Sin documentos cargados".</empty_state>
      </tab>
      <tab id="contracts" label="Contratos">
        <list>nombre · alcance · vigencia (inicio → vencimiento) ·
          periodicidad de costo · monto · frecuencia de visitas · estado
          calculado (badge: Vigente | Por vencer | Vencido) ·
          acciones.</list>
        <actions>
          <action roles="mantenimiento" to="V5.4">Nuevo contrato
            (prellena proveedor)</action>
          <action>M4.4-style detalle: click en fila abre V5.4 en modo
            lectura/edición.</action>
        </actions>
        <empty_state>"Sin contratos registrados".</empty_state>
      </tab>
      <tab id="history" label="Historial de intervención">
        <content>Lista de TODAS las OTs donde participó el tercero
          (work_orders.provider_id): fecha · OT · activo · ubicación ·
          costo del servicio externo · estado — más contadores rápidos:
          OTs totales, OTs últimos 12 meses, costo acumulado del servicio
          externo (evaluación de desempeño sin reporte aparte — spec
          intervention_history).</content>
        <row_click>Abre la OT en V2.3.</row_click>
        <access>Solo lectura — todos los roles con acceso a la ficha
          (Mantenimiento, Admin, Calidad).</access>
      </tab>
    </view>

    <view id="V5.3" name="Formulario de Proveedor/Contratista" type="formulario">
      <entry_points>V5.1 → "Nuevo proveedor" · V5.2 → "Editar".</entry_points>
      <sections>
        <section name="General">
          <field>código (autogenerado PRO-####, editable — code_counters,
            decisión de sesión)</field>
          <field>nombre / razón social (obligatorio)</field>
          <field>tipo: Proveedor de materiales | Contratista de servicio
            | Ambos (obligatorio)</field>
          <field>categoría de servicio (dropdown único del árbol de
            categorías de activo — M1)</field>
          <field>estado: Activo | Inactivo (default Activo)</field>
          <field>observaciones (texto libre — campo de la spec)</field>
        </section>
        <section name="Contacto">
          <field>contacto principal: nombre · teléfono · correo
            (obligatorio nombre y al menos un medio de contacto)</field>
          <field>dirección</field>
        </section>
        <section name="Documentos">
          <upload>archivos múltiples con tipo (Contrato marco |
            Certificación | Póliza | Otro) → provider_files +
            Storage.</upload>
        </section>
      </sections>
      <save_actions>Validación → INSERT/UPDATE → auditoría → redirige
        V5.1/V5.2. Inactivar NO borra: contratos y OTs históricas
        conservan la referencia (FKs).</save_actions>
    </view>

    <view id="V5.4" name="Formulario de Contrato" type="formulario">
      <entry_points>V5.2-Contratos → "Nuevo contrato" (prellena proveedor)
        / click en fila.</entry_points>
      <sections>
        <section name="Vínculo">
          <field>proveedor/contratista (FK obligatoria — prellenada desde
            la ficha; editable con búsqueda si se abrió sin
            contexto)</field>
          <field>nombre/descripción del contrato (obligatorio)</field>
          <field>alcance del servicio (texto)</field>
        </section>
        <section name="Vigencia">
          <field>fecha de inicio · fecha de vencimiento (obligatorias;
            validación vencimiento &gt; inicio)</field>
          <field>frecuencia de visitas pactadas (enum opcional — decisión
            de sesión)</field>
        </section>
        <section name="Costo">
          <field>monto del contrato (NUMERIC ≥ 0, obligatorio)</field>
          <field>periodicidad del monto: único | mensual | trimestral |
            semestral | anual (obligatorio)</field>
        </section>
        <section name="Extras">
          <field>documento adjunto (contrato firmado — Storage bucket
            `documentos`, prefijo `proveedores/`, opcional)</field>
          <field>observaciones</field>
          <read_only>estado calculado: Vigente | Por vencer | Vencido
            (derivado — decisión de sesión; los días de anticipación
            salen de la config del Evento 11)</read_only>
        </section>
      </sections>
      <save_actions>Validación → INSERT/UPDATE (module='providers',
        entity_type='contract') → auditoría → redirige V5.2-Contratos.
        Editar contrato NO afecta OTs ni garantías ya
        emitidas.</save_actions>
    </view>

  </views>

  <flows>

    <flow id="F5.1" name="CRUD de proveedores/contratistas (y documentos)">
      <trigger>Mantenimiento → V5.1 "Nuevo proveedor" / V5.2 "Editar"
        (V5.3).</trigger>
      <steps>
        <step>Código autogenerado PRO-#### (code_counters, editable) →
          nombre, tipo, categoría de servicio (FK categories M1),
          contacto, dirección, observaciones, estado.</step>
        <step>Documentos: subida con tipo → Storage + provider_files
          (patrón asset_files).</step>
        <step>Validación (nombre, código único, al menos un medio de
          contacto) → INSERT/UPDATE → auditoría.</step>
        <step>Inactivar sin borrar (FKs de work_orders, warranties,
          items, contracts conservan la referencia); eliminar solo si no
          tiene referencias.</step>
      </steps>
      <tables written="[providers](BD/providers.md) (incluye provider_files), [audit_log](BD/audit_log.md)" read="[code_counters](BD/code_counters.md), [categories](BD/categories.md)"/>
    </flow>

    <flow id="F5.2" name="CRUD de contratos">
      <trigger>V5.2-Contratos → "Nuevo contrato" / edición (V5.4) — solo
        Mantenimiento.</trigger>
      <steps>
        <step>Proveedor FK + datos del contrato: vigencia, frecuencia de
          visitas (enum), monto + periodicidad, adjunto,
          observaciones.</step>
        <step>Validación de fechas (fin &gt; inicio) → INSERT/UPDATE
          (module='providers', entity_type='contract') → auditoría con
          snapshot.</step>
        <step>estado_calculado se DERIVA en cada lectura (decisión de
          sesión): Vencido si hoy &gt; fin · Por vencer si hoy &gt; fin −
          anticipación (config Evento 11) · si no → Vigente (incluye
          preinicio).</step>
      </steps>
      <tables written="[contracts](BD/contracts.md), [audit_log](BD/audit_log.md)" read="[notification_config](BD/notification_config.md) (días anticipación Evento 11)"/>
    </flow>

    <flow id="F5.3" name="Historial de intervención (consulta de desempeño)">
      <trigger>V5.2 pestaña "Historial de intervención".</trigger>
      <steps>
        <step>SELECT de work_orders con provider_id = tercero (todas las
          OTs — la FK ya existe en M2): fecha, activo, costo externo,
          estado.</step>
        <step>Contadores rápidos: total de OTs, OTs últimos 12 meses,
          costo acumulado de servicio externo.</step>
        <step>Click en fila → V2.3 (la OT completa).</step>
      </steps>
      <rules>Sin tabla propia ni reporte aparte (spec: "para evaluar
        desempeño sin reporte aparte"). Solo lectura.</rules>
      <tables read="[work_orders](BD/work_orders.md), [assets](BD/assets.md)"/>
    </flow>

    <flow id="F5.4" name="Integración con OT y garantía (cross-flows)">
      <trigger>Flujos de M2/M1 con contexto de contratista.</trigger>
      <steps>
        <step>En la OT (V2.2): "Ejecutada por" = Contratista externo →
          selector de proveedores con tipo contratista/ambos +
          "Costo del servicio externo" (monto único) — campos ya
          diseñados en M2 (work_orders.executed_by, provider_id,
          external_cost).</step>
        <step>OT de contratista PUEDE quedar SIN técnico interno (spec
          unassigned_technician): la gestiona directamente Mantenimiento —
          sin fila en wo_technicians de interno; horas = 0 en la fórmula
          de costo.</step>
        <step>Al CERRAR con garantía = Sí en OT de contratista externo:
          el modal M2.1 → F1.5 preselecciona ese contratista como
          "proveedor que otorga la garantía" (spec warranty_link; ya
          declarado en M1 y M2).</step>
        <step>La OT queda registrada en el historial de intervención del
          contratista automáticamente (F5.3).</step>
      </steps>
      <tables read="[work_orders](BD/work_orders.md)" written="[warranties](BD/warranties.md) (via F1.5)"/>
    </flow>

    <flow id="F5.5" name="Evento 11 — Contrato por vencer (diario)">
      <trigger>pg_cron diario (mismo job que los eventos 3/6).</trigger>
      <steps>
        <step>SELECT de contratos activos cuyos vencimientos entran en la
          ventana de anticipación (días = config Evento 11, editable —
          patrón garantías).</step>
        <step>Evento 11 "Contrato por vencer" → RESUMEN DIARIO agrupado
          (una notificación con todos los contratos por vencer: proveedor,
          contrato, fecha de vencimiento, días restantes) →
          notification_log.</step>
        <step>Badge "Por vencer" en V5.1 (columna contratos vigentes) y
          en V5.2-Contratos durante la ventana.</step>
      </steps>
      <rules>Sin push (es resumen diario por correo); los contratos ya
        VENCIDOS no reenvían una vez que salieron de la ventana (solo la
        ventana de anticipación genera el evento, igual que garantías:
        estado Vencido es dato visible, no notificación recurrente).</rules>
      <tables read="[contracts](BD/contracts.md), [notification_config](BD/notification_config.md)" written="[notification_log](BD/notification_log.md)"/>
    </flow>

  </flows>

  <cross_module_flows>
    <cross from="M1 (Activos)">
      <item>categoría de servicio FK → árbol de categorías de activo
        (V1.6); la categoría del proveedor alimenta filtros de
        "Contratistas recomendados" en el cierre de OT (M2).</item>
      <item>F1.5 (garantías): warranties.provider_id → selector del
        catálogo + preselección automática desde OT de contratista (F5.4).</item>
    </cross>
    <cross from="M2 (OTs)">
      <item>work_orders.executed_by / provider_id / external_cost ya
        diseñados en M2 — F5.4 completa la lógica (sin técnico interno,
        garantía preseleccionada) y F5.3 los consume.</item>
      <item>Costo total de la OT = mano de obra interna + repuestos
        (kardex M4) + external_cost (spec cost_formula).</item>
    </cross>
    <cross from="M4 (Inventario)">
      <item>items.preferred_provider_id (proveedor preferido) → selector
        del catálogo; la Entrada de material (F4.3) registra proveedor
        del documento.</item>
    </cross>
    <cross from="T1/T2/T3">
      <item>T1: permissions de la spec aplicadas en cada vista
        (decisions_taken + access_by_role).</item>
      <item>T2: Evento 11 "Contrato por vencer" (resumen diario, días
        editables) — ya en catálogo y notification_config.</item>
      <item>T3: audit_log con module='providers' (CUBIERTO por el CHECK
        existente) y entity_type='contract' para contratos.</item>
    </cross>
  </cross_module_flows>

  <notifications>
    <event number="11" type="resumen diario (sugerido en catálogo T2)" channel="push + email (resumen)">
      <trigger>pg_cron diario (F5.5).</trigger>
      <content>"Contrato por vencer": lista de contratos cuyo vencimiento
        entra en la ventana de anticipación — proveedor, contrato, fecha,
        días restantes. Días de anticipación EDITABLE en la config del
        evento (mismo patrón que garantías — spec contracts.notification).
      </content>
      <audience>Mantenimiento.</audience>
      <dedup>Una ejecución diaria; los vencidos salen de la ventana y no
        reenvían.</dedup>
    </event>
    <not_triggered>
      <item>Alta/edición de proveedores o contratos: sin notificación.</item>
      <item>Documentos cargados: sin notificación.</item>
      <item>Historial de intervención: es vista, no evento.</item>
    </not_triggered>
  </notifications>

  <supabase_mapping>
    <engine>RLS por rol (patrón T1); pg_cron diario comparte job con
      M3/M4 (Eventos 6, 3 y 11 en la misma corrida); Storage: bucket
      compartido `documentos` (prefijo `proveedores/` — política base y
      detalle de prefijos declarados en
      [04-inventario-flujos](04-inventario-flujos.md)
      storage_buckets) para documentos de proveedores y contratos.</engine>
    <tables>
      <table file="providers">Catálogo único proveedor/contratista:
        código PRO-#### (code_counters), nombre, tipo (supplier|
        contractor|both), categoría de servicio FK → categories (M1),
        contacto principal, dirección, observaciones, estado —
        INCLUYE provider_files (documentos con tipo: contrato_marco,
        certificacion, poliza, otro).</table>
      <table file="contracts">Contratos: FK proveedor, vigencia, alcance,
        frecuencia de visitas (enum), monto + periodicidad (enum),
        documento adjunto, observaciones; estado_calculado DERIVADO
        (decisión de sesión).</table>
      <table file="code_counters" shared="true">Secuencia PRO- (fila
        prefix='PRO', location_id NULL).</table>
      <table file="work_orders" shared="true">executed_by, provider_id,
        external_cost → historial F5.3 e integración F5.4.</table>
      <table file="warranties" shared="true">provider_id preseleccionado
        desde OT de contratista (F1.5/F5.4).</table>
      <table file="categories" shared="true">Categoría de servicio del
        proveedor.</table>
      <table file="items" shared="true">preferred_provider_id +
        proveedor de entradas (M4).</table>
      <table file="audit_log" shared="true">module='providers',
        entity_type='contract' para contratos.</table>
      <table file="notification_config">Evento 11 (días de anticipación
        editables).</table>
      <table file="notification_log">Envíos diarios del Evento 11.</table>
    </tables>
    <rls_policy>Mantenimiento: SELECT/INSERT/UPDATE en providers,
      provider_files y contracts (DELETE solo sin referencias; si no,
      inactivar); Administrador/Calidad: SELECT; Técnico: sin acceso al
      catálogo (solo el dato "Ejecutado por" dentro de OTs — vía RLS de
      work_orders, no de providers).</rls_policy>
  </supabase_mapping>

  <open_pending_items>
    <item>Plantilla de contrato marco: contenido legal base — fuera de
      alcance del CMMS (solo adjunta el archivo).</item>
    <item>Historial de intervención — PARCIALMENTE en Módulo 7:
      provider_cost (costo por proveedor) + contractor_history (link a la
      ficha M5); los KPIs extendidos de desempeño (% a tiempo,
      re-trabajos) NO están en la spec actual → futuro (catálogo de KPIs
      ampliable).</item>
    <item>Certificaciones de la empresa en provider_files: vigencia con
      Evento 8 (certificaciones) NO se aplica a proveedores hoy —
      ¿extender? Pendiente de decisión si el hotel lo pide (la spec
      aplica Evento 8 a certificaciones de personal/activos).</item>
    <item>Horario del pg_cron del Evento 11 — RESUELTO en M5: jobid 6
      '10 2 * * *' → fn_m5_contract_jobs (definir con los jobs de M3/M4
      si el hotel necesita mover la franja; configuración vía
      notification_config).</item>
  </open_pending_items>

</module>
```
