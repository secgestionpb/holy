# categories

> Módulo 1 — Gestión de Activos. Catálogo CRUD de categorías de activo.
> Flujo: F1.10 / Vista: V1.6 — [01-gestion-de-activos-flujos.md](../01-gestion-de-activos-flujos.md)

```sql
CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,
                    -- "Climatización (HVAC)", "Edificación/Infraestructura"
    description     TEXT NULL,
    code_prefix     TEXT NOT NULL UNIQUE,
                    -- "HVAC" → primer segmento del código de activo
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      SMALLINT NULL,
    created_by      UUID NULL,               -- FK → users
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_active ON categories(is_active) WHERE is_active;
```

## Reglas y notas

- **CRUD: rol Mantenimiento** (decisión de sesión); Administrador solo consulta (acceso directo desde T2).
- **Sin borrado físico**: solo `is_active = false`; los activos existentes conservan su categoría.
- Cambiar `code_prefix` **NO recodifica** activos existentes — solo afecta futuras altas autogeneradas.
- **Semilla de arranque: 11 ítems** — los 10 de la spec (HVAC, Eléctrico, Plomería, Contra incendios, Elevadores, Cocina, Lavandería, Piscina/Spa, Seguridad y acceso, Mobiliario técnico) + `Edificación/Infraestructura`.
- **Una sola categoría por activo** (cardinalidad); la naturaleza mixta se resuelve con componentes.
- Vinculación a planes PM (Módulo 3) y a contratistas (Módulo 5) es **dinámica por esta FK**.
