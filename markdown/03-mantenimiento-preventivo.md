# Módulo 3: Mantenimiento Preventivo

> **Entregables:** spec (abajo) · **Flujos/Interfaces:** [03-mantenimiento-preventivo-flujos.md](03-mantenimiento-preventivo-flujos.md)
> **Tablas BD:** [maintenance_plans](BD/maintenance_plans.md) (incluye plan_asset_links y plan_category_links) · [checklist_templates](BD/checklist_templates.md) (incluye checklist_items y checklist_item_items — consumibles presuntos) · [wo_checklist_entries](BD/wo_checklist_entries.md) — **compartidas:** [audit_log](BD/audit_log.md) · [notification_config](BD/notification_config.md) · [notification_log](BD/notification_log.md) — **referenciadas:** [work_orders](BD/work_orders.md) · [assets](BD/assets.md)

```xml
<module id="3" name="Mantenimiento Preventivo">
  <core_entity name="Plan de Mantenimiento">
    <description>
      Plantilla que define qué tarea se hace, con qué frecuencia, y a qué
      activo(s) o categoría de activos aplica. Genera automáticamente OTs tipo
      "Preventiva".
    </description>
    <fields>
      <field>nombre del plan</field>
      <field name="aplicacion">
        <options>
          <option value="activo_individual">Vinculación a un activo específico.
            Selección estática, fija a ese activo.</option>
          <option value="categoria">Vinculación a una CATEGORÍA completa de
            activo. La vinculación es DINÁMICA: si se agrega un nuevo activo a
            esa categoría en el futuro, el plan se aplica automáticamente a él
            sin configuración adicional.</option>
        </options>
        <ui_note>Al crear el plan, el formulario permite elegir por categoría
          (expande a todos los activos actuales y futuros de esa categoría) o
          individualmente (selección puntual de uno o varios activos
          específicos). Ambos métodos coexisten en el mismo formulario.</ui_note>
      </field>
      <field name="tipo_frecuencia">
        <options>
          <option value="tiempo">Por calendario (ej. cada 90 días). Requiere
            fecha de última ejecución + intervalo.</option>
          <option value="uso">Por contador de uso (ej. cada 250 horas de
            operación). Requiere registro de contador en el activo. El contador
            se actualiza MANUALMENTE por el técnico en cada OT (no hay
            integración con sistemas que lo reporten automáticamente).</option>
        </options>
      </field>
      <field>intervalo (numérico, según tipo de frecuencia)</field>
      <field name="checklist">Selección de una plantilla de checklist reutilizable
        (ver entidad abajo), o creación de una nueva desde cero si no aplica
        ninguna.</field>
      <field>técnico/rol sugerido (opcional, solo referencia — la asignación real
        siempre es manual)</field>
      <field>prioridad por defecto (Urgente/Normal/Baja, heredada al crear la OT,
        editable)</field>
      <field>anticipación de generación (ej. generar la OT 7 días antes del
        vencimiento)</field>
      <field name="margen_de_gracia">
        <rule>OBLIGATORIO al crear cada plan. Es INDIVIDUAL por plan (NO existe
          un valor global por defecto) — cada plan define su propio margen en
          días de tolerancia antes de considerarse visualmente vencido.</rule>
      </field>
      <field name="estado">Activo / Inactivo</field>
    </fields>
  </core_entity>

  <checklist_templates>
    <rule>Catálogo CRUD independiente y reutilizable ("plantillas de
      checklist"). <!-- BD: checklist_templates --></rule>
    <fields>
      <field>nombre de la plantilla (ej. "Checklist estándar HVAC trimestral")</field>
      <field>ítems del checklist (lista de pasos/tareas)</field>
      <field>categoría sugerida (opcional, para facilitar búsqueda)</field>
    </fields>
    <execution_note>Dentro de la OT preventiva generada, el técnico marca cada
      ítem del checklist como completado, con observación individual por ítem
      (no solo un comentario general de la OT). <!-- BD: wo_checklist_entries
      --></execution_note>
  </checklist_templates>

  <wo_generation>
    <trigger>Automática al cumplirse la condición (fecha o contador), según el
      plan.</trigger>
    <effect>Se genera una OT tipo "Preventiva", vinculada al activo, con el
      checklist del plan.</effect>
    <recalculation>Al cerrarse esa OT, el plan recalcula la PRÓXIMA fecha de
      ejecución tomando como base la FECHA PROGRAMADA del plan (no la fecha real
      de cierre), para mantener el ritmo original de la frecuencia.</recalculation>
    <notification>Evento "OT preventiva generada" → correo, modo RESUMEN DIARIO
      (un correo agrupado por plan con la lista de OTs generadas ese día, para
      evitar decenas de correos individuales cuando un plan por categoría genera
      muchas OTs a la vez). <!-- BD: notification_config, notification_log --></notification>
    <multiple_plans_per_asset>Un mismo activo puede tener varios planes
      simultáneos (ej. limpieza de filtro trimestral + revisión de gas
      refrigerante anual).</multiple_plans_per_asset>
  </wo_generation>

  <overdue_handling>
    <rule>Una OT preventiva vencida (superó fecha + margen de gracia) PERMANECE
      en estado "Abierta" — NO cambia de estado formalmente.</rule>
    <visual_indicator>Se marca con un color/indicador visual distintivo en las
      vistas de calendario y lista.</visual_indicator>
    <notification>Evento "OT preventiva vencida" → correo, modo RESUMEN DIARIO,
      con lista ACUMULADA de todas las OTs vencidas que sigan sin cerrarse (no
      solo las que vencieron ese día). <!-- BD: notification_config,
      notification_log --></notification>
  </overdue_handling>

  <rescheduling>
    <scope_1>Reprogramar UNA fecha puntual (arrastrar el evento en el
      calendario a otra fecha) — mueve solo esa ocurrencia.</scope_1>
    <scope_2>Reprogramar el PLAN COMPLETO hacia adelante — desplaza toda la
      secuencia futura de fechas. No afecta OTs ya generadas/cerradas, solo las
      próximas ocurrencias pendientes de generar.</scope_2>
    <permission>Exclusivo de Mantenimiento.</permission>
    <audit>Ambos tipos de reprogramación quedan en el log, con estado anterior y
      nuevo. <!-- BD: audit_log --></audit>
    <grace_period_note>Al reprogramar, el margen de gracia se cuenta desde la
      NUEVA fecha.</grace_period_note>
  </rescheduling>

  <views>
    <description>
      Pantalla con DOS PESTAÑAS separadas: Calendario y Lista.
    </description>
    <calendar_tab>
      <granularity>Mes, semana y día, navegable (anterior/siguiente/hoy).</granularity>
      <content>
        <item>OTs preventivas YA GENERADAS (color sólido, clicable, con
          indicador de vencida).</item>
        <item>PROYECCIONES de planes futuros aún sin generar OT — SOLO para
          planes de frecuencia POR TIEMPO (estilo visual tenue/diferenciado). Los
          planes por uso/contador NO se proyectan, solo aparecen cuando
          efectivamente se genera la OT.</item>
      </content>
      <event_label>Solo el título (ej. "OT-1842 · FCU-305 · Cambio de
        filtro").</event_label>
      <click_behavior>
        <on_generated_wo>Abre ventana MODAL con: número, activo, ubicación,
          plan, estado, prioridad, técnicos asignados, fecha programada, y
          botón "Abrir OT completa".</on_generated_wo>
        <on_projection>Abre modal con datos del plan, activo y fecha estimada,
          SIN botón de OT (aún no existe).</on_projection>
      </click_behavior>
      <drag_and_drop>Permitido, solo por Mantenimiento, mueve únicamente esa
        ocurrencia (no reprograma el plan completo). Las proyecciones no se
        pueden arrastrar.</drag_and_drop>
      <access>EXCLUSIVO de Mantenimiento y Administrador. El Técnico NO tiene
        acceso a la vista de calendario.</access>
      <technical_note>Implementable con librería de calendario tipo FullCalendar
        u equivalente que soporte eventos clicables y arrastre.</technical_note>
    </calendar_tab>
    <list_tab>
      <columns>número de OT, activo, ubicación, plan, fecha programada,
        técnicos, prioridad, estado</columns>
      <filters>categoría, activo, plan, técnico asignado, estado</filters>
      <color_coding>Mismo color para vencidas que en el calendario.</color_coding>
      <access>
        <technician>Solo sus propias OTs asignadas.</technician>
        <maintenance>Todas las OTs.</maintenance>
        <administrator>Todas las OTs (solo consulta).</administrator>
      </access>
      <scope_note>Esta pestaña Lista pertenece al módulo general de Órdenes de
        Trabajo (no solo preventivas) — muestra TODAS las OTs, no únicamente
        las generadas por planes.</scope_note>
    </list_tab>
  </views>

  <quality_role_oversight>
    El rol Calidad tiene acceso de SOLO CONSULTA a este módulo completo (planes,
    checklists ejecutados, calendario y lista de OTs preventivas), para auditar
    el cumplimiento de los preventivos. No puede crear ni modificar planes ni
    OTs.
  </quality_role_oversight>
</module>
```
