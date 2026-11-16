# measurement_types

> Módulo 6 — Mediciones. Catálogo de tipos de medición (**diseño completo del Módulo 6**). Caso inicial: pH de piscinas; extensible a cloro, temperatura, etc.
> Flujos: [F6.4](../06-cumplimiento-mediciones-flujos.md) (resultado automático), [F6.5](../06-cumplimiento-mediciones-flujos.md) (faltantes) · vista [V6.3](../06-cumplimiento-mediciones-flujos.md).

```sql
CREATE TABLE measurement_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,                  -- "pH piscina", "Cloro libre piscina"
    category_id     UUID NOT NULL REFERENCES categories(id),
                    -- categoría de activo APLICABLE: filtra qué activos del Módulo 1
                    -- pueden seleccionarse como punto de medición (ej. Piscina/Spa)
    unit            TEXT NOT NULL
                    CHECK (unit IN ('unidad','pH','ppm','mg_l','porcentaje','celsius','litro','kg','m3','otro')),
                    -- ENUM FIJO (decisión de sesión — patrón M4)
    min_value       NUMERIC(10,3) NOT NULL,         -- rango aceptable mínimo
    max_value       NUMERIC(10,3) NOT NULL,         -- rango aceptable máximo
    frequency       TEXT NOT NULL DEFAULT 'daily'
                    CHECK (frequency IN ('daily','every_2_days','weekly','biweekly','monthly')),
                    -- frecuencia ESPERADA (informativo — detectar mediciones faltantes, spec)
    is_active       BOOLEAN NOT NULL DEFAULT true,

    -- Auditoría (patrón del sistema)
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (max_value > min_value)
);

CREATE INDEX idx_measurement_types_category ON measurement_types (category_id);
CREATE INDEX idx_measurement_types_active ON measurement_types (is_active) WHERE is_active;
```

## Reglas de negocio

- **CRUD = Calidad** (spec permissions); Mantenimiento/Admin solo lectura; Técnico sin acceso.
- **La categoría (M1) es el filtro**: al registrar, el selector de activos muestra solo `assets.category_id = measurement_types.category_id`.
- **Categoría de activo (M1) desactivada** → sus tipos conservan histórico pero NO admiten nuevos registros (decisión de sesión — cierra el pendiente que dejaba este archivo).
- **Desactivar tipo**: conserva `measurement_records`; deja de aparecer en "faltantes" (F6.5) y en el selector de registro.
- **`frequency` informativo**: alimenta SOLO el indicador de mediciones faltantes en UI (decisión de sesión — sin correo).
- Sin borrado físico (FK desde `measurement_records` lo bloquearía).

## Uso en el Módulo 1

- **FK directa a `categories`** (Módulo 1) — el catálogo de categorías es la fuente del filtro.
- CRUD = Calidad; Mantenimiento no gestiona el catálogo.

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Calidad | SELECT/INSERT/UPDATE + inactivar (CRUD — spec) |
| Mantenimiento / Administrador | SELECT (Mantenimiento: "recibe alertas, sin gestión del catálogo") |
| Técnico | Sin acceso |
