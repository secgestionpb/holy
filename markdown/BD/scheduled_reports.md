# scheduled_reports

> Módulo 7 — Reportes programados. Config de los 6 reportes mensuales (spec `scheduled_monthly_reports.config_table`) — decisión 7.3: CRUD = solo Administrador.
> Flujos: [F7.4](../07-reportes-kpis-flujos.md) (config), [F7.5](../07-reportes-kpis-flujos.md) (envío) · vista [V7.2](../07-reportes-kpis-flujos.md) / modal [M7.2](../07-reportes-kpis-flujos.md).

```sql
CREATE TABLE scheduled_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_key      TEXT NOT NULL UNIQUE
                    CHECK (report_key IN (
                        'costos_mantenimiento',     -- spec report id 1
                        'cumplimiento_pm',          -- spec report id 2
                        'estado_certificaciones',   -- spec report id 3
                        'consumo_inventario',       -- spec report id 4
                        'ranking_fallas',           -- spec report id 5
                        'costos_proveedor'          -- spec report id 6
                    )),                -- UNIQUE: 1 fila por catálogo (decisión 7.9)
    report_name     TEXT NOT NULL,      -- denormalizado (spec: nombre del reporte)
    frequency       TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (frequency IN ('monthly')),
                    -- "Mensual, fijo por ahora" (spec) — CHECK extensible si
                    -- aparecen otras frecuencias
    send_day        INTEGER NOT NULL DEFAULT 1
                    CHECK (send_day BETWEEN 1 AND 28),  -- día de envío (spec)
    format          TEXT NOT NULL DEFAULT 'pdf'
                    CHECK (format IN ('pdf','excel')),  -- formato adjunto (spec)
    recipients      TEXT NOT NULL DEFAULT '',  -- texto libre (spec): correos
                    -- separados por coma; vacío + is_active → skipped (F7.5)
    is_active       BOOLEAN NOT NULL DEFAULT true,     -- activo/inactivo (spec)

    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sr_due ON scheduled_reports (send_day, is_active) WHERE is_active;
```

## Seeds (los 6 de la spec — ACTIVOS POR DEFECTO)

| report_key | report_name (spec) | send_day | format | is_active |
|---|---|---|---|---|
| costos_mantenimiento | Resumen de costos de mantenimiento | 1 | pdf | true |
| cumplimiento_pm | Cumplimiento de PM del mes | 1 | pdf | true |
| estado_certificaciones | Estado de certificaciones normativas | 1 | pdf | true |
| consumo_inventario | Consumo e inventario | 1 | pdf | true |
| ranking_fallas | Ranking de activos con más fallas del mes | 1 | pdf | true |
| costos_proveedor | Costos por proveedor/contratista del mes | 1 | pdf | true |

- `recipients` sembrado = correos de los usuarios rol **Administrador** (los 6 salen de fábrica — spec "activos por defecto"); luego cada reporte se configura independientemente (ej. certificaciones → también a Calidad).

## Reglas de negocio

- **CRUD = solo Administrador** (decisión 7.3, coherente con T1); demás roles solo lectura. Silenciar = `is_active = false` (patrón notification_config: sin DELETE).
- **Envío**: pg_cron diario → RPC selecciona `is_active AND send_day = hoy AND sin fila en report_send_log para el mes anterior` → Edge Function (F7.5). El reporte cubre siempre el **mes natural anterior**, enviado el `send_day` del mes en curso.
- **Cada modificación genera `audit_log`** (module `configuration`, entity_type `scheduled_report`).
- T2 Configuración → sección "Reportes programados" = puntero a esta tabla (spec T2).

## Uso en el Módulo 1

- FK a `users` (creador/editor). Sin relación con activos (los datos salen de las consultas de F7.5).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Administrador | SELECT/INSERT/UPDATE (UPDATE = silenciar/configurar; DELETE prohibido) |
| Mantenimiento / Técnico / Calidad | SELECT (solo lectura) |
| Service role (Edge Function) | Lectura completa vía backend |
