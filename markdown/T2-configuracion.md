# Módulo T2: Configuración/Opciones (Transversal)

> **Entregables:** spec (abajo) · **Flujos/Interfaces:** [T2-configuracion-flujos.md](T2-configuracion-flujos.md)
> **Tablas BD:** [notification_config](BD/notification_config.md) (opciones de correo y eventos) · [notification_log](BD/notification_log.md) (envíos y deduplicación de avisos) · [push_subscriptions](BD/push_subscriptions.md) (dispositivos PWA — mecanismo separado) · [system_parameters](BD/system_parameters.md) (Parámetros generales del sistema — creado en M7) — **referenciadas:** [scheduled_reports](BD/scheduled_reports.md) (sección "Reportes programados" = puntero al Módulo 7) · [users](BD/users.md) · [audit_log](BD/audit_log.md) (module `configuration`)

```xml
  <module id="T2" name="Configuración/Opciones" type="transversal">
    <access_restriction>Módulo EXCLUSIVO del rol Administrador, sin excepciones
      por ningún otro rol (incluyendo Calidad, incluso para los eventos
      relacionados a certificaciones y mediciones).</access_restriction>
    <audit_note>Todo cambio en este módulo (destinatarios, parámetros,
      activación/desactivación) se registra en el LOG DE AUDITORÍA GENERAL — no
      tiene su propia vista de historial separada.</audit_note>

    <section name="Notificaciones por correo"> <!-- BD: notification_config, notification_log -->
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
      <event id="12" name="Activo al fin de vida útil" mode="Resumen diario">
        Se dispara cuando la vida útil restante de un activo llega a 0 o menos
        (Módulo 1). No cambia la etapa de vida automáticamente.
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

      <push_notifications_separate_mechanism> <!-- BD: push_subscriptions -->
        <description>
          Las notificaciones PUSH al técnico son un mecanismo SEPARADO, con
          destinatario dinámico (el/los técnico(s) afectado(s)), NO configurable
          en la tabla de opciones de correo. <!-- BD: notification_config.md -->
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

    <section name="Reportes programados"> <!-- BD: scheduled_reports (Módulo 7) -->
      <ver>Ver tabla completa en módulo 7 → scheduled_monthly_reports.</ver>
    </section>

    <section name="Parámetros generales del sistema"> <!-- BD: system_parameters -->
      <parameter name="Días de anticipación de aviso de garantía" default="0"/>
      <parameter name="Tarifa global de mano de obra por hora" default="0"/>
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
```

