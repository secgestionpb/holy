# Módulo 2: Órdenes de Trabajo

> **Entregables:** spec (abajo) · **Flujos/Interfaces:** [02-ordenes-de-trabajo-flujos.md](02-ordenes-de-trabajo-flujos.md)
> **Tablas BD:** [work_orders](BD/work_orders.md) · [damage_reports](BD/damage_reports.md) · [wo_technicians](BD/wo_technicians.md) · [wo_comments](BD/wo_comments.md) · [wo_evidence](BD/wo_evidence.md) — **compartidas:** [audit_log](BD/audit_log.md) · [notification_log](BD/notification_log.md) · [notification_config](BD/notification_config.md) — **referenciadas:** [assets](BD/assets.md) · [users](BD/users.md) · [providers](BD/providers.md) · [maintenance_plans](BD/maintenance_plans.md) · [warranties](BD/warranties.md)

```xml
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

  <damage_report_entity name="Reporte de Daño"> <!-- BD: damage_reports.md -->
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
      catálogo de notificaciones <!-- BD: BD/notification_config.md -->).</notification>
  </damage_report_entity>

  <lifecycle_states> <!-- BD: work_orders.md (columna status) -->
    Abierta → Asignada → En proceso → Pendiente de repuesto/aprobación →
    Completada → Cerrada
    (rama alterna: → Cancelada)
    (transición especial: Cerrada → En proceso, solo vía reapertura por
    Mantenimiento)
    <note>"Completada" = el técnico terminó el trabajo físico. "Cerrada" = un
      supervisor (Mantenimiento) valida y confirma, incluida la pregunta
      obligatoria de garantía.</note>
  </lifecycle_states>

  <fields> <!-- BD: work_orders.md -->
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
    <field name="tecnico_asignado"> <!-- BD: wo_technicians.md -->
      <cardinality>Uno o VARIOS técnicos simultáneamente sobre la misma OT.</cardinality>
      <optionality>OPCIONAL — una OT puede quedar SIN asignar y ser gestionada
        directamente por Mantenimiento (caso típico: ejecución por contratista
        externo).</optionality>
    </field>
    <field>fecha/hora de asignación (automática)</field>
    <field>fecha/hora de inicio y fin de trabajo (registrada por el técnico)</field>
    <field>horas de mano de obra registradas POR TÉCNICO (no un total único),
      cuando hay varios técnicos asignados <!-- BD: wo_technicians.md (hours_worked) --></field>
    <field>repuestos/insumos utilizados (vinculado al módulo de Inventario
      <!-- BD: stock_movements (kardex) --></field>
    <field>costo total = mano de obra interna + repuestos consumidos + costo de
      servicio externo (contratista)</field>
    <field>evidencia (fotos antes/después) <!-- BD: wo_evidence.md --></field>
    <field>diagnóstico / solución aplicada (texto libre al cerrar)</field>
    <field name="afecta_disponibilidad_venta">
      <values>Sí / No</values>
      <note>Como NO hay integración con el PMS, este campo es puramente
        informativo: dispara una notificación por correo (evento 1 del
        catálogo), pero NO bloquea automáticamente la venta en el PMS. El
        bloqueo real es un proceso 100% manual fuera del CMMS.</note>
    </field>
    <field name="genera_o_extiende_garantia"> <!-- BD: warranties.md -->
      <values>Sí / No</values>
      <obligatoriedad>Obligatorio al CERRAR la OT (ver regla crítica en módulo 1,
        warranties <!-- BD: BD/warranties.md -->). Una OT correctiva SIN
        garantía se cierra con "No" — la respuesta queda en
        work_orders.generates_warranty.</obligatoriedad>
    </field>
    <field name="ejecutada_por">
      <values>Personal interno | Contratista externo</values>
      <optional>true</optional>
      <conditional_field>Si = Externo, se habilita selección del catálogo de
        Proveedores/Contratistas (módulo 5 <!-- BD: BD/providers.md -->) y el
        campo "costo del servicio externo" (monto único).</conditional_field>
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
          general <!-- BD: BD/audit_log.md -->, con observación, técnico anterior y técnico nuevo.</item>
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
    <audit>Queda registrada en el log de auditoría <!-- BD: BD/audit_log.md -->
      (usuario, fecha, motivo,
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
      <item>Genera movimiento tipo "Devolución" en el kardex
        (<!-- BD: stock_movements (tipo devolucion) -->), referenciando la
        OT.</item>
      <item>Reduce el costo de la OT usando el COSTO CONGELADO del movimiento de
        salida original (no el costo actual del ítem).</item>
      <item>Se registra en el log de auditoría (<!-- BD: BD/audit_log.md -->).</item>
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
        provienen del mismo log de auditoría general (<!-- BD: BD/audit_log.md -->),
        filtrado por esa OT (no
        hay una segunda fuente de verdad).</automatic>
      <manual_comments>Autor, fecha, texto, adjuntos opcionales. Los técnicos
        asignados y Mantenimiento pueden comentar; Administrador solo lee. Los
        comentarios NO se editan ni se borran una vez publicados. Un comentario
        nuevo NO genera notificación push. <!-- BD: BD/wo_comments.md --></manual_comments>
    </entry_types>
  </history_tab>
</module>
```
