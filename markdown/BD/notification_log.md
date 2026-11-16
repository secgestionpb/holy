# notification_log

> Módulo T2 — Configuración (tabla compartida). Registro de envíos y deduplicación de avisos ÚNICOS.
> Eventos del Módulo 1: 7 (garantía por vencer), 10 (activo requiere reemplazo), 12 (activo al fin de vida útil).
> Flujos: [F-T2.2](../T2-configuracion-flujos.md) (inmediato), [F-T2.3](../T2-configuracion-flujos.md) (resumen diario) — [01-gestion-de-activos-flujos.md](../01-gestion-de-activos-flujos.md)

```sql
CREATE TABLE notification_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            SMALLINT NOT NULL,     -- FK → notification_config
    dedup_key           TEXT NULL,             -- 'warranty:{uuid}',
                        -- 'asset_lifespan:{uuid}' → aviso ÚNICO
    target_entity_type  TEXT NULL,             -- 'warranty','asset'
    target_entity_id    UUID NULL,
    channel             TEXT NOT NULL DEFAULT 'email',
                        -- campo diseñado extensible a WhatsApp (T2)
    recipients          TEXT[] NULL,           -- destinos del envío
    status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','sent','failed')),
    sent_at             TIMESTAMPTZ NULL,
    error_detail        TEXT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, dedup_key) WHERE dedup_key IS NOT NULL
);

CREATE INDEX idx_notiflog_event ON notification_log(event_id, created_at DESC);
CREATE INDEX idx_notiflog_status ON notification_log(status)
    WHERE status = 'pending';
```

## Reglas y notas

- **Deduplicación de avisos únicos**: el UNIQUE parcial `(event_id, dedup_key)` impide reenviar el Evento 7 por la misma garantía (recalculado si la garantía se edita/extiende — borrar la fila de dedup al editar).
- Modo **Resumen diario**: los eventos se encolan (`pending`) y la Edge Function disparada por `pg_cron` agrupa y envía a la hora configurada en T2; luego `sent`.
- Modo **Inmediato**: envío directo al dispara el evento (Eventos 10; 9, 4, 5, 1, 8 de otros módulos).
- Destinatarios y modo salen SIEMPRE de `notification_config` (T2) — nunca hardcodeados.
- **Push a técnicos NO pasa por esta tabla** (mecanismo separado, destinatario dinámico — `push_subscriptions`).
