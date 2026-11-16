# Módulo 1 — Flujos de Información (Vistas y Flujos de Datos)

Detalle de pantallas y flujos de datos del Módulo 1: Gestión de Activos.
Decisiones de rol resueltas en esta sesión: **CRUD de Categorías → Mantenimiento**, **CRUD de estructura de Ubicaciones → Mantenimiento**.

> **Tablas BD del Módulo 1:** [assets](BD/assets.md) · [locations](BD/locations.md) · [categories](BD/categories.md) · [warranties](BD/warranties.md) · [asset_files](BD/asset_files.md) · [code_counters](BD/code_counters.md) — **compartidas:** [audit_log](BD/audit_log.md) · [notification_log](BD/notification_log.md) · [notification_config](BD/notification_config.md) — **referenciadas (otros módulos):** [users](BD/users.md) · [work_orders](BD/work_orders.md) · [providers](BD/providers.md) · [maintenance_plans](BD/maintenance_plans.md) · [item_asset_links](BD/item_asset_links.md) · [certifications](BD/certifications.md) · [measurement_records](BD/measurement_records.md) · [measurement_types](BD/measurement_types.md)

```xml
<module id="1" name="Gestión de Activos" artifact="flujos">

  <decisions_taken>
    <decision>CRUD de Categorías de activo: rol MANTENIMIENTO. El índice en T2
      Configuración queda como acceso directo de solo consulta para
      Administrador; la edición vive en el Módulo 1 con permisos de
      Mantenimiento.</decision>
    <decision>CRUD de la estructura de ubicaciones (Hotel → Torre → Piso →
      Ubicación): rol MANTENIMIENTO, gestionado desde el árbol del explorador.
      (No estaba definido en la spec; resuelto en esta sesión.)</decision>
    <decision>etapa_de_vida: las fases "Sin garantía" y "En garantía" son
      DUEÑAS DEL MOTOR DE GARANTÍAS (transiciones automáticas, alternan solo
      entre sí); las fases "Operativo", "Por Reparar", "Requiere reemplazo" y
      "Dado de baja" las asigna manualmente Mantenimiento.</decision>
    <decision>La baja de activo ("Dado de baja") es REVERSIBLE por
      Mantenimiento (no terminal): puede volver a asignar una fase manual (ej.
      "Operativo"). El forzado estado_operativo = Inactivo aplica SOLO mientras
      la etapa sea "Dado de baja".</decision>
    <decision>Campos del componente confirmados: nombre + código (autogenerado)
      + estado operativo + vida útil opcional — además de sus propios de
      mini-ficha (garantías, documentación, historial de OTs).</decision>
    <decision>Desactivar ubicación: PERMITIDO cuando no contiene activos (aunque
      tenga historial de OTs); bloqueado solo si tiene activos asociados
      (obligando a reubicarlos primero).</decision>
    <decision>Borrado físico PROHIBIDO en todo el módulo — solo bajas y
      desactivaciones lógicas (confirmado).</decision>
    <decision>Obra civil/áreas comunes: elementos mantenibles sin equipo
      (fachada, verjas, pisos, luminarias, balcones) se modelan como activos-
      CONTENEDOR con categoría nueva "Edificación/Infraestructura" (11.º ítem
      de la semilla), con Planes de PM para pintura/limpieza periódica. Un
      activo por elemento mantenible AGRUPADO (no por pieza individual).</decision>
    <decision>Jerarquía de ubicaciones LIBRE por contención espacial:
      Resort > Modulo100 > Piso (opcional) > Pasillo > Habitación > Baño >
      activos. El nodo Piso es OPCIONAL; los tipos (Torre/Edificio, Pasillo,
      Habitación, Baño, Exterior...) son ETIQUETAS, no una cadena rígida.
      Profundidad máxima: 5 niveles de ubicación contando desde Resort.</decision>
    <decision>Una ubicación PUEDE contener sub-ubicaciones Y activos propios
      al mismo tiempo (ej. Pasillo 1 → habitaciones hijas + su pintura y
      luminarias).</decision>
    <decision>Área común/Exterior puede colgar directamente del nodo
      Torre/Edificio (cuando no aplica el nivel Piso).</decision>
    <decision>Pasillo = Ubicación (área común) con activos dentro — nunca un
      activo.</decision>
    <decision>Importación masiva de activos (CSV/Excel) aprobada — ver flujo
      F1.12. Resuelto en build: SOLO .xlsx (ExcelJS); commit vía edge
      function + RPC con auditoría consolidada.</decision>
    <decision>Etiqueta QR por activo: la ficha genera/imprime un QR con el
      código del activo; la PWA abre la ficha al escanear.</decision>
    <decision>Pestaña "Costos" en la ficha: visible SOLO para Mantenimiento y
      Administrador (Técnico y Calidad no ven costos).</decision>
    <decision>Nuevo EVENTO 12 "Activo al fin de vida útil" (Resumen diario,
      fila editable en T2): se dispara cuando vida_util_restante ≤ 0; NO cambia
      la etapa de vida automáticamente.</decision>
    <decision>Confirmado: el Reporte de Daño (Módulo 2
      <!-- BD: BD/damage_reports.md -->) solo referencia activos
      del catálogo — equipos fuera de scope (ej. secador de pelo) no se
      reportan (scope_rule de la spec).</decision>
  </decisions_taken>

  <!-- ==================================================================== -->
  <!-- DECISIONES DE IMPLEMENTACIÓN (M1 — build)                             -->
  <!-- ==================================================================== -->
  <implementation_notes>
    <status>Front M1 (V1.1–V1.7) implementado y validado: typecheck/lint/build
      en verde (solo 3 warnings preexistentes de shadcn aceptados), smoke de BD
      65/65 y E2E de navegador cubriendo alta (preview+allocate de código,
      garantía con recálculo del motor), ficha completa (8 pestañas), cambio de
      etapa con motivo/auditoría, baja forzada a Inactivo y reversible,
      componentes, documentos (subir/abrir con enlace firmado/eliminar),
      explorador con árbol, filtros, deep-link ?loc=, edición V1.2 y
      gating por rol (Administrador sin edición; Costos solo Mantenimiento/
      Administrador).</status>
    <note key="codigo">Código autogenerado PREFIX-HOTEL-NNN vía
      Edge Function validate-asset-code: acción "preview" (debounce al escribir
      categoría/ubicación) y "allocate" (reserva el consecutivo en code_counters
      solo al guardar; el código manual pasa chequeo de unicidad con
      excludeAssetId en edición).</note>
    <note key="fases_motor">fn_assets_guard rechaza (RAISE) todo UPDATE de
      sesión de usuario que intente entrar a no_warranty/under_warranty; el
      motor (service role, auth.uid() NULL) sí puede transicionar. El INSERT
      de alta SÍ permite under_warranty (F1.1 paso 6). La UI muestra las fases
      de motor deshabilitadas con indicador "(motor)".</note>
    <note key="baja_reversible">Decidido en E2E (confirmado por el usuario):
      al salir de "Dado de baja" hacia una fase manual, el estado operativo
      queda en Inactivo (no se restaura automáticamente); solo se rehabilita el
      control del switch para que Mantenimiento lo cambie a mano. El forzado a
      Inactivo aplica solo mientras etapa = decommissioned (trigger
      fn_assets_guard, sin memoria del estado previo).</note>
    <note key="rpc_etapa">m1_set_life_stage(p_asset_id, p_stage, p_reason):
      exige motivo para decommissioned (GUC app.audit_reason → audit_log);
      acepta solo fases manuales; el motor de garantías nunca se invoca desde
      aquí. Evento 10 (requiere_reemplazo) se dispara desde el front invocando
      asset-replacement-alert tras el cambio de etapa.</note>
    <note key="ubicaciones">Desactivar ubicación: guard
      fn_locations_deactivate_guard cuenta activos en el subárbol (recursivo)
      y bloquea con el conteo en el mensaje; historial de OTs no impide
      (decisión de diseño). Los activos se mueven con cascada auditada
      (fn_assets_cascade_location) cuando cambia location_id de un contenedor.
      Accesos al CRUD (corregido en E2E: el menú solo existía en nodos no-raíz
      y el árbol ocultaba raíces sin hotel — imposible crear la primera
      ubicación): menú ⋮ en TODOS los nodos (en la raíz hotel solo "Agregar
      ubicación"; editar/reubicar/desactivar excluidos allí), botón "Nueva
      ubicación" en la cabecera del panel (crea en raíz, parent_id NULL) y CTA
      "Crear la primera" en el estado vacío; el árbol muestra las raíces
      hotel primero y después el resto. Reactivación: el diálogo de edición
      muestra "Reactivar" cuando la ubicación está inactiva (antes no
      existía UI de reactivación); el form de activo y el selector "Reubicar
      bajo" excluyen inactivas (locationOptions filtra is_active).</note>
    <note key="fk_diferidas">FK hacia tablas M2/M5 (work_orders, providers)
      RESUELTAS en la migración M2 20261010000000: warranties.origin_wo_id →
      work_orders y warranties.provider_id → providers (tabla creada en ese
      mismo módulo; el CRUD de proveedores es alcance de M5). El enlace de
      reportes de daño/OTs se resuelve con work_orders.damage_report_id
      (sin FK circular).</note>
    <note key="import_export">F1.12 importación masiva IMPLEMENTADA: botón
      "Importar" habilitado (solo Mantenimiento) → diálogo wizard de 3 pasos
      (plantilla .xlsx con hoja de instrucciones → subida + prevalidación en
      cliente con previsualización de filas válidas/errores y checkbox "crear
      ubicaciones faltantes" → commit). Solo formato .xlsx (ExcelJS, ya era
      dependencia; CSV descartado por ambigüedad de delimitadores/acentos).
      Commit vía edge function m1-import-assets (requireActor mantenimiento):
      re-valida contra BD, resuelve/crea rutas de ubicación, reserva códigos
      vacíos con la lógica compartida _shared/asset_code.ts e inserta por
      lotes (~200 filas/lote) llamando la RPC m1_import_lot (una transacción
      por lote) que inyecta el GUC app.audit_import para que fn_audit_assets
      NO escriba por fila — auditoría CONSOLIDADA única ("Importación masiva:
      N activos creados", action 'import', actor = usuario vía
      app.actor_user_id). Reporte final descargable .xlsx (Éxitos + Errores
      con número de fila y motivo). Alcance: SOLO activos raíz — sin
      componentes, garantías ni documentación. Exportación (PDF/Excel del
      listado) ya existente desde V1.1.</note>
    <note key="storage">Bucket activos con policies activos_* (INSERT/UPDATE/
      DELETE solo has_role('mantenimiento'); SELECT authenticated). El front
      sube vía POST /storage/v1/object y registra metadatos en asset_files con
      uploaded_by explícito (default auth.uid() en BD — fix
      20261009000003). Abrir usa enlace firmado de 1 hora (token download).
      En dev, el proxy de Vite debe incluir /storage/v1 (además de
      /functions/v1, /rest/v1, /auth/v1).</note>
    <note key="motor_garantias">pg_cron m1-warranty-jobs ('15 2 * * *')
      invoca asset-warranty-engine (recálculo completo) y
      warranty-expiring-digest (Evento 7, dedupe en notification_log).
      dias_anticipacion_garantia = 0 por defecto (fila editable en T2).
      El editor de garantías llama a recalc tras crear/editar para reflejar el
      estado al instante.</note>
    <note key="tabs_m2">Pestaña OTs de la ficha: POBLADA desde M2 (fetch de
      work_orders por asset_id con trigger "abiertas/total", tabla con
      "Abrir OT" que enlaza al alta con ?asset=; badge open_wo_count en el
      explorador). Pestaña Costos: gating de rol intacto (solo Mantenimiento/
      Administrador) y contenido hasta los KPIs agregados del Módulo 7 (los
      costos por OT viven en la pestaña Costos del detalle de OT).</note>
    <note key="auditoria">audit_log poblado por triggers (fn_audit_assets,
      fn_audit_asset_files, fn_audit_* de locations/categories/warranties);
      actor_name se resuelve en el fetch (JOIN users) porque el log guarda
      user_id (NULL = sistema, p. ej. el motor de garantías). Diffs campo
      anterior → nuevo con FIELD_LABELS del front.</note>
    <note key="qr">Etiqueta QR: lib qrcode genera PNG data-URL con el código
      del activo; diálogo de impresión desde la ficha (decisión de
      diseño ya existente en decisions_taken).</note>
  </implementation_notes>

  <!-- ==================================================================== -->
  <!-- VISTAS (PANTALLAS)                                                    -->
  <!-- ==================================================================== -->
  <views>

    <view id="V1.1" name="Explorador de Activos" type="principal">
      <layout>Pantalla dividida: ÁRBOL de ubicaciones a la izquierda + LISTADO
        de activos a la derecha.</layout>
      <tree>
        <nodes>Cadena LIBRE por contención espacial (los tipos son etiquetas):
          Resort (Hotel) → Modulo/Torre-Edificio → [Piso — OPCIONAL] →
          Ubicaciones anidadas (Pasillo, Habitación, Baño, Exterior, Área
          común, Área técnica...) → Activos → Componentes. Un nodo puede
          contener sub-ubicaciones Y activos a la vez. Profundidad máxima: 5
          niveles de ubicación desde Resort. Componente con indicador visual
          distinto al de activo.</nodes>
        <behaviors>
          <item>Click en un nodo filtra el listado a ese subárbol (incluye
            descendientes).</item>
          <item>Cada nodo muestra contador de activos.</item>
          <item>CRUD de nodos (agregar, renombrar, reubicar, desactivar) solo
            Mantenimiento, vía menú contextual.</item>
          <item>Doble click en un activo del árbol abre su ficha (V1.3).</item>
        </behaviors>
      </tree>
      <list>
        <columns>código | nombre | categoría | ubicación (ruta) | criticidad |
          estado operativo | etapa de vida | garantía (badge) | OTs abiertas
          (badge contador) | responsable | última modificación</columns>
        <filters>categoría, torre, piso, ubicación, criticidad, estado
          operativo, etapa de vida, responsable, búsqueda por texto
          (código/nombre)</filters>
        <badges>
          <badge name="ots_abiertas">Contador de OTs no cerradas sobre el activo
            o sus componentes (regla de Módulo 2: múltiples OTs abiertas
            permitidas con indicador).</badge>
          <badge name="garantia">Vigente / Vencida / Ninguna — derivado del
            estado calculado de la garantía más reciente.</badge>
        </badges>
        <row_click>Abre la Ficha del Activo (V1.3).</row_click>
        <actions>Nuevo activo (V1.2) | Importar (F1.12) | Gestionar
          categorías (V1.6) | Exportar listado (PDF/Excel con los filtros
          aplicados — exigido por Módulo 7)</actions>
      </list>
      <roles>
        <mantenimiento>Lectura + alta de activos + CRUD de nodos de ubicación +
          CRUD de categorías.</mantenimiento>
        <tecnico>Solo lectura (sin CRUD de nodos).</tecnico>
        <administrador>Solo lectura.</administrador>
        <calidad>Solo lectura.</calidad>
      </roles>
    </view>

    <view id="V1.2" name="Formulario Nuevo / Editar Activo" type="formulario">
      <entry_points>
        <item>Explorador → botón "Nuevo activo" (ubicación prellenada si hay
          nodo seleccionado en el árbol).</item>
        <item>Ficha → botón "Editar" (modo edición con los mismos campos).</item>
      </entry_points>
      <sections>
        <section name="Identificación">
          <field>nombre (obligatorio)</field>
          <field>código único — preview AUTOGENERADO [PrefijoCategoría]-
            [Ubicación]-[Consecutivo] al elegir categoría + ubicación; EDITABLE;
            validación de unicidad en tiempo real (debounce) y al guardar
            (constraint en DB + respuesta de error legible).</field>
        </section>
        <section name="Clasificación">
          <field>categoría (dropdown solo categorías activas; define el
            prefijo del código)</field>
          <field>criticidad — select FIJO Alta/Media/Baja con los criterios
            como texto de ayuda (no editable como catálogo).</field>
          <note>Al CAMBIAR la categoría de un activo existente, este se mueve
            DINÁMICAMENTE entre los planes de PM por categoría (Módulo 3): sale
            de los planes de la categoría anterior y entra en los de la nueva,
            sin configuración adicional.</note>
        </section>
        <section name="Ubicación">
          <field>selector jerárquico de RUTA LIBRE (Piso opcional): recorrer el
            árbol Resort → Módulo → [Piso] → Ubicación(s) hasta la ubicación
            destino (prellenada desde el árbol cuando aplica).</field>
        </section>
        <section name="Vida útil y operación">
          <field>fecha de puesta en operación (obligatoria)</field>
          <field>vida útil esperada: valor numérico + unidad (años | horas |
            ciclos) + flag "tiene contador de uso"</field>
          <field>responsable del activo (dropdown de usuarios/técnicos,
            OPCIONAL — no bloquea el alta)</field>
          <field>estado operativo (default: Operativo)</field>
          <field>etapa de vida (default: "En garantía" si en el alta se
            registra una garantía vigente, si no "Sin garantía"; luego la
            gobierna el motor de garantías o Mantenimiento — ver
            decisiones_taken)</field>
        </section>
      </sections>
      <save_actions>Validación → INSERT (RLS: solo Mantenimiento) → trigger de
        auditoría (acción "Crear" con snapshot) → redirige a la ficha
        (V1.3).</save_actions>
      <roles>
        <mantenimiento>Alta y edición.</mantenimiento>
        <others>Sin acceso (las vistas de solo lectura no abren el
          formulario).</others>
      </roles>
    </view>

    <view id="V1.3" name="Ficha del Activo" type="detalle">
      <entry_points>Click en fila del listado (V1.1) | doble click en el árbol
        | desde una OT (Módulo 2, link "Ver activo") | desde una medición o
        certificación (Módulo 6).</entry_points>
      <header>Código | nombre | criticidad | estado operativo (badge) | etapa
        de vida (badge) | garantía (badge) | OTs abiertas (contador, click →
        pestaña OTs) | botón Generar QR (etiqueta PNG con el código,
        escaneable desde la PWA) | botones: Editar (V1.2) | Desactivar/
        Baja.</header>
      <tabs>
        <tab name="General">
          <content>Todos los campos de identificación/clasificación en modo
            lectura; ruta de ubicación (clicable, navega al nodo del árbol);
            responsable; documentación resumida.</content>
        </tab>
        <tab name="Estado y Vida Útil">
          <content>
            <item>estado_operativo — switch Operativo/Inactivo (Mantenimiento).
              Si etapa = "Dado de baja", el campo aparece BLOQUEADO en Inactivo
              (lo impone el trigger, no editable).</item>
            <item>etapa_de_vida — select con las fases; "Sin garantía" y "En
              garantía" deshabilitadas si son dueño del motor (mostradas con
              candado + fecha de cálculo); las demás editables por
              Mantenimiento.</item>
            <item>vida útil: barra de progreso consumida/restante (calculadas),
              valor esperado + unidad.</item>
            <item>contador de uso (si aplica): valor actual, SOLO LECTURA aquí —
              lo actualiza el técnico dentro de una OT preventiva (Módulo
              3).</item>
            <item>fecha de puesta en operación editable.</item>
          </content>
        </tab>
        <tab name="Componentes">
          <content>
            Lista anidada de componentes: código | nombre | estado operativo |
            OTs abiertas | garantías vigentes. Acciones (solo Mantenimiento):
            "Nuevo componente" (V1.4), editar, ver mini-ficha.
            Click en componente → abre su ficha con el MISMO layout que V1.3
            (mismas pestañas, datos propios de historial/garantías/documentación;
            la ubicación aparece heredada y NO editable).</content>
        </tab>
        <tab name="Garantías">
          <content>
            Tabla de garantías <!-- BD: warranties.md --> (tipo
            Compra/Reparación, proveedor, inicio,
            vencimiento, cobertura, estado calculado Vigente/Vencida, documento).
            Acciones (solo Mantenimiento): "Nueva garantía" (V1.5), editar,
            ver OT origen (si existe, link a Módulo 2). Indicador "origen: OT
            #N reabierta" cuando aplica.</content>
        </tab>
        <tab name="Documentación">
          <content>Grid de archivos (manual técnico, ficha, foto, factura):
            miniatura/ícono, nombre, fecha, subido por. Subida y borrado solo
            Mantenimiento; descarga los 4 roles. La ficha y la documentación
            quedan cacheadas para consulta OFFLINE en la PWA (service worker) —
            el técnico en campo las ve sin señal.</content>
        </tab>
        <tab name="OTs">
          <content>Lista de OTs históricas y abiertas de este activo y sus
            componentes (columnas: número, tipo, prioridad, estado, técnicos,
            fecha programada/creación) — vista filtrada del listado general de
            OTs (Módulo 2), con link "Abrir OT".</content>
        </tab>
        <tab name="Costos">
          <content>Costo acumulado del activo: mano de obra interna + repuestos
            consumidos + costo de servicio externo, con desglose por OT y
            evolución en el tiempo. Visible SOLO para Mantenimiento y
            Administrador — Técnico y Calidad no ven esta pestaña. Es la misma
            base de los KPIs "Costo por activo/categoría/ubicación"
            (Módulo 7).</content>
        </tab>
        <tab name="Historial">
          <content>Línea de tiempo del LOG DE AUDITORÍA filtrada por este activo
            (vista embebida T3: fecha, usuario, acción, detalle campo anterior →
            nuevo, motivo). Solo lectura.</content>
        </tab>
      </tabs>
      <roles>
        <mantenimiento>Todas las pestañas con edición.</mantenimiento>
        <tecnico>Lectura de todas EXCEPTO Costos; sin edición; Historial
          visible (su OT incluida).</tecnico>
        <administrador>Lectura de todas, incluye Costos, Historial y listado
          general del log.</administrador>
        <calidad>Lectura de todas excepto Costos.</calidad>
      </roles>
    </view>

    <view id="V1.4" name="Formulario de Componente" type="modal">
      <entry_point>Ficha → pestaña Componentes → "Nuevo componente" (o editar
        componente existente).</entry_point>
      <fields>nombre (obligatorio) | código (autogenerado [códigoPadre]-C#,
        editable, único) | estado operativo (default Operativo) | fecha de
        puesta en operación y vida útil (opcionales) | descripción.</fields>
      <inheritance>Ubicación HEREDADA del activo padre — mostrada como solo
        lectura.</inheritance>
      <save_actions>INSERT (solo Mantenimiento) → auditoría → el componente
        aparece en la lista y en el árbol bajo su padre.</save_actions>
      <note>Documento generado y garantías se cargan después desde la
        mini-ficha del componente (pestañas iguales a V1.3).</note>
    </view>

    <view id="V1.5" name="Formulario de Garantía" type="modal">
      <entry_point>Ficha (activo o componente) → pestaña Garantías → "Nueva
        garantía".</entry_point>
      <fields>
        <field>tipo: Compra | Reparación (catálogo simple extensible)</field>
        <field>proveedor otorgante: selector del catálogo de Proveedores/
          Contratistas (Módulo 5) o texto libre (fabricante/taller)</field>
        <field>fecha de inicio | fecha de vencimiento (validación inicio ≤
          vencimiento)</field>
        <field>cobertura: piezas | mano de obra | ambas</field>
        <field>observaciones (texto libre) | documento adjunto (Storage)</field>
        <field>estado calculado — SOLO LECTURA (Vigente/Vencida según fecha
          actual vs. vencimiento, recalculado por motor/cron)</field>
      </fields>
      <save_actions>INSERT (solo Mantenimiento) → auditoría (Crear) → dispara
        recálculo de etapa_de_vida si corresponde (F1.4) → queda incluida
        en el próximo resumen diario del Evento 7.</save_actions>
    </view>

    <view id="V1.6" name="CRUD de Categorías de Activo" type="catalogo">
      <entry_point>Explorador → botón "Gestionar categorías" (Módulo 1).</entry_point>
      <list_columns>nombre | descripción | código corto (prefijo) | estado
        (Activa/Inactiva) | contador de activos asociados</list_columns>
      <form_fields>nombre | descripción | código corto (prefijo, único) |
        estado activa/inactiva</form_fields>
      <rules>
        <item>NO existe borrado físico — solo desactivar (los activos existentes
          conservan su categoría; una categoría inactiva no es seleccionable en
          nuevas altas).</item>
        <item>Cambiar el prefijo NO recodifica activos existentes (el código es
          propio de cada activo y editable); solo afecta a futuras altas.</item>
        <item>Semilla inicial: los 10 ítems de la spec se cargan como migración
          de arranque.</item>
      </rules>
      <roles>
        <mantenimiento>CRUD completo.</mantenimiento>
        <administrador>Solo lectura (y acceso directo desde T2 Configuración,
          solo consulta).</administrador>
        <others>No acceden a la pantalla; el dropdown de categorías en V1.2
          muestra las activas.</others>
      </roles>
    </view>

    <view id="V1.7" name="Gestión de Estructura de Ubicaciones" type="inline">
      <entry_point>Árbol del Explorador → menú contextual de nodo
        (Mantenimiento).</entry_point>
      <forms>
        <form>Crear nodo: tipo del PADRE permitido = Hotel | Torre/Edificio |
          Piso | otra Ubicación (anidamiento libre). Nombre + etiqueta/tipo
          (Torre/Edificio, Piso, Pasillo, Habitación, Baño, Exterior, Área
          común, Área técnica — catálogo de etiquetas extensible), código de
          habitación si aplica. Validación de profundidad: máx. 5 niveles de
          ubicación desde Resort. Un nodo puede contener activos propios Y
          sub-ubicaciones a la vez.</form>
        <form>Editar: renombrar, cambiar etiqueta, reubicar (arrastrable o
          selector de padre, respetando reglas de tipo y profundidad; al
          mover, activos y sub-ubicaciones descienden con él).</form>
        <form>Desactivar: PERMITIDO si no contiene activos (el historial de OTs
          NO impide desactivar); BLOQUEADO si contiene activos o sub-ubicaciones
          con activos (mostrar contadores y sugerir reubicar primero). Sin
          borrado físico.</form>
      </forms>
      <audit>Toda operación queda en el log (Crear/Modificar/Desactivar) con
        entidad "Ubicación ...".</audit>
    </view>

  </views>

  <!-- ==================================================================== -->
  <!-- FLUJOS DE DATOS                                                       -->
  <!-- ==================================================================== -->
  <flows>

    <flow id="F1.1" name="Alta de activo">
      <trigger>Usuario Mantenimiento presiona "Nuevo activo" (V1.2).</trigger>
      <steps>
        <step>1. Selecciona ubicación (obligatoria, prellenada si vino del
          árbol) y categoría → el sistema muestra el PREVIEW del código
          autogenerado [Prefijo]-[Ubicación]-[Consecutivo].</step>
        <step>2. Completa identificación, criticidad, vida útil, responsable
          (opcional) y, si desea, registra una garantía de compra en línea con
          la alta.</step>
        <step>3. El código es editable; cada cambio valida unicidad
          (debounce).</step>
        <step>4. Guardar → validación de reglas → INSERT en DB con RLS
          (solo rol Mantenimiento) → constraint de unicidad de código como
          respaldo final. <!-- BD: assets.md + code_counters.md --></step>
        <step>5. TRIGGER PG escribe auditoría (acción "Crear", snapshot de
          valores).</step>
        <step>6. etapa_de_vida = "En garantía" si se registró garantía vigente
          en la alta, si no "Sin garantía". estado_operativo = "Operativo".</step>
        <step>7. Redirección a la Ficha (V1.3).</step>
      </steps>
      <notifications>Ninguna.</notifications>
    </flow>

    <flow id="F1.2" name="Edición de activo">
      <trigger>Mantenimiento → Ficha → "Editar" (V1.2 en modo edición).</trigger>
      <steps>
        <step>1. Edita campos permitidos (nombre, código con unicidad,
          categoría, criticidad, ubicación, vida útil, responsable).</step>
        <step>2. Guardar → UPDATE (RLS Mantenimiento).</step>
        <step>3. TRIGGER PG detecta cambios por campo y registra en auditoría:
          entidad + "Modificar" + cada campo con valor anterior → nuevo (una
          entrada por campo modificado, o una entrada con detalle múltiple —
          decisión técnica: una entrada con JSON de cambios).</step>
        <step>4. Si cambia la UBICACIÓN → los componentes heredan el nuevo
          valor automáticamente (UPDATE en cascada lógica, también
          auditado).</step>
        <step>5. Si cambia la CATEGORÍA → NO se modifica el código existente;
          el nuevo prefijo solo aplica a códigos futuros autogenerados.</step>
      </steps>
      <notifications>Ninguna por edición simple.</notifications>
    </flow>

    <flow id="F1.3" name="Cambio de estado operativo y etapa de vida">
      <trigger>Mantenimiento desde la pestaña "Estado y Vida Útil" (V1.3).</trigger>
      <branches>
        <branch name="estado_operativo">
          <rule>Alterna Operativo ↔ Inactivo libremente, EXCEPTO cuando
            etapa_de_vida = "Dado de baja": el campo queda forzado a Inactivo
            (trigger de DB lo re-imposta en cada UPDATE — imposible
            sobreescribir).</rule>
          <audit>Cambio de estado con anterior → nuevo.</audit>
        </branch>
        <branch name="etapa_de_vida_manual">
          <rule>Mantenimiento asigna: Operativo | Por Reparar | Requiere
            reemplazo | Dado de baja. Las fases "Sin garantía"/"En garantía"
            NO se asignan manualmente (deshabilitadas con indicador de origen
            automático).</rule>
          <effects>
            <effect name="requiere_reemplazo">Al pasar a "Requiere reemplazo":
              Edge Function dispara EVENTO 10 "Activo requiere reemplazo" →
              correo INMEDIATO (destinatarios según tabla T2).
              <!-- BD: notification_config.md (evento 10) --></effect>
            <effect name="dado_de_baja">Al pasar a "Dado de baja": trigger
              fuerza estado_operativo = Inactivo en la misma operación. La baja
              es REVERSIBLE: Mantenimiento puede volver a asignar una fase
              manual (ej. "Operativo"); el forzado a Inactivo aplica SOLO
              mientras la etapa sea "Dado de baja" y el control de
              estado_operativo se rehabilita al salir de la baja.</effect>
          </effects>
          <audit>Cambio de etapa con anterior → nuevo (siempre).</audit>
        </branch>
        <branch name="etapa_de_vida_automatica">
          <rule>Motor de garantías (F1.4) alterna "Sin garantía" ↔ "En
            garantía"; NUNCA sobrescribe una fase manual (si la etapa actual es
            Operativo/Por Reparar/Requiere reemplazo, el motor no
            toca).</rule>
        </branch>
      </branches>
    </flow>

    <flow id="F1.4" name="Motor de garantías: recálculo de estados">
      <triggers>
        <item>Al crear/editar/vencer una garantía (Edge Function de
          garantías).</item>
        <item>pg_cron diario (recálculo general).</item>
      </triggers>
      <steps>
        <step>1. Recalcular estado_calculado de cada garantía: Vigente si
          hoy ≤ vencimiento, si no Vencida.</step>
        <step>2. Si etapa_de_vida ∈ {Sin garantía, En garantía}:
          con al menos 1 garantía Vigente → "En garantía"; con 0 Vigentes y etapa
          actual = "En garantía" → "Sin garantía".</step>
        <step>3. Disparar EVENTO 7 "Garantía por vencer" (Resumen diario, días
          de anticipación = parámetro GLOBAL de Configuración, default 0):
          aviso ÚNICO por garantía (tabla de deduplicación de avisos
          <!-- BD: notification_log.md -->), solo
          garantías con estado Vigente; recalculado si la garantía se
          edita/extiende.</step>
      </steps>
      <audit>Los cambios automáticos de etapa quedan en auditoría con usuario
        = "sistema".</audit>
    </flow>

    <flow id="F1.5" name="Garantía generada al cerrar OT (entrada desde Módulo 2)">
      <trigger>Edge Function de CIERRE de OT (Módulo 2). El campo
        genera_o_extiende_garantia es OBLIGATORIO en el formulario de cierre
        (Sí/No, default No — una correctiva sin garantía se cierra con "No");
        F1.5 solo dispara cuando la respuesta es "Sí".</trigger>
      <steps>
        <step>1. Se crea registro en tabla de garantías
          <!-- BD: warranties.md -->: tipo "Reparación",
          activo/componente = el de la OT, proveedor otorgante = contratista si
          la OT fue "Ejecutada por: Contratista externo" (tomado del campo de
          la OT), fechas según respuesta del formulario de cierre, origen =
          FK a la OT.</step>
        <step>2. Dispara F1.4 (posible transición "Sin garantía" → "En
          garantía" y agendamiento del Evento 7).</step>
        <step>3. Auditoría: "Crear" en entidad Garantía, con referencia a la
          OT.</step>
      </steps>
      <reopening_rule>Si la OT se REABRE: la garantía NO se elimina; queda
        marcada "OT origen reabierta". Al volver a CERRAR, el formulario de
        garantía se abre en modo EDICIÓN del registro existente (nunca se
        duplica).</reopening_rule>
    </flow>

    <flow id="F1.6" name="Navegación y cruces de datos entre vistas">
      <paths>
        <path>Árbol (nodo) → filtra Listado → click fila → Ficha → "Editar" →
          Formulario → guardar → vuelve a Ficha.</path>
        <path>Ficha → pestaña OTs → "Abrir OT" → Módulo 2 (contexto del activo
          conservado para el botón "volver").</path>
        <path>OT (Módulo 2) → link "Ver activo/componente" → Ficha
          (V1.3).</path>
        <path>Ficha → pestaña Garantías → "Nueva garantía" → modal → guardar →
          refresca badges de etapa/garantía en la misma ficha.</path>
        <path>Ficha → pestaña Componentes → click componente → mini-ficha
          (mismo layout, datos propios, ubicación heredada solo
          lectura).</path>
        <path>Explorador → "Gestionar categorías" → CRUD (V1.6) → cerrar →
          refresca dropdowns y preview de códigos.</path>
      </paths>
    </flow>

    <flow id="F1.7" name="Alta de componente">
      <trigger>Mantenimiento → Ficha → Componentes → "Nuevo componente"
        (V1.4).</trigger>
      <steps>
        <step>1. Formulario: nombre, código con preview autogenerado
          [códigoPadre]-C# (editable, único), estado operativo.</step>
        <step>2. Ubicación se HEREDA del padre (solo lectura en el
          formulario).</step>
        <step>3. INSERT → auditoría (Crear) → el componente aparece en la lista
          y en el árbol.</step>
        <step>4. Desde ese momento, el componente tiene historial de OTs,
          garantías y documentación PROPIOS (mini-ficha con layout de
          V1.3).</step>
      </steps>
      <ot_link>Una OT puede apuntar al activo O a un componente específico —
        el selector de activo en la OT (Módulo 2) incluye el desglose
        anidado.</ot_link>
    </flow>

    <flow id="F1.8" name="Carga de documentación">
      <trigger>Ficha → Documentación → subir archivo (o drag&amp;drop).</trigger>
      <steps>
        <step>1. Subida a Supabase Storage (bucket privado por entidad:
          activos/ y activos/componentes/), con tipo y tamaño validados en
          cliente.</step>
        <step>2. INSERT en tabla de archivos <!-- BD: asset_files.md -->
          (FK a activo o componente, metadatos: nombre, fecha, subido
          por).</step>
        <step>3. Auditoría: "Crear" en entidad "Documento del activo ...".</step>
        <step>4. Lectura/descarga: los 4 roles (el Técnico necesita manuales
          en campo desde la PWA); escritura/borrado: solo Mantenimiento.</step>
      </steps>
    </flow>

    <flow id="F1.9" name="Vida útil y contador de uso">
      <calculations>
        <calc>vida_util_consumida = hoy − fecha de puesta en operación (para
          unidad en años) — calculado al leer, no almacenado.</calc>
        <calc>vida_util_restante = vida_util_esperada − consumida — calculado
          al leer; si ≤ 0 el listado/ficha muestra indicador de "fin de vida
          alcanzado".</calc>
        <calc>Para activos con contador (horas/ciclos): la consumida por fecha
          NO aplica de forma útil; se muestra el CONTADOR ACTUAL contra la
          vida útil esperada en unidades de uso.</calc>
      </calculations>
      <counter_update>El contador solo se actualiza MANUALMENTE por el técnico
        DENTRO de una OT (Módulo 3, pestaña de ejecución de la OT preventiva) —
        nunca desde la ficha. La ficha muestra el valor en solo lectura con
        fecha de última actualización.</counter_update>
      <downstream>Alimenta el KPI "Activos próximos a fin de vida útil"
        (Módulo 7) y el listado "Vida útil consumida/restante" para presupuesto
        CAPEX.</downstream>
      <end_of_life_alert>Cuando vida_util_restante ≤ 0 (calculado al leer o por
        pg_cron diario): se dispara EVENTO 12 "Activo al fin de vida útil"
        (Resumen diario, fila editable en T2). NO cambia la etapa de vida
        automáticamente — Mantenimiento decide pasar a "Requiere reemplazo"
        (lo que a su vez dispara el Evento 10, inmediato).</end_of_life_alert>
    </flow>

    <flow id="F1.10" name="CRUD de categorías">
      <trigger>Mantenimiento → Explorador → "Gestionar categorías" (V1.6).</trigger>
      <steps>
        <step>1. Alta/edición: nombre, descripción, prefijo (único), estado
          activa/inactiva.</step>
        <step>2. Desactivar = UPDATE de estado (sin borrado físico); los
          activos existentes conservan la categoría.</step>
        <step>3. Auditoría de cada operación.</step>
        <step>4. Efecto inmediato: el dropdown de V1.2 y el preview de códigos
          reflejan el cambio.</step>
      </steps>
      <seed>La migración de arranque inserta los 11 ítems: los 10 de la
        semilla de la spec + "Edificación/Infraestructura" (obra civil y áreas
        comunes).</seed>
    </flow>

    <flow id="F1.11" name="CRUD de estructura de ubicaciones">
      <trigger>Árbol → menú contextual (solo Mantenimiento, V1.7).</trigger>
      <steps>
        <step>1. Crear/renombrar/reubicar nodos con reglas de jerarquía LIBRE:
          padre permitido = Hotel | Torre/Edificio | Piso | otra Ubicación;
          profundidad máxima 5 niveles desde Resort; etiquetas de tipo
          libres.</step>
        <step>2. Desactivar: PERMITIDO cuando el nodo no contiene activos (el
          historial de OTs no es impedimento); BLOQUEADO si contiene activos o
          sub-ubicaciones con activos (mostrar contadores; el flujo obliga a
          reubicarlos primero). Solo desactivación lógica, sin borrado.</step>
        <step>3. Mover un nodo arrastra TODOS sus descendientes (activos y
          componentes heredan la nueva ruta).</step>
        <step>4. Auditoría de cada operación con la ruta afectada.</step>
      </steps>
      <seed>La migración de arranque inserta el hotel raíz (y torres/pisos que
        defina Mantenimiento en el primer uso).</seed>
    </flow>

    <flow id="F1.12" name="Importación masiva de activos (carga inicial)">
      <trigger>Explorador → botón "Importar" (solo Mantenimiento, V1.1).</trigger>
      <steps>
        <step>1. Descarga de plantilla CSV/Excel con columnas: código (opcional
          — si vacío se autogenera), nombre, categoría, ruta de ubicación
          (texto con separador, ej. "Modulo100/Piso 1/Pasillo 1/Habitación
          101"), criticidad, fecha de puesta en operación, vida útil esperada +
          unidad, responsable, estado operativo, etapa inicial.</step>
        <step>2. Subida → PREVISUALIZACIÓN: filas válidas, filas con error y
          detección de nodos de ubicación inexistentes (opción: crearlos
          automáticamente siguiendo la ruta, o cancelar).</step>
        <step>3. Validaciones: unicidad de códigos (contra la BD y dentro del
          propio archivo), categoría existe y activa, criticidad válida,
          profundidad ≤ 5, fecha válida.</step>
        <step>4. Confirmación → INSERT masivo por lotes (una transacción por
          lote) → auditoría CONSOLIDADA ("Importación masiva: N activos
          creados", con el reporte como referencia).</step>
        <step>5. Reporte de resultado descargable (éxitos + errores con número
          de fila y motivo).</step>
      </steps>
      <limits>Alcance inicial: SOLO activos — no componentes, garantías ni
        documentación (esos se cargan después desde las fichas o en una fase
        2).</limits>
      <notifications>Ninguna.</notifications>
      <implementation_status>IMPLEMENTADO (build): plantilla/parseo/validación
        en cliente (lib/m1-import.ts, ExcelJS), diálogo
        components/activos/import-dialog.tsx, commit vía edge function
        m1-import-assets + RPC m1_import_lot (lotes transaccionales +
        auditoría consolidada action 'import'), reporte .xlsx descargable.
        Ver implementation_notes key="import_export".</implementation_status>
    </flow>

  </flows>

  <!-- ==================================================================== -->
  <!-- FLUJOS CRUZADOS CON OTROS MÓDULOS                                     -->
  <!-- ==================================================================== -->
  <cross_module_flows>
    <flow from="2" to="1" name="OT sobre activo/componente">
      La OT hereda ubicación del activo (que es instancia individual). Al
      cerrarse la OT con garantía → F1.5. El badge "OTs abiertas" del listado y
      de la ficha se alimenta de las OTs no cerradas del activo + sus
      componentes. El campo "afecta_disponibilidad_venta" solo dispara Evento 1
      (correo), sin impacto en este módulo. Cierre de OT con contador →
      actualiza el contador del activo (F1.9, vía Módulo 3).
    </flow>
    <flow from="3" to="1" name="Planes preventivos sobre activos">
      Plan por activo individual: selección estática desde este catálogo. Plan
      por categoría: vinculación DINÁMICA — un alta nueva en una categoría
      (F1.1) queda automáticamente cubierta por los planes de esa categoría sin
      configuración adicional.
    </flow>
    <flow from="4" to="1" name="Repuestos vinculados a activos/categorías">
      Relación N:N ([BD: item_asset_links](BD/item_asset_links.md) —
      Módulo 4) para sugerir repuestos en
      OTs y en checklists. Solo lectura desde este módulo.
    </flow>
    <flow from="5" to="1" name="Contratistas y garantías">
      El "categoría de servicio" del proveedor (Módulo 5) referencia el
      catálogo de categorías de activo (V1.6). Al cerrar OT de contratista con
      garantía, el proveedor otorgante se preselecciona (F1.5).
    </flow>
    <flow from="6" to="1" name="Certificaciones y mediciones">
      Certificaciones: FK opcional a activo (o "general" = todo el hotel) — el
      link va desde la certificación a la ficha. Mediciones: los activos de la
      categoría aplicable SON los puntos de medición (selección desde este
      catálogo, filtrada); la ficha puede mostrar resumen de mediciones futuras
      (extensión, fuera del alcance mínimo).
    </flow>
    <flow from="1" to="7" name="Alimentación de KPIs">
      Activos por etapa de vida | vida útil consumida/restante (próximos a fin
      de vida) | garantías vigentes/por vencer | costo de mantenimiento por
      activo/categoría/ubicación | ranking de activos con más fallas.
    </flow>
  </cross_module_flows>

  <!-- ==================================================================== -->
  <!-- NOTIFICACIONES QUE TOCAN ESTE MÓDULO                                  -->
  <!-- ==================================================================== -->
  <notifications>
    <event id="7" name="Garantía por vencer" mode="Resumen diario">
      Disparada por F1.4. Días de anticipación: parámetro GLOBAL único en
      Configuración (default 0). Aviso ÚNICO por garantía, solo Vigentes,
      deduplicado.</event>
    <event id="10" name="Activo requiere reemplazo" mode="Inmediato">
      Disparada por F1.3 al cambiar etapa a "Requiere reemplazo".</event>
    <event id="12" name="Activo al fin de vida útil" mode="Resumen diario">
      Disparada por F1.9 cuando vida_util_restante ≤ 0. No cambia etapa; fila
      editable en Configuración (T2).</event>
    <event_from_others id="1" name="OT afecta disponibilidad de venta">No
      modifica datos de este módulo; solo contexto.</event_from_others>
  </notifications>

  <!-- ==================================================================== -->
  <!-- MAPEO SUPABASE                                                        -->
  <!-- ==================================================================== -->
  <supabase_mapping>
    <tables>BD/locations.md (árbol jerárquico con parent_id) | BD/assets.md
      (activos y COMPONENTES con parent_id nullable — mismo modelo reutiliza la
      mini-ficha; vida útil como columnas propias, sin tabla separada) |
      BD/categories.md | BD/warranties.md | BD/asset_files.md (metadatos de
      Storage) | BD/code_counters.md (preview y consecutivos por ubicación) |
      BD/audit_log.md (append-only, RLS sin UPDATE/DELETE, poblado por
      triggers) | BD/notification_log.md (deduplicación de avisos, Evento 7) |
      BD/notification_config.md (destinatarios y modo, Eventos 7/10/12) |
      BD/users.md (responsable, autoría, contador) | BD/work_orders.md
      (pestaña OTs y F1.5) | BD/maintenance_plans.md (vínculo dinámico por
      categoría, F1.1) | BD/item_asset_links.md (sugerir repuestos en OT) |
      BD/certifications.md | BD/measurement_records.md | BD/measurement_types.md
      (FK a categories) | BD/providers.md (otorgante de garantía, F1.5)</tables>
    <rls>SELECT: los 4 roles (con alcance completo en este módulo); INSERT/
      UPDATE: solo rol Mantenimiento (patrón de rol por JWT → user_roles);
      DELETE: prohibido en todas las tablas del módulo (bajas lógicas) y en
      audit_log.</rls>
    <edge_functions>asset_warranty_engine (F1.4/F1.5 — cálculo de etapas y
      estados) | warranty_expiring_digest (invocada por pg_cron, Evento 7) |
      asset_replacement_alert (Event 10) | validate_asset_code (unicidad con
      secuencia).</edge_functions>
    <pg_cron>Diario: recálculo de estados de garantías + detección de garantías
      por vencer.</pg_cron>
    <storage_buckets>activos (privado, lectura 4 roles, escritura solo
      Mantenimiento vía política de storage).</storage_buckets>
  </supabase_mapping>

  <!-- ==================================================================== -->
  <!-- PENDIENTES DEL MÓDULO                                                  -->
  <!-- ==================================================================== -->
  <open_pending_items>
    <status>Diseño: Ninguno — los 4 pendientes del módulo fueron resueltos en la
      sesión de spec (ver decisions_taken): baja reversible, campos del componente
      confirmados, desactivación de ubicación sin activos permitida, y borrado
      físico prohibido (solo bajas lógicas).</status>
    <impl_pending>F1.12 RESUELTA: importación masiva implementada (ver
      implementation_notes key="import_export" y flujo F1.12). La exportación
      masiva "por archivo" (descarga del catálogo completo con columnas
      propias) sigue sin implementarse; la exportación del listado filtrado
      a PDF/Excel sí está operativa desde V1.1.</impl_pending>
    <impl_pending>FK hacia M2 y M5 — RESUELTA en M2 (migración
      20261010000000): warranties.origin_wo_id → work_orders,
      warranties.provider_id → providers (la tabla providers se creó en esa
      misma migración; su CRUD de ventana llega con M5). Ver
      implementation_notes key="fk_diferidas".</impl_pending>
  </open_pending_items>

</module>
```
