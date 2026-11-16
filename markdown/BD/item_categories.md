# item_categories

> Módulo 4 — Inventario. Catálogo CRUD propio de categorías de ítem (repuestos HVAC, eléctricos, químicos de piscina, lubricantes, ferretería…).
> Flujos: [F4.1 subflow](../04-inventario-flujos.md) (CRUD), usado como filtro en V4.1 y dropdown en V4.2.

```sql
CREATE TABLE item_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,             -- "Repuestos HVAC", "Ferretería"
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,    -- baja lógica (patrón del sistema)

    -- Auditoría (patrón del sistema)
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Reglas de negocio

- **Lista PLANA** (no jerárquica — a diferencia de [locations](locations.md) del Módulo 1; decisión de sesión).
- **CRUD solo Mantenimiento** (mismo criterio que categorías de activo en M1 — decisión de sesión).
- Baja lógica (`is_active = false`): los ítems existentes conservan la referencia; deja de ser seleccionable para nuevos ítems.
- Sin borrado físico (FK desde `items` lo bloquearía).

## Uso en el Módulo 4

- Filtro de V4.1-Ítems y dropdown de V4.2.
- **Alcance de conteo físico**: "categoría de ítems" en V4.4/F4.8 selecciona el alcance desde aquí.

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Mantenimiento | SELECT/INSERT/UPDATE + desactivar |
| Técnico / Administrador / Calidad | SELECT |
