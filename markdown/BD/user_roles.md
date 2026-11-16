# user_roles

> Módulo T1 — Asignación de roles a usuarios (N:N — spec `multi_role_support`: cardinalidad mucha-a-mucha; catálogo de roles FIJO, sin CRUD — `no_crud`).
> Flujos: [F-T1.1](../T1-usuarios-y-roles-flujos.md) (sync de roles), [F-T1.4](../T1-usuarios-y-roles-flujos.md) (unión de permisos) · modal [M-T1.1](../T1-usuarios-y-roles-flujos.md).

```sql
CREATE TABLE user_roles (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN
                  ('mantenimiento','tecnico','administrador','calidad')),
                  -- catálogo FIJO de 4 roles (spec roles_catalog)
    assigned_by UUID NULL REFERENCES users(id),    -- quién asignó (Admin)
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, role)
);

CREATE INDEX idx_user_roles_role ON user_roles (role);
```

## Reglas de negocio

- **Unión de permisos**: el usuario accede a todo lo permitido por CUALQUIERA de sus roles, sin "cambiar de modo" (spec `permission_combination`) — la app resuelve `UNION(role)` (F-T1.4).
- **Sin tabla `roles`**: el catálogo es fijo en código (spec `no_crud`); el CHECK del enum es la restricción de integridad.
- **Multi-selección obligatoria**: ≥1 rol por usuario (guard T1.5 — no se puede dejar un usuario sin roles quitándole el último manualmente; la baja es `users.is_active = false`).
- **≥1 Administrador activo** en todo momento (guard T1.5 — trigger/validación en app al actualizar esta tabla).
- **Sync desde M-T1.1**: el modal Admin recalcula las filas (alta/baja) de la N:N; cada cambio genera `audit_log` ("asignación de roles").
- `audit_log` registra SOLO el usuario que ejecuta la acción, nunca el rol (spec `audit_logging`).

## Uso en el Módulo 1

- Sin FK desde Módulo 1 — los roles se leen en cada request (F-T1.4) y alimentan RLS (`is_admin()`, `has_role()`).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Administrador | SELECT (UI); escritura solo vía service role (`admin-users`) |
| Mantenimiento / Técnico / Calidad | SELECT (para resolver su propia unión de permisos) |
| Todos | DELETE/UPDATE directos prohibidos (patrón: edición solo por el flujo Admin) |
