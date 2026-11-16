# code_counters

> Módulo 1 — Gestión de Activos (extendido en Módulo 4). Secuencia para autogenerar códigos de activos e ítems de inventario.
> Flujos: F1.1 (preview), F1.12 (importación) — [01-gestion-de-activos-flujos.md](../01-gestion-de-activos-flujos.md) · F4.1 (REP-) — [04-inventario-flujos.md](../04-inventario-flujos.md)

```sql
CREATE TABLE code_counters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prefix          TEXT NOT NULL,             -- prefijo de categoría ("HVAC") o de secuencia simple ("REP")
    location_id     UUID REFERENCES locations(id),
                    -- segundo segmento del código ("305", "CM-01"); NULL para secuencias SIN segmento de ubicación (M4: ítems)
    next_value      BIGINT NOT NULL DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (prefix, location_id)
);

-- Secuencias simples sin ubicación (ej. M4 ítems): una sola fila por prefijo
CREATE UNIQUE INDEX idx_code_counters_simple
    ON code_counters(prefix) WHERE location_id IS NULL;

CREATE INDEX idx_code_counters_lookup
    ON code_counters(prefix, location_id);
```

## Reglas y notas

- **Formato**: `[prefix]-[ubicación]-[NNN]` → Edge Function `validate_asset_code` incrementa `next_value` y formatea el consecutivo (ej. `HVAC-305-001`).
- **El código es editable** después de generado: si el usuario lo modifica manualmente, la secuencia NO se retroalimenta — la garantía final es el `UNIQUE (assets.code)`.
- Si un código editado manualmente "toca" un consecutivo futuro, la Edge Function debe saltar valores tomados como `MAX` del patrón (evitar colisión) — comportamiento a validar al implementar.
- En **importación masiva (F1.12)** los códigos vienen del archivo; la fila de contador solo se usa para las filas con código vacío.
- Al **cambiar categoría** de un activo no se modifica su código ni su contador.
- **Módulo 4 (ítems)**: fila con `prefix='REP'` y `location_id = NULL` → formato simple `REP-0001` (decisión de sesión: mismo patrón de autogeneración editable que activos, sin segmento de ubicación).
