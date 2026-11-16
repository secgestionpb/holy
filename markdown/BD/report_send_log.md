# report_send_log

> Módulo 7 — Historial de envíos de reportes programados (deduplicación mensual + auditoría de envíos — decisión 7.7).
> Flujos: [F7.5](../07-reportes-kpis-flujos.md) (envío + reenviar) · vista [V7.2](../07-reportes-kpis-flujos.md) (columna "Último envío").

```sql
CREATE TABLE report_send_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID NOT NULL REFERENCES scheduled_reports(id),
    period_ym       TEXT NOT NULL,          -- 'YYYY-MM' del mes REPORTADO
                    -- (mes natural anterior al envío)
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          TEXT NOT NULL
                    CHECK (status IN ('sent','failed','skipped_no_recipients')),
    recipients      TEXT NOT NULL,          -- snapshot de la lista usada
    file_path       TEXT NULL,              -- ruta en bucket `reportes`
                    -- ({report_key}/{period_ym}.{pdf|xlsx})
    error_message   TEXT NULL,              -- detalle si status='failed'

    UNIQUE (report_id, period_ym)           -- DEDUP: 1 fila por reporte/mes
);

CREATE INDEX idx_rsl_report ON report_send_log (report_id, sent_at DESC);
```

## Reglas de negocio

- **Garantía de envío único**: la UNIQUE `(report_id, period_ym)` es el candado de deduplicación — pg_cron no puede encolar dos veces el mismo reporte/mes aunque la función corra dos veces.
- **Estados**: `sent` (correo con adjunto entregado) · `failed` (error de generación/envío — `error_message`; se reintenta SOLO con "Reenviar ahora" manual, F7.5) · `skipped_no_recipients` (reporte activo con destinatarios vacíos — visible en V7.2 para que el Admin lo complete).
- **Append-only**: INSERT solo del service role; UPDATE/DELETE prohibidos para todos — es la auditoría de envíos.
- **Reenviar** (Admin) = upsert forzado del `period_ym` vigente (sobrescribe la fila `failed` y actualiza `sent_at`/`status`).
- `file_path` conserva el adjunto en el bucket `reportes` (historial descargable vía URL firmada).

## Uso en el Módulo 1

- Ninguno (FK a `scheduled_reports`; los datos de los reportes salen de las consultas de F7.2/F7.5).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Administrador / Mantenimiento | SELECT |
| Service role (Edge Function) | INSERT (único escritor) |
| Técnico / Calidad | Sin acceso |
| Todos (UPDATE/DELETE) | Prohibido |
