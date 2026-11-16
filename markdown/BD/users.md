# users

> Módulo T1 — Usuarios y Roles. Perfil de usuario (espejo 1:1 de `auth.users` de Supabase Auth — decisión T1.2). Incluye `hourly_rate` (aporte del Módulo 7 — decisión 7.4).
> Flujos: [F-T1.1](../T1-usuarios-y-roles-flujos.md) (CRUD), [F-T1.3](../T1-usuarios-y-roles-flujos.md) (login/cambio forzado) · vistas [V-T1.1](../T1-usuarios-y-roles-flujos.md) / [M-T1.1](../T1-usuarios-y-roles-flujos.md).

```sql
CREATE TABLE users (
    id                  UUID PRIMARY KEY,
                      -- = auth.users.id (Supabase Auth — el FK a auth.users
                      -- se crea como FK del esquema auth; sin DEFAULT propio)
    full_name           TEXT NOT NULL,
    email               TEXT NOT NULL UNIQUE,     -- identificador de login
    phone               TEXT NULL,                -- futuro WhatsApp (spec)
    avatar_path         TEXT NULL,                -- ruta en bucket `usuarios`
    is_active           BOOLEAN NOT NULL DEFAULT true,
                        -- nunca se elimina un usuario con historial (spec)
    must_change_password BOOLEAN NOT NULL DEFAULT false,
                        -- true en alta inicial y tras reset (F-T1.2/F-T1.3)
    last_sign_in_at     TIMESTAMPTZ NULL,
    hourly_rate         NUMERIC(10,2) NULL
                        CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
                        -- tarifa/h (M7 decisión 7.4; NULL = tarifa global
                        -- system_parameters.labor_hourly_rate)
    created_by          UUID NULL REFERENCES users(id),
    updated_by          UUID NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Reglas de negocio

- **Perfil ≠ auth**: la contraseña y el hash viven en `auth.users` (Supabase Auth, bcrypt); aquí NO hay columna de clave. El alta/edición/reset pasa por la Edge Function `admin-users` (service role).
- **Alta inicial** = contraseña inicial predeterminada `PlayaBlanca2026` (decisión T1.9) + `must_change_password = true` → pantalla de cambio forzado (S-T1.2).
- **Baja lógica** (`is_active = false`): el usuario deja de poder iniciar sesión y desaparece de los selectores, pero conserva OTs, mediciones, movimientos y audit (spec `management`). **DELETE prohibido.**
- **Guards** (decisión T1.5): no auto-desactivación; no quitarse el último rol (en `user_roles`); ≥1 Admin activo siempre.
- **Roles** → [user_roles](user_roles.md) · **categorías de especialidad** → [user_category_assignments](user_category_assignments.md).
- **`hourly_rate`**: editable solo por Administrador (ficha M-T1.1); costo de mano de obra en M2/M7 = `hours × COALESCE(hourly_rate, system_parameters.labor_hourly_rate)`.

## Uso en el Módulo 1

- `assets.responsible_user_id` → responsable (opcional).
- `assets.usage_counter_updated_by`, `*.created_by`, `*.uploaded_by` → autoría.
- `audit_log.user_id` → usuario de cada entrada (NULL = sistema).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Administrador | SELECT/UPDATE (INSERT/DELETE solo vía service role `admin-users`) |
| Mantenimiento / Técnico / Calidad | SELECT (nombres para UI/audit); UPDATE solo de su propio avatar/datos menores |
| Todos | DELETE prohibido |
