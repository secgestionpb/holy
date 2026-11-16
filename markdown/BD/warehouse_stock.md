# warehouse_stock

> Módulo 4 — Inventario. Existencia **por ítem y por bodega** (spec `warehouses.stock_model`: "El stock se maneja POR ÍTEM Y POR BODEGA, no como total único").
> Flujos: [F4.3](../04-inventario-flujos.md) (entrada), [F4.4](../04-inventario-flujos.md) (salida), [F4.5](../04-inventario-flujos.md) (devolución), [F4.6](../04-inventario-flujos.md) (ajuste), [F4.7](../04-inventario-flujos.md) (transferencia), [F4.9](../04-inventario-flujos.md) (evaluación de mínimos).

```sql
CREATE TABLE warehouse_stock (
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
    item_id         UUID NOT NULL REFERENCES items(id),
    qty             NUMERIC(12,3) NOT NULL DEFAULT 0,  -- NEGATIVA permitida (spec negative_stock)
    min_stock       NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
                    -- stock mínimo POR ÍTEM Y POR BODEGA (spec; capturado en V4.2)

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (warehouse_id, item_id)
);

CREATE INDEX idx_warehouse_stock_item ON warehouse_stock (item_id);
-- Bajo mínimo (F4.9):
CREATE INDEX idx_warehouse_stock_low ON warehouse_stock (warehouse_id)
    WHERE qty < min_stock;
```

## Reglas de negocio

- **Fila creada** en la primera Entrada/Ajuste del ítem en esa bodega (o al pre-guardar el mínimo desde V4.2 — decisión de sesión).
- **`qty` puede ser negativa** (spec): los consumos nunca se bloquean; el negativo dispara **Evento 4** (inmediato) y badge en listados.
- **`qty < min_stock`** → badge "bajo mínimo" + **Evento 3** (resumen diario por bodega, F4.9).
- Toda variación de `qty` va acompañada de un registro en [stock_movements](stock_movements.md) (kardex) — la consistencia se mantiene en transacción única (stock y kardex siempre juntos).
- Este módulo **no almacena costo**: el costo vive en [items](items.md) (`unit_cost` único) y se congela en el kardex.

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Mantenimiento | SELECT + mutaciones vía flujos de movimientos (F4.3–F4.7) |
| Técnico | SELECT; mutaciones SOLO vía salida/devolución en sus OT asignadas (F4.4/F4.5) |
| Administrador / Calidad | SELECT |
