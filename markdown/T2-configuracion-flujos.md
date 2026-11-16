# Módulo T2: Configuración/Opciones — Flujos, Interfaces y Mapeo Supabase

> Spec fuente: [T2-configuracion.md](T2-configuracion.md)
> **Tablas BD del Módulo T2:** [notification_config](BD/notification_config.md) (catálogo editable de los 12 eventos) · [notification_log](BD/notification_log.md) (envíos + deduplicación) · [push_subscriptions](BD/push_subscriptions.md) (dispositivos PWA) · [system_parameters](BD/system_parameters.md) (Parámetros generales — creado en M7) — **referenciadas (otros módulos):** [scheduled_reports](BD/scheduled_reports.md) (sección Reportes programados = puntero al M7) · [failed_logins](BD/failed_logins.md) (lockout — parametrizado desde system_parameters) · [users](BD/users.md) · [audit_log](BD/audit_log.md) (module `configuration`) · [work_orders](BD/work_orders.md)

```xml
<module id="T2" name="Configuración/Opciones — Flujos" type="transversal">

  <decisions_taken>
    <decision n="T2.1">NAVEGACIÓN: UN ítem lateral "Configuración" (solo
      Administrador — spec access_restriction) con 3 pestañas: Notificaciones
      | Parámetros | Catálogos. La sección "Reportes programados" NO abre
      pestaña propia: es un acceso directo a V7.2 del Módulo 7 (spec T2:
      "Ver tabla completa en módulo 7").</decision>
    <decision n="T2.2">PARÁMETROS DE AUTENTICACIÓN DIVIDIDOS (user
      confirmó la corrección, coherente con stack): SOLO LECTURA = duración
      del access token y del refresh token (los gestiona Supabase Auth en
      plataforma, edición en su dashboard). EDITABLES IN-APP =
      intentos de login antes de bloqueo (5) y duración del bloqueo
      (15 min) — el lockout es CUSTOM (Edge Function `login-custom` +
      failed_logins, decisión T1.3) y el stack exige "Parámetros tomados de
      Configuración": viven en system_parameters (login_attempts,
      lockout_minutes). También editables: días de anticipación de
      garantía y tarifa global de mano de obra (system_parameters);
      prefijos/formato de código = lectura con acceso directo a los
      catálogos del Módulo 1.</decision>
    <decision n="T2.3">ENVÍO DE CORREOS transaccional vía Brevo (decisión
      cerrada) desde la Edge Function `send-notifications` (service role); los
      destinatarios salen SIEMPRE de notification_config.recipients
      (texto libre, admite personas externas al CMMS — spec) — nunca
      hardcodeados (instrucción general de la spec).</decision>
    <decision n="T2.4">DOS MODOS DE ENTREGA (spec): INMEDIATO = el módulo
      dispara → se encola pending en notification_log → pg_notify → la Edge
      Function envía ya; RESUMEN DIARIO = se encola pending y pg_cron
      (cada hora) agrupa los eventos con digest_time alcanzado → UN correo
      por evento con sus filas pendientes → sent. digest_time editable por
      evento (default 08:00).</decision>
    <decision n="T2.5">DEDUPLICACIÓN de avisos únicos por
      notification_log UNIQUE (event_id, dedup_key) — p.ej. Evento 7 por
      garantía; si la garantía se edita/extiende se borra la fila de dedup y
      el aviso se recalcula (patrón ya declarado en notification_log).
      is_active=false silencia el evento SIN encolar (no solo sin enviar).</decision>
    <decision n="T2.6">PUSH = mecanismo SEPARADO (spec): tabla
      push_subscriptions (tokens FCM por dispositivo, N:1 usuario), trigger
      lógico en los módulos (OT asignada / reasignada / OT propia
      modificada por OTRO usuario), destinatario DINÁMICO (el técnico
      afectado), NO pasa por notification_config ni notification_log.
      Requiere PWA instalada (spec infrastructure_dependency).</decision>
    <decision n="T2.7">CORSARIO de no-eventos: "OT reabierta" y "Conteo
      físico con diferencias" NO generan notificación (spec
      event_excluded) — documentado en la pestaña Notificaciones como
      "Excluidos" para que nadie intente crearlos.</decision>
    <decision n="T2.8">ÍNDICE DE CATÁLOGOS (spec section) = pestaña de
      accesos directos a los catálogos administrables de otros módulos;
      cada enlace abre el catálogo EN SU MÓDULO y respeta el permiso dueño
      (ej. categorías normativas las CRUD-ea Calidad aunque el Admin llegue
      desde T2 — T2 no hereda CRUD de catálogos ajenos).</decision>
    <decision n="T2.9">DESPACHO EN SUPABASE (implementación): el "pg_notify"
      de T2.4 se materializa con pg_net.http_post hacia la Edge Function
      `send-notifications` (el hosting no tiene listener persistente para
      pg_notify; pg_net es el equivalente práctico). Inmediato = fn_notify
      encola + http_post por fila; digesto = pg_cron horario llama
      fn_enqueue_digest() → http_post por evento. Zona horaria del digesto:
      UTC (zona del hotel = open_pending). La URL del proyecto queda fija
      en las funciones; endurecer con secreto compartido =
      open_pending.</decision>
  </decisions_taken>

  <navigation>
    <lateral_menu admin_only="true">
      <item view="V-T2.1" label="Configuración">Módulo T2 —
        [02-flujos admin_items](02-ordenes-de-trabajo-flujos.md)
        (Usuarios | Configuración | Auditoría — solo Admin).</item>
    </lateral_menu>
    <tabs>
      <tab id="notificaciones" label="Notificaciones" default="true">V-T2.1a
        — tabla de los 12 eventos + excluidos.</tab>
      <tab id="parametros" label="Parámetros">V-T2.1b — Parámetros generales
        del sistema (editables/lectura).</tab>
      <tab id="catalogos" label="Catálogos">V-T2.1c — índice de accesos
        directos.</tab>
      <link external="M7">Sección "Reportes programados" (barra de aviso al
        pie de la pestaña Notificaciones) → abre V7.2
        [07-reportes-kpis-flujos](07-reportes-kpis-flujos.md).</link>
    </tabs>
    <by_role>
      <administrador>3 pestañas con edición completa (spec: CRUD completo de
        Configuración/Opciones).</administrador>
      <otros_roles>Sin ítem — "Módulo EXCLUSIVO del rol Administrador, sin
        excepciones por ningún otro rol (incluyendo Calidad…)" (spec
        access_restriction).</otros_roles>
    </by_role>
  </navigation>

  <views>
    <view id="V-T2.1a" name="Notificaciones (pestaña)" type="principal">
      <entry_point>Menú lateral → Configuración → Notificaciones.</entry_point>
      <table columns="Evento (id + nombre) | Canal | Modo | Hora resumen |
        Destinatarios | Parámetro | Estado | editar">12 filas del catálogo
        (notification_config) en orden 1–12; la columna "Parámetro" solo se
        muestra en los eventos con extra_param (7, 8, 11 — días de
        anticipación).</table>
      <excluded_box>Panel "No generan notificación (decisión de diseño)":
        OT reabierta · Conteo físico con diferencias (spec
        event_excluded).</excluded_box>
      <push_banner>Banner "Push a técnicos: mecanismo separado (destinatario
        dinámico)" con link a push_subscriptions / F-T2.4 — referencia al
        bloque spec push_notifications_separate_mechanism.</push_banner>
      <actions>Fila → Editar (→ M-T2.1) · link "Reportes programados →"
        (→ V7.2).</actions>
    </view>

    <modal id="M-T2.1" name="Editar evento de notificación">
      <trigger>Fila → Editar en V-T2.1a (solo Admin).</trigger>
      <fields>Modo de envío (Inmediato | Resumen diario) · Hora del resumen
        (TIME, solo si modo = Resumen diario; default 08:00) · Correos
        destinatarios (textarea texto libre — uno o varios, admite externos)
        · Parámetro adicional (solo eventos 7/8/11 — días de anticipación,
        numérico ≥0) · Activo/Inactivo (silencia sin borrar config — spec
        field). Evento y canal NO se editan (canal = Correo; diseñado
        extensible a WhatsApp futuro sin tocar el catálogo).</fields>
      <save>UPDATE notification_config (updated_by/updated_at) → audit_log
        (module `configuration`, entity_type `notification_event`, cambios
        campo-a-campo).</save>
    </modal>

    <view id="V-T2.1b" name="Parámetros (pestaña)" type="principal">
      <entry_point>Configuración → Parámetros.</entry_point>
      <rows>
        <row editable="true">Días de anticipación de aviso de garantía (default 0)
          → system_parameters.dias_anticipacion_garantia (Eventos 7 —
          campo global único, spec).</row>
        <row editable="true">Tarifa global de mano de obra por hora (default 0) →
          system_parameters.labor_hourly_rate (fallback M7 —
          decisión 7.4).</row>
        <row editable="true">Intentos fallidos de login antes de bloqueo (default
          5) → system_parameters.login_attempts — lockout CUSTOM
          (failed_logins + Edge Function `login-custom` — decisión T2.2
          corregida).</row>
        <row editable="true">Duración del bloqueo (default 15 min) →
          system_parameters.lockout_minutes (mismo mecanismo).</row>
        <row readonly="true" source="Supabase Auth">Duración del access token
          (15-30 min) · Duración del refresh token (7 días) — "gestionado
          por Supabase Auth" (decisión T2.2).</row>
        <row readonly="true" link="M1">Prefijos de código por categoría de activo ·
          Formato del consecutivo de código de ítems/activos — gestionados
          en los catálogos/code_counters del Módulo 1 (acceso directo,
          lectura).</row>
      </rows>
      <save>Los editables: UPDATE system_parameters + audit_log (module
        `configuration`, entity_type `system_parameter`).</save>
    </view>

    <view id="V-T2.1c" name="Catálogos (pestaña)" type="principal">
      <entry_point>Configuración → Catálogos (spec: "Índice de catálogos
        administrables (accesos directos)").</entry_point>
      <links>Categorías de activos (M1) · Categorías de ítems (M4) · Bodegas
        (M4) · Plantillas de checklist (M3) · Categorías normativas (M6) ·
        Tipos de medición (M6) · Roles (T1 — solo visible, no editable, catálogo
        fijo).</links>
      <rule>Cada enlace navega al catálogo en SU módulo; allí aplica el
        permiso dueño (decisión T2.8) — T2 solo indexa.</rule>
    </view>
  </views>

  <flows>

    <flow id="F-T2.1" name="Editar configuración de un evento" actor="Administrador">
      <entry>V-T2.1a → fila → Editar → M-T2.1.</entry>
      <steps>
        <step>1. Ajusta modo, hora de resumen, destinatarios, parámetro o
          estado.</step>
        <step>2. UPDATE notification_config (updated_by/updated_at).</step>
        <step>3. audit_log (module `configuration`, cambios campo-a-campo).</step>
      </steps>
      <rules>Patrón OBLIGATORIO para eventos nuevos (spec): fila editable
        aquí — nunca destinatarios/modos hardcodeados en la lógica de
        negocio · silenciar = is_active=false (sin DELETE) · el motor de
        cada módulo solo "dispara" event_id + entidades; la Edge Function
        resuelve el resto leyendo esta tabla.</rules>
      <tables written="[notification_config](BD/notification_config.md), [audit_log](BD/audit_log.md)" read="[]"/>
    </flow>

    <flow id="F-T2.2" name="Disparo y envío INMEDIATO" actor="sistema (módulo → Edge Function)">
      <entry>Evento inmediato dispara desde su módulo (ej. Evento 5:
        reporte de daño nuevo; Evento 4: stock negativo; Evento 9: medición
        fuera de rango).</entry>
      <steps>
        <step>1. El módulo llama a fn_notify(event_id, target_entity_type,
          target_entity_id, dedup_key|null, payload) → si notification_config
          is_active y (si hay dedup_key) no existe la fila → INSERT
          notification_log status `pending` (UNIQUE (event_id, dedup_key)
          garantiza aviso único — decisión T2.5).</step>
        <step>2. pg_notify → la Edge Function `send-notifications` despierta
          con la(s) fila(s).</step>
        <step>3. Lee recipients/extra_param de notification_config → envía
          correo (Brevo — decisión T2.3) con el payload
          (template por evento).</step>
        <step>4. UPDATE notification_log → `sent` (sent_at) o `failed`
          (error_detail, visible para reintento manual).</step>
      </steps>
      <rules>is_active=false → NO se encola (silenciado) · destinatarios
        vacíos → `failed` con detalle "sin destinatarios" · el módulo jamás
        ve destinatarios (solo dispara event_id).</rules>
      <tables written="[notification_log](BD/notification_log.md)" read="[notification_config](BD/notification_config.md)"/>
    </flow>

    <flow id="F-T2.3" name="Resumen diario" actor="sistema (pg_cron → Edge Function)">
      <entry>pg_cron CADA HORA (00:00–23:00) → fn_enqueue_digest() (o
        directo en la Edge Function `send-notifications` modo
        digest).</entry>
      <steps>
        <step>1. Selecciona eventos mode=`daily_digest` con is_active y
          digest_time ≤ hora actual SIN procesar de hoy → recoge sus filas
          `pending`.</step>
        <step>2. Agrupa: UN correo por evento con todas sus filas (ej.
          Evento 2 agrupa por plan la lista de OTs generadas — spec;
          Evento 6 lista acumulada de OTs vencidas; Evento 3 evalúa por
          bodega).</step>
        <step>3. Envía → filas → `sent`; sin destinatarios → `failed`.</step>
      </steps>
      <rules>Dedup de avisos únicos ya garantizado por dedup_key (una fila
        solo entra al resumen una vez) · eventos inactivos no se procesan ·
        hora editable por evento (M-T2.1).</rules>
      <tables written="[notification_log](BD/notification_log.md)" read="[notification_config](BD/notification_config.md)"/>
      <cron>pg_cron horario — patrón declarado en stack-tecnologico
        (resúmenes diarios a la hora configurada).</cron>
    </flow>

    <flow id="F-T2.4" name="Suscripción y envío de PUSH (mecanismo separado)" actor="técnico (PWA) / sistema">
      <entry>Suscripción: la PWA, tras login, pide permiso de notificaciones
        → FCM token → upsert push_subscriptions. Disparo: eventos de
        asignación en el Módulo 2.</entry>
      <steps>
        <step>1. Alta del token: user_id + fcm_token + device_info; logout o
          cambio de cuenta → is_active=false.</step>
        <step>2. Disparos (spec triggers): OT ASIGNADA a un técnico · OT
          REASIGNADA (push al que la recibe Y al que la pierde) · OT PRÓPIA
          MODIFICADA por otro usuario (sin push si modifica el propio
          técnico).</step>
        <step>3. Edge Function `send-push` → resuelve tokens activos del
          técnico destinatario (destinatario DINÁMICO) → FCM →
          dispositivo.</step>
        <step>4. NO usa notification_config/notification_log (spec:
          configurable es solo el canal de correo).</step>
      </steps>
      <rules>No-disparos (spec): OT reabierta · comentario nuevo en la OT
        (a discreción de Mantenimiento avisar por fuera) · requiere PWA
        instalada (sin PWA = sin push, el correo no cubre estos casos porque
        no son eventos).</rules>
      <tables written="[push_subscriptions](BD/push_subscriptions.md)" read="[push_subscriptions](BD/push_subscriptions.md), [users](BD/users.md)"/>
    </flow>

    <flow id="F-T2.5" name="Editar Parámetros generales" actor="Administrador">
      <entry>V-T2.1b → editar (solo las filas `editable`).</entry>
      <steps>
        <step>1. Actualiza el valor (numérico ≥0 para días/tarifa).</step>
        <step>2. UPDATE system_parameters (updated_by/updated_at) →
          audit_log (module `configuration`, entity_type
          `system_parameter`).</step>
        <step>3. Filas readonly: sin acción (indicación de fuente —
          Supabase Auth / catálogos M1 — decisión T2.2).</step>
      </steps>
      <rules>Días de garantía = campo GLOBAL único que leen los F1.4/F1.9
        (evento 7) · tarifa global = fallback de costos M7 ·
        login_attempts/lockout_minutes = leídos por la Edge Function
        `login-custom` en cada intento (failed_logins — decisión T2.2
        corregida) — cambios afectan cálculos futuros, nunca reescriben
        históricos (costo congelado en kardex).</rules>
      <tables written="[system_parameters](BD/system_parameters.md), [audit_log](BD/audit_log.md)" read="[]"/>
    </flow>

  </flows>

  <cross_module_flows>
    <events_by_module>Los 12 eventos viven en notification_config; los
      módulos solo disparan: M1 = 7, 10, 12 · M2 = 1, 5, 6 (y no-5 es de
      reportes de daño), push de asignación · M3 = 2 (generación) y 6
      (vencidas) · M4 = 3, 4 · M5 = 11 · M6 = 8, 9 · M7 = sin eventos
      (reportes programados propios).</events_by_module>
    <to module="M7">Sección T2 "Reportes programados" = puntero a V7.2
      (scheduled_reports + report_send_log — mecanismo separado de este
      motor de notificaciones).</to>
    <to module="T1">T2 y T1 comparten el grupo admin_items del menú; los
      destinatarios NO son usuarios (texto libre — admite externos), por lo
      que T2 no depende de user_roles.</to>
    <to module="T3">Todo cambio en T2 (destinatarios, modo, parámetro,
      activo, parámetros generales) genera audit_log — spec audit_note:
      "no tiene su propia vista de historial separada" (se ve en el listado
      general T3).</to>
    <from stack="fcm-brevo-pgcron-pwa">FCM (push), Brevo (correo), pg_cron (resúmenes y
      reportes), PWA (instalación) — todos declarados en
      stack-tecnologico.</from>
  </cross_module_flows>

  <notifications>
    <role>Este módulo ES el motor de notificaciones del sistema: mantiene
      intacto el catálogo de 12 eventos + 2 excluidos (sin altas en esta
      sesión).</role>
    <new_event_rule>Regla de la spec (00-proyecto-general): cualquier evento
      futuro = fila editable en notification_config + lógica de solo
      disparo en su módulo + entrada en notification_log — jamás
      hardcodear destinatarios ni modos.</new_event_rule>
    <push_summary>Push separado (F-T2.4): 3 triggers, 2 no-triggers,
      destinatario dinámico, sin fila en notification_log.</push_summary>
  </notifications>

  <supabase_mapping>
    <tables written="[notification_config](BD/notification_config.md), [notification_log](BD/notification_log.md), [push_subscriptions](BD/push_subscriptions.md), [system_parameters](BD/system_parameters.md), [audit_log](BD/audit_log.md)" read="[notification_config](BD/notification_config.md), [notification_log](BD/notification_log.md), [push_subscriptions](BD/push_subscriptions.md), [users](BD/users.md)"/>
    <rls>
      notification_config: SELECT (por seguridad de lectura de plantillas;
        UI solo Admin) / INSERT-UPDATE = Admin (UPDATE directo con sesión
        Admin o service role) / DELETE prohibido. ·
      notification_log: INSERT = service role (motor) / SELECT = Admin
        (visibilidad de fallos en T2) / UPDATE = service role (transiciones
        pending→sent|failed) / DELETE prohibido. ·
      push_subscriptions: INSERT/UPDATE/DELETE = fila propia (auth.uid()) —
        el técnico gestiona sus dispositivos; SELECT = fila propia + service
        role; Admin solo lectura para diagnóstico. ·
      system_parameters: SELECT (4 roles — valores no sensibles) / UPDATE =
        Admin.
    </rls>
    <edge_functions>send-notifications (inmediato + digest; Brevo) ·
      send-push (FCM vía service account) · admin-users (T1, referenciada
      aquí por la exclusividad del grupo admin).</edge_functions>
    <cron>pg_cron horario para digest (F-T2.3) + job diario de reportes
      (M7) — instanciados en la migración.</cron>
    <sequences>Sin sequences.</sequences>
    <storage>Sin buckets propios (los adjuntos de reportes son del M7 —
      bucket `reportes`).</storage>
  </supabase_mapping>

  <open_pending_items>
    <item>Plantillas (templates) HTML de correo por evento — definir
      contenido al implementar (afecta a todos los módulos, decisión de
      diseño de copy). Hoy: cuerpo en texto plano.</item>
    <item>Canal WhatsApp Business API como segunda vía de notification_config
      — futuro declarado (el campo channel ya está listo).</item>
    <item>Test de envío ("probar evento") por fila de configuración —
      utilidad futura para validar destinatarios antes de producción.</item>
    <item>push_subscriptions: limpieza automática de tokens inválidos
      (respuestas FCM NOT_FOUND) — al implementar la Edge Function.</item>
    <item>Endurecer las llamadas internas pg_net → `send-notifications` con
      secreto compartido (hoy la EF acepta llamadas sin JWT — la acción
      `retry` sí exige sesión Admin).</item>
    <item>Zona horaria del hotel para digest_time (hoy UTC) y horario de
      los jobs pg_cron — definir con el cliente.</item>
  </open_pending_items>

</module>
```
