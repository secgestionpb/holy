# physical_counts (incluye physical_count_items)

> Módulo 4 — Inventario. Función de Conteo Físico (toma de inventario) — spec `physical_counts`; exclusiva del rol Mantenimiento.
> Flujos: [F4.8](../04-inventario-flujos.md) (flujo completo de 6 pasos), vista [V4.4](../04-inventario-flujos.md).

```sql
CREATE TABLE physical_counts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
    scope_type      TEXT NOT NULL CHECK (scope_type IN ('warehouse','category')),  -- alcance: bodega completa | categoría
    scope_category_id UUID REFERENCES item_categories(id),   -- requerido si scope_type='category'
    count_date      DATE NOT NULL DEFAULT current_date,
    responsible_id  UUID NOT NULL REFERENCES users(id),

    status          TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','confirmed','cancelled')),
                    -- En proceso | Confirmado | Cancelado (spec fields)

    cancel_reason   TEXT,
    confirmed_by    UUID REFERENCES users(id),
    confirmed_at    TIMESTAMPTZ,

    -- Auditoría (patrón del sistema)
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (scope_type <> 'category' OR scope_category_id IS NOT NULL),
    CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
    CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL)
);

-- Detalle por ítem (spec: teórico, contado, diferencia, observación):
CREATE TABLE physical_count_items (
    count_id        UUID NOT NULL REFERENCES physical_counts(id),
    item_id         UUID NOT NULL REFERENCES items(id),
    theoretical     NUMERIC(12,3) NOT NULL,   -- stock TEÓRICO CONGELADO al iniciar el conteo (spec paso 2)
    counted         NUMERIC(12,3),            -- cantidad contada (NULL = sin contar aún)
    difference      NUMERIC(12,3) GENERATED ALWAYS AS (counted - theoretical) STORED,  -- contado − teórico (spec paso 4)
    observation     TEXT,                     -- observación por ítem

    PRIMARY KEY (count_id, item_id)
);

CREATE INDEX idx_physical_counts_warehouse ON physical_counts (warehouse_id, count_date DESC);
CREATE INDEX idx_physical_counts_status ON physical_counts (status);
```

## Reglas de negocio

- **Flujo (spec)**: crear (bodega + alcance) → congela teórico por ítem → se ingresa contado → calcula diferencia → Mantenimiento confirma → **genera automáticamente Ajustes** en [stock_movements](stock_movements.md) (`type='ajuste'`, `reason='Conteo físico'`, `count_id` referenciado) por cada ítem con `difference ≠ 0`.
- **Solo Mantenimiento** crea/ confirma / cancela conteos (spec `permission: Exclusivo de Mantenimiento`); otros roles solo consultan.
- **Confirmado = INMUTABLE** (spec `immutability`): no se edita; corrección vía nuevo conteo o ajuste manual, con registro en log.
- **Cancelado** exige motivo; no genera ajustes.
- **Sin notificación** por diferencias (spec `no_notification`): Mantenimiento revisa en el flujo de confirmación — no hay evento T2 para conteos.
- El teórico se congela **al iniciar** el conteo: movimientos posteriores (entradas/salidas) durante el conteo generan diferencia legítima — es material del kardex que el revisor interpreta.

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Mantenimiento | SELECT/INSERT/UPDATE (transiciones de estado) — CRUD de conteos |
| Técnico | SELECT (posibilidad de apoyo en el conteo se habilita vía Mantenimiento; el registro masivo es de Mantenimiento) |
| Administrador / Calidad | SELECT |
