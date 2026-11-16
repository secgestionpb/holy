# Módulo 4 — Flujos de Información (Vistas y Flujos de Datos)

Detalle de pantallas y flujos de datos del Módulo 4: Inventario de Repuestos y Suministros Técnicos.
Decisiones de UI resueltas en esta sesión: **1 ítem "Inventario" con 4 pestañas**, **unidad de medida = enum fijo**, **stock mínimo por bodega en el form del ítem**, **código `REP-0001` vía `code_counters`**.

> **Tablas BD del Módulo 4:** [items](BD/items.md) (incluye stock por bodega) · [item_categories](BD/item_categories.md) · [warehouses](BD/warehouses.md) · [warehouse_stock](BD/warehouse_stock.md) · [stock_movements](BD/stock_movements.md) · [physical_counts](BD/physical_counts.md) (incluye physical_count_items) · [item_asset_links](BD/item_asset_links.md) (incluye item_category_links) — **compartidas:** [code_counters](BD/code_counters.md) · [audit_log](BD/audit_log.md) · [notification_log](BD/notification_log.md) · [notification_config](BD/notification_config.md) — **referenciadas (otros módulos):** [work_orders](BD/work_orders.md) · [providers](BD/providers.md) · [checklist_templates](BD/checklist_templates.md) (checklist_item_items) · [users](BD/users.md) · [categories](BD/categories.md)

