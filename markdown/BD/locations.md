# locations

> Módulo 1 — Gestión de Activos. Árbol jerárquico libre de ubicaciones.
> Flujo: F1.11 / Vista: V1.7 — [01-gestion-de-activos-flujos.md](../01-gestion-de-activos-flujos.md)

```sql
CREATE TABLE locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id       UUID NULL REFERENCES locations(id),
                    -- NULL solo en la raíz (hotel/resort)
    name            TEXT NOT NULL,
                    -- "Pasillo Piso 1", "Habitación 101", "Exterior"
    kind            TEXT NOT NULL CHECK (kind IN
                      ('hotel','building','floor','zone')),
                    -- zone = ubicación libre (pasillo, habitación, baño,
                    -- exterior, área común, área técnica)
    zone_subtype    TEXT NULL CHECK (zone_subtype IN
                      ('room','corridor','bathroom','exterior',
                       'common_area','technical_area')),
    room_code       TEXT NULL,               -- código de habitación si aplica
    depth           SMALLINT NOT NULL,       -- nivel calculado
                    -- CHECK (depth <= 5)  ← profundidad máxima desde Resort
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      SMALLINT NULL,
    created_by      UUID NULL,               -- FK → users
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (parent_id, name)                 -- nombres únicos entre hermanos
);

CREATE INDEX idx_locations_parent   ON locations(parent_id);
CREATE INDEX idx_locations_kind     ON locations(kind);
CREATE INDEX idx_locations_active   ON locations(is_active) WHERE is_active;
```

## Reglas y notas

- **Jerarquía libre**: padre permitido = hotel | building | floor | otra ubicación (anidamiento por contención espacial).
- **Profundidad ≤ 5** desde la raíz (validada al INSERT/UPDATE en Edge Function o trigger).
- **Un nodo puede contener sub-ubicaciones Y activos a la vez** (ej. Pasillo 1 → habitaciones hijas + su pintura/luminarias).
- **Mover un nodo arrastra** todos sus descendientes (activos y componentes heredan la ruta).
- **Desactivación lógica** (`is_active = false`) permitida solo si no contiene activos ni sub-ubicaciones con activos; **DELETE prohibido** (RLS).
- `updated_at` lo mantiene el trigger global de tablas.
- Raíz (`kind = 'hotel'`, `parent_id IS NULL`) insertada por migración de arranque.
