# Módulo 4: Inventario de Repuestos y Suministros Técnicos

> **Entregables:** spec (abajo) · **Flujos/Interfaces:** [04-inventario-flujos.md](04-inventario-flujos.md)
> **Tablas BD:** [items](BD/items.md) · [item_categories](BD/item_categories.md) · [warehouses](BD/warehouses.md) · [warehouse_stock](BD/warehouse_stock.md) · [stock_movements](BD/stock_movements.md) (kardex) · [physical_counts](BD/physical_counts.md) (incluye physical_count_items) · [item_asset_links](BD/item_asset_links.md) (incluye item_category_links) — **compartidas:** [code_counters](BD/code_counters.md) · [audit_log](BD/audit_log.md) · [notification_config](BD/notification_config.md) (eventos 3 y 4) · [notification_log](BD/notification_log.md) — **referenciadas:** [work_orders](BD/work_orders.md) · [providers](BD/providers.md) · [users](BD/users.md)

```xml
<module id="4" name="Inventario de Repuestos y Suministros Técnicos">
  <scope>
    Gestiona SOLO materiales de mantenimiento (repuestos, insumos, químicos
    técnicos). Quedan fuera amenities, lencería e inventario de F&amp;B.
  </scope>

  <item_catalog> <!-- BD: items, item_categories -->
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

  <warehouses> <!-- BD: warehouses, warehouse_stock -->
    <rule>MÚLTIPLES bodegas (no una sola). Catálogo CRUD de bodegas: nombre,
      descripción, responsable opcional, estado.</rule>
    <stock_model>El stock se maneja POR ÍTEM Y POR BODEGA, no como total
      único.</stock_model>
  </warehouses>

  <valuation> <!-- BD: items.unit_cost, stock_movements.unit_cost -->
    <method>ÚLTIMO COSTO DE COMPRA. El costo unitario del ítem se actualiza con
      cada entrada por compra, tomando el costo de esa última entrada.</method>
    <freezing_rule>Las SALIDAS por OT usan el costo vigente al momento del
      consumo y lo guardan CONGELADO en el movimiento (el costo histórico de una
      OT no cambia si el precio del ítem se actualiza después).</freezing_rule>
    <transfer_rule>Las transferencias entre bodegas no modifican el costo.</transfer_rule>
    <scope>El costo es único por ítem (no varía por bodega).</scope>
  </valuation>

  <movements> <!-- BD: stock_movements (kardex) -->
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

  <negative_stock> <!-- BD: warehouse_stock.qty, stock_movements; Evento 4 -->
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

  <minimum_stock_alert> <!-- BD: warehouse_stock.min_stock; Evento 3 -->
    <notification>Evento "Stock bajo mínimo" → correo, modo RESUMEN DIARIO,
      evaluado POR BODEGA.</notification>
  </minimum_stock_alert>

  <physical_counts> <!-- BD: physical_counts (incluye physical_count_items) -->
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

  <returns> <!-- BD: stock_movements (tipo devolucion) -->
    <ver>Ver reglas completas en módulo 2 → returns_from_wo. Las devoluciones
      SOLO se originan desde dentro de una OT, nunca desde una pantalla
      independiente de inventario.</ver>
  </returns>

  <asset_item_linking> <!-- BD: item_asset_links (incluye item_category_links) -->
    <rule>Un repuesto puede vincularse a CATEGORÍAS de activo y a ACTIVOS
      individuales (relación muchos a muchos). Un mismo repuesto puede servir a
      varias categorías/activos.</rule>
    <uses>
      <use>Sugerir repuestos compatibles al llenar una OT.</use>
      <use>Asociar repuestos a los ítems de un checklist de plan preventivo, de
        modo que la OT preventiva pueda mostrar repuestos probables y verificar
        disponibilidad antes de ejecutar. <!-- BD: checklist_item_items
        (Módulo 3; presunción no bloqueante) --></use>
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
```
