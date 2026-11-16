# failed_logins

> Módulo T1/T2 — Control de intentos fallidos de login. Lockout custom (stack-tecnologico: "NO es nativo de Supabase: se implementa con tabla failed_logins + Edge Function de login custom").
> Flujos: [F-T1.3](../T1-usuarios-y-roles-flujos.md) (login) · parámetros editables en [V-T2.1b](../T2-configuracion-flujos.md) (`system_parameters.login_attempts` / `lockout_minutes`).

```sql
CREATE TABLE failed_logins (
    email           TEXT PRIMARY KEY,        -- correo intentado (lowercase)
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until    TIMESTAMPTZ NULL         -- last_attempt_at + lockout_minutes
                    -- (NULL = no bloqueado)
);

CREATE INDEX idx_failed_logins_locked ON failed_logins (locked_until)
    WHERE locked_until IS NOT NULL;
```

## Reglas de negocio

- **Escritura SOLO service role** (Edge Function `login-custom` — único camino de login, decisión T1.3 corregida): el front nunca toca esta tabla.
- **Flujo**: intento → si `locked_until > now()` → rechazo inmediato ("Cuenta bloqueada, intente en X min"); si no → Supabase Auth valida → falla → `failed_attempts + 1`, `last_attempt_at = now()`; cuando `failed_attempts ≥ system_parameters.login_attempts` → `locked_until = now() + system_parameters.lockout_minutes`.
- **Reset**: login exitoso → DELETE de la fila (o `failed_attempts = 0`, `locked_until = NULL`).
- **Parámetros** (spec T2 "Parámetros generales"): `login_attempts` (default 5) y `lockout_minutes` (default 15) editables por Administrador en T2 — decisión T2.2 corregida (coherente con stack: "Parámetros tomados de Configuración").
- **Limpieza**: pg_cron borra filas con `locked_until` vencido y `last_attempt_at` > 24 h (anti-crecimiento).
- **No genera audit_log** por intento (ruido; T3 solo audita creación/modificación/reset de usuarios); el bloqueo se informa en la pantalla de login.
- **Sin cuenta/no existe el correo**: mismo mensaje genérico (sin filtrar existencia — igual que Supabase Auth).

## Uso en el Módulo 1

- Ninguno. FK lógico a `users.email` sin FK física (el correo puede no existir aún — intentos contra cuentas inexistentes también se cuentan).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Service role (Edge Function `login-custom`) | Único escritor/lector |
| Todos los roles (UI) | Sin acceso (nunca se consulta desde la app) |
