# stock_movements (Kardex)

> Módulo 4 — Inventario. Historial INMUTABLE de todos los movimientos de stock (spec `movements`): fecha, usuario, cantidad, costo y referencia.
> Flujos: [F4.3](../04-inventario-flujos.md) entrada · [F4.4](../04-inventario-flujos.md) salida OT · [F4.5](../04-inventario-flujos.md) devolución · [F4.6](../04-inventario-flujos.md) ajuste · [F4.7](../04-inventario-flujos.md) transferencia · [F4.8](../04-inventario-flujos.md) ajustes por conteo.

```sql
CREATE TABLE stock_movements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    type                TEXT NOT NULL
                        CHECK (type IN ('entrada','salida_ot','ajuste','devolucion','transferencia')),
                        -- 5 tipos de spec movements

    item_id             UUID NOT NULL REFERENCES items(id),
    warehouse_id        UUID NOT NULL REFERENCES warehouses(id),   -- bodega del movimiento (ORIGEN en transferencias)
    destiny_warehouse_id UUID REFERENCES warehouses(id),           -- SOLO transferencias

    qty                 NUMERIC(12,3) NOT NULL,     -- CON SIGNO: entrada(+) devolucion(+) salida_ot(−) transferencia(±) ajuste(±)
    unit_cost           NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
                        -- CONGELADO en salidas/devoluciones (spec freezing_rule); vigente en entradas/ajustes/transferencias
    line_total          NUMERIC(14,2) NOT NULL,     -- |qty| × unit_cost

    -- Referencias estructuradas (spec audit: referencia = nº OT o documento de compra)
    wo_id               UUID REFERENCES work_orders(id),   -- salida_ot / devolucion / (ajuste desde OT)
    document_number     TEXT,                              -- nº factura/documento (OBLIGATORIO en entradas)
    provider_id         UUID REFERENCES providers(id),     -- proveedor de la recepción
    reason              TEXT,                              -- motivo (OBLIGATORIO en ajustes)
    count_id            UUID REFERENCES physical_counts(id),-- referencia cuando el ajuste nace de un conteo

    user_id             UUID NOT NULL REFERENCES users(id),
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(), -- fecha/hora del movimiento
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Integridad por tipo (refuerza las reglas de la spec a nivel BD)
    CHECK (type <> 'entrada'    OR (qty > 0 AND document_number IS NOT NULL AND destiny_warehouse_id IS NULL)),
    CHECK (type <> 'devolucion' OR (qty > 0 AND wo_id IS NOT NULL AND destiny_warehouse_id IS NULL)),
    CHECK (type <> 'salida_ot'  OR (qty < 0 AND wo_id IS NOT NULL AND destiny_warehouse_id IS NULL)),
    CHECK (type <> 'ajuste'     OR (qty <> 0 AND reason IS NOT NULL AND destiny_warehouse_id IS NULL)),
    CHECK (type <> 'transferencia' OR (qty <> 0 AND destiny_warehouse_id IS NOT NULL AND destiny_warehouse_id <> warehouse_id))
);

CREATE INDEX idx_kardex_item_date    ON stock_movements (item_id, occurred_at DESC);
CREATE INDEX idx_kardex_warehouse    ON stock_movements (warehouse_id, occurred_at DESC);
CREATE INDEX idx_kardex_wo           ON stock_movements (wo_id);
CREATE INDEX idx_kardex_type_date    ON stock_movements (type, occurred_at DESC);
CREATE INDEX idx_kardex_count        ON stock_movements (count_id);
```

## Reglas de negocio

- **Kardex append-only**: los movimientos NO se editan ni se eliminan — una corrección es un NUEVO movimiento (ajuste). Patrón igual que `audit_log` (decisión de sesión en `supabase_mapping`).
- **Costo congelado**: `salida_ot` y `devolucion` guardan el `unit_cost` vigente AL MOMENTO del movimiento; el histórico de la OT no cambia si luego se actualiza `items.unit_cost` (spec `freezing_rule`).
- **Transferencias no modifican costo** (spec `transfer_rule`): `unit_cost` = vigente del ítem en ambos extremos del par.
- **Signo de `qty`**: determina el efecto — positivo suma, negativa resta (la variación efectiva en `warehouse_stock` es exactamente `qty`).
- **Eventos**: una `salida_ot` (u otro movimiento) que deje `warehouse_stock.qty < 0` → **Evento 4** inmediato (spec `negative_stock`); el kardex conserva la referencia `wo_id` para el correo.
- **Conteo físico**: al confirmar (F4.8) se insertan filas `type='ajuste'` con `reason='Conteo físico'` y `count_id` referenciado.

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Mantenimiento | SELECT + INSERT (vía F4.3–F4.8); NUNCA UPDATE/DELETE |
| Técnico | SELECT + INSERT SOLO `salida_ot`/`devolucion` de sus OT asignadas (F4.4/F4.5) |
| Administrador / Calidad | SELECT |