```xml
<module id="4" name="Inventario de Repuestos y Suministros Técnicos" artifact="flujos">

  <decisions_taken>
    <decision>Navegación: UN ítem "Inventario" en el grupo lateral →
      V4.1 con CUATRO PESTAÑAS: Ítems | Bodegas | Stock y Kardex | Conteo
      físico (decisión de sesión).</decision>
    <decision>Unidad de medida: ENUM FIJO (unidad, par, juego, caja,
      litro, galón, kg, m, m², rollo, tubo, filtro, otro) — TEXT+CHECK en
      BD, consistente con el patrón del sistema; no texto libre (rompería
      agregaciones de KPIs de consumo).</decision>
    <decision>Stock mínimo POR ÍTEM Y POR BODEGA (spec) se captura en el
      FORMULARIO DEL ÍTEM (V4.2), sección "Stock por bodega": filas
      bodega + cantidad mínima (agregar/quitar bodega).</decision>
    <decision>Código de ítem: autogenerado editable REP-0001 reutilizando
      code_counters (mismo patrón que activos — spec item_catalog).</decision>
    <decision>Alcance de "Stock y Kardex" (pestaña 3): selector interno
      [Stock actual | Kardex] — stock = matriz ítem × bodega con negativos
      resaltados; kardex = historial filtrable de movimientos.</decision>
    <decision>La fila de stock (warehouse_stock) se CREA en la primera
      ENTRADA o AJUSTE del ítem en esa bodega; el mínimo puede
      definirse desde V4.2 aun sin existencias (pre-alta de fila).</decision>
    <decision>Transferencia = par de movimientos ATÓMICO (salida origen +
      entrada destino en una transacción); el costo del ítem no cambia
      (spec).</decision>
    <decision>Conteo físico: al CONFIRMAR genera automáticamente los
      movimientos de Ajuste con motivo "Conteo físico" + referencia al
      conteo (spec physical_counts); sin correo por diferencias; conteo
      confirmado es INMUTABLE (corrección = nuevo conteo o ajuste
      manual).</decision>
    <decision>Stock NEGATIVO permitido (spec): el consumo nunca bloquea
      la OT; Evento 4 inmediato + badge visual en listados; "Pendiente de
      repuesto/aprobación" solo se asigna MANUALMENTE (no automático por
      falta de stock).</decision>
    <decision>Sin órdenes de compra: solo se registra la ENTRADA con
      documento/factura cuando el material ya llegó (spec
      purchase_orders).</decision>
    <decision>Categorías de ítem = catálogo CRUD propio bajo rol
      Mantenimiento (mismo criterio que categorías de activo en M1); su
      árbol es PLANO (lista, no jerárquico como locations).</decision>
    <decision>El picker de "consumibles sugeridos" del Módulo 3
      (checklist_item_items) queda OPERATIVO con la existencia de `items`
      (FK item_id resoluble); asociación no bloqueante (decisión
      M3).</decision>
  </decisions_taken>

  <implementation_notes>
    <note key="front">Front IMPLEMENTADO (V4.1–V4.4): pages/inventario.tsx
      (4 pestañas con ?tab= en URL, filtros + paginación, matriz de stock
      con acciones por fila, kardex con rango/bodega/ítem/tipo/OT y detalle
      M4.4), pages/item-form.tsx (V4.2: código REP-#### con
      check/allocate, costo unitario SOLO lectura — se escribe en la
      Entrada, stock por bodega con mínimos, vínculos N:N de activos y
      categorías de activo, imagen/ficha en bucket documentos, modo
      "Detalle del ítem" SOLO LECTURA para roles sin Mantenimiento),
      pages/conteo.tsx (V4.4: /conteo/nuevo + /conteo/:id con guardas por
      rol/estado), modales components/inventario/ (bodega V4.3,
      categorías de ítem, movimientos M4.1–M4.3, detalle M4.4, diálogos
      de OT consume/return/probables), navegación "Inventario" (ícono
      Warehouse) y accesos desde Configuración → catálogos.</note>
    <note key="integracion_m2">Integración en pages/orden-detalle.tsx:
      tab "Repuestos consumidos" con kardex real de la OT (salidas y
      devoluciones con costo congelado), botones "Agregar consumo" y
      "Devolver" con guardas de rol y estado de la OT (deshabilitados en
      Cerrada o para no asignados), "Ver repuestos probables" (N:N
      item_asset_links / categorías de activo) y fila "Repuestos
      consumidos" en Costos con el neto = salidas − devoluciones (prop
      consumedTotal en CloseDialog).</note>
    <note key="garantias">Escrituras SIEMPRE vía RPC (m4_entry / adjust /
      transfer / consume / return / count_*): un UPDATE directo de qty en
      warehouse_stock lo bloquea fn_m4_stock_guard (400) y el kardex es
      append-only (UPDATE/DELETE → error). Los helpers PATCH/POST del
      front tratan "204 con 0 filas" (filtro RLS silencioso de PostgREST)
      como error de permisos.</note>
    <note key="ui">Detalles de UI: "Agregar bodega" añade secuencialmente
      la siguiente bodega activa (cada clic agrega una fila); los Select
      se renderizan con value='' (nunca undefined) para evitar el warning
      controlled/uncontrolled de Radix; el aviso de stock negativo
      (Evento 4) se muestra ANTES de enviar (F4.6/F4.4); el avance del
      conteo se persiste al salir del campo (PATCH del renglón) y
      Confirmar/Cancelar usan confirm/prompt nativos con motivo.</note>
    <note key="smoke">Verificación: scripts/smoke-m4.py — 102 aserciones
      (RPCs con deltas, RLS/guards, Eventos 3 y 4, kardex append-only,
      bucket documentos, vistas) idempotente con fixtures get-or-create;
      smoke de navegador V4.1–V4.4 + integración OT sin errores de
      consola.</note>
  </implementation_notes>

  <navigation>
    <lateral_menu group="Mantenimiento">
      <item view="V1.1" label="Activos">Módulo 1.</item>
      <item view="V2.1" label="Órdenes de Trabajo">Módulo 2.</item>
      <item view="V2.4" label="Reportes de Daño">Módulo 2.</item>
      <item view="V3.1" label="Preventivo">Módulo 3.</item>
      <item view="V4.1" label="Inventario" active="true">Módulo 4 — abre
        V4.1 (4 pestañas). Formularios/modales: V4.2 ítem, V4.3 bodega,
        M4.1 entrada, M4.2 ajuste, M4.3 transferencia, M4.4 detalle,
        V4.4 conteo físico.</item>
    </lateral_menu>
    <access_by_role>
      <mantenimiento>CRUD de ítems, categorías de ítem y bodegas;
        entradas, ajustes, transferencias y conteos; consume en cualquier
        OT; devoluciones desde cualquier OT; stock y kardex completo
        (permissions_matrix de la spec).</mantenimiento>
      <tecnico>Solo lectura de stock y kardex; consume SOLO dentro de sus
        OT asignadas; devoluciones SOLO desde sus OT asignadas (patrón
        is_assigned_wo).</tecnico>
      <administrador>Solo consulta y reportes — sin movimientos, sin
        ajustes, sin devoluciones (permissions_matrix de la
        spec).</administrador>
      <calidad>Solo consulta (patrón de los demás módulos; no aparece en
        permissions_matrix de M4 pero su rol es transversal de solo
        lectura).</calidad>
    </access_by_role>
  </navigation>

  <views>

    <view id="V4.1" name="Inventario (4 pestañas)" type="principal">
      <entry_point>Menú lateral → "Inventario".</entry_point>

      <tab id="items" label="Ítems">
        <list>
          <columns>código (REP-####) · nombre · categoría de ítem ·
            unidad · costo unitario (último costo) · stock total (suma de
            bodegas, con badge si alguno negativo) · mínimo total ·
            proveedor preferido · estado · acciones</columns>
          <filters>categoría, bodega (existencia en…), estado, con stock
            bajo mínimo, búsqueda texto (código/nombre).</filters>
          <negative_badge>Ítems con stock negativo en cualquier bodega se
            marcan visualmente (spec negative_stock.visual).</negative_badge>
          <pagination>20 | 40 | 60 | 100 (patrón del sistema).</pagination>
          <row_click>V4.2 (edición Mant. / lectura otros roles).</row_click>
          <actions>
            <action roles="mantenimiento" to="V4.2">Nuevo ítem</action>
            <action roles="mantenimiento" to="M4.1">Registrar entrada</action>
            <action roles="mantenimiento" to="M4.2">Ajustar</action>
            <action roles="mantenimiento" to="M4.3">Transferir</action>
          </actions>
        </list>
        <empty_state>"Sin ítems registrados" + "Nuevo ítem" (Mantenimiento).</empty_state>
      </tab>

      <tab id="warehouses" label="Bodegas">
        <list>
          <columns>nombre · descripción · responsable · # de ítems con
            stock · estado · acciones</columns>
          <row_click>V4.3 (edición Mant. / lectura otros).</row_click>
          <actions>
            <action roles="mantenimiento" to="V4.3">Nueva bodega</action>
            <action roles="mantenimiento" to="M4.3">Transferir
              (origen→destino)</action>
          </actions>
        </list>
      </tab>

      <tab id="stock_kardex" label="Stock y Kardex">
        <internal_selector>
          <segment id="stock" label="Stock actual">
            <matrix>filas = ítems con existencia o mínimo definido ·
              columnas = bodegas · celda = cantidad (editable solo vía
              modales, no inline) · celda negativa en rojo · ícono si
              qty &lt; mínimo.</matrix>
            <filters>bodega, categoría, solo bajo mínimo, solo
              negativos.</filters>
            <row_actions>Ver ítem (V4.2) · Entrada (M4.1) · Ajuste
              (M4.2) · Transferir (M4.3) — según permisos.</row_actions>
          </segment>
          <segment id="kardex" label="Kardex">
            <table>fecha/hora · tipo (Entrada | Salida por OT | Ajuste |
              Devolución a bodega | Transferencia) · ítem · bodega (+
              destino si transferencia) · cantidad · costo unitario ·
              costo total de línea · referencia (nº OT / factura /
              motivo / conteo) · usuario.</table>
            <filters>fecha (presets Hoy/7d/30d/Personalizado), bodega,
              ítem, tipo de movimiento, nº de OT.</filters>
            <row_action>M4.4 detalle (todos los campos incluyendo el
              snapshot de costo).</row_action>
          </segment>
        </internal_selector>
        <roles>
          <mantenimiento>Ver + acciones.</mantenimiento>
          <tecnico_administrador_calidad>Solo lectura.</tecnico_administrador_calidad>
        </roles>
      </tab>

      <tab id="counts" label="Conteo físico">
        <list>fecha · bodega · alcance (bodega completa / categoría) ·
          responsable · estado (En proceso | Confirmado | Cancelado) · #
          ítems con diferencia · acciones.</list>
        <actions>
          <action roles="mantenimiento" to="V4.4">Nuevo conteo</action>
        </actions>
        <roles>
          <mantenimiento>CRUD de conteos (spec physical_counts.permission
            es exclusivo de Mantenimiento).</mantenimiento>
          <otras>Solo lectura de conteos confirmados/históricos.</otras>
        </roles>
      </tab>

      <header_actions>
        <action roles="mantenimiento" to="M4.1">Registrar entrada</action>
        <action roles="mantenimiento" to="V4.4">Conteo físico</action>
      </header_actions>
    </view>

    <view id="V4.2" name="Formulario de Ítem" type="formulario">
      <entry_points>V4.1-Ítems → "Nuevo ítem" / click en fila.</entry_points>
      <sections>
        <section name="General">
          <field>código (autogenerado REP-####, editable — patrón
            code_counters M1)</field>
          <field>nombre (obligatorio) · descripción</field>
          <field>categoría de ítem (dropdown de item_categories CRUD —
            Mantenimiento)</field>
          <field>unidad de medida (enum fijo — decisión de sesión)</field>
          <field>estado: Activo | Inactivo (default Activo)</field>
          <field>imagen / ficha técnica adjunta (Storage — bucket
            `documentos`, prefijo `items/` — mismo patrón que
            asset_files)</field>
        </section>
        <section name="Costo y compra">
          <field>costo unitario — SOLO LECTURA (se actualiza con cada
            Entrada, spec valuation: último costo de compra)</field>
          <field>proveedor preferido (dropdown de providers — Módulo
            5)</field>
        </section>
        <section name="Stock por bodega">
          <matrix_editable>filas: bodega (dropdown) + stock mínimo
            (numérico ≥ 0) + acciones (quitar) + botón "Agregar bodega"
            + celda de stock actual (solo lectura).</matrix_editable>
          <note>Mínimo definido POR ÍTEM Y POR BODEGA (spec). Puede
            pre-definirse mínimo sin existencias; la fila warehouse_stock
            se materializa con la primera entrada/ajuste o con guardar
            aquí (decisión de sesión).</note>
        </section>
        <section name="Vínculos con activos (repuestos compatibles)">
          <field>activos individuales: selector múltiple (búsqueda por
            código/nombre/ubicación) → item_asset_links</field>
          <field>categorías de activo: checkbox + árbol (M1) →
            item_category_links — DINÁMICO: activos actuales y futuros de
            la categoría quedan vinculados</field>
          <note>N:N — un repuesto sirve a varios activos/categorías
            (spec asset_item_linking). Usos: sugerir en OT (V2.3) y
            asociar a ítems de checklist (checklist_item_items,
            M3).</note>
        </section>
      </sections>
      <save_actions>Validación (nombre, código único, unidades del enum,
        mínimos ≥ 0) → INSERT/UPDATE → auditoría → redirige V4.1
        Ítems.</save_actions>
    </view>

    <view id="V4.3" name="CRUD de Bodega" type="formulario">
      <entry_point>V4.1-Bodegas → "Nueva bodega" / click en fila.</entry_point>
      <fields>nombre (obligatorio, único) · descripción · responsable
        (dropdown users, opcional) · estado (Activo | Inactivo).</fields>
      <save_actions>INSERT/UPDATE (solo Mantenimiento) → auditoría.
        Inactivar NO borra stock existente: bloquea nuevas entradas a esa
        bodega; transferencia de salida posible mientras quede
        stock.</save_actions>
      <rules>Sin borrado físico; bodega con movimientos queda solo
        inactivable (patrón del sistema).</rules>
    </view>

    <view id="V4.4" name="Conteo Físico (listado + flujo)" type="principal">
      <entry_points>V4.1-Conteo físico → "Nuevo conteo" / fila existente.</entry_points>
      <create_screen>
        <fields>bodega (obligatoria) · alcance: bodega COMPLETA o
          CATEGORÍA de ítems (dropdown item_categories) · fecha (default
          hoy) · responsable (default usuario actual).</fields>
        <effect>Al iniciar: congela el stock TEÓRICO por ítem en el
          alcance (snapshot en physical_count_items) → estado "En
          proceso".</effect>
      </create_screen>
      <counting_screen>
        <columns>ítem · código · unidad · teórico congelado (solo
          lectura) · contado (editable) · diferencia (= contado −
          teórico, calculado) · observación (opcional por ítem).</columns>
        <actions>Guardar avance (reanudable) · Cancelar conteo (con
          motivo) · Confirmar (ver M4.2/bottom).</actions>
      </counting_screen>
      <confirm_action>Revisión y confirmación por Mantenimiento → genera
        AUTOMÁTICAMENTE un movimiento de Ajuste POR ÍTEM con diferencia
        ≠ 0, motivo "Conteo físico" y referencia al conteo (spec paso
        6) → estado "Confirmado" → INMUTABLE.</confirm_action>
      <rules>Sin correo por diferencias (spec no_notification —
        Mantenimiento revisa en el flujo). Corrección posterior: nuevo
        conteo o ajuste manual, con registro en log.</rules>
    </view>

    <modal id="M4.1" name="Registrar Entrada de material">
      <entry_point>V4.1-Ítems / Stock → "Registrar entrada" (Mantenimiento).</entry_point>
      <fields>ítem (obligatorio) · bodega destino (obligatoria) ·
        cantidad (&gt; 0) · costo unitario (&gt; 0 — hace el último costo
        de compra) · fecha (default hoy) · proveedor (opcional, default
        proveedor preferido del ítem) · nº factura/documento de
        referencia (obligatorio — spec: "documento de referencia") ·
        nota (opcional).</fields>
      <effects>+ stock (crear/actualizar fila warehouse_stock) → UPDATE
        items.costo_unitario = costo de ESTA entrada (spec valuation) →
        INSERT kardex → auditoría. Sin notificaciones (entrada normal no
        es evento).</effects>
    </modal>

    <modal id="M4.2" name="Ajuste de stock">
      <entry_point>V4.1-Ítems / Stock → "Ajustar" (SOLO Mantenimiento —
        spec movements).</entry_point>
      <fields>ítem · bodega · tipo: incremento | decremento · cantidad
        (&gt; 0) · motivo (OBLIGATORIO, texto libre) · nota.</fields>
      <effects>± stock → INSERT kardex (costo unitario = vigente del
        ítem) → auditoría. Negativo resultante permitido → Evento
        4.</effects>
      <negative_warning>Si el ajuste dejaría el stock negativo, aviso
        previo ("el stock quedará en −N") — confirma igualmente.</negative_warning>
    </modal>

    <modal id="M4.3" name="Transferencia entre bodegas">
      <entry_point>V4.1 (acción desde Stock o Bodegas) — SOLO
        Mantenimiento (spec).</entry_point>
      <fields>ítem · bodega origen (con stock suficiente advertido) ·
        bodega destino · cantidad (&gt; 0) · nota.</fields>
      <effects>Transacción única: INSERT salida en origen + INSERT
        entrada en destino (ambos en kardex, costo unitario intacto —
        spec transfer_rule) → warehouse_stock actualizado en ambas →
        auditoría. Origen sin stock suficiente → advierte pero PERMITE
        (regla de stock negativo es global); si origen queda negativo →
        Evento 4.</effects>
    </modal>

    <modal id="M4.4" name="Detalle de movimiento (kardex)">
      <entry_point>Click en fila del kardex.</entry_point>
      <content>Campos completos en solo lectura: fecha, tipo, ítem
        (+link), bodega origen/destino, cantidad, costo unitario y total,
        costo CONGELADO vs costo vigente (si difiere), referencia (OT /
        factura / motivo / conteo), usuario. Link "Ver OT" cuando la
        referencia es una OT (V2.3).</content>
    </modal>

  </views>

  <flows>

    <flow id="F4.1" name="CRUD de ítems (y categorías de ítem, vínculos)">
      <trigger>Mantenimiento → V4.1-Ítems → "Nuevo ítem" / edición (V4.2).</trigger>
      <steps>
        <step>Código autogenerado REP-#### (code_counters, editable) → datos generales (nombre, categoría, unidad del enum, estado, imagen/ficha).</step>
        <step>Sección "Stock por bodega": agrega filas bodega + mínimo (puede ser sin existencias aún).</step>
        <step>Sección de vínculos: activos individuales (estáticos) y/o categorías de activo (dinámicas) → N:N.</step>
        <step>Guardar → validación (código único, enum, mínimos ≥ 0) → INSERT/UPDATE → auditoría.</step>
      </steps>
      <rules>costo unitario NO es editable aquí (solo por Entrada, F4.3). Inactivar ítem: sin nuevas entradas; salidas/devoluciones de stock existente siguen posibles.</rules>
      <tables written="[items](BD/items.md), [item_asset_links](BD/item_asset_links.md) (incluye item_category_links), [audit_log](BD/audit_log.md)" read="[code_counters](BD/code_counters.md), [categories](BD/categories.md)"/>
      <subflow>Categorías de ítem: catálogo CRUD propio dentro de V4.1-Ítems (dropdown de V4.2 / filtro), solo Mantenimiento, baja lógica, auditoría — CRUD directo sobre [item_categories](BD/item_categories.md).</subflow>
    </flow>

    <flow id="F4.2" name="CRUD de bodegas">
      <trigger>Mantenimiento → V4.1-Bodegas → "Nueva bodega" / edición (V4.3).</trigger>
      <steps>
        <step>Nombre (único), descripción, responsable opcional, estado → INSERT/UPDATE → auditoría.</step>
        <step>Inactivar: bloquea entradas nuevas; stock existente permanece visible y transferible.</step>
      </steps>
      <tables written="[warehouses](BD/warehouses.md), [audit_log](BD/audit_log.md)"/>
    </flow>

    <flow id="F4.3" name="Entrada de material (recepción)">
      <trigger>M4.1 (solo Mantenimiento) — material YA llegó físicamente (spec: sin órdenes de compra).</trigger>
      <steps>
        <step>Registrar ítem, bodega destino, cantidad, costo unitario, fecha, proveedor, nº de factura/documento (obligatorio).</step>
        <step>+ stock: INSERT/UPDATE warehouse_stock (crear fila si no existe — F4.1 decisión).</step>
        <step>UPDATE items.costo_unitario = costo de ESTA entrada (último costo de compra — spec valuation).</step>
        <step>INSERT kardex (tipo Entrada, referencia = factura) → auditoría.</step>
      </steps>
      <tables written="[warehouse_stock](BD/warehouse_stock.md), [items](BD/items.md), [stock_movements](BD/stock_movements.md), [audit_log](BD/audit_log.md)"/>
    </flow>

    <flow id="F4.4" name="Salida por OT (consumo de repuestos)">
      <trigger>Técnico/Mantenimiento en V2.3 → pestaña "Repuestos consumidos" → picker (cross F2.5, Módulo 2).</trigger>
      <steps>
        <step>Selector: ítem + cantidad + bodega de salida (si el ítem tiene stock en varias).</step>
        <step>− stock (warehouse_stock) → INSERT kardex tipo "Salida por OT" con costo unitario CONGELADO al momento del consumo + referencia nº OT (spec movements/audit).</step>
        <step>Si la salida deja el stock de esa bodega NEGATIVO → el consumo se permite SIN bloquear la OT (spec) → Evento 4 "Stock negativo" INMEDIATO (ítem, bodega, OT, stock resultante, instrucción de ajuste) → badge visual en listados.</step>
        <step>El estado "Pendiente de repuesto/aprobación" NO se activa automáticamente: es asignación MANUAL de Mantenimiento (spec wo_impact).</step>
      </steps>
      <rules>Costo congelado = el histórico de la OT no cambia aunque el precio del ítem se actualice después (spec freezing_rule).</rules>
      <tables written="[warehouse_stock](BD/warehouse_stock.md), [stock_movements](BD/stock_movements.md), [notification_log](BD/notification_log.md)" read="[items](BD/items.md), [notification_config](BD/notification_config.md)"/>
      <cross_m2>La fila de consumo se crea en wo_kardex vínculo M2 (referencia a stock_movements desde la OT) — ver F2.5.</cross_m2>
    </flow>

    <flow id="F4.5" name="Devolución a bodega (desde una OT)">
      <trigger>V2.3 → "Repuestos consumidos" → "Devolver" (modal V2.6 / F2.9, Módulo 2) — SOLO desde dentro de una OT (spec returns).</trigger>
      <steps>
        <step>Registrar cantidad a devolver (≤ la consumida — VALIDADO: la RPC calcula el máximo como |qty| − ya devuelto y lo muestra el diálogo en "Máximo a devolver") + motivo.</step>
        <step>+ stock en la bodega de origen de la salida → INSERT kardex tipo "Devolución a bodega" con referencia a la OT y al movimiento de salida original.</step>
        <step>El costo de la devolución = costo CONGELADO del movimiento original (conserva el costo histórico de la OT).</step>
      </steps>
      <rules>Permisos T1: Técnico solo en sus OT asignadas; Mantenimiento en cualquier OT; nunca desde pantalla de inventario (spec).</rules>
      <tables written="[warehouse_stock](BD/warehouse_stock.md), [stock_movements](BD/stock_movements.md)" read="[stock_movements](BD/stock_movements.md)"/>
      <cross_m2>Definido en detalle en F2.9 (Módulo 2); este flujo es su cara de inventario.</cross_m2>
    </flow>

    <flow id="F4.6" name="Ajuste manual de stock">
      <trigger>M4.2 — SOLO Mantenimiento (spec movements).</trigger>
      <steps>
        <step>Registrar ítem, bodega, incremento/decremento, cantidad, motivo OBLIGATORIO.</step>
        <step>Si el resultado queda negativo → aviso previo "quedará en −N" → confirma (permitido).</step>
        <step>± stock → INSERT kardex (costo unitario = vigente) → auditoría.</step>
      </steps>
      <rules>Único movimiento que admite motivo libre obligatorio; los demás usan referencias estructuradas (OT/factura/conteo).</rules>
      <tables written="[warehouse_stock](BD/warehouse_stock.md), [stock_movements](BD/stock_movements.md), [audit_log](BD/audit_log.md)"/>
    </flow>

    <flow id="F4.7" name="Transferencia entre bodegas">
      <trigger>M4.3 — SOLO Mantenimiento (spec movements).</trigger>
      <steps>
        <step>Registrar ítem, bodega origen, bodega destino, cantidad.</step>
        <step>Transacción única: INSERT salida (origen) + INSERT entrada (destino) en kardex — costo unitario INTACTO en ambos (spec transfer_rule).</step>
        <step>Actualizar warehouse_stock en ambas bodegas → auditoría. Origen negativo permitido (advirtiendo) → Evento 4 si ocurre.</step>
      </steps>
      <tables written="[warehouse_stock](BD/warehouse_stock.md), [stock_movements](BD/stock_movements.md), [audit_log](BD/audit_log.md)"/>
    </flow>

    <flow id="F4.8" name="Conteo físico (toma de inventario)">
      <trigger>Mantenimiento → V4.4 → "Nuevo conteo" (spec physical_counts: exclusivo de Mantenimiento).</trigger>
      <steps>
        <step>Crear Conteo: bodega + alcance (bodega completa | categoría de ítems) + fecha + responsable → "En proceso".</step>
        <step>Sistema congela el stock TEÓRICO por ítem del alcance (snapshot en physical_count_items).</step>
        <step>Técnico/Mantenimiento ingresa cantidades CONTADAS (reanudable); el sistema calcula diferencia = contado − teórico por ítem.</step>
        <step>Mantenimiento revisa y CONFIRMA.</step>
        <step>Al confirmar: genera AUTOMÁTICAMENTE un movimiento de Ajuste por cada ítem con diferencia ≠ 0, motivo "Conteo físico" + referencia al conteo → estado "Confirmado".</step>
        <step>Conteo confirmado = INMUTABLE; corrección vía nuevo conteo o ajuste manual, con registro en log (spec immutability). Sin correo por diferencias (spec no_notification).</step>
      </steps>
      <tables written="[physical_counts](BD/physical_counts.md) (incluye physical_count_items), [warehouse_stock](BD/warehouse_stock.md), [stock_movements](BD/stock_movements.md), [audit_log](BD/audit_log.md)"/>
    </flow>

    <flow id="F4.9" name="Evaluación de stock mínimo (diaria)">
      <trigger>pg_cron diario (junto al job de vencimientos de M3).</trigger>
      <steps>
        <step>Comparar warehouse_stock.qty &lt; warehouse_stock.min_stock POR BODEGA (spec minimum_stock_alert).</step>
        <step>Evento 3 "Stock bajo mínimo" → RESUMEN DIARIO agrupado (una notificación con la lista de ítems/bodegas bajo mínimo, por bodega) → notification_log.</step>
        <step>Badge "bajo mínimo" en V4.1 (stock e ítems) durante el día.</step>
      </steps>
      <rules>Sin eventos por entradas que reparen el mínimo (el resumen del día siguiente simplemente no los lista).</rules>
      <tables read="[warehouse_stock](BD/warehouse_stock.md)" written="[notification_log](BD/notification_log.md), [notification_config](BD/notification_config.md) (evento 3)"/>
    </flow>

  </flows>

  <cross_module_flows>
    <cross from="M1 (Activos)">
      <item>Vínculos repuesto ↔ activo/categoría (item_asset_links): F1.? "Ver repuestos probables" en la OT (V2.3) lee estos vínculos; alta de activo en categoría queda vinculada dinámicamente.</item>
      <item>Patrón de código autogenerado editable = code_counters (REP- prefix, mismo mecanismo que activos).</item>
    </cross>
    <cross from="M2 (OTs)">
      <item>F4.4 consumo ← F2.5 (picker de repuestos en la OT); F4.5 devolución ← F2.9 (modal V2.6).</item>
      <item>Evento 4 menciona la OT que originó el consumo (link a V2.3).</item>
      <item>Costo total de la OT (V2.5) suma líneas del kardex con costo congelado, neto de devoluciones.</item>
    </cross>
    <cross from="M3 (Preventivo)">
      <item>checklist_item_items (consumibles presuntos por ítem de checklist) → picker operativo con `items` existente; verificación de disponibilidad antes de ejecutar (F3.4) — no bloqueante.</item>
      <item>Repuestos probables en OT preventiva: mismo mecanismo item_asset_links (V2.3).</item>
    </cross>
    <cross from="M5 (Proveedores)">
      <item>items.proveedor preferido → FK providers (M5); la ENTRADA registra proveedor del documento.</item>
    </cross>
    <cross from="T1/T2/T3">
      <item>T1: permissions_matrix aplicada en cada vista y modal (decisions_taken + access_by_role).</item>
      <item>T2: eventos 3 (stock bajo mínimo, resumen diario por bodega) y 4 (stock negativo, inmediato) — ya en catálogo y notification_config.</item>
      <item>T3: auditoría de ítems, bodegas, todos los movimientos (los kardex ya guardan usuario/fecha/referencia por spec movements.audit) y conteos.</item>
    </cross>
  </cross_module_flows>

  <notifications>
    <event number="4" type="inmediato" channel="push + email">
      <trigger>Cualquier movimiento (salida por OT, ajuste, transferencia
        de salida) que deje warehouse_stock.qty &lt; 0.</trigger>
      <content>"Stock negativo": ítem, bodega, OT que originó el consumo
        (si aplica), stock resultante, instrucción de realizar ajuste
        (spec negative_stock.notification).</content>
      <audience>Mantenimiento.</audience>
      <dedup>Sin dedup — cada movimiento negativo notifica (inmediato).
        El badge visual persiste en listados hasta reparar.</dedup>
    </event>
    <event number="3" type="resumen diario" channel="push + email (resumen)">
      <trigger>pg_cron diario (F4.9).</trigger>
      <content>"Stock bajo mínimo": lista evaluada POR BODEGA de todas
        las filas warehouse_stock con qty &lt; min_stock (spec
        minimum_stock_alert: modo resumen diario).</content>
      <audience>Mantenimiento.</audience>
      <dedup>Una ejecución diaria = un resumen (job_id por día).</dedup>
    </event>
    <not_triggered>
      <item>Entradas normales: sin notificación.</item>
      <item>Devoluciones: sin notificación propia (el evento relevante es el stock, si aplica).</item>
      <item>Conteos con diferencias: EXPLÍCITAMENTE sin correo (spec no_notification).</item>
      <item>Transferencias: solo Evento 4 si dejan negativo.</item>
    </not_triggered>
  </notifications>

  <supabase_mapping>
    <engine>RLS por rol (patrón T1); pg_cron diario para F4.9 (puede
      compartir job con M3); Storage para imágenes/fichas de ítems;
      triggers de stock = aplicación transaccional (advisory/row lock en
      warehouse_stock) más que trigger puro, para mantener kardex y stock
      siempre consistentes.</engine>
    <storage_buckets>BUCKET COMPARTIDO `documentos` (decisión de cierre —
      M4+M5+M6): privado; lectura los 4 roles; escritura y borrado por
      PREFIJO de ruta — `items/` = solo Mantenimiento (patrón asset_files:
      el DELETE de la fila borra el objeto vía Edge Function). Prefijos de
      otros módulos: `proveedores/` (M5) y `cumplimiento/` (M6) — misma
      política base, permiso de escritura según su módulo.</storage_buckets>
    <tables>
      <table file="items">Catálogo: código REP-#### (code_counters),
        nombre, descripción, categoría FK, unidad enum, costo_unitario
        (último costo), ubicación en bodega, proveedor preferido FK,
        estado, imagen/ficha.</table>
      <table file="item_categories">Catálogo CRUD propio de categorías de
        ítem (plano, baja lógica).</table>
      <table file="warehouses">Catálogo de bodegas (nombre único,
        responsable opcional, estado).</table>
      <table file="warehouse_stock">Existencia POR ÍTEM Y POR BODEGA:
        qty + min_stock (mínimo definido por fila — decisión de
        sesión).</table>
      <table file="stock_movements">Kardex: 5 tipos (Entrada, Salida por
        OT, Ajuste, Devolución a bodega, Transferencia), costo
        unitario/total, referencias estructuradas (wo_id / documento /
        motivo / conteo_id), usuario, fecha. Costo congelado en
        salidas.</table>
      <table file="physical_counts">Conteos + physical_count_items
        (teórico congelado, contado, diferencia, observación); ajustes
        generados al confirmar referencian conteo_id en
        kardex.</table>
      <table file="item_asset_links">N:N repuesto ↔ activo y repuesto ↔
        categoría (incluye item_category_links) — con M4 las reglas de
        uso quedan operativas (sugerencias en OT, checklist_item_items).
      </table>
      <table file="code_counters" shared="true">Secuencia REP- para
        códigos de ítem (M1, patrón de activos).</table>
      <table file="work_orders" shared="true">Referencias de salidas y
        devoluciones (kardex.wo_id).</table>
      <table file="providers" shared="true">Proveedor preferido y
        proveedor de entrada.</table>
      <table file="audit_log" shared="true">Ítems, bodegas, ajustes,
        conteos, transferencias.</table>
      <table file="notification_config">Eventos 3 y 4 (ya
        sembrados).</table>
      <table file="notification_log">Envíos de eventos 3 y 4.</table>
      <table file="users" shared="true">Responsable de bodega/conteo,
        autor de movimientos.</table>
    </tables>
    <rls_policy>Mantenimiento: SELECT/INSERT/UPDATE en todo el módulo
      (DELETE prohibido — kardex inmutable, catálogos con baja lógica);
      Técnico: SELECT de items/warehouses/warehouse_stock/stock_movements
      + INSERT de salidas/devoluciones SOLO desde sus OT (is_assigned_wo);
      Administrador/Calidad: SELECT.</rls_policy>
    <kardex_immutability>Los movimientos del kardex NO se editan ni
      eliminan: una corrección es un NUEVO movimiento (ajuste) — patrón
      append-only igual que audit_log.</kardex_immutability>
  </supabase_mapping>

  <open_pending_items>
    <item>Contador de bodega: ¿bodegas con conteos múltiples simultáneos?
      — VALIDADO al implementar: la RPC no los bloquea (la spec no lo
      prohíbe); operativa del hotel: confirmar de a uno por bodega para
      que dos snapshots no se ajusten en cascada.</item>
    <item>Semilla de categorías de ítem — RESUELTA en Módulo 4 (6
      categorías provisorias: Repuestos HVAC, Repuestos eléctricos,
      Químicos de piscina, Lubricantes, Ferretería y General; alta y baja
      lógica desde Inventario → Categorías). El contenido real del hotel
      se carga sobre este catálogo al dar de alta los repuestos.</item>
    <item>Horario del pg_cron de F4.9 — definir junto al job de M3
      (operativa del hotel).</item>
    <item>Exportación de kardex/stock a Excel — RESUELTA en Módulo 7
      (utilitario compartido de export PDF/Excel, F7.3 —
      [07-reportes-kpis-flujos](07-reportes-kpis-flujos.md), decisión
      7.6).</item>
    <item>Picker de consumibles del M3 (checklist_item_items): operativo
      en diseño; su UX de selección se pulirá con datos reales de
      `items`.</item>
  </open_pending_items>

</module>

```
