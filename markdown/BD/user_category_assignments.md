# user_category_assignments

> Módulo T1 — Categorías asignadas a usuarios (N:N users↔categories de M1 — spec `user_entity`: "categorías asignadas (opcional, solo aplicable a Técnico, para filtrar especialidad)").
> Flujos: [F-T1.1](../T1-usuarios-y-roles-flujos.md) (CRUD) · modal [M-T1.1](../T1-usuarios-y-roles-flujos.md) · decisión T1.4.

```sql
CREATE TABLE user_category_assignments (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    assigned_by  UUID NULL REFERENCES users(id),
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, category_id)
);

CREATE INDEX idx_uca_category ON user_category_assignments (category_id);
```

## Reglas de negocio

- **Solo rol Técnico**: el selector en M-T1.1 solo aparece si el usuario tiene marcado `tecnico`; si se le quita el rol, sus filas se eliminan (sync del modal).
- **Uso = filtro de especialidad, NO restricción** (decisión T1.4): V2.2 (asignación de OT) y listados pueden filtrar "técnicos de la categoría X"; Mantenimiento puede asignar fuera de categoría igualmente. La especialidad es una ayuda operativa, no un permiso.
- Sync completo (alta/baja de filas) desde el modal Admin; cambios → `audit_log` (dentro de la entrada de modificación de usuario).

## Uso en el Módulo 1

- FK a `categories` (categorías de activos de M1) — la fuente de especialidades.
- Sin lecturas directas desde Módulo 1 (el consumo es de M2/M7 sobre esta tabla).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Administrador | SELECT (UI); escritura solo vía service role |
| Mantenimiento / Técnico / Calidad | SELECT (Técnico: la propia — perfil; Mantenimiento: para el filtro de asignación) |
| Todos | DELETE/UPDATE directos prohibidos |
