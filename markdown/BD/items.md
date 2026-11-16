# items

> Módulo 4 — Inventario. Catálogo de repuestos, insumos y suministros técnicos (solo materiales de mantenimiento: fuera amenities, lencería y F&B).
> Flujos: [F4.1](../04-inventario-flujos.md) (CRUD), [F4.3](../04-inventario-flujos.md) (entrada actualiza costo), [V4.2](../04-inventario-flujos.md) (form con sección Stock por bodega).

```sql
CREATE TABLE items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                  TEXT NOT NULL UNIQUE,       -- "REP-0042" autogenerado editable (code_counters, patrón activos)
    name                  TEXT NOT NULL,
    description           TEXT,

    item_category_id      UUID REFERENCES item_categories(id),   -- catálogo CRUD propio de ítem
    unit                  TEXT NOT NULL
                          CHECK (unit IN (
                            'unidad','par','juego','caja','litro','galon','kg','g',
                            'm','m2','rollo','tubo','filtro','otro'
                          )),                          -- ENUM FIJO (decisión de sesión; no texto libre)

    unit_cost             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
                          -- ÚLTIMO COSTO DE COMPRA: solo lo actualiza una Entrada (spec valuation)

    bin_location          TEXT,                        -- ubicación en bodega (estante/zona, opcional)
    preferred_provider_id UUID REFERENCES providers(id),  -- proveedor preferido (Módulo 5)

    image_path            TEXT,                        -- imagen en Storage (bucket `documentos`, prefijo items/ — patrón asset_files)
    technical_sheet_path  TEXT,                        -- ficha técnica adjunta en Storage (mismo bucket/prefijo)

    is_active             BOOLEAN NOT NULL DEFAULT true,

    -- Auditoría (patrón del sistema)
    created_by            UUID REFERENCES users(id),
    updated_by            UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_category ON items (item_category_id);
CREATE INDEX idx_items_active ON items (is_active) WHERE is_active;
```

## Reglas de negocio

- **Costo unitario NO es editable en el form**: lo escribe únicamente una **Entrada** con el costo de esa recepción (F4.3 — "último costo de compra", spec `valuation`).
- **Costo único por ítem** (no varía por bodega — spec `valuation.scope`).
- **Salidas por OT** congelan `unit_cost` en el kardex al momento del consumo (spec `freezing_rule`) — el histórico de la OT no cambia después.
- **Estado Inactivo**: sin nuevas entradas; stock existente sigue visible y devolvible/transferible.
- **Stock mínimo**: NO vive en `items` — es **por ítem y por bodega** en [warehouse_stock](warehouse_stock.md) (spec `item_catalog` + decisión de sesión: se captura en V4.2).
- **Código**: autogenerado `REP-####` vía [code_counters](code_counters.md) (editable, único).
- Sin borrado físico: `is_active = false` (patrón del sistema).

## Relaciones

- **N:N con activos**: [item_asset_links](item_asset_links.md) (activos individuales y categorías — sugerencias en OT y `checklist_item_items` de M3).
- **Existencias**: [warehouse_stock](warehouse_stock.md) (fila por bodega).
- **Movimientos**: [stock_movements](stock_movements.md) (kardex).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Mantenimiento | SELECT/INSERT/UPDATE + inactivar (CRUD — spec permissions_matrix) |
| Técnico / Administrador / Calidad | SELECT (solo consulta) |
