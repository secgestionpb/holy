# Prompt de Especificación — CMMS Hotelero

Prompt listo para usar en OpenCode. Contiene todas las decisiones de diseño acordadas, estructuradas en XML para que el agente las use como especificación de referencia durante el desarrollo.

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
  <!-- MÓDULO 1: GESTIÓN DE ACTIVOS                                         -->
  <!-- ==================================================================== -->
  <module id="1" name="Gestión de Activos">
    <model_decision>
      Cada equipo físico es una INSTANCIA INDIVIDUAL con ficha propia (no un
      "activo genérico" compartido). Ejemplo: el fan coil de la habitación 305 y
      el de la 512 son dos registros de activo distintos, cada uno con su propio
      historial, garantías y componentes.
    </model_decision>

    <hierarchy>
      Hotel → Torre/Edificio → Piso → Ubicación (Habitación / Área común / Área
      técnica) → Activo → Componente (opcional, anidado)
    </hierarchy>

    <categories>
      <rule>Catálogo CRUD de categorías de activo, totalmente administrable (crear,
        editar, desactivar). Semilla inicial sugerida:</rule>
      <seed_list>
        <item>Climatización (HVAC)</item>
        <item>Eléctrico</item>
        <item>Plomería / Fontanería</item>
        <item>Contra incendios</item>
        <item>Elevadores / Verticales</item>
        <item>Cocina</item>
        <item>Lavandería</item>
        <item>Piscina / Spa</item>
        <item>Seguridad y acceso</item>
        <item>Mobiliario técnico</item>
      </seed_list>
      <rule_cardinality>UNA sola categoría por activo (no múltiples categorías
        simultáneas). Si un activo tiene naturaleza mixta, se resuelve con el
        desglose de componentes, no con múltiples categorías en el padre.</rule_cardinality>
      <category_fields>nombre, descripción, código corto (usado como prefijo del
        código único del activo), estado activa/inactiva</category_fields>
    </categories>

    <criticality>
      <rule>Catálogo FIJO de 3 niveles, no editable: Alta / Media / Baja.</rule>
      <criteria>
        <alta>Afecta seguridad, cumplimiento legal, o deja habitaciones/áreas de
          venta fuera de servicio.</alta>
        <media>Afecta confort pero no impide la operación.</media>
        <baja>Impacto estético o de bajo impacto operativo.</baja>
      </criteria>
    </criticality>

    <components>
      <rule>TODOS los activos (no solo los de alto valor) pueden tener desglose de
        componentes anidados.</rule>
      <behavior>
        Cada componente hereda la ubicación del activo padre, pero tiene su propio
        historial de OTs, garantías y documentación — funciona como un "mini-activo"
        anidado. Una Orden de Trabajo puede apuntar a un activo o a un componente
        específico dentro de él.
      </behavior>
    </components>

    <status_fields>
      <field name="estado_operativo">
        <values>Operativo | Inactivo</values>
        <note>Campo independiente, cambia con frecuencia.</note>
      </field>
      <field name="etapa_de_vida">
        <values>Sin garantía → En garantía → Operativo → Por Reparar → Requiere
          reemplazo → Dado de baja</values>
        <note>Campo independiente, cambia pocas veces. No es estrictamente lineal:
          un activo puede pasar de "En garantía" a "Sin garantía" automáticamente
          cuando la tabla de garantías indica que ya no hay garantía vigente.</note>
        <rule_automatica>Si etapa_de_vida = "Dado de baja", el sistema fuerza
          automáticamente estado_operativo = "Inactivo".</rule_automatica>
      </field>
    </status_fields>

    <useful_life>
      <field name="fecha_puesta_en_operacion">Fecha en que el activo entró en
        funcionamiento (no necesariamente igual a la fecha de compra).</field>
      <field name="vida_util_esperada">Valor numérico + unidad (años, o
        horas/ciclos de uso si el activo tiene contador — ej. generadores,
        ascensores).</field>
      <field name="vida_util_consumida" calculated="true">Fecha actual − fecha de
        puesta en operación.</field>
      <field name="vida_util_restante" calculated="true">Vida útil esperada − vida
        útil consumida.</field>
      <report>Alimenta un reporte de "activos próximos a fin de vida útil" para
        presupuesto CAPEX.</report>
    </useful_life>

    <documentation>
      <rule>El activo y cada componente permiten subir múltiples archivos/imágenes
        (manual técnico, ficha, foto del equipo, factura de compra).</rule>
    </documentation>

    <warranties>
      <rule>Entidad en tabla SEPARADA (relación uno a muchos con el activo o
        componente), NO un simple campo de fecha en la ficha del activo.</rule>
      <rule_multiplicity>Un mismo activo puede tener múltiples garantías
        simultáneas o a lo largo del tiempo: garantía de COMPRA original y
        garantía(s) de REPARACIÓN posteriores.</rule_multiplicity>
      <fields>
        <field>activo/componente vinculado (FK)</field>
        <field>tipo de garantía: Compra | Reparación (catálogo simple, extensible)</field>
        <field>proveedor/fabricante/taller que otorga la garantía (puede vincularse
          automáticamente al contratista cuando la OT fue ejecutada por un externo)</field>
        <field>fecha de inicio</field>
        <field>fecha de vencimiento</field>
        <field>cobertura (piezas, mano de obra, ambas)</field>
        <field>observaciones (texto libre)</field>
        <field>documento adjunto</field>
        <field name="estado_calculado">Vigente / Vencida, calculado automáticamente
          según fecha actual vs. vencimiento</field>
      </fields>
      <critical_rule name="confirmacion_al_cerrar_ot">
        Al CERRAR cualquier OT (preventiva o correctiva), el sistema debe preguntar
        OBLIGATORIAMENTE si esa intervención genera o extiende una garantía. Si la
        respuesta es "Sí", se crea automáticamente un nuevo registro en la tabla de
        garantías, vinculado a esa OT como origen.
      </critical_rule>
    </warranties>

    <responsible_field>
      <rule>Campo "Responsable del activo", NO obligatorio, selección de
        usuario/técnico. No bloquea la creación del activo si se deja vacío.</rule>
    </responsible_field>

    <unique_code>
      <generation>Autogenerado al crear el activo, con lógica sugerida:
        [Prefijo categoría]-[Ubicación]-[Consecutivo]. Ejemplo: HVAC-305-001,
        ASC-CM-01.</generation>
      <editable>El campo es editable después de generado (para nomenclatura
        interna propia del equipo de mantenimiento).</editable>
      <validation>Debe validarse unicidad, incluso si se edita manualmente.</validation>
    </unique_code>

    <scope_rule>
      Solo entran al catálogo de activos los equipos con mantenimiento preventivo
      programado o valor de reemplazo relevante. Equipos de bajo costo sin PM (ej.
      secador de pelo) quedan fuera, gestionados como reposición simple.
    </scope_rule>
  </module>

  <!-- ==================================================================== -->
  <!-- MÓDULO 2: ÓRDENES DE TRABAJO                                         -->
  <!-- ==================================================================== -->
  <module id="2" name="Órdenes de Trabajo">
    <types>
      <type>Correctiva (reactiva) — originada por un Reporte de Daño convertido</type>
      <type>Preventiva — generada automáticamente por el motor de Planes de
        Mantenimiento (módulo 3)</type>
      <type>Inspección/mejora (opcional) — detectada durante una visita, sin ser
        falla aún</type>
    </types>

    <entry_sources>
      <source>Formulario interno "Reporte de Daño" dentro del CMMS (ver entidad
        abajo)</source>
      <source future="true">App externa de reportes (futuro, vía API aún no
        disponible). El CMMS debe dejar previsto un campo "origen del reporte" y
        "N° de referencia externo" para cuando se integre.</source>
    </entry_sources>

    <damage_report_entity name="Reporte de Daño">
      <description>
        Entidad previa e independiente de la OT formal. Cualquier Técnico,
        Mantenimiento o Calidad puede crearla; NO la crean Administrador ni
        ningún otro rol.
      </description>
      <fields>
        <field>activo/componente afectado</field>
        <field>descripción del daño</field>
        <field>reportado por (automático, usuario logueado)</field>
        <field>fecha/hora (automática)</field>
        <field>evidencia fotográfica (opcional)</field>
        <field name="estado">Pendiente de revisión | Convertido a OT | Descartado</field>
      </fields>
      <flow>
        Técnico/Calidad/Mantenimiento crea el reporte → Mantenimiento lo revisa →
        decide: convertir en OT (hereda activo y descripción; se agregan prioridad,
        asignación, etc.) o descartar (con motivo, queda como registro histórico).
      </flow>
      <notification>Evento "Reporte de daño nuevo" dispara correo inmediato (ver
        catálogo de notificaciones).</notification>
    </damage_report_entity>

    <lifecycle_states>
      Abierta → Asignada → En proceso → Pendiente de repuesto/aprobación →
      Completada → Cerrada
      (rama alterna: → Cancelada)
      (transición especial: Cerrada → En proceso, solo vía reapertura por
      Mantenimiento)
      <note>"Completada" = el técnico terminó el trabajo físico. "Cerrada" = un
        supervisor (Mantenimiento) valida y confirma, incluida la pregunta
        obligatoria de garantía.</note>
    </lifecycle_states>

    <fields>
      <field>número de OT (autogenerado, consecutivo)</field>
      <field>activo/componente afectado (hereda ubicación automáticamente del
        activo, ya que el activo es instancia individual)</field>
      <field>tipo de OT (Correctiva / Preventiva / Inspección)</field>
      <field name="prioridad">
        <catalog>Urgente | Normal | Baja</catalog>
        <rule>100% MANUAL. No se sugiere ni se calcula automáticamente según
          criticidad del activo. La determinan los usuarios que crean o modifican
          la OT.</rule>
      </field>
      <field>descripción del problema</field>
      <field>reportado por / origen del reporte</field>
      <field>fecha/hora de reporte (automática)</field>
      <field name="tecnico_asignado">
        <cardinality>Uno o VARIOS técnicos simultáneamente sobre la misma OT.</cardinality>
        <optionality>OPCIONAL — una OT puede quedar SIN asignar y ser gestionada
          directamente por Mantenimiento (caso típico: ejecución por contratista
          externo).</optionality>
      </field>
      <field>fecha/hora de asignación (automática)</field>
      <field>fecha/hora de inicio y fin de trabajo (registrada por el técnico)</field>
      <field>horas de mano de obra registradas POR TÉCNICO (no un total único),
        cuando hay varios técnicos asignados</field>
      <field>repuestos/insumos utilizados (vinculado al módulo de Inventario)</field>
      <field>costo total = mano de obra interna + repuestos consumidos + costo de
        servicio externo (contratista)</field>
      <field>evidencia (fotos antes/después)</field>
      <field>diagnóstico / solución aplicada (texto libre al cerrar)</field>
      <field name="afecta_disponibilidad_venta">
        <values>Sí / No</values>
        <note>Como NO hay integración con el PMS, este campo es puramente
          informativo: dispara una notificación por correo (evento 1 del
          catálogo), pero NO bloquea automáticamente la venta en el PMS. El
          bloqueo real es un proceso 100% manual fuera del CMMS.</note>
      </field>
      <field name="genera_o_extiende_garantia">
        <values>Sí / No</values>
        <obligatoriedad>Obligatorio al CERRAR la OT (ver regla crítica en módulo 1,
          warranties).</obligatoriedad>
      </field>
      <field name="ejecutada_por">
        <values>Personal interno | Contratista externo</values>
        <optional>true</optional>
        <conditional_field>Si = Externo, se habilita selección del catálogo de
          Proveedores/Contratistas (módulo 5) y el campo "costo del servicio
          externo" (monto único).</conditional_field>
      </field>
    </fields>

    <multiple_wo_per_asset>
      Se PERMITEN múltiples OT abiertas simultáneamente sobre el mismo activo, sin
      bloqueo ni advertencia. Las vistas de listado pueden mostrar un indicador
      visual (badge/contador) cuando un activo tiene más de una OT abierta.
    </multiple_wo_per_asset>

    <reassignment_rules>
      <by_maintenance>Mantenimiento puede asignar y reasignar cualquier OT, en
        cualquier momento, agregando o quitando técnicos libremente.</by_maintenance>
      <by_technician>
        <rule>Un Técnico puede REASIGNAR (reemplazar) una OT que tiene asignada a
          OTRO técnico. Es un REEMPLAZO, no una adición: el técnico se sustituye a
          sí mismo por otro.</rule>
        <restrictions>
          <item>Solo puede reasignar OTs que él mismo tiene asignadas (no OTs
            ajenas).</item>
          <item>Solo puede reasignar a OTROS TÉCNICOS (no a Mantenimiento ni a
            ningún otro rol).</item>
          <item>No puede reasignar a alguien que ya esté asignado a esa misma OT.</item>
          <item>La observación/justificación es OBLIGATORIA.</item>
          <item>No requiere aceptación del técnico receptor — es inmediata.</item>
          <item>Solo se permite en estados: Asignada, En proceso, Pendiente de
            repuesto/aprobación. NO se permite en Completada, Cerrada ni Cancelada.</item>
        </restrictions>
        <effects>
          <item>Push notification al técnico que entra, al técnico que sale, y a
            los demás técnicos que permanecen asignados a esa OT (si los hay).</item>
          <item>Queda registrada en el historial de la OT y en el log de auditoría
            general, con observación, técnico anterior y técnico nuevo.</item>
          <item>Mantenimiento ve un indicador/filtro de "OTs reasignadas por
            técnico" (sin notificación por correo para este caso específico).</item>
        </effects>
      </by_technician>
    </reassignment_rules>

    <multi_technician_wo_rules>
      <item>Todos los técnicos asignados a una OT pueden registrar consumos,
        devoluciones y comentarios en ella.</item>
      <item>Cualquiera de los técnicos asignados puede marcar la OT como
        "Completada"; solo Mantenimiento la cierra formalmente.</item>
      <item>Las horas de mano de obra se registran por técnico individualmente.</item>
    </multi_technician_wo_rules>

    <reopening>
      <rule>Solo el rol MANTENIMIENTO puede reabrir una OT CERRADA.</rule>
      <obligatory_fields>Motivo obligatorio.</obligatory_fields>
      <audit>Queda registrada en el log de auditoría (usuario, fecha, motivo,
        estado anterior y nuevo).</audit>
      <resulting_state>Al reabrir, la OT vuelve al estado "En proceso".</resulting_state>
      <no_notification>La reapertura de OT NO genera notificación por correo (solo
        Mantenimiento puede reabrir, ya tiene visibilidad directa).</no_notification>
      <no_push_to_technician>No genera push al técnico (queda a discreción de
        Mantenimiento avisarle por fuera del sistema).</no_push_to_technician>
      <consequences>
        <item>Garantía: si la OT ya generó un registro de garantía, al reabrir NO
          se elimina; queda marcado "OT origen reabierta". Al volver a cerrar se
          pide confirmar de nuevo, editando el registro existente (no se duplica).</item>
        <item>Costos: mientras está reabierta, el costo del activo se recalcula
          con los cambios; al cerrar de nuevo, se consolida.</item>
        <item>Planes preventivos: si la OT era preventiva, la reapertura NO
          revierte el cálculo de la siguiente fecha del plan (que ya se calculó al
          cerrar la primera vez).</item>
        <item>La OT conserva historial de cada cierre y reapertura (fechas,
          motivos) en su pestaña de Historial.</item>
      </consequences>
    </reopening>

    <returns_from_wo>
      <entry_point>La devolución SOLO existe dentro de una OT (no hay pantalla
        independiente de devoluciones). Flujo: abrir la OT → pestaña "Repuestos
        consumidos" → botón "Devolver" en la línea del repuesto → cantidad +
        bodega de destino + motivo → confirmar.</entry_point>
      <max_quantity>consumido − ya devuelto</max_quantity>
      <permissions>
        <technician>Solo desde las OT que tiene asignadas.</technician>
        <maintenance>Desde cualquier OT.</maintenance>
        <administrator>No puede hacer devoluciones (solo consulta).</administrator>
      </permissions>
      <allowed_states>En proceso, Pendiente de repuesto/aprobación, Completada.
        En Cancelada, solo Mantenimiento. En Cerrada: NO SE PERMITE (Opción 1) —
        si se requiere, Mantenimiento debe reabrir la OT primero.</allowed_states>
      <effects>
        <item>Suma stock en la bodega de destino elegida (no necesariamente la de
          origen).</item>
        <item>Genera movimiento tipo "Devolución" en el kardex, referenciando la
          OT.</item>
        <item>Reduce el costo de la OT usando el COSTO CONGELADO del movimiento de
          salida original (no el costo actual del ítem).</item>
        <item>Se registra en el log de auditoría.</item>
        <item>Si el stock del ítem estaba en negativo, la devolución lo corrige
          parcial o totalmente.</item>
      </effects>
    </returns_from_wo>

    <history_tab>
      <description>
        Cada OT tiene una pestaña "Historial y comentarios" con línea de tiempo
        cronológica que mezcla:
      </description>
      <entry_types>
        <automatic>Cambios de estado, reasignaciones (con observación),
          modificaciones de campos (valor anterior → nuevo), consumos,
          devoluciones, cierres y reaperturas, reprogramaciones. Estas entradas
          provienen del mismo log de auditoría general, filtrado por esa OT (no
          hay una segunda fuente de verdad).</automatic>
        <manual_comments>Autor, fecha, texto, adjuntos opcionales. Los técnicos
          asignados y Mantenimiento pueden comentar; Administrador solo lee. Los
          comentarios NO se editan ni se borran una vez publicados. Un comentario
          nuevo NO genera notificación push.</manual_comments>
      </entry_types>
    </history_tab>
  </module>

  <!-- ==================================================================== -->
  <!-- MÓDULO 3: MANTENIMIENTO PREVENTIVO (PM)                              -->
  <!-- ==================================================================== -->
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
        checklist").</rule>
      <fields>
        <field>nombre de la plantilla (ej. "Checklist estándar HVAC trimestral")</field>
        <field>ítems del checklist (lista de pasos/tareas)</field>
        <field>categoría sugerida (opcional, para facilitar búsqueda)</field>
      </fields>
      <execution_note>Dentro de la OT preventiva generada, el técnico marca cada
        ítem del checklist como completado, con observación individual por ítem
        (no solo un comentario general de la OT).</execution_note>
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
        muchas OTs a la vez).</notification>
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
        solo las que vencieron ese día).</notification>
    </overdue_handling>

    <rescheduling>
      <scope_1>Reprogramar UNA fecha puntual (arrastrar el evento en el
        calendario a otra fecha) — mueve solo esa ocurrencia.</scope_1>
      <scope_2>Reprogramar el PLAN COMPLETO hacia adelante — desplaza toda la
        secuencia futura de fechas. No afecta OTs ya generadas/cerradas, solo las
        próximas ocurrencias pendientes de generar.</scope_2>
      <permission>Exclusivo de Mantenimiento.</permission>
      <audit>Ambos tipos de reprogramación quedan en el log, con estado anterior y
        nuevo.</audit>
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

  <!-- ==================================================================== -->
  <!-- MÓDULO 4: INVENTARIO DE REPUESTOS Y SUMINISTROS TÉCNICOS             -->
  <!-- ==================================================================== -->
  <module id="4" name="Inventario de Repuestos y Suministros Técnicos">
    <scope>
      Gestiona SOLO materiales de mantenimiento (repuestos, insumos, químicos
      técnicos). Quedan fuera amenities, lencería e inventario de F&amp;B.
    </scope>

    <item_catalog>
      <fields>
        <field>código de ítem (autogenerado, editable, mismo patrón que activos)</field>
        <field>nombre y descripción</field>
        <field>categoría de ítem (catálogo CRUD propio: repuestos HVAC, eléctricos,
          químicos de piscina, lubricantes, ferretería, etc.)</field>
        <field>unidad de medida</field>
        <field>stock mínimo — definido POR ÍTEM Y POR BODEGA (no un valor único
          global)</field>
        <field name="costo_unitario">Ver regla de valoración abajo.</field>
        <field>ubicación en bodega (estante/zona, opcional)</field>
        <field>proveedor preferido (vinculado al módulo 5)</field>
        <field>estado (Activo/Inactivo)</field>
        <field>imagen/ficha técnica adjunta</field>
      </fields>
    </item_catalog>

    <warehouses>
      <rule>MÚLTIPLES bodegas (no una sola). Catálogo CRUD de bodegas: nombre,
        descripción, responsable opcional, estado.</rule>
      <stock_model>El stock se maneja POR ÍTEM Y POR BODEGA, no como total
        único.</stock_model>
    </warehouses>

    <valuation>
      <method>ÚLTIMO COSTO DE COMPRA. El costo unitario del ítem se actualiza con
        cada entrada por compra, tomando el costo de esa última entrada.</method>
      <freezing_rule>Las SALIDAS por OT usan el costo vigente al momento del
        consumo y lo guardan CONGELADO en el movimiento (el costo histórico de una
        OT no cambia si el precio del ítem se actualiza después).</freezing_rule>
      <transfer_rule>Las transferencias entre bodegas no modifican el costo.</transfer_rule>
      <scope>El costo es único por ítem (no varía por bodega).</scope>
    </valuation>

    <movements>
      <movement_type name="Entrada">+ stock. Registro manual de recepción (fecha,
        proveedor, cantidad, costo unitario, nº de factura/documento de
        referencia). Actualiza el costo del ítem (último costo de compra).</movement_type>
      <movement_type name="Salida por OT">− stock. Automática al registrar
        repuestos consumidos en una OT. Usa costo congelado.</movement_type>
      <movement_type name="Ajuste">± stock. Manual, con motivo OBLIGATORIO. Solo
        ejecutable por rol Mantenimiento.</movement_type>
      <movement_type name="Devolución a bodega">+ stock. Ver reglas detalladas en
        módulo 2 (returns_from_wo) — solo accesible desde dentro de una OT.</movement_type>
      <movement_type name="Transferencia entre bodegas">Genera salida en bodega
        origen + entrada en bodega destino, registrada en el kardex. Solo
        ejecutable por Mantenimiento.</movement_type>
      <audit>Cada movimiento guarda fecha, usuario, cantidad, costo, y referencia
        (nº de OT o documento de compra).</audit>
    </movements>

    <purchase_orders>
      <decision>NO se gestionan órdenes de compra dentro del CMMS. Solo se
        registra la ENTRADA cuando el material ya llegó físicamente.</decision>
    </purchase_orders>

    <negative_stock>
      <decision>SE PERMITE registrar consumos que superen el stock disponible
        (el stock queda en negativo).</decision>
      <notification>Evento "Stock negativo" → correo INMEDIATO con ítem, bodega,
        OT que originó el consumo y stock resultante, instrucción de realizar
        ajuste.</notification>
      <visual>Ítems con stock negativo se marcan visualmente en los listados.</visual>
      <wo_impact>El consumo se permite sin bloquear la OT; el estado "Pendiente de
        repuesto/aprobación" queda disponible para uso manual de Mantenimiento
        (ej. esperando compra), no se activa automáticamente por falta de stock
        en sistema.</wo_impact>
    </negative_stock>

    <minimum_stock_alert>
      <notification>Evento "Stock bajo mínimo" → correo, modo RESUMEN DIARIO,
        evaluado POR BODEGA.</notification>
    </minimum_stock_alert>

    <physical_counts>
      <feature_name>Función de Conteo Físico (toma de inventario)</feature_name>
      <permission>Exclusivo de Mantenimiento.</permission>
      <flow>
        1. Mantenimiento crea un Conteo (bodega, fecha, alcance: bodega completa o
        categoría de ítems) → 2. El sistema genera la lista de ítems con su stock
        TEÓRICO CONGELADO al iniciar el conteo → 3. Se ingresa la cantidad
        contada de cada ítem → 4. El sistema calcula la diferencia (contado −
        teórico) → 5. Mantenimiento revisa y confirma → 6. Al confirmar, se
        generan automáticamente los movimientos de ajuste con motivo "Conteo
        físico" y referencia al conteo.
      </flow>
      <fields>bodega, alcance, estado (En proceso/Confirmado/Cancelado), detalle
        por ítem (teórico, contado, diferencia, observación), responsable</fields>
      <immutability>Un conteo confirmado no se edita; corrección vía nuevo conteo
        o ajuste manual, con registro en el log.</immutability>
      <no_notification>Un conteo con diferencias NO genera notificación por
        correo (Mantenimiento ya lo revisa directamente en el flujo de
        confirmación).</no_notification>
    </physical_counts>

    <returns>
      <ver>Ver reglas completas en módulo 2 → returns_from_wo. Las devoluciones
        SOLO se originan desde dentro de una OT, nunca desde una pantalla
        independiente de inventario.</ver>
    </returns>

    <asset_item_linking>
      <rule>Un repuesto puede vincularse a CATEGORÍAS de activo y a ACTIVOS
        individuales (relación muchos a muchos). Un mismo repuesto puede servir a
        varias categorías/activos.</rule>
      <uses>
        <use>Sugerir repuestos compatibles al llenar una OT.</use>
        <use>Asociar repuestos a los ítems de un checklist de plan preventivo, de
          modo que la OT preventiva pueda mostrar repuestos probables y verificar
          disponibilidad antes de ejecutar.</use>
      </uses>
    </asset_item_linking>

    <permissions_matrix>
      <role name="Mantenimiento">CRUD de ítems y bodegas; registra entradas,
        transferencias, ajustes y conteos; consume en cualquier OT; devoluciones
        desde cualquier OT; consulta stock y kardex completo.</role>
      <role name="Técnico">Consulta stock (solo lectura); consume solo dentro de
        sus OT asignadas; devoluciones solo desde sus OT asignadas.</role>
      <role name="Administrador">Solo consulta y reportes (sin devoluciones, sin
        ajustes, sin movimientos).</role>
    </permissions_matrix>
  </module>

  <!-- ==================================================================== -->
  <!-- MÓDULO 5: PROVEEDORES Y CONTRATISTAS EXTERNOS                        -->
  <!-- ==================================================================== -->
  <module id="5" name="Proveedores y Contratistas Externos">
    <depth_level>NIVEL 3 (catálogo + historial de intervención + contratos con
      vigencia) — nivel más completo de los tres evaluados.</depth_level>

    <catalog>
      <single_table>Un solo catálogo para ambos tipos (proveedor de materiales y
        contratista de servicio), diferenciados por campo "tipo", ya que un mismo
        tercero puede ser ambos.</single_table>
      <fields>
        <field>código (autogenerado, editable)</field>
        <field>nombre/razón social</field>
        <field name="tipo">Proveedor de materiales | Contratista de servicio |
          Ambos</field>
        <field>categoría de servicio (vinculada al catálogo de categorías de
          activo del módulo 1, ej. contratista de "Elevadores/Verticales")</field>
        <field>contacto principal (nombre, teléfono, correo)</field>
        <field>dirección</field>
        <field>documentos (contrato marco, certificaciones de la empresa,
          pólizas)</field>
        <field>estado (Activo/Inactivo)</field>
        <field>observaciones</field>
      </fields>
    </catalog>

    <contracts>
      <entity_name>Contratos (tabla propia)</entity_name>
      <fields>
        <field>proveedor/contratista vinculado (FK)</field>
        <field>nombre/descripción del contrato</field>
        <field>alcance del servicio</field>
        <field>fecha de inicio</field>
        <field>fecha de vencimiento</field>
        <field>frecuencia de visitas pactadas (opcional)</field>
        <field>costo del contrato (monto y periodicidad)</field>
        <field>documento adjunto</field>
        <field name="estado_calculado">Vigente / Por vencer / Vencido</field>
        <field>observaciones</field>
      </fields>
      <notification>Nuevo evento "Contrato por vencer" en la tabla de
        configuración, con días de anticipación editable (mismo patrón que
        garantías).</notification>
    </contracts>

    <intervention_history>
      Vista dentro de la ficha del proveedor/contratista que lista todas las OTs
      donde participó (fecha, activo, costo del servicio, estado), para evaluar
      desempeño sin reporte aparte.
    </intervention_history>

    <wo_integration>
      <field>Campo "Ejecutada por" en la OT: Personal interno | Contratista
        externo (opcional).</field>
      <field>Campo "Costo del servicio externo": MONTO ÚNICO (no desglosado en
        mano de obra + materiales).</field>
      <cost_formula>Costo total de la OT = Mano de obra interna + Repuestos
        consumidos + Costo del servicio externo.</cost_formula>
      <unassigned_technician>Una OT ejecutada por contratista externo PUEDE
        quedar SIN técnico interno asignado; la gestiona directamente
        Mantenimiento.</unassigned_technician>
      <warranty_link>Al confirmar garantía al cierre de una OT con contratista
        externo, el registro de garantía puede tomar automáticamente ese
        contratista como "proveedor que otorga la garantía".</warranty_link>
    </wo_integration>

    <permissions>
      <role name="Mantenimiento">CRUD completo de proveedores, contratistas y
        contratos.</role>
      <role name="Administrador">Solo consulta.</role>
      <role name="Técnico">Sin acceso al catálogo (puede ver el dato "ejecutado
        por" dentro de una OT si aplica).</role>
      <role name="Calidad">Solo consulta.</role>
    </permissions>
  </module>

  <!-- ==================================================================== -->
  <!-- MÓDULO 6: CUMPLIMIENTO NORMATIVO Y MEDICIONES                        -->
  <!-- ==================================================================== -->
  <module id="6" name="Cumplimiento Normativo y Mediciones">

    <compliance_certifications>
      <description>
        Gestiona certificaciones y obligaciones legales ante autoridades —
        distinto de garantías (comerciales) y contratos (de servicio). Opción A:
        módulo/catálogo INDEPENDIENTE del motor de Plan de Mantenimiento. NO
        genera OT automáticamente; solo alerta, y la coordinación de renovación
        (agendar contratista, crear OT si aplica) es manual.
      </description>
      <fields>
        <field>nombre de la certificación/obligación</field>
        <field>activo o instalación vinculado (FK a activo, o general si aplica a
          todo el hotel, ej. permiso de bomberos)</field>
        <field>categoría normativa (catálogo: Seguridad estructural, Contra
          incendios, Sanitaria/agua, Ambiental, Eléctrica, Elevadores, etc.)</field>
        <field>entidad emisora</field>
        <field>número de certificado/permiso</field>
        <field>fecha de emisión</field>
        <field>fecha de vencimiento</field>
        <field>periodicidad de renovación</field>
        <field>contratista/entidad responsable de renovarlo (vinculado al módulo
          5)</field>
        <field>documento adjunto</field>
        <field name="estado_calculado">Vigente / Por vencer / Vencido</field>
        <field>observaciones</field>
      </fields>
      <history>
        <rule>Se CONSERVA un registro histórico de cada renovación (vigencias
          anteriores, fechas de vencimiento y renovación) — NO se sobrescribe el
          registro. Tabla relacionada "Historial de vigencias", ligada a la
          certificación padre, para poder auditar si hubo períodos sin
          certificado vigente.</rule>
      </history>
      <notification>
        Evento "Certificación/permiso por vencer" → correo, AVISO ÚNICO (no
        escalonado) con días de anticipación CONFIGURABLE por certificación/global.
      </notification>
      <permissions>
        <role name="Calidad">CRUD completo del catálogo de certificaciones.</role>
        <role name="Mantenimiento">Gestiona la renovación operativa (coordina
          contratista, crea la OT si aplica) — no es dueño del catálogo.</role>
        <role name="Administrador">Solo consulta.</role>
        <role name="Técnico">Sin acceso.</role>
      </permissions>
    </compliance_certifications>

    <measurements>
      <description>
        Módulo propio para registro de mediciones periódicas de control de
        calidad. Caso inicial: pH de piscinas. Diseñado extensible a otros
        parámetros (cloro, temperatura, etc.).
      </description>
      <design_decision>
        Los "puntos de medición" NO son un concepto nuevo — se REUTILIZA el
        catálogo de ACTIVOS del módulo 1. Ejemplo: la piscina misma es un activo
        (ej. PISC-01 — Piscina Principal) dentro de la categoría "Piscina/Spa",
        funcionando como contenedor lógico de sus componentes (bomba, filtro) y
        ahora también como punto de medición. Si hay una segunda piscina, es
        simplemente otro activo más de esa categoría.
      </design_decision>
      <measurement_type_catalog>
        <fields>
          <field>nombre del tipo de medición (ej. "pH piscina")</field>
          <field>categoría de activo aplicable (ej. Piscina/Spa — filtra qué
            activos se pueden seleccionar al registrar)</field>
          <field>unidad de medida</field>
          <field>valor mínimo aceptable</field>
          <field>valor máximo aceptable</field>
          <field>frecuencia esperada (informativo, para detectar mediciones
            faltantes)</field>
          <field>estado (Activo/Inactivo)</field>
        </fields>
      </measurement_type_catalog>
      <measurement_record>
        <fields>
          <field>tipo de medición (del catálogo)</field>
          <field>activo (seleccionado del catálogo general de activos, filtrado
            por la categoría aplicable al tipo de medición)</field>
          <field>fecha y hora</field>
          <field>valor medido (numérico)</field>
          <field name="resultado_calculado">Dentro de rango / Fuera de rango
            (automático, comparando contra min/max del catálogo)</field>
          <field>registrado por (automático)</field>
          <field>observaciones</field>
          <field>evidencia fotográfica (opcional)</field>
        </fields>
      </measurement_record>
      <wo_link>NINGUNO — el registro de medición NO se vincula a ninguna OT,
        queda como dato histórico y de control independiente. Si Calidad lo
        considera necesario, crea un Reporte de Daño por separado (no hay
        automatismo ni referencia cruzada).</wo_link>
      <out_of_range_notification>
        Evento "Medición fuera de rango" → correo INMEDIATO a Mantenimiento (para
        intervenir) y Calidad (para seguimiento).
      </out_of_range_notification>
      <trend_view>
        Gráfico de línea temporal por tipo de medición y activo: eje X = fecha,
        eje Y = valor medido, con banda/líneas horizontales marcando el rango
        aceptable (min/max). Filtros por rango de fechas y por activo.
      </trend_view>
      <permissions>
        <role name="Calidad">CRUD completo (catálogo de tipos + registro de
          mediciones).</role>
        <role name="Mantenimiento">Recibe alertas, sin gestión del catálogo.</role>
        <role name="Administrador">Solo consulta.</role>
        <role name="Técnico">Sin acceso.</role>
      </permissions>
    </measurements>
  </module>

  <!-- ==================================================================== -->
  <!-- MÓDULO 7: REPORTES Y KPIs                                            -->
  <!-- ==================================================================== -->
  <module id="7" name="Reportes y KPIs">
    <kpi_catalog>
      <group name="Operativos de mantenimiento">
        <kpi name="MTTR">Promedio de (fecha cierre − fecha apertura) de OTs
          correctivas.</kpi>
        <kpi name="MTBF">Promedio de tiempo entre OTs correctivas consecutivas de
          un mismo activo.</kpi>
        <kpi name="% cumplimiento de PM">OTs preventivas cerradas a tiempo / total
          de preventivas generadas.</kpi>
        <kpi name="OTs vencidas actuales">Preventivas que superaron margen de
          gracia y siguen abiertas.</kpi>
        <kpi name="Tiempo promedio de respuesta">Fecha de asignación − fecha de
          creación de la OT.</kpi>
        <kpi name="Costo de mantenimiento por activo">Mano de obra + repuestos +
          servicio externo, acumulado.</kpi>
        <kpi name="Costo de mantenimiento por categoría">Igual, agregado por
          categoría de activo.</kpi>
        <kpi name="Costo de mantenimiento por ubicación">Igual, agregado por
          ubicación/habitación.</kpi>
        <kpi name="Ranking de activos con más fallas">Conteo de OTs correctivas
          por activo, orden descendente.</kpi>
        <kpi name="OTs por origen">Reporte de daño / app externa (futuro) /
          inspección.</kpi>
        <kpi name="OTs reasignadas por técnicos">Conteo y detalle.</kpi>
        <kpi name="Desempeño por técnico">OTs cerradas, tiempo promedio, horas
          registradas.</kpi>
      </group>
      <group name="Inventario">
        <kpi name="Valor total de inventario">Suma de stock × último costo, por
          bodega.</kpi>
        <kpi name="Ítems bajo stock mínimo">Listado actual.</kpi>
        <kpi name="Ítems con stock negativo">Listado actual, pendientes de
          ajuste.</kpi>
        <kpi name="Consumo de repuestos por activo/categoría">Identifica qué
          equipos consumen más materiales.</kpi>
        <kpi name="Historial de conteos y diferencias">Ajustes generados por
          conteos físicos.</kpi>
      </group>
      <group name="Proveedores y contratistas">
        <kpi name="Costo total por proveedor/contratista">Suma de servicios
          externos en OTs.</kpi>
        <kpi name="Contratos por vencer">Listado con días restantes.</kpi>
        <kpi name="Historial de intervención por contratista">Ver módulo 5.</kpi>
      </group>
      <group name="Cumplimiento normativo y calidad">
        <kpi name="Certificaciones vigentes/por vencer/vencidas">Estado actual de
          cada una.</kpi>
        <kpi name="Historial de vigencias por certificación">Auditoría de
          períodos sin cobertura.</kpi>
        <kpi name="Mediciones fuera de rango">Conteo y frecuencia por punto de
          medición.</kpi>
        <kpi name="Tendencia de mediciones">Consolidado por rango de fechas
          amplio.</kpi>
      </group>
      <group name="Activos">
        <kpi name="Activos por etapa de vida">Conteo por estado.</kpi>
        <kpi name="Vida útil consumida/restante">Listado de activos próximos a fin
          de vida útil, para presupuesto.</kpi>
        <kpi name="Garantías vigentes/por vencer">Estado actual.</kpi>
      </group>
    </kpi_catalog>

    <dashboard>
      <per_role_set>
        Cada rol tiene un SET PREDEFINIDO de KPIs disponibles (no todos ven todos
        los indicadores del sistema). Dentro de ese set, el usuario decide cuáles
        mostrar.
      </per_role_set>
      <configurability>
        <mechanism>Checkboxes DENTRO del propio dashboard (botón/ícono
          "Personalizar" que despliega la lista de KPIs disponibles para su rol).
          Al marcar/desmarcar, el widget aparece o desaparece inmediatamente, sin
          navegar a otra pantalla.</mechanism>
        <persistence>La selección se guarda POR USUARIO individual (no por rol
          general) — dos técnicos pueden personalizar su dashboard de forma
          distinta dentro de lo permitido para su rol.</persistence>
      </configurability>
      <widget_order>
        <rule>El orden de los KPIs es FIJO, agrupado por categoría (ej. todos los
          de costos juntos, todos los de PM juntos, todos los de inventario
          juntos). El usuario SOLO controla visibilidad (mostrar/ocultar), NO
          reordena ni reagrupa.</rule>
      </widget_order>
      <multi_role_users>
        Si un usuario tiene varios roles asignados, el dashboard COMBINA en un
        solo set de checkboxes los KPIs disponibles de TODOS sus roles (unión).
      </multi_role_users>
    </dashboard>

    <export>
      <formats>PDF y Excel</formats>
      <scope>Todos los reportes (dashboard y listados), respetando los filtros
        aplicados al momento de exportar.</scope>
    </export>

    <scheduled_monthly_reports>
      <config_table>
        <field>reporte (selección del catálogo)</field>
        <field>frecuencia (Mensual, fijo por ahora)</field>
        <field>día de envío</field>
        <field>formato adjunto (PDF/Excel)</field>
        <field>correos destinatarios (editable, texto libre)</field>
        <field>activo/inactivo</field>
      </config_table>
      <active_reports>
        <report id="1" name="Resumen de costos de mantenimiento">Por categoría de
          activo y por ubicación.</report>
        <report id="2" name="Cumplimiento de PM del mes">% ejecutado a tiempo vs.
          vencido.</report>
        <report id="3" name="Estado de certificaciones normativas">Vigentes / por
          vencer / vencidas.</report>
        <report id="4" name="Consumo e inventario">Ítems bajo mínimo, valor total
          de inventario.</report>
        <report id="5" name="Ranking de activos con más fallas del mes">Top N por
          conteo de OTs correctivas.</report>
        <report id="6" name="Costos por proveedor/contratista del mes">Servicios
          externos consumidos.</report>
      </active_reports>
      <note>Los 6 quedan ACTIVOS POR DEFECTO, cada uno con destinatarios de correo
        configurables independientemente (ej. el reporte de certificaciones podría
        ir también a Calidad, mientras costos van a gerencia general).</note>
    </scheduled_monthly_reports>
  </module>

  <!-- ==================================================================== -->
  <!-- MÓDULOS TRANSVERSALES                                                -->
  <!-- ==================================================================== -->

  <module id="T1" name="Usuarios y Roles" type="transversal">
    <roles_catalog fixed="true">
      <role name="Mantenimiento">
        <description>Jefes de mantenimiento. Rol operativo de mayor alcance.</description>
        <permissions>
          CRUD de activos, CRUD/ejecuta/cierra/modifica OTs de cualquier técnico,
          reporta daños, CRUD de inventario (ítems, bodegas, entradas,
          transferencias, ajustes, conteos), consume/devuelve en cualquier OT,
          CRUD de proveedores/contratistas/contratos, CRUD de planes de PM y
          checklists, gestiona renovación operativa de certificaciones (consulta
          el catálogo, coordina contratista), sin acceso a Configuración ni a
          Usuarios.
        </permissions>
      </role>
      <role name="Técnico">
        <description>Ejecuta trabajo de campo.</description>
        <permissions>
          Consulta activos, ejecuta/cierra/modifica solo sus OTs asignadas,
          reasigna (reemplaza) sus propias OTs a otro técnico con observación
          obligatoria, reporta daños, consume/devuelve repuestos solo en sus OTs,
          consulta planes de PM (sin editar), sin acceso a proveedores,
          certificaciones, mediciones, usuarios ni configuración. Sin acceso a la
          vista de calendario de PM (sí a la vista de lista, limitada a sus OTs).
        </permissions>
      </role>
      <role name="Administrador">
        <description>Supervisión y gestión de usuarios.</description>
        <permissions>
          Solo CONSULTA en todos los módulos operativos (activos, OTs, inventario,
          proveedores, PM, cumplimiento, mediciones), dashboard completo
          consolidado de todos los KPIs, CRUD completo de Usuarios y Roles, CRUD
          completo de Configuración/Opciones, acceso exclusivo al Log de
          Auditoría. Sin capacidad de crear/modificar OTs, sin devoluciones, sin
          reportar daños.
        </permissions>
      </role>
      <role name="Calidad">
        <description>
          Asociado a Mantenimiento, pero enfocado exclusivamente en evaluar
          cumplimiento de obligaciones legales y estándares de calidad.
        </description>
        <permissions>
          CRUD completo de Cumplimiento Normativo (certificaciones) y de
          Mediciones (tipos y registros), consulta de Activos/OTs/Proveedores/PM,
          puede reportar daños pero NO puede crear OTs, sin acceso a Inventario,
          Usuarios ni Configuración.
        </permissions>
      </role>
      <no_crud>El catálogo de roles es FIJO — no existe CRUD para crear roles
        nuevos.</no_crud>
    </roles_catalog>

    <multi_role_support>
      <cardinality>Un usuario puede tener MÚLTIPLES roles simultáneamente
        (relación muchos a muchos Usuario↔Rol).</cardinality>
      <permission_combination>UNIÓN — el usuario accede a todo lo permitido por
        CUALQUIERA de sus roles asignados, sin necesidad de "cambiar de modo" en
        la interfaz.</permission_combination>
      <dashboard_combination>El dashboard combina en un solo set de checkboxes
        todos los KPIs disponibles de todos sus roles.</dashboard_combination>
      <audit_logging>El log de auditoría registra solo el USUARIO que ejecuta la
        acción, SIN distinguir bajo qué rol específico actuó.</audit_logging>
    </multi_role_support>

    <user_entity>
      <fields>
        <field>nombre completo</field>
        <field>correo electrónico (único, usado como identificador de login)</field>
        <field>teléfono (opcional, para futura integración WhatsApp)</field>
        <field>rol(es) asignado(s) — selección múltiple</field>
        <field>categorías asignadas (opcional, solo aplicable a Técnico, para
          filtrar especialidad)</field>
        <field>estado (Activo/Inactivo — nunca se elimina un usuario con
          historial, solo se desactiva)</field>
        <field>fecha de creación / último acceso</field>
        <field>foto de perfil (opcional)</field>
      </fields>
      <management>CRUD exclusivo de Administrador. Toda acción queda en el log de
        auditoría. Desactivar un usuario preserva su historial completo (OTs,
        mediciones, movimientos, etc.).</management>
    </user_entity>

    <authentication>
      <method>Correo + contraseña</method>
      <password_hashing>bcrypt o argon2 (nunca texto plano)</password_hashing>
      <session_management>
        <token_type>JWT</token_type>
        <access_token_duration>Corta duración (ej. 15-30 min)</access_token_duration>
        <refresh_token_duration>Mayor duración (ej. 7 días)</refresh_token_duration>
        <refresh_token_storage>Cookie httpOnly + secure</refresh_token_storage>
        <access_token_storage>En memoria del front, NO en localStorage</access_token_storage>
      </session_management>
      <api_protection>Middleware de autenticación en cada endpoint, validando JWT
        y rol/permiso correspondiente a cada ruta.</api_protection>
      <failed_login_lockout>Ej. 5 intentos fallidos → bloqueo temporal de 15
        minutos.</failed_login_lockout>
      <password_policy>Mínimo 8 caracteres, combinación de mayúsculas y
        números.</password_policy>
      <https_required>Obligatorio en todo el sistema, sin excepción.</https_required>
      <two_factor_auth enabled="false">
        Explícitamente NO implementado por el momento (decisión del cliente,
        revaluable a futuro).
      </two_factor_auth>
      <sso enabled="false">
        NO se implementa SSO — el hotel no usa Google Workspace ni Microsoft
        365.
      </sso>
      <password_recovery>
        <self_service>NO existe flujo de autorecuperación por correo/enlace.</self_service>
        <admin_reset>Solo el rol ADMINISTRADOR puede resetear la contraseña de
          cualquier usuario desde el módulo de gestión de usuarios. Al resetear,
          se genera una contraseña TEMPORAL que el usuario debe cambiar en su
          primer inicio de sesión. Esta acción queda registrada en el log de
          auditoría.</admin_reset>
      </password_recovery>
    </authentication>
  </module>

  <module id="T2" name="Configuración/Opciones" type="transversal">
    <access_restriction>Módulo EXCLUSIVO del rol Administrador, sin excepciones
      por ningún otro rol (incluyendo Calidad, incluso para los eventos
      relacionados a certificaciones y mediciones).</access_restriction>
    <audit_note>Todo cambio en este módulo (destinatarios, parámetros,
      activación/desactivación) se registra en el LOG DE AUDITORÍA GENERAL — no
      tiene su propia vista de historial separada.</audit_note>

    <section name="Notificaciones por correo">
      <table_fields>
        <field>evento (fijo, definido por el sistema, no editable)</field>
        <field>descripción</field>
        <field name="canal">Correo (único canal disponible actualmente; campo
          diseñado para ser extensible a WhatsApp u otros canales de mensajería
          en una integración futura, sin tocar la lógica de los eventos)</field>
        <field>correos destinatarios (uno o varios, texto libre editable — NO
          vinculados a usuarios del sistema, por decisión explícita, para poder
          incluir personas externas al CMMS como recepción)</field>
        <field name="modo_de_envio">Inmediato / Resumen diario (configurable por
          evento)</field>
        <field>hora del resumen (solo aplica si modo = Resumen diario)</field>
        <field>parámetro adicional (ej. días de anticipación, solo donde aplique)</field>
        <field>activo/inactivo (silencia el evento sin borrar la configuración)</field>
      </table_fields>

      <event_catalog_final>
        <event id="1" name="OT afecta disponibilidad de venta" mode="Inmediato"/>
        <event id="2" name="OT preventiva generada" mode="Resumen diario">
          Un correo agrupado por plan con la lista completa de OTs generadas.
        </event>
        <event id="3" name="Stock bajo mínimo" mode="Resumen diario">Evaluado por
          bodega.</event>
        <event id="4" name="Stock negativo" mode="Inmediato"/>
        <event id="5" name="Reporte de daño nuevo" mode="Inmediato"/>
        <event id="6" name="OT preventiva vencida" mode="Resumen diario">Lista
          acumulada de todas las OTs vencidas que sigan sin cerrarse.</event>
        <event id="7" name="Garantía por vencer" mode="Resumen diario">
          <parameter>Días de anticipación — CAMPO GLOBAL ÚNICO en Configuración,
            aplica a TODAS las garantías. Valor por defecto: 0 días (mismo día del
            vencimiento). Aviso ÚNICO por garantía (no repetido), recalculado si
            la garantía se edita/extiende. Solo aplica a garantías con estado
            Vigente.</parameter>
        </event>
        <event id="8" name="Certificación/permiso por vencer" mode="Inmediato">
          <parameter>Días de anticipación configurable. Aviso ÚNICO (no
            escalonado).</parameter>
        </event>
        <event id="9" name="Medición fuera de rango" mode="Inmediato">
          Destinatarios sugeridos: Mantenimiento y Calidad.
        </event>
        <event id="10" name="Activo requiere reemplazo" mode="Inmediato">
          Se dispara cuando la etapa_de_vida de un activo cambia a "Requiere
          reemplazo".
        </event>
        <event id="11" name="Contrato por vencer" mode="Resumen diario (sugerido)">
          Días de anticipación configurable.
        </event>
        <event_excluded name="OT reabierta">
          NO genera notificación — decisión explícita, ya que solo Mantenimiento
          puede reabrir y ya tiene visibilidad directa de su propia acción.
        </event_excluded>
        <event_excluded name="Conteo físico con diferencias">
          NO genera notificación — Mantenimiento ya lo revisa directamente en el
          flujo de confirmación del conteo.
        </event_excluded>
      </event_catalog_final>

      <push_notifications_separate_mechanism>
        <description>
          Las notificaciones PUSH al técnico son un mecanismo SEPARADO, con
          destinatario dinámico (el/los técnico(s) afectado(s)), NO configurable
          en la tabla de opciones de correo.
        </description>
        <triggers>
          <trigger>OT asignada a un técnico</trigger>
          <trigger>OT reasignada (notifica tanto al que recibe como al que
            pierde la OT)</trigger>
          <trigger>OT propia modificada por otro usuario (no genera push si el
            propio técnico es quien modifica)</trigger>
        </triggers>
        <non_triggers>
          <item>OT reabierta — no genera push (a discreción de Mantenimiento
            avisar por fuera del sistema)</item>
          <item>Comentario nuevo en la OT — no genera push</item>
        </non_triggers>
        <infrastructure_dependency>Requiere la PWA instalada en el dispositivo
          del técnico.</infrastructure_dependency>
      </push_notifications_separate_mechanism>
    </section>

    <section name="Reportes programados">
      <ver>Ver tabla completa en módulo 7 → scheduled_monthly_reports.</ver>
    </section>

    <section name="Parámetros generales del sistema">
      <parameter name="Días de anticipación de aviso de garantía" default="0"/>
      <parameter name="Prefijos de código por categoría de activo"/>
      <parameter name="Formato del consecutivo de código de ítems/activos"/>
      <parameter name="Intentos fallidos de login antes de bloqueo" default="5"/>
      <parameter name="Duración del bloqueo por intentos fallidos" default="15 min"/>
      <parameter name="Duración del access token" default="15-30 min"/>
      <parameter name="Duración del refresh token" default="7 días"/>
    </section>

    <section name="Índice de catálogos administrables (accesos directos)">
      <catalog_ref module="1">Categorías de activos</catalog_ref>
      <catalog_ref module="4">Categorías de ítems de inventario</catalog_ref>
      <catalog_ref module="4">Bodegas</catalog_ref>
      <catalog_ref module="3">Plantillas de checklist</catalog_ref>
      <catalog_ref module="6">Categorías normativas</catalog_ref>
      <catalog_ref module="6">Tipos de medición</catalog_ref>
      <catalog_ref module="T1">Roles (solo visible, no editable — catálogo fijo)</catalog_ref>
    </section>
  </module>

  <module id="T3" name="Log de Auditoría" type="transversal">
    <access>Exclusivo del rol ADMINISTRADOR para la vista de listado general.</access>
    <retention>INDEFINIDA — sin archivado ni purga automática.</retention>
    <immutability>Solo lectura — nadie edita ni elimina entradas, ni siquiera
      Administrador.</immutability>
    <export>Exportable a PDF y Excel, con los filtros aplicados.</export>

    <record_fields>
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
      <item module="Reportes de Daño">Creación, conversión a OT, descarte</item>
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
        activación/desactivación de eventos y reportes programados</item>
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

  <!-- ==================================================================== -->
  <!-- PENDIENTES ABIERTOS (no resueltos aún en el diseño)                  -->
  <!-- ==================================================================== -->
  <open_pending_items>
    <item>Definir, para cada uno de los 7 módulos principales, el detalle
      completo de vistas y flujos de datos (qué pantallas tiene cada uno: lista,
      detalle, calendario, tablero, árbol, y cómo fluyen los datos entre ellas).</item>
    <item>Definir infraestructura completa: hosting, base de datos, arquitectura
      del API REST, librería/mecanismo específico de emisión de JWT, proveedor de
      envío de correos, proveedor de notificaciones push para la PWA.</item>
    <item>Evaluar en el futuro: integración por API con el PMS del hotel (hoy
      cerrado) para sincronizar automáticamente estados OOO/OOS de habitaciones.</item>
    <item>Evaluar en el futuro: integración por API con la app web externa de
      reportes de incidencias ya existente.</item>
    <item>Evaluar en el futuro: integración con canal de mensajería tipo
      WhatsApp Business API como canal adicional de notificaciones (el campo
      "canal" ya está previsto en el diseño para soportarlo sin romper la lógica
      actual).</item>
  </open_pending_items>

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
      (módulo T2) para cualquier nuevo evento de notificación que se agregue a
      futuro: debe quedar en esa tabla como fila editable (correo, modo de envío,
      destinatarios, parámetros), no hardcodeado en el código de negocio.</instruction>
  </instructions_for_agent>
</project>
```
