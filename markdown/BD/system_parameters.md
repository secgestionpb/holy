# system_parameters

> Módulo T2 (Transversal) — Parámetros generales del sistema. **Tabla creada en el Módulo 7** para la tarifa global de mano de obra (decisión 7.4); contenedor extensible para los demás `Parámetros generales del sistema` de T2 (días de anticipación de garantía, prefijos, formatos…).
> Flujos: [F7.2](../07-reportes-kpis-flujos.md) (fallback de tarifa en KPIs de costo) · spec T2 [T2-configuracion.md](../T2-configuracion.md).

```sql
CREATE TABLE system_parameters (
    key         TEXT PRIMARY KEY,          -- nombre estable del parámetro
                -- ej. 'labor_hourly_rate'
    value       TEXT NOT NULL,             -- valor en texto (cast en uso:
                -- NUMERIC/INTEGER/BOOLEAN según key)
    description TEXT,                      -- qué es / unidad (para la UI T2)
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Semillas:
INSERT INTO system_parameters (key, value, description) VALUES
  ('labor_hourly_rate', '0',
   'Tarifa global por hora de mano de obra (fallback cuando users.hourly_rate es NULL)'),
  ('dias_anticipacion_garantia', '0',
   'Días de anticipación del Evento 7 — campo GLOBAL único (spec T2 Parámetros generales)'),
  ('login_attempts', '5',
   'Intentos fallidos de login antes de bloquear la cuenta (lockout custom — failed_logins)'),
  ('lockout_minutes', '15',
   'Duración del bloqueo temporal por intentos fallidos, en minutos');
```

## Reglas de negocio

- **Modelo clave/valor** (una fila por parámetro) — evita ALTER TABLE por cada parámetro nuevo de T2.
- **Alcance T2** (decisión T2.2 corregida): editables IN-APP = `labor_hourly_rate`, `dias_anticipacion_garantia`, `login_attempts` y `lockout_minutes` (estos dos los lee la Edge Function `login-custom` sobre failed_logins); de SOLO LECTURA en T2 (fuente externa): access/refresh token (Supabase Auth) y prefijos/formato de código (catálogos/code_counters del M1).
- **`labor_hourly_rate`** (decisión 7.4): costo de mano de obra de OT/KPIs = `SUM(hours_worked × COALESCE(users.hourly_rate, system_parameters.labor_hourly_rate))`; con ambos vacíos/0 el costo de mano de obra cuenta como 0 y el widget muestra el dato como incompleto.
- **`dias_anticipacion_garantia`**: la leen F1.4/F1.9 (aviso Único, recálculo al editar/extender la garantía); default '0' (mismo día — spec).
- **Solo Administrador actualiza** (T1: CRUD completo de Configuración/Opciones); demás roles SELECT. Cambios = `audit_log` (module `configuration`, entity_type `system_parameter`).
- Cambios afectan cálculos FUTUROS: la tarifa no reescribe históricos (costo congelado en kardex).
- Semillas nuevas = migración (no CRUD desde la UI salvo los parámetros con formulario en T2).

## Uso en el Módulo 1

- FK a `users` (editor). Sin relación con activos — la tarifa alimenta costos de OT (M2) y sus KPIs (M7).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Administrador | SELECT/UPDATE |
| Mantenimiento / Técnico / Calidad | SELECT |
