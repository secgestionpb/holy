# compliance_categories

> Módulo 6 — Cumplimiento Normativo. Catálogo CRUD propio de categorías normativas (decisión de sesión sobre el campo "categoría normativa" de la spec).
> Flujos: [F6.1](../06-cumplimiento-mediciones-flujos.md) (dropdown de certificaciones), vista [V6.2](../06-cumplimiento-mediciones-flujos.md).

```sql
CREATE TABLE compliance_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,         -- "Contra incendios", "Sanitaria/agua", ...
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true, -- baja lógica (patrón del sistema)

    -- Auditoría (patrón del sistema)
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Reglas de negocio

- **Semillas de arranque (spec)**: Seguridad estructural · Contra incendios · Sanitaria/agua · Ambiental · Eléctrica · Elevadores.
- **CRUD = Calidad** (dueña del catálogo de certificaciones — spec permissions).
- Baja lógica: las certificaciones existentes conservan la referencia; deja de ser seleccionable para nuevas.
- Sin borrado físico (FK desde `certifications` lo bloquearía).

## Relación

- `certifications.compliance_category_id` → esta tabla (categoría normativa de cada certificación/obligación).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Calidad | SELECT/INSERT/UPDATE + desactivar (CRUD) |
| Mantenimiento | SELECT (renovación operativa la necesita como lectura) |
| Administrador | SELECT |
| Técnico | Sin acceso |
