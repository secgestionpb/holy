# Módulo 3 — Flujos de Información (Vistas y Flujos de Datos)

Detalle de pantallas y flujos de datos del Módulo 3: Mantenimiento Preventivo.
Decisiones de rol y UI resueltas en esta sesión: **Calidad ve el calendario en solo lectura**, **checklist completo como requisito de cierre**, **navegación con 1 ítem "Preventivo" + subpantallas**.

> **Tablas BD del Módulo 3:** [maintenance_plans](BD/maintenance_plans.md) (incluye plan_asset_links y plan_category_links) · [checklist_templates](BD/checklist_templates.md) (incluye checklist_items y checklist_item_items) · [wo_checklist_entries](BD/wo_checklist_entries.md) — **compartidas:** [audit_log](BD/audit_log.md) · [notification_log](BD/notification_log.md) · [notification_config](BD/notification_config.md) — **referenciadas (otros módulos):** [work_orders](BD/work_orders.md) · [assets](BD/assets.md) · [categories](BD/categories.md) · [users](BD/users.md) · [item_asset_links](BD/item_asset_links.md)

```xml
<module id="3" name="Mantenimiento Preventivo" artifact="flujos">

  <decisions_taken>
    <decision>Acceso al calendario: Mantenimiento y Administrador (spec:
      calendar_tab) + CALIDAD en SOLO LECTURA (resolución de la
      contradicción con quality_role_oversight, que enumera "calendario"
      explícitamente). El Técnico queda EXCLUIDO del calendario (spec
      unánime); sí ve la pestaña Lista.</decision>
    <decision>Cierre de OT preventiva con checklist: para llevar la OT a
      "Completada" TODOS los ítems deben quedar resueltos — estado
      "Completado" u "No aplica" con OBSERVACIÓN INDIVIDUAL OBLIGATORIA en
      este último caso. Completa y vincula el campo "checklist completado"
      del modal de cierre M2.1 (Módulo 2).</decision>
    <decision>Navegación: UN ítem "Preventivo" en el grupo lateral
      Mantenimiento → V3.1 (pestañas Calendario | Lista). Botones
      "Gestionar planes" → V3.2 y "Plantillas de checklist" → V3.4 (subpantallas
      del mismo módulo, no ítems hermanos).</decision>
    <decision>La pestaña "Lista" de V3.1 es el COMPONENTE COMPARTIDO de
      V2.1 (listado general de OTs del Módulo 2, spec scope_note: "muestra
      TODAS las OTs, no únicamente las preventivas") — se embebe sin
      duplicar definición ni lógica de filtros.</decision>
    <decision>Alcance de un plan: UNIÓN de sus vínculos por categoría y por
      activo individual (el formulario de V3.3 permite ambos métodos y
      coexisten en el mismo plan, según ui_note de la spec).</decision>
    <decision>Checklist por SNAPSHOT: al generar cada OT preventiva se
      copian los ítems de la plantilla a wo_checklist_entries
      (item_text inmutable). Editar la plantilla después NO altera OTs ya
      generadas ni histórico.</decision>
    <decision>Primer disparo del plan: al crearlo, Mantenimiento indica la
      PRÓXIMA fecha de ejecución (next_due_at) — la spec describe el cálculo
      recurrente (última ejecución + intervalo) pero no el disparo inicial;
      desde esa fecha corre la secuencia.</decision>
    <decision>Reprogramación de OCURRENCIA (drag en calendario): mueve la
      fecha programada de ESA OT ya generada. Reprogramación de PLAN:
      desplaza next_due_at (secuencia futura); OTs generadas/cerradas no se
      tocan. Las PROYECCIONES no se arrastran (spec). Ambas con auditoría y
      margen de gracia contado desde la nueva fecha.</decision>
    <decision>Generación de OTs preventivas SIN asignación automática: el
      "técnico/rol sugerido" del plan es solo referencia (spec: la
      asignación real siempre es manual) → la generación NO dispara push;
      el push ocurre cuando Mantenimiento asigna (F2.4 del Módulo 2).</decision>
    <decision>Plan Inactivo = motor lo salta (sin generar nuevas OTs), las
      OTs ya generadas siguen su ciclo normal.</decision>
    <decision>Catálogos (planes, plantillas): sin borrado físico —
    baja lógica por estado, consistente con el patrón del resto del
      sistema.</decision>
    <decision>Consumibles presuntos por ítem de checklist
      (checklist_item_items): repuestos/insumos que la OT SUGIERE para la
      ejecución — asociación opcional, NO bloquea la creación del PM ni la
      ejecución/cierre de la OT (spec M4: "asociar repuestos a los ítems
      de un checklist"; decisión de sesión: presunción no restrictiva).
      Picker operativo — `items` con diseño completo desde el Módulo 4.</decision>
    <decision>Herramientas necesarias: FUERA DE ALCANCE — no existe en la
      spec en ningún módulo (decisión de sesión: descartado).</decision>
    <decision>Observación/notas del plan = campo `description` existente
      en maintenance_plans (la spec no define un campo "observación"
      aparte — decisión de sesión).</decision>
  </decisions_taken>

  <implementation_notes>
    <note key="front">Front IMPLEMENTADO (V3.1–V3.4): pages/preventivo.tsx
      (V3.1 pestañas Calendario|Lista; el Técnico NO ve el calendario y
      arranca en Lista), components/preventivo/preventivo-calendar.tsx
      (mes Lun–Dom con navegación y "Hoy", OTs programadas con color por
      estado y resaltado rojo de vencidas, proyecciones punteadas de los
      planes de tiempo desde next_due_at, drag&amp;drop para reprogramar SOLO
      Mantenimiento — conserva la hora local vía ISO-UTC y la OT queda en
      su historial —, click en la OT → detalle), pestaña Lista = el
      componente V2.1 compartido (pages/ordenes.tsx embebido, sin
      duplicar filtros ni lógica), pages/preventivo-planes.tsx y
      pages/preventivo-plantillas.tsx (listados con botones CRUD SOLO
      para Mantenimiento; Administrador y Calidad quedan en lectura),
      pages/preventivo-plan-form.tsx (V3.3: frecuencia tiempo/uso,
      anticipación y margen de gracia, próximo disparo, alcance = activos
      puntuales + categorías sincronizado por diff N:N con
      syncPlanScope), pages/preventivo-plantilla-form.tsx (V3.4 editor
      de ítems con orden y reemplazo), rutas CRUD bajo
      RequireMaintenance.</note>
    <note key="bd">BD: migraciones 20261012000000–000002 (tablas, RLS,
      RPCs, cron) + 20261012000003 (fixes: RLS ON en plan_asset_links y
      plan_category_links, FK work_orders_plan_fkey, eliminación de
      políticas duplicadas de wo_checklist_entries, FK del snapshot
      checklist_item_id con ON DELETE SET NULL para poder editar
      plantillas aunque existan OTs generadas).</note>
    <note key="motor">Motor m3_wo_generate (SECURITY DEFINER; cron
      diario 02:00 "m3-wo-generate-daily"): salta planes inactivos; en
      frecuencia de tiempo exige next_due_at y al generar avanza
      next_due_at + intervalo con reason de auditoría "Recálculo F3.3
      (generación preventiva)"; SIN asignación automática; copia los
      ítems de la plantilla a wo_checklist_entries (snapshot); omite si
      ya existe una OT abierta del mismo plan y activo (verificado:
      segunda corrida no duplicó); wo_number lo asigna fn_wo_number (el
      motor no lo pasa); Notificaciones vía fn_notify — Evento 2 por
      plan con dedup plan+fecha y Evento 6 ACUMULADO diario de OTs
      preventivas vencidas (scheduled + grace &lt; hoy) con dedup por
      fecha (la versión anterior insertaba columnas inexistentes en
      notification_log y habría fallado); EXECUTE solo a
      authenticated/service_role.</note>
    <note key="f34_f35">F3.4: pestaña "Checklist" en
      pages/orden-detalle.tsx + components/ordenes/checklist-tab.tsx —
      estados Hecho/No aplica con badges y progreso X/Y, "No aplica"
      exige observación (botón deshabilitado hasta escribirla),
      editable SOLO Mantenimiento o técnico asignado en OT no terminal;
      el cierre valida dos veces: en el front (CloseDialog muestra
      "Checklist incompleto: no se puede cerrar la OT.") y en la BD
      (m2_close_wo). F3.5: m3_plan_close_recalc invocada por el trigger
      trg_wo_close_recalc (AFTER UPDATE de work_orders cuando status
      pasa a "closed" — cubre la RPC y cualquier otro camino); tiempo →
      next_due_at = fecha PROGRAMADA de la OT + intervalo; uso →
      last_run_counter = contador actual del activo; auditoría con
      reason "Recálculo F3.5 al cerrar &lt;OT&gt;". F3.7: trigger
      trg_audit_maintenance_plans audita create/update/deactivate con
      snapshot de campos (module preventive_maintenance).</note>
    <note key="ui">Detalles: PostgREST alojado NO acepta order por
      columna embebida (PGRST100) → los ítems de la plantilla se
      ordenan en cliente; zod+RHF sin coerce (z.number con helper
      numberValue para normalizar spinbuttons); Radix desde el paquete
      unificado radix-ui (Slot.Root / Label.Root).</note>
    <note key="smoke">Verificación: typecheck/lint/build ✓ y smoke de
      navegador sin errores de consola — plantilla de 3 ítems, plan con
      alcance y disparo vencido, motor vía SQL (OT-0034 + snapshot +
      next_due 10-11 → 11-10 + Evento 2), segunda corrida con Evento 6
      y sin duplicar OT, checklist completo (No aplica con nota,
      progreso, bloqueo de cierre con 1 pendiente y cierre exitoso),
      F3.5 probado con drift artificial (12-31 → 11-10 + audit),
      RLS negativa (Calidad POST maintenance_plans → 403), calendario
      con proyección del plan el 10-nov y drag 10 → 15 conservando la
      hora local.</note>
  </implementation_notes>


  <navigation>
    <lateral_menu group="Mantenimiento">
      <item view="V1.1" label="Activos">Módulo 1.</item>
      <item view="V2.1" label="Órdenes de Trabajo">Módulo 2.</item>
      <item view="V2.4" label="Reportes de Daño">Módulo 2.</item>
      <item view="V3.1" label="Preventivo" active="true">Módulo 3 — abre
        V3.1 (Calendario | Lista). Dentro de V3.1: botones
        "Gestionar planes" (V3.2) y "Plantillas de checklist" (V3.4);
        V3.2 → "Nuevo/Editar plan" → V3.3.</item>
    </lateral_menu>
    <access_by_role>
      <mantenimiento>Todo: calendario, planes, plantillas, reprogramar.</mantenimiento>
      <administrador>Calendario y planes en solo lectura (sin CRUD, sin
        reprogramar — CRUD de planes es Mantenimiento según T1).</administrador>
      <calidad>Solo consulta del módulo completo: calendario (lectura),
        planes, plantillas y checklists ejecutados (spec
        quality_role_oversight + decisión de sesión).</calidad>
      <tecnico>SIN calendario; ve pestaña Lista (solo sus OTs) y consulta
        de planes desde el contexto de su OT (sin CRUD).</tecnico>
    </access_by_role>
  </navigation>

  <views>

    <view id="V3.1" name="Preventivo (Calendario | Lista)" type="principal">
      <entry_point>Menú lateral → "Preventivo".</entry_point>
      <tabs>
        <tab id="calendar" label="Calendario" default="true">
          <tool>FullCalendar (o equivalente: eventos clicables + drag).</tool>
          <granularity>Mes | Semana | Día — navegable (anterior / siguiente /
            hoy).</granularity>
          <content>
            <item><b>OTs preventivas YA GENERADAS</b> (color sólido,
              clicable): etiqueta solo "OT-1842 · FCU-305 · Cambio de
              filtro" (número · activo · nombre corto del plan); indicador
              VISUAL distintivo si está VENCIDA (fecha programada + margen
              de gracia &lt; hoy).</item>
            <item><b>PROYECCIONES</b> de planes futuros aún sin generar OT —
              SOLO frecuencia POR TIEMPO (estilo tenue/diferenciado). Los
              planes por USO/CONTADOR NO se proyectan: solo aparece la OT
              cuando efectivamente se genera (spec).</item>
          </content>
          <click_behavior>
            <on_generated_wo>Modal M3.1: número, activo, ubicación, plan,
              estado, prioridad, técnicos asignados, fecha programada +
              botón "Abrir OT completa" → V2.3.</on_generated_wo>
            <on_projection>Modal M3.1 (modo proyección): datos del plan,
              activo y fecha estimada — SIN botón de OT (aún no
              existe).</on_projection>
          </click_behavior>
          <drag_and_drop>Permitido SOLO Mantenimiento y SOLO sobre OTs ya
            generadas → mueve esa ocurrencia (scheduled_at de esa OT, F3.7a).
            Las proyecciones NO se arrastran.</drag_and_drop>
          <filters>por plan, categoría, estado; rango de fechas visible =
            mes/semana/día actual.</filters>
          <roles>
            <mantenimiento>Lectura + drag + acciones de planes.</mantenimiento>
            <administrador>Solo lectura.</administrador>
            <calidad>Solo lectura (decisión de sesión).</calidad>
            <tecnico>SIN ACCESO (spec unánime).</tecnico>
          </roles>
        </tab>
        <tab id="list" label="Lista">
          <component>Componente compartido de V2.1 (Módulo 2) embebido
            sin duplicar: mismas 4 pestañas de estado, filtros de fecha,
            paginación 20/40/60/100 y columnas. Muestra TODAS las OTs
            (preventivas y las demás — scope_note de spec), con el filtro
            "tipo = Preventiva" disponible (no automático).</component>
          <color_coding>Las filas de OT preventiva vencida usan el MISMO
            color/indicador que el calendario. Colores exactos según
            design_tokens de
            [stack-tecnologico](stack-tecnologico.md): preventiva futura =
            azul primary · vencida = rojo · ejecutada = verde · correctiva =
            ámbar.</color_coding>
          <roles>Las de V2.1: Técnico solo sus OTs; Mantenimiento todas;
            Admin lectura; Calidad lectura.</roles>
        </tab>
      </tabs>
      <header_actions>
        <action roles="mantenimiento" to="V3.2">Gestionar planes</action>
        <action roles="mantenimiento|calidad|administrador" to="V3.4">Plantillas de checklist</action>
      </header_actions>
    </view>

    <view id="V3.2" name="Listado de Planes de Mantenimiento" type="catalogo">
      <entry_point>V3.1 → "Gestionar planes".</entry_point>
      <list>
        <columns>nombre | aplicación (categoría / N activos) | frecuencia
          (cada N días | cada N horas-ciclos) | próxima ejecución (next_due)
          | checklist vinculado | estado (Activo/Inactivo) | OTs abiertas |
          acciones</columns>
        <filters>estado, categoría, tipo de frecuencia, búsqueda
          texto</filters>
        <pagination>20 | 40 | 60 | 100 (patrón del sistema).</pagination>
        <row_click>V3.3 en modo edición (Mant.) / modo lectura (Admin,
          Calidad, Técnico).</row_click>
        <actions>
          <action roles="mantenimiento" to="V3.3">Nuevo plan</action>
          <action roles="mantenimiento" to="V3.4">Plantillas de
            checklist</action>
          <action roles="mantenimiento" to="M3.2">Reprogramar plan
            completo</action>
        </actions>
        <empty_state>"Sin planes de mantenimiento" + botón "Nuevo plan"
          (Mantenimiento).</empty_state>
      </list>
      <roles>
        <mantenimiento>CRUD completo (T1).</mantenimiento>
        <administrador>Solo lectura.</administrador>
        <calidad>Solo lectura.</calidad>
        <tecnico>Solo lectura (T1: "consulta planes de PM sin
          editar").</tecnico>
      </roles>
    </view>

    <view id="V3.3" name="Formulario de Plan de Mantenimiento" type="formulario">
      <entry_points>V3.2 → "Nuevo plan" / click en fila (edición) |
        V3.4 o M3.1 con contexto de plan.</entry_points>
      <sections>
        <section name="General">
          <field>nombre del plan (obligatorio)</field>
          <field>description — observaciones/notas del plan (objetivo,
            alcance técnico, referencias; decision de sesión: la spec no
            define campo "observación" aparte)</field>
          <field>estado: Activo | Inactivo (default Activo)</field>
          <field>prioridad por defecto: Urgente | Normal | Baja (heredada
            al crear la OT, editable ahí)</field>
          <field>técnico/rol sugerido (opcional — SOLO referencia, la
            asignación real siempre es manual; no genera
            auto-asignación)</field>
        </section>
        <section name="Aplicación (alcance)">
          <field>por CATEGORÍA: checkbox + árbol de categorías (Módulo 1) —
            vínculo DINÁMICO: activos actuales y futuros de esa categoría
            entran al plan automáticamente (F3.2 / cross M1)</field>
          <field>por ACTIVO INDIVIDUAL: selector múltiple de activos
            (búsqueda por código/nombre/ubicación) — selección
            estática</field>
          <note>Ambos métodos coexisten en el mismo plan (decisión de
            sesión): el alcance efectivo es la unión de ambos vínculos. Al
            menos uno requerido.</note>
        </section>
        <section name="Frecuencia">
          <field>tipo: Por calendario (tiempo) | Por contador de uso
            (condicional)</field>
          <field if="tiempo">intervalo en DÍAS (numérico &gt; 0) +
            próxima fecha de ejecución (primer disparo — decisión de
            sesión); el cálculo recurrente toma fecha de última ejecución +
            intervalo</field>
          <field if="uso">intervalo en HORAS/CICLOS (numérico &gt; 0) +
            nota: requiere "tiene contador de uso" en el activo (M1); el
            contador se registra MANUALMENTE por el técnico en cada OT (no
            hay telemetría)</field>
        </section>
        <section name="Generación y tolerancia">
          <field>anticipación de generación en días (default 0 — ej. 7 =
            la OT se crea 7 días antes del vencimiento)</field>
          <field>margen de gracia en días — OBLIGATORIO, individual por
            plan (NO existe valor global; default vacío, el form no deja
            guardar sin él)</field>
          <field>checklist: dropdown de plantillas activas (M3.4) +
            opción "Crear nueva plantilla…" (abre M3.3 sin salir) +
            opción "Sin checklist"</field>
        </section>
      </sections>
      <save_actions>Validación (margen obligatorio, intervalo &gt; 0, al
        menos 1 vínculo) → INSERT/UPDATE (RLS Mantenimiento) → recálculo de
        next_due_at → auditoría (Crear/Modificar con snapshot) → redirige a
        V3.2. Editar un plan NO re genera OTs ya creadas ni toca OTs en
        curso.</save_actions>
      <deactivate_rule>Inactivar NO borra: el motor salta el plan; las OTs
        generadas siguen su ciclo. Sin borrado físico (decisión de
        sesión).</deactivate_rule>
    </view>

    <view id="V3.4" name="Catálogo de Plantillas de Checklist" type="catalogo">
      <entry_point>V3.1 → "Plantillas de checklist" o V3.3 → "Crear nueva
        plantilla…".</entry_point>
      <list>
        <columns>nombre | categoría sugerida | # de ítems | estado |
          planes que la usan | acciones</columns>
        <filters>categoría sugerida, estado, búsqueda texto.</filters>
        <actions>
          <action roles="mantenimiento">Nueva plantilla / Editar /
            Activar-Inactivar (modal M3.3). Sin borrado físico: si está
            vinculada a un plan activo, el desactivarla NO afecta planes ni
            OTs existentes (snapshot), pero sí deja de ser seleccionable en
            nuevos planes.</action>
        </actions>
      </list>
      <roles>
        <mantenimiento>CRUD (T1).</mantenimiento>
        <administrador_y_calidad>Solo lectura (Calidad audita "checklists
          ejecutados").</administrador_y_calidad>
        <tecnico>Solo lectura desde el contexto de su OT (la plantilla
          aparece como snapshot en la pestaña Ejecución).</tecnico>
      </roles>
    </view>

    <modal id="M3.1" name="Detalle de evento del calendario">
      <mode_generated>OT generada: número, activo (+link ficha V1.3),
        ubicación, plan, estado, prioridad, técnicos, fecha programada
        (editable por Mantenimiento → drag equivalente) + botón "Abrir OT
        completa" → V2.3.</mode_generated>
      <mode_projection>Proyección: plan, activo, fecha estimada, frecuencia
        — SIN botón de OT. Cierre: botón "Ver plan" → V3.3.</mode_projection>
    </modal>

    <modal id="M3.2" name="Reprogramar plan completo">
      <entry_point>V3.2 acción "Reprogramar plan completo" (solo
        Mantenimiento).</entry_point>
      <fields>nueva fecha base de la secuencia futura (date picker) + resumen
        "las próximas N ocurrencias se desplazan; las OTs ya generadas no
        cambian" + motivo (opcional, recomendado).</fields>
      <effects>UPDATE next_due_at → auditoría (Modificar con anterior →
        nuevo) → proyecciones del calendario se mueven. La margen de gracia
        se cuenta desde la NUEVA fecha (spec).</effects>
    </modal>

    <modal id="M3.3" name="Nueva / Editar plantilla de checklist">
      <fields>nombre (obligatorio) | categoría sugerida (dropdown M1,
        opcional) | editor de ítems: lista ORDENABLE (arriba/abajo o drag)
        con texto por ítem; agregar/quitar ítems; por ítem: "consumibles
        sugeridos" (opcional — repuestos/insumos con cantidad presunta,
        picker de Módulo 4, operativo con `items` diseñado en M4; presunción NO
        bloqueante); estado Activo/Inactivo.</fields>
      <save_actions>INSERT/UPDATE (solo Mantenimiento) → auditoría. Al
        guardar desde V3.3 (plan), la plantilla nueva queda seleccionada en
        el dropdown del plan en curso.</save_actions>
      <snapshot_rule>Editos posteriores NO cambian wo_checklist_entries de
        OTs ya generadas (decisión de sesión).</snapshot_rule>
    </modal>

  </views>

  <flows>

    <flow id="F3.1" name="CRUD de plantillas de checklist">
      <trigger>Mantenimiento → V3.4 "Nueva plantilla" / "Editar" / "Activar-Inactivar" (M3.3).</trigger>
      <steps>
        <step>Completa nombre (obligatorio), categoría sugerida (opcional, M1) y lista ordenada de ítems.</step>
        <step>Guardar → INSERT/UPDATE (RLS solo Mantenimiento) → auditoría.</step>
        <step>Si se abrió desde V3.3 (plan), la plantilla nueva queda seleccionada en el dropdown del plan.</step>
      </steps>
      <rules>Sin borrado físico; desactivar excluye de nuevos planes sin afectar planes/OTs existentes (snapshot).</rules>
      <tables written="[checklist_templates](BD/checklist_templates.md) (incluye checklist_items), [audit_log](BD/audit_log.md)"/>
    </flow>

    <flow id="F3.2" name="Crear / editar plan de mantenimiento">
      <trigger>Mantenimiento → V3.2 "Nuevo plan" o edición de fila → V3.3.</trigger>
      <steps>
        <step>Define alcance: vínculos por categoría (dinámicos) y/o activos individuales (estáticos) — al menos uno (unión = alcance efectivo).</step>
        <step>Frecuencia: tiempo (intervalo en días + próxima fecha base) o uso (intervalo en horas/ciclos; requiere activos con "tiene contador de uso").</step>
        <step>Completa prioridad por defecto, anticipación de generación, margen de gracia (OBLIGATORIO) y checklist (plantilla existente, nueva o ninguno).</step>
        <step>Guardar → validación → INSERT/UPDATE → cálculo de next_due_at → auditoría con snapshot anterior → redirige V3.2.</step>
      </steps>
      <rules>Editar plan NO modifica OTs ya generadas. Inactivar = motor lo salta; OTs existentes siguen su ciclo.</rules>
      <tables written="[maintenance_plans](BD/maintenance_plans.md), plan_asset_links / plan_category_links (en archivo), [audit_log](BD/audit_log.md)"/>
      <cross_m1>El árbol de categorías y el selector de activos leen [categories](BD/categories.md) y [assets](BD/assets.md).</cross_m1>
    </flow>

    <flow id="F3.3" name="Motor de generación de OTs preventivas">
      <trigger>pg_cron diario (evalúa planes Activos) + reevaluación inmediata al registrar un contador de uso (F3.8).</trigger>
      <steps>
        <step>Por cada plan activo con al menos 1 activo en su alcance (unión de vínculos): ¿corresponde generar?
          - Frecuencia TIEMPO: hoy ≥ next_due_at − anticipación de generación.
          - Frecuencia USO: contador actual del activo ≥ último contador registrado + intervalo.</step>
        <step>Por cada activo elegido → INSERT OT (tipo = Preventiva, prioridad heredada del plan, fecha programada = disparo, SIN asignación → sin push; plan_id vinculado).</step>
        <step>Snapshot: copia los ítems de la plantilla del plan a wo_checklist_entries (F3.4).</step>
        <step>Recalcula next_due_at del plan = fecha programada + intervalo (desde la fecha PROGRAMADA — F3.5).</step>
        <step>Evento 2 (T2): "Resumen diario de OTs preventivas generadas", AGRUPADAS POR PLAN (una notificación por plan con sus OTs, no una por OT) → notification_log.</step>
      </steps>
      <rules>Sin asignación automática (técnico/rol sugerido = solo referencia). Vencimiento NO genera OT duplicada: mientras exista OT Preventiva ABIERTA para ese activo+plan, el motor no duplica (F3.6).</rules>
      <tables written="[work_orders](BD/work_orders.md), [wo_checklist_entries](BD/wo_checklist_entries.md), [maintenance_plans](BD/maintenance_plans.md) (next_due_at), [notification_log](BD/notification_log.md), [notification_config](BD/notification_config.md) (evento 2)"/>
      <cross_m2>La OT generada es idéntica en estructura a F2.10 (Módulo 2) y entra a la misma bandeja V2.1.</cross_m2>
    </flow>

    <flow id="F3.4" name="Ejecución del checklist en la OT (pestaña Ejecución de V2.3)">
      <trigger>Técnico abre la OT preventiva → pestaña "Ejecución" (Módulo 2).</trigger>
      <steps>
        <step>Muestra los ítems SNAPSHOT (wo_checklist_entries) en orden, con la plantilla original como referencia. De cada ítem se listan sus CONSUMIBLES PRESUNTOS (checklist_item_items vía checklist_item_id) con verificación de disponibilidad en almacén (Módulo 4) — SOLO informativo, nunca bloquea la ejecución ni el cierre (decisión de sesión).</step>
        <step>Por cada ítem: marcar "Completado" u "No aplicable" — este último REQUIERE observación individual (obligatoria). Opcional: adjuntar evidencia (cross M2 → wo_evidence).</step>
        <step>Cada marca → UPDATE de la fila → auditoría. El estado de la OT NO cambia por marcar ítems.</step>
        <step>Cierre (F2.6): TODOS los ítems deben estar resueltos (Completado o No aplicable+obs.) — requisito de "Completada" (decisión de sesión, completa M2.1). Violación → bloquea cierre con mensaje "Faltan N ítems sin resolver".</step>
      </steps>
      <rules>Checklist es OBLIGATORIO solo si la OT preventiva tiene ítems (plan con plantilla); "Sin checklist" → cierre normal. Solo el Técnico asignado (o Mantenimiento) marca ítems.</rules>
      <tables written="[wo_checklist_entries](BD/wo_checklist_entries.md), [audit_log](BD/audit_log.md)"/>
    </flow>

    <flow id="F3.5" name="Recálculo de la próxima ejecución al cerrar la OT">
      <trigger>Cierre de OT preventiva (F2.6, Módulo 2) → cross.</trigger>
      <steps>
        <step>Frecuencia TIEMPO: next_due_at = fecha PROGRAMADA de la OT cerrada + intervalo (base = scheduled_at, NO la fecha real de cierre — spec).</step>
        <step>Frecuencia USO: último contador del plan = contador registrado en la OT + intervalo = nuevo umbral (F3.8).</step>
        <step>UPDATE maintenance_plans → auditoría → proyecciones del calendario se recalculan.</step>
      </steps>
      <rules>Si la OT se cerró FUERA de tiempo (vencida), la secuencia sigue reanudándose desde la fecha programada + intervalo; el margen de gracia del plan protege la ventana de tolerancia.</rules>
      <tables written="[maintenance_plans](BD/maintenance_plans.md)"/>
    </flow>

    <flow id="F3.6" name="Vencimiento de OT preventiva">
      <trigger>Evaluación (misma ejecución del motor F3.3).</trigger>
      <steps>
        <step>Condición: fecha programada + margen de gracia del plan &lt; hoy y la OT sigue en estado "Abierta".</step>
        <step>La OT NO cambia de estado (permanece "Abierta" — spec); se marca con indicador VISUAL de vencida en calendario y lista (mismo color/estilo en ambas).</step>
        <step>Evento 6 (T2): "Resumen diario acumulado de OTs preventivas VENCIDAS que siguen sin cerrarse" — UNA notificación con TODAS las vencidas de todos los planes (lista acumulada, no incremento) → notification_log.</step>
      </steps>
      <rules>El motor NO duplica OT mientras exista una abierta para ese activo+plan — una OT vencida "cubre" el ciclo hasta que se cierre o cancele.</rules>
      <tables read="[work_orders](BD/work_orders.md), [maintenance_plans](BD/maintenance_plans.md)" written="[notification_log](BD/notification_log.md), [notification_config](BD/notification_config.md) (evento 6)"/>
    </flow>

    <flow id="F3.7" name="Reprogramación (ocurrencia / plan completo)">
      <trigger>(a) Drag en calendario sobre OT generada (V3.1) — Mantenimiento. (b) V3.2 → "Reprogramar plan completo" (M3.2) — Mantenimiento.</trigger>
      <steps>
        <step>(a) Drag/fecha manual → UPDATE work_orders.scheduled_at de ESA OT → auditoría (Modificar: anterior → nuevo). La siguiente generación del plan no se ve afectada (next_due ya fue recalculado al generar).</step>
        <step>(b) M3.2 → nueva fecha base → UPDATE maintenance_plans.next_due_at → auditoría con snapshot. OTs ya generadas NO se modifican.</step>
        <step>Ambas acciones mueven proyecciones y eventos futuros del calendario; la margen de gracia se cuenta desde la NUEVA fecha (spec).</step>
      </steps>
      <rules>Proyecciones no se arrastran (solo OTs generadas). Solo Mantenimiento (no Admin — CRUD/reprogramar es Mantenimiento en T1). Registrado en audit_log (spec: "queda en el log").</rules>
      <tables written="[work_orders](BD/work_orders.md) | [maintenance_plans](BD/maintenance_plans.md), [audit_log](BD/audit_log.md)"/>
    </flow>

    <flow id="F3.8" name="Registro de contador de uso en la OT">
      <trigger>Técnico en la OT de un plan por uso (pestaña Ejecución/Estado de V2.3) ingresa el valor ACTUAL del contador del activo.</trigger>
      <steps>
        <step>Validación (M1 F1.9): valor &gt; 0 y no menor que el último registrado (rechaza con explicación).</step>
        <step>UPDATE assets.usage_counter → Evento 12 (M1: nuevo valor) → auditoría.</step>
        <step>Reevaluación INMEDIATA de planes por uso del activo (no espera pg_cron): si el contador alcanzó el umbral → F3.3 genera la siguiente OT.</step>
      </steps>
      <rules>Contador = manual (no hay telemetría, decisión de M1). Solo el técnico asignado o Mantenimiento puede registrarlo.</rules>
      <tables written="[assets](BD/assets.md), [audit_log](BD/audit_log.md)" cross="[maintenance_plans](BD/maintenance_plans.md)"/>
    </flow>

  </flows>

  <cross_module_flows>
    <cross from="M1 (Activos)">
      <item>Alta de activo en categoría con plan dinámico → entra al alcance del plan automáticamente en la siguiente ejecución del motor (F3.3); sin OT retroactiva.</item>
      <item>Cambio de categoría del activo (V1.2) → sale/entra de planes por categoría en la siguiente evaluación; planes por activo individual no se afectan.</item>
      <item>Baja lógica de activo con OT preventiva abierta → la OT continúa su ciclo; el plan deja de generar para ese activo.</item>
      <item>F1.9 (contador de uso) → base de F3.8; F1.11 (ficha de activo) → "Ver plan" desde M3.1.</item>
    </cross>
    <cross from="M2 (OTs)">
      <item>F2.10 (generación) es el INSERT que ejecuta F3.3; las OTs generadas entran a la misma bandeja V2.1 y al modal de cierre M2.1.</item>
      <item>F2.6 (cierre) → invoca F3.5 (recálculo) y valida F3.4 (checklist completo) cuando aplica.</item>
      <item>V2.1 embebido en V3.1 (pestaña Lista) — componente compartido.</item>
      <item>Asignación manual (F2.4) es el ÚNICO push relacionado con preventiva (F3.3 no asigna).</item>
    </cross>
    <cross from="M4 (Inventario)">
      <item>Repuestos probables: el checklist del plan puede sugerir repuestos vía item_asset_links (cross declarado en F2.9 de Módulo 2); la salida de almacén se registra en la OT en curso.</item>
      <item>Consumibles presuntos por ítem de checklist: checklist_item_items (M3.4/F3.4) — sugerencia no bloqueante con verificación de disponibilidad en el kardex; sin efecto sobre creación de PMs ni cierres.</item>
    </cross>
    <cross from="T1/T2/T3">
      <item>T1: permisos por rol aplicados en cada vista (decisions_taken + access_by_role).</item>
      <item>T2: eventos 2 y 6 (catálogo); configurables por Mantenimiento.</item>
      <item>T3: auditoría append-only de planes (Crear/Modificar/Inactivar), plantillas, reprogramaciones (F3.7), generaciones y marcas de checklist.</item>
    </cross>
  </cross_module_flows>

  <notifications>
    <event number="2" type="resumen diario" channel="push + email (resumen)">
      <trigger>Tras la ejecución diaria del motor F3.3.</trigger>
      <content>"Se generaron N OTs preventivas hoy" — AGRUPADAS POR PLAN
        (una entrada por plan con su lista de OTs), a Mantenimiento
        (asignador). Sin destinatarios técnicos (no hay asignación
        automática).</content>
      <dedup>Una ejecución diaria = un solo resumen (job_id por
        día).</dedup>
    </event>
    <event number="6" type="resumen diario acumulado" channel="push + email (resumen)">
      <trigger>Misma ejecución diaria (evaluación F3.6).</trigger>
      <content>"OTs preventivas vencidas sin cerrarse: N" — lista ACUMULADA
        de TODAS las vencidas (todos los planes), a Mantenimiento y
        Administrador. Acumulada = se reenvía la lista completa cada día
        mientras persistan vencidas.</content>
      <dedup>Una por día; se vacía al no haber vencidas.</dedup>
    </event>
    <not_triggered>
      <item>Generación de OT: sin push (sin asignación — decisión de sesión; el push llega con la asignación manual vía evento 1/5 del Módulo 2).</item>
      <item>Reprogramaciones (F3.7): sin push — quedan en audit_log.</item>
      <item>Ediciones de planes/plantillas: sin push.</item>
    </not_triggered>
  </notifications>

  <supabase_mapping>
    <engine>pg_cron (job diario, horario laboral hotel) para F3.3/F3.6;
      evaluación de contraseñas de uso por trigger/after-update en F3.8;
      RLS por rol en todas las tablas (patrón T1).</engine>
    <tables>
      <table file="maintenance_plans">Plan: frecuencia, intervalo,
        plantilla de checklist, prioridad default, anticipación, margen de
        gracia (OBLIGATORIO), estado, next_due_at, last_run_counter.
        Incluye plan_asset_links y plan_category_links (alcance =
        unión).</table>
      <table file="checklist_templates">Plantilla CRUD (nombre, categoría
        sugerida, estado) + checklist_items (posición, texto) +
        checklist_item_items (consumibles presuntos por ítem, no
        bloqueantes). Baja lógica (decisión de sesión).</table>
      <table file="wo_checklist_entries">Snapshot de ítems por OT
        generada (F3.3): checklist_item_id (vínculo de origen para
        consumibles), posición, texto inmutable, estado
        (pending/done/not_applicable), observación, marcado por/at.
        Índice (wo_id, posición). FK → work_orders.</table>
      <table file="work_orders" shared="true">Lectura/escritura:
        scheduled_at (F3.7a), plan_id, damage_report_id (M2), estado para
        vencidas.</table>
      <table file="assets" shared="true">usage_counter (F3.8 / M1
        F1.9); tiene_contador.</table>
      <table file="categories" shared="true">Árbol para vínculos por
        categoría (F3.2).</table>
      <table file="audit_log" shared="true">Crear/Modificar de planes y
        plantillas; reprogramaciones; marcas de checklist (si T3
        aplica).</table>
      <table file="notification_config">Eventos 2 y 6
        (habilitados/canales/umbral vencimiento).</table>
      <table file="notification_log">Envíos de los eventos 2 y 6
        (dedup por fecha+evento).</table>
    </tables>
    <rls_policy>Mantenimiento: CRUD completo sobre plans/templates/entries
      de OTs del equipo; Administrador/Calidad: SELECT en todo el módulo;
      Técnico: SELECT de plans + UPDATE de entries SOLO de sus OTs
      asignadas (helper is_assigned_wo, patrón M2) — sin acceso a
      calendario.</rls_policy>
  </supabase_mapping>

  <open_pending_items>
    <item>Semilla de plantillas de checklist de ejemplo (aire acondicionado,
      FCU, calderas…) — pendiente de contenido real del hotel.</item>
    <item>Horario exacto del pg_cron diario (operativa del hotel: ¿06:00?
      ¿22:00?) — confirmar con el usuario al implementar.</item>
    <item>Vista de "Historial de ejecuciones por plan" (ejecuciones
      pasadas por activo) — NO está en la spec; futuro.</item>
    <item>Métricas de cumplimiento preventivo — RESUELTAS en Módulo 7
      (dashboard): mtbf, pm_on_time_pct, overdue_pms —
      [07-reportes-kpis-flujos](07-reportes-kpis-flujos.md).</item>
    <item>Alcance de planes por UBICACIÓN — nuevo requerimiento del
      cliente: el plan de MP debe poder reunir activos por categoría Y por
      ubicación como criterios INDIVIDUALES (separados). Hoy el alcance es
      solo vínculos por categoría (dinámicos) y activos individuales
      (estáticos) — decisión "Alcance de un plan". Diseño pendiente: tercer
      tipo de vínculo plan_locations (ubicación + subárbol, dinámico como
      categoría), formulario V3.3 con criterios separados, y motor
      m3_wo_generate que evalúe la unión de los 3 tipos.</item>
  </open_pending_items>

</module>

```
