# assets

> Módulo 1 — Gestión de Activos. Almacena activos Y componentes en una sola tabla.
> Flujos: F1.1, F1.2, F1.3, F1.7, F1.9 / Vistas: V1.1-V1.4 — [01-gestion-de-activos-flujos.md](../01-gestion-de-activos-flujos.md)

```sql
CREATE TABLE assets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id           UUID NULL REFERENCES assets(id),
                        -- componente → activo padre; NULL = activo raíz
    location_id         UUID NOT NULL REFERENCES locations(id),
                        -- en componentes: copia del padre (cascada al mover)
    category_id         UUID NULL REFERENCES categories(id),
                        -- NOT NULL si parent_id IS NULL (regla CHECK abajo);
                        -- en componentes: heredada, columna nullable
    code                TEXT NOT NULL UNIQUE,
                        -- editable: [Prefijo]-[Ubicación]-[Consecutivo]
    name                TEXT NOT NULL,
    description         TEXT NULL,
    criticality         TEXT NOT NULL CHECK (criticality IN
                          ('high','medium','low')),
    operational_status  TEXT NOT NULL DEFAULT 'operational'
                          CHECK (operational_status IN
                          ('operational','inactive')),
    life_stage          TEXT NOT NULL DEFAULT 'no_warranty'
                          CHECK (life_stage IN
                          ('no_warranty','under_warranty','operational',
                           'pending_repair','requires_replacement',
                           'decommissioned')),
                        -- 'decommissioned' = baja lógica (trigger fuerza
                        -- operational_status='inactive'; reversible)
    commissioning_date  DATE NOT NULL,
    expected_lifespan_value NUMERIC(10,2) NULL,   -- vida útil esperada
    lifespan_unit       TEXT NULL CHECK (lifespan_unit IN
                          ('years','hours','cycles')),
    has_usage_counter   BOOLEAN NOT NULL DEFAULT false,
    usage_counter       BIGINT NULL,           -- lo escribe una OT (Módulo 3)
    usage_counter_updated_at TIMESTAMPTZ NULL,
    usage_counter_updated_by UUID NULL,        -- FK → users
    responsible_user_id UUID NULL,             -- FK → users, NO obligatorio
    notes               TEXT NULL,
    created_by          UUID NULL,             -- FK → users
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (parent_id IS NOT NULL OR category_id IS NOT NULL)
                        -- todo activo raíz debe tener categoría
);

CREATE INDEX idx_assets_location   ON assets(location_id);
CREATE INDEX idx_assets_category   ON assets(category_id);
CREATE INDEX idx_assets_parent     ON assets(parent_id);
CREATE INDEX idx_assets_life_stage ON assets(life_stage);
CREATE INDEX idx_assets_status     ON assets(operational_status);
CREATE INDEX idx_assets_resp       ON assets(responsible_user_id);
```

## Reglas y notas

- **Instancia individual**: cada equipo físico es una fila (FCU-305 ≠ FCU-512).
- **Componente = misma tabla con `parent_id`** (mini-activo: historial, garantías y documentación propios; ubicación heredada NO editable).
- **Calculados al leer, NO son columnas**: `lifespan_consumed` (hoy − commissioning_date) y `lifespan_remaining`.
- `life_stage` gobierna el motor de garantías (transiciones automáticas solo entre `no_warranty` ↔ `under_warranty`) y Mantenimiento (las demás, **reversible** incluida la baja).
- **Contador de uso**: solo lectura en ficha; se actualiza desde una OT preventiva (F1.9).
- **Códigos**: unicidad garantizada por UNIQUE; generación vía `code_counters` (Edge Function `validate_asset_code`).
- **Baja lógica**: `life_stage = 'decommissioned'` — **DELETE prohibido** (RLS).
- **Cambio de categoría** mueve dinámicamente el activo entre planes PM por categoría (Módulo 3).
- Costos acumulados **no se almacenan aquí**: se calculan desde `work_orders` (pestaña Costos, Mto + Admin).
