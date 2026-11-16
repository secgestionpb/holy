# Módulo 6 — Flujos de Información (Vistas y Flujos de Datos)

Detalle de pantallas y flujos de datos del Módulo 6: Cumplimiento Normativo y Mediciones.
Decisiones de UI resueltas en esta sesión: **1 ítem "Cumplimiento" con 2 pestañas**, **categoría normativa = catálogo CRUD**, **mediciones faltantes = solo indicador en UI (sin Evento nuevo)**.

> **Tablas BD del Módulo 6:** [certifications](BD/certifications.md) (incluye certification_history) · [compliance_categories](BD/compliance_categories.md) · [measurement_types](BD/measurement_types.md) · [measurement_records](BD/measurement_records.md) — **compartidas:** [audit_log](BD/audit_log.md) · [notification_log](BD/notification_log.md) · [notification_config](BD/notification_config.md) — **referenciadas (otros módulos):** [assets](BD/assets.md) · [categories](BD/categories.md) · [providers](BD/providers.md) · [users](BD/users.md)

```xml
<module id="6" name="Cumplimiento Normativo y Mediciones" artifact="flujos">

  <decisions_taken>
    <decision>Navegación: UN ítem "Cumplimiento" en el grupo lateral →
      V6.1 con DOS PESTAÑAS: Certificaciones | Mediciones. Dentro de
      Mediciones, sub-selector [Registro y Tendencias | Tipos de
      medición] (decisión de sesión).</decision>
    <decision>Categoría normativa: tabla CRUD propia
      compliance_categories (rol Calidad) con semillas de la spec:
      Seguridad estructural, Contra incendios, Sanitaria/agua,
      Ambiental, Eléctrica, Elevadores (decisión de sesión — extensible
      sin migración).</decision>
    <decision>Mediciones faltantes: SOLO indicador en UI (badge/lista
      "mediciones pendientes" según la frecuencia esperada del tipo) —
      SIN correo; la spec la marca "informativo" y T2 no define evento
      (decisión de sesión; Evento 13 descartado).</decision>
    <decision>DUEÑO DEL MÓDULO = CALIDAD en ambos bloques: CRUD de
      certificaciones y CRUD/registro de mediciones (spec permissions);
      Mantenimiento solo gestiona la renovación operativa de
      certificaciones (coordina contratista, crea OT si aplica); Admin
      solo consulta; Técnico SIN acceso.</decision>
    <decision>estado_calculado de certificaciones: DERIVADO en
      consulta/vista (patrón contracts M5): Vencido si hoy &gt; vencimiento
      · Por vencer si hoy &gt; vencimiento − lead · si no → Vigente.</decision>
    <decision>Días de anticipación: columna lead_days POR
      CERTIFICACIÓN (nullable) con fallback a la config global del
      Evento 8 — la spec permite "configurable por certificación/global".
    </decision>
    <decision>Renovación = acción "Renovar" (Calidad): INSERT de la
      vigencia ACTUAL en certification_history (emisión, vencimiento,
      documento, fecha de renovación) + UPDATE del padre con los nuevos
      datos — el padre NUNCA se sobrescribe sin dejar rastro (spec
      history: auditar períodos sin certificado vigente).</decision>
    <decision>periodicidad de renovación: ENUM (mensual | bimestral |
      trimestral | semestral | anual | otra) — informativo, coherente con
      los enums de contracts (M5).</decision>
    <decision>Puntos de medición = ACTIVOS del Módulo 1 (spec
      design_decision: sin entidad nueva; el tipo filtra por categoría
      de activo aplicable).</decision>
    <decision>Categoría de activo (M1) desactivada → sus tipos de
      medición conservan histórico pero NO admiten nuevos registros
      (baja lógica consistente; cierra el "pendiente de decisión en M6"
      de measurement_types).</decision>
    <decision>Vínculo con OT = NINGUNO (spec wo_link): el registro es
      dato independiente; si Calidad lo requiere, crea un Reporte de
      Daño manual (M2) — sin referencia cruzada automática.</decision>
  </decisions_taken>

  <implementation_notes>
    <note key="front">Front IMPLEMENTADO (V6.1–V6.4): pages/cumplimiento.tsx
      (V6.1: 2 pestañas ?tab=certificaciones|mediciones con sub-selector
      [Registro y Tendencias | Tipos de medición], filtros de certificados
      (búsqueda/categoría/estado/vence-en-N-días) y de mediciones
      (rango de fechas/tipo/resultado), CertificateList con estado
      derivado + fila → ficha, MissingBadge con lista de mediciones
      pendientes por tipo, TrendChart SVG con banda min/max cuando hay
      tipo seleccionado), pages/certificacion-form.tsx (V6.2 dual mode
      crear/editar, historial de vigencias con snapshot, upload de
      documento vía uploadComplianceFile + firma firmada, toggle
      activo/inactivo, RenewDialog para Calidad/Mant), pages/tipo-
      medicion-form.tsx (V6.3 zod v4 valueAsNumber, filtro por categoría
      de activo, periodicidad enum, min&lt;max), componentes
      compliance/record-measurement-dialog.tsx (V6.4: resultado
      calculado automático vs min/max, upload evidencia opcional),
      measurement-detail-dialog.tsx (M6.1 solo lectura), renew-dialog.tsx
      (M6.2: snapshot + update + storage), trend-chart.tsx (SVG sin
      recharts). Navegación "Cumplimiento" (ícono ShieldCheck, oculta al
      técnico puro, desktop+mobile) y tarjeta en el Panel (link, oculta
      a técnico, hero text actualizado).</note>
    <note key="permisos">Permisos: RequireProviderAccess en App.tsx
      redirige a /app cuando roles es [tecnico] puro (V6.1 oculto en nav
      y panel); RequireQuality envuelve /cumplimiento/certificaciones/nueva
      y /cumplimiento/tipos/(nuevo|:id) → /app/cumplimiento si no es
      Calidad; ficha certificación (V6.2) en modo solo lectura para
      Mant/Admin (sin "Guardar cambios" ni "Desactivar", con nota "Vista
      de solo lectura" y botón "Renovar" visible para Mant — renovación
      operativa F6.2); Calidad ve CRUD completo; RLS SELECT de
      certifications/mediciones abierto a authenticated; INSERT/UPDATE/
      DELETE restringidos a Calidad (certificados, tipos, mediciones);
      renovación (UPDATE padre + INSERT historial) permitida a Calidad
      y Mantenimiento.</note>
    <note key="bd">BD: migraciones 20261013000001_m6_core.sql (tablas
      compliance_categories, certifications, certification_history,
      measurement_types, measurement_records; ENUM
      certification_periodicity; ENUM measurement_result; RPC
      m6_register_measurement con resultado_calculado + Evento 9
      inmediato; RPC m6_renew_certification con snapshot historial +
      state_change audit; RPC m6_missing_measurements; Evento 8 "aviso
      certificación por vencer" con fn_m6_certification_jobs y pg_cron
      jobid 7 '25 2 * * *'; notification_config events 8 (extra_param=30)
      y 9; dedup_key cert-window:&lt;id&gt;:&lt;expires_at&gt;) +
      fixes 20261013000002–000006 (missing columns, counts RPC, assets
      is_active → operational_status, renew RETURN, missing assets).
      audit_log module='compliance' activo. Storage bucket documentos con
      prefijo cumplimiento/ para certificados y evidencias de medición.</note>
    <note key="ui">Detalles de UI: PostgREST shorthand operational_status
      no is_active (assets usa operational_status='operational');
      zod v4.6.5 sin invalid_type_error → z.number() + register
      ('min_value', { valueAsNumber: true }); Result como unión
      discriminada { ok: true } | { ok: false; message: string } con
      helpers postJson/callRpc/callRpcRows (arrays → rows); fetchAssetsLite
      filtra operational_status=eq.operational; uploadComplianceFile
      (upload + signComplianceFileUrl para lectura firmada); filtros de
      certificados recalculan vencimiento delante con lead_days propio o
      global; badges de estado (Vigente/Por vencer/Vencido) y resultado
      (Dentro de rango/Fuera de rango); sin recharts (SVG propio).</note>
    <note key="smoke">Verificación: BD smoke completo — tipo "Agua
      potable - cloro" (id 6dfe6bc9…) creado vía UI con min 0.2 max 1.0
      ppm; m6_register_measurement 0.5 ppm → in_range ✓; 2.5/3.1 ppm →
      out_of_range + Evento 9 notification_log ✓; categoría incorrecta →
      error esperado ✓; cert "Certificado de potabilidad M6" (id
      81c2ded2…) creada con vencimiento +10 días; Evento 8 job →
      notificación con dedup_key y days_left=10 ✓; 2ª corrida total=1
      (dedup) ✓; m6_renew_certification → historial snapshot + cert
      actualizada (vencimiento +2 años, doc path) ✓; audit_log
      'compliance' 7 filas ✓; m6_missing_measurements → [] tras fix ✓.
      Navegador: Calidad (login smoke-m2-calidad, pestañas
      Certificaciones/Mediciones visibles, 1 tipo + 3 registros con
      badges, TrendChart SVG con banda "Rango 0,2–1 ppm" y valores,
      medición 0,7 ppm registrada vía UI con toast éxito, sub-tab Tipos
      con 1 tipo + 4 registros + botón "Nuevo tipo") ✓; Mant (login
      smoke-m1-mant, lista sin "Nueva certificación", ficha en modo solo
      lectura con nota, campos disabled, botón "Renovar" visible + sin
      "Guardar cambios"/"Desactivar", historial con snapshot renovación
      2025-10-13 → 2026-10-23) ✓; Admin (login admin@holy.com, lista
      visible sin "Nueva certificación", sin "Registrar medición",
      lectura) ✓; Técnico (login smoke-t2-tecnico, nav sin "Cumplimiento",
      panel sin tarjeta, /app/cumplimiento → redirect /app) ✓. Typecheck/
      lint/build ✓. Notificaciones: events 8/9 con destinatario
      admin@holy.com configurado durante smoke; con destinatario →
      failed: BREVO_API_KEY no configurada (infra, no código); sin
      destinatarios → failed: Sin destinatarios (correcto).</note>
  </implementation_notes>

  <navigation>
    <lateral_menu group="Mantenimiento">
      <item view="V1.1" label="Activos">Módulo 1.</item>
      <item view="V2.1" label="Órdenes de Trabajo">Módulo 2.</item>
      <item view="V2.4" label="Reportes de Daño">Módulo 2.</item>
      <item view="V3.1" label="Preventivo">Módulo 3.</item>
      <item view="V4.1" label="Inventario">Módulo 4.</item>
      <item view="V5.1" label="Proveedores">Módulo 5.</item>
      <item view="V6.1" label="Cumplimiento" active="true">Módulo 6 —
        abre V6.1 (Certificaciones | Mediciones). Formularios: V6.2
        certificación, V6.3 tipo de medición, V6.4 registro de
        medición.</item>
    </lateral_menu>
    <access_by_role>
      <calidad>CRUD completo de certificaciones (catálogo e historial),
        tipos de medición y registros de medición — dueño del módulo
        (spec permissions de ambos bloques).</calidad>
      <mantenimiento>Gestiona la RENOVACIÓN operativa de certificaciones
        (coordina contratista, crea la OT si aplica) sin ser dueño del
        catálogo; RECIBE el Evento 9 (medición fuera de rango); sin
        gestión del catálogo de mediciones (spec permissions de ambos
        bloques).</mantenimiento>
      <administrador>Solo consulta (ambos bloques — spec).</administrador>
      <tecnico>SIN ACCESO al módulo (spec — ambos bloques).</tecnico>
    </access_by_role>
  </navigation>

  <views>

    <view id="V6.1" name="Cumplimiento (2 pestañas)" type="principal">
      <entry_point>Menú lateral → "Cumplimiento".</entry_point>

      <tab id="certifications" label="Certificaciones">
        <list>
          <columns>nombre · categoría normativa · activo vinculado (o
            "General — todo el hotel") · entidad emisora · nº de
            certificado · vencimiento · responsable (contratista) ·
            estado calculado (badge: Vigente | Por vencer | Vencido) ·
            acciones</columns>
          <filters>categoría normativa, estado, activo, responsable,
            con vencimiento en los próximos N días, búsqueda
            texto. <pending>Opción a revisar: el filtro "activo" hoy es un
            desplegable sin buscador; con catálogo grande conviene el
            combobox con búsqueda (components/asset-combobox.tsx, ya usado
            en V2.2 — Nueva OT).</pending></filters>
          <badges>Vencido en rojo · Por vencer en ámbar (ventana = lead
            de la certificación o config global Evento 8).</badges>
          <actions>
            <action roles="calidad|mantenimiento" to="V6.2">Nueva
              certificación (Calidad) / Renovar / Editar</action>
            <action roles="mantenimiento">Ver y gestionar la renovación
              operativa (abrir V6.2 en modo renovación: coordina
              contratista, adjunta documento, registra nueva vigencia
              vía "Renovar") — Calidad aprueba/edita el catálogo (decisión
              de sesión: Mantenimiento opera la renovación, Calidad es
              dueña del catálogo).</action>
          </actions>
          <row_click>V6.2 (lectura/edición según rol).</row_click>
          <roles>
            <calidad>CRUD completo (spec permissions).</calidad>
            <mantenimiento>Renovación operativa + consulta (spec
              permissions).</mantenimiento>
            <administrador>Solo lectura.</administrador>
            <tecnico>Sin acceso.</tecnico>
          </roles>
        </list>
        <empty_state>"Sin certificaciones registradas" + "Nueva
          certificación" (Calidad).</empty_state>
      </tab>

      <tab id="measurements" label="Mediciones">
        <internal_selector>
          <segment id="records" label="Registro y Tendencias">
            <actions_bar>
              <action roles="calidad" to="V6.4">Registrar medición</action>
              <indicator roles="calidad|mantenimiento|administrador">Badge
                "mediciones faltantes" (N): tipos activos sin registro
                dentro de su frecuencia esperada por activo —
                INFORMATIVO, sin correo (decisión de sesión). Click →
                lista desplegable tipo/activo/última medición.</indicator>
            </actions_bar>
            <trend_chart>Gráfico de línea temporal (Recharts o
              equivalente): eje X = fecha, eje Y = valor medido, banda o
              líneas horizontales de min/max del tipo (rango aceptable) con
              relleno verde/rojo al 20% según dentro/fuera — colores según
              design_tokens de
              [stack-tecnologico](stack-tecnologico.md); filtros: tipo de
              medición, activo, rango de fechas; puntos fuera de rango
              destacados en rojo (spec trend_view).</trend_chart>
            <recent_table>últimos registros: fecha/hora · tipo · activo
              · valor · resultado (Dentro/Fuera de rango) · registrado
              por · observaciones.</recent_table>
            <row_click>Detalle M6.x (lectura completa + evidencia
              fotográfica).</row_click>
          </segment>
          <segment id="types" label="Tipos de medición">
            <list>nombre · categoría de activo aplicable · unidad ·
              rango (min–max) · frecuencia esperada · estado ·
              # de registros · acciones.</list>
            <actions>
              <action roles="calidad" to="V6.3">Nuevo tipo</action>
            </actions>
          </segment>
        </internal_selector>
        <roles>
          <calidad>CRUD (catálogo + registro — spec).</calidad>
          <mantenimiento>Recibe alertas (Evento 9), consulta; sin
            gestión (spec).</mantenimiento>
          <administrador>Solo lectura.</administrador>
          <tecnico>Sin acceso.</tecnico>
        </roles>
      </tab>
    </view>

    <view id="V6.2" name="Formulario de Certificación" type="formulario">
      <entry_points>V6.1-Certificaciones → "Nueva certificación" /
        fila.</entry_points>
      <sections>
        <section name="General">
          <field>nombre de la certificación/obligación (obligatorio)</field>
          <field>categoría normativa (dropdown compliance_categories —
            CRUD Calidad)</field>
          <field>activo o instalación vinculado: selector de activos (M1)
            O "General — todo el hotel" (ej. permiso de bomberos) — FK
            nullable. <pending>Opción a revisar: reemplazar el desplegable
            por el combobox con buscador (components/asset-combobox.tsx,
            ya usado en V2.2 — Nueva OT) cuando el catálogo crezca; hoy el
            Select de Radix no filtra y dificulta la búsqueda.</pending></field>
          <field>entidad emisora · número de certificado/permiso</field>
          <field>estado derivado (solo lectura — Vigente | Por vencer |
            Vencido)</field>
        </section>
        <section name="Vigencia">
          <field>fecha de emisión · fecha de vencimiento (obligatorias;
            vencimiento &gt; emisión)</field>
          <field>periodicidad de renovación (enum — decisión de
            sesión)</field>
          <field>días de anticipación (lead_days — opcional; vacío =
            usa config global del Evento 8)</field>
        </section>
        <section name="Responsables y documento">
          <field>contratista/entidad responsable de la renovación
            (dropdown providers — Módulo 5, opcional)</field>
          <field>documento adjunto (certificado/permiso vigente —
            Storage bucket `documentos`, prefijo `cumplimiento/`)</field>
          <field>observaciones</field>
        </section>
      </sections>
      <actions_bar>
        <action roles="calidad" to="self">Guardar (INSERT/UPDATE →
          auditoría).</action>
        <action roles="calidad|mantenimiento" to="self">RENOVAR →
          modal de renovación: nueva emisión + nuevo vencimiento + nuevo
          documento (+ responsable opcional) → archiva la vigencia
          actual en certification_history + UPDATE del padre (F6.2) →
          auditoría.</action>
      </actions_bar>
      <history_section>Lista de "Historial de vigencias" (spec history):
        emisión · vencimiento · fecha de renovación · responsable ·
        documento (link) — permite auditar períodos sin certificado
        vigente.</history_section>
      <save_actions>Validación → INSERT/UPDATE (Calidad; Mantenimiento
        solo vía "Renovar") → auditoría → redirige V6.1.</save_actions>
    </view>

    <view id="V6.3" name="Formulario de Tipo de Medición" type="formulario">
      <entry_points>V6.1-Mediciones-Tipos → "Nuevo tipo" / fila (solo
        Calidad).</entry_points>
      <fields>nombre (ej. "pH piscina") · categoría de activo aplicable
        (dropdown categories M1 — filtra los activos seleccionables) ·
        unidad de medida (enum fijo — patrón M4) · valor mínimo y máximo
        aceptables (NUMERIC; max &gt; min) · frecuencia esperada (enum
        informativo: diaria | cada 2 días | semanal | quincensual |
        mensual) · estado (Activo | Inactivo).</fields>
      <save_actions>Validación → INSERT/UPDATE → auditoría. Desactivar
        tipo: conserva registros históricos; deja de aparecer en
        "faltantes" y en el selector de registro.</save_actions>
      <category_rule>Si la categoría de activo (M1) se desactiva, el
        tipo conserva histórico pero NO admite nuevos registros — decisión
        de sesión (cierra el pendiente de measurement_types).</category_rule>
    </view>

    <view id="V6.4" name="Registro de Medición (modal)" type="modal">
      <entry_point>V6.1-Mediciones → "Registrar medición" (solo
        Calidad).</entry_point>
      <fields>tipo de medición (dropdown activos) · activo (selector
        filtrado por la categoría aplicable del tipo — los activos SON
        los puntos de medición, spec design_decision;
        <pending>mismo candidato a combobox con buscador —
        components/asset-combobox.tsx</pending>) · fecha y hora
        (default ahora) · valor medido (numérico, con el rango
        aceptable visible como ayuda) · observaciones (opcional) ·
        evidencia fotográfica (opcional, Storage bucket `documentos`,
        prefijo `cumplimiento/`).</fields>
      <auto_result>Al guardar: result = Dentro de rango | Fuera de rango
        (automático vs min/max del tipo — spec resultado_calculado) ·
        registrado_por = usuario actual (automático).</auto_result>
      <effects>INSERT (module='compliance') → auditoría. Si fuera de
        rango → Evento 9 INMEDIATO (F6.4). SIN vínculo con OT (spec
        wo_link).</effects>
    </view>

    <modal id="M6.1" name="Detalle de medición">
      <content>Solo lectura: fecha/hora, tipo + rango, activo, valor,
        resultado, registrado por, observaciones, evidencia fotográfica
        (descarga).</content>
    </modal>

    <modal id="M6.2" name="Renovar certificación">
      <entry_point>V6.2 → "Renovar" (Calidad o Mantenimiento — F6.2).</entry_point>
      <fields>nueva fecha de emisión (default hoy) · nuevo vencimiento
        (obligatorio, &gt; emisión) · nuevo documento (obligatorio) ·
        responsable (opcional, default el actual) · nota de
        renovación.</fields>
      <effects>INSERT de la vigencia actual en certification_history →
        UPDATE del padre (fechas, documento, responsable, nota) →
        auditoría (state_change con anterior → nuevo) → estado derivado
        recalcula a "Vigente".</effects>
      <rule>El padre actualiza SIEMPRE que pasa por aquí — nunca se
        sobrescribe sin dejar la copia en el historial (spec
        history).</rule>
    </modal>

  </views>

  <flows>

    <flow id="F6.1" name="CRUD de certificaciones">
      <trigger>Calidad → V6.1 "Nueva certificación" / edición (V6.2).</trigger>
      <steps>
        <step>Completa nombre, categoría normativa, activo vinculado (o
          General), entidad emisora, nº, emisión/vencimiento,
          periodicidad (enum), lead_days (opcional → fallback config
          global), responsable (providers M5), documento,
          observaciones.</step>
        <step>Validación (fechas, max &gt; min no aplica aquí: vencimiento
          &gt; emisión) → INSERT/UPDATE → auditoría.</step>
        <step>Estado derivado en cada lectura: Vencido | Por vencer
          (ventana = lead propio o global) | Vigente.</step>
      </steps>
      <rules>Calidad es dueña del catálogo; inactivar/baja lógica;
        editar NO reescribe historial.</rules>
      <tables written="[certifications](BD/certifications.md), [audit_log](BD/audit_log.md)" read="[compliance_categories](BD/compliance_categories.md), [assets](BD/assets.md), [providers](BD/providers.md), [notification_config](BD/notification_config.md) (lead global Evento 8)"/>
    </flow>

    <flow id="F6.2" name="Renovación con historial de vigencias">
      <trigger>V6.2 → "Renovar" (Calidad — o Mantenimiento en modo
        renovación operativa, decisión de sesión).</trigger>
      <steps>
        <step>Registrar nueva emisión + vencimiento + documento (+
          responsable opcional) en M6.2.</step>
        <step>INSERT de la vigencia ACTUAL en certification_history
          (emisión, vencimiento, responsable, documento, fecha_renovación,
          nota) — snapshot ANTES de cambiar.</step>
        <step>UPDATE del padre con los nuevos datos → auditoría (con
          anterior → nuevo) → estado recalcula a Vigente.</step>
        <step>El historial acumula todas las vigencias anteriores:
          permite auditar períodos sin certificado vigente (spec
          history).</step>
      </steps>
      <rules>Nunca sobrescribir el padre sin insertar primero en
        historial. Renovación vencida (fuera de ventana) queda reflejada:
        el histórico permite ver el hueco entre vencimiento anterior y
        nueva emisión.</rules>
      <tables written="[certifications](BD/certifications.md) (padre), [audit_log](BD/audit_log.md)"/>
    </flow>

    <flow id="F6.3" name="Evento 8 — Certificación/permiso por vencer (aviso único)">
      <trigger>pg_cron diario (mismo job que Eventos 3/6/11).</trigger>
      <steps>
        <step>Para cada certificación vigente: ventana = vencimiento −
          (lead_days propio si existe, si no config global del Evento
          8).</step>
        <step>Al ENTRAR en la ventana (hoy &gt; vencimiento − lead y
          certificación sin aviso para esta vigencia) → Evento 8
          INMEDIATO (catálogo T2) con modo AVISO ÚNICO (spec: no
          escalonado): nombre, entidad, vencimiento, días restantes,
          responsable.</step>
        <step>Dedup: UN aviso por certificación POR VIGENCIA (control
          en notification_log por entity_id + fecha de vencimiento
          vigente) — no se repite diariamente como el Evento 6.</step>
      </steps>
      <rules>Audience: Calidad (dueña) + Mantenimiento (renovación
        operativa). Los ya Vencidos NO reenvían (estado visible en
        V6.1); renovar (F6.2) resetea el dedup para la nueva
        vigencia.</rules>
      <tables read="[certifications](BD/certifications.md), [notification_config](BD/notification_config.md) (lead global)" written="[notification_log](BD/notification_log.md)"/>
    </flow>

    <flow id="F6.4" name="Registro de medición y Evento 9 (fuera de rango)">
      <trigger>Calidad → V6.4 "Registrar medición".</trigger>
      <steps>
        <step>Elegir tipo → el selector de activos muestra SOLO los de
          la categoría aplicable del tipo (los activos son los puntos de
          medición — spec).</step>
        <step>Registrar fecha/hora, valor (rango aceptable visible),
          observaciones, evidencia opcional.</step>
        <step>Al guardar: result automático = Dentro de rango | Fuera de
          rango (comparación contra min/max del tipo) · registrado_por =
          usuario actual → INSERT (module='compliance') →
          auditoría.</step>
        <step>Si FUERA DE RANGO → Evento 9 INMEDIATO (spec): correo a
          Mantenimiento (para intervenir) y Calidad (para seguimiento),
          con tipo, activo, valor, rango, fecha.</step>
        <step>SIN vínculo con OT (spec wo_link): si Calidad lo decide,
          crea un Reporte de Daño manual desde M2 — sin referencia
          cruzada automática.</step>
      </steps>
      <tables written="[measurement_records](BD/measurement_records.md), [notification_log](BD/notification_log.md), [audit_log](BD/audit_log.md)" read="[measurement_types](BD/measurement_types.md), [assets](BD/assets.md)"/>
    </flow>

    <flow id="F6.5" name="Indicador de mediciones faltantes (informativo)">
      <trigger>Cálculo en carga de V6.1-Mediciones (sin cron, sin
        correo — decisión de sesión).</trigger>
      <steps>
        <step>Por cada tipo ACTIVO y cada activo de su categoría: ¿existe
          registro dentro de la ventana de su frecuencia esperada? (tipo
          activo con registro reciente o nunca registrado).</step>
        <step>Badge "mediciones faltantes: N" + lista desplegable
          (tipo · activo · última medición · atraso).</step>
      </steps>
      <rules>SOLO indicador en UI (spec lo marca "informativo"; Evento 13
        descartado en sesión). Los tipos desactivados o con categoría
        inactiva salen del cálculo.</rules>
      <tables read="[measurement_types](BD/measurement_types.md), [measurement_records](BD/measurement_records.md), [assets](BD/assets.md), [categories](BD/categories.md)"/>
    </flow>

  </flows>

  <cross_module_flows>
    <cross from="M1 (Activos)">
      <item>certifications.asset_id → FK opcional a la ficha del activo
        ("General" = NULL — ya enlazado en M1); el Módulo 1 solo recibe
        lectura (posible resumen futuro en ficha).</item>
      <item>measurement_types.category_id → categorías de activo (M1)
        filtran los puntos de medición; measurement_records.asset_id →
        el activo ES el punto (spec design_decision).</item>
      <item>Desactivar categoría M1 → sus tipos quedan con histórico y
        sin nuevos registros (decisión de sesión — F6.3).</item>
    </cross>
    <cross from="M2 (OTs)">
      <item>Sin vínculo OT ↔ medición (spec wo_link): Reporte de Daño
        manual si Calidad lo decide.</item>
      <item>La renovación de certificación PUEDE crear una OT (Mantenimiento
        coordina: OT correctiva/preventiva manual o plan — la spec NO
        automatiza: "la coordinación de renovación es manual").</item>
      <item>Evento 9 lleva link al activo → ficha V1.3 (no a
        OT).</item>
    </cross>
    <cross from="M5 (Proveedores)">
      <item>certifications.provider_id → contratista/entidad responsable
        de la renovación (dropdown del catálogo M5); la ficha del
        proveedor puede listar certificaciones a cargo (lectura
        futura).</item>
    </cross>
    <cross from="T1/T2/T3">
      <item>T1: permissions de la spec aplicadas (Calidad dueña;
        Mantenimiento renovación operativa; Admin lectura; Técnico sin
        acceso).</item>
      <item>T2: Evento 8 (aviso ÚNICO, lead configurable — ya en
        catálogo/notification_config) y Evento 9 (inmediato dual
        Mantenimiento+Calidad).</item>
      <item>T3: audit_log con module='compliance' (CHECK existente) para
        certificaciones, historial, tipos y registros.</item>
    </cross>
  </cross_module_flows>

  <notifications>
    <event number="8" type="inmediato (modo AVISO ÚNICO)" channel="push + email">
      <trigger>pg_cron diario, al ENTRAR en la ventana de anticipación de
        una certificación (F6.3).</trigger>
      <content>"Certificación/permiso por vencer": nombre, entidad
        emisora, nº, vencimiento, días restantes, responsable. Días de
        anticipación: lead_days por certificación o config global del
        evento (spec: configurable por certificación/global).</content>
      <audience>Calidad + Mantenimiento.</audience>
      <dedup>UN aviso por certificación POR VIGENCIA (no escalonado, no
        diario — spec). Renovar resetea el dedup de la nueva
        vigencia.</dedup>
    </event>
    <event number="9" type="inmediato" channel="push + email">
      <trigger>Al guardar un registro con result = Fuera de rango
        (F6.4).</trigger>
      <content>"Medición fuera de rango": tipo, activo (con link a
        ficha), valor medido, rango aceptable min–max, fecha/hora,
        registrado por.</content>
      <audience>Mantenimiento (intervenir) + Calidad (seguimiento) —
        spec out_of_range_notification.</audience>
      <dedup>Sin dedup: cada medición fuera de rango notifica
        (inmediato).</dedup>
    </event>
    <not_triggered>
      <item>Mediciones faltantes: SIN correo — solo indicador en UI
        (decisión de sesión; Evento 13 descartado).</item>
      <item>Alta/edición de certificaciones y tipos: sin notificación
        propia.</item>
      <item>Renovaciones completadas: sin notificación (la nueva vigencia
        simplemente reprograma el Evento 8).</item>
      <item>Vencido ya notificado: no reenvía (avisos son por
        ventana).</item>
    </not_triggered>
  </notifications>

  <supabase_mapping>
    <engine>RLS por rol (patrón T1); pg_cron diario comparte job con
      M3/M4/M5 (Eventos 6, 3, 11 y 8 en la misma corrida); Storage: bucket
      compartido `documentos` (prefijo `cumplimiento/` — política base en
      [04-inventario-flujos](04-inventario-flujos.md) storage_buckets)
      para documentos de certificaciones y evidencia de mediciones; el
      indicador F6.5 se calcula en consulta al cargar la vista (sin
      job).</engine>
    <tables>
      <table file="certifications">Certificación vigente: FK activo
        nullable ("General"), categoría normativa FK, entidad emisora,
        nº, emisión/vencimiento, periodicidad (enum), lead_days
        (nullable → config global), responsable FK providers,
        documento, observaciones, estado derivado — INCLUYE
        certification_history (vigencias anteriores: emisión,
        vencimiento, responsable, documento, fecha_renovación, nota).</table>
      <table file="compliance_categories">Catálogo CRUD (rol Calidad) de
        categorías normativas con las 6 semillas de la spec.</table>
      <table file="measurement_types">Tipo de medición: categoría de
        activo aplicable FK (M1), unidad (enum), min/max, frecuencia
        esperada (informativo), estado.</table>
      <table file="measurement_records">Registro: tipo FK, activo FK
        (punto de medición), fecha/hora, valor, result automático
        (in_range|out_of_range), registrado_por, observaciones,
        evidencia fotográfica.</table>
      <table file="audit_log" shared="true">module='compliance' (CHECK
        existente) para certificaciones, historial, tipos y
        registros.</table>
      <table file="notification_config">Eventos 8 (lead global) y 9
        (ya sembrados).</table>
      <table file="notification_log">Dedup del aviso único (Evento 8) y
        envíos del Evento 9.</table>
      <table file="assets" shared="true">Activo vinculado y puntos de
        medición.</table>
      <table file="categories" shared="true">Categoría aplicable de los
        tipos.</table>
      <table file="providers" shared="true">Responsable de la
        renovación.</table>
    </tables>
    <rls_policy>Calidad: SELECT/INSERT/UPDATE en certifications,
      certification_history, compliance_categories, measurement_types,
      measurement_records (DELETE prohibido — kardex-like); Mantenimiento:
      SELECT + UPDATE limitado a la acción "Renovar" en certifications
      (no crea/edita el catálogo) + SELECT de mediciones + INSERT de
      reportes vía M2 si lo decide; Administrador: SELECT; Técnico: sin
      acceso (ni SELECT) al módulo (spec).</rls_policy>
    <append_only_records>measurement_records y certification_history NO
      se editan ni eliminan (patrón kardex/audit_log): corrección =
      registro nuevo o nueva renovación.</append_only_records>
  </supabase_mapping>

  <open_pending_items>
    <item>Resumen de mediciones en la ficha del activo (V1.3) — lectura
      futura declarada en measurement_records; fuera del alcance de la
      spec actual.</item>
    <item>Semillas de compliance_categories: además de las 6 de la
      spec, confirmar con el hotel normativas locales reales.</item>
    <item>Reportes de cumplimiento — RESUELTO en Módulo 7: reporte
      programado "Estado de certificaciones" (id 3) + widgets
      certification_status / out_of_range_measurements en dashboard;
      ¿reporte programado de mediciones fuera de rango? solo si el hotel
      lo pide (catálogo ampliable — decisión 7.9).</item>
    <item>Evidencia de medición con firma/huellas del laboratorio — no
      está en la spec; solo foto opcional por ahora.</item>
  </open_pending_items>

</module>
```
