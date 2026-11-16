# notification_config

> Módulo T2 — Configuración. Tabla de eventos de notificación por correo (fuente única de configuración).
> Eventos del Módulo 1: **7, 10 y 12**. Ver también: [notification_log.md](notification_log.md)
> Flujos: [F-T2.1](../T2-configuracion-flujos.md) (CRUD), [F-T2.2](../T2-configuracion-flujos.md) (inmediato), [F-T2.3](../T2-configuracion-flujos.md) (resumen diario) · vista [V-T2.1a](../T2-configuracion-flujos.md) / modal [M-T2.1](../T2-configuracion-flujos.md) · [01-gestion-de-activos-flujos.md](../01-gestion-de-activos-flujos.md)

```sql
CREATE TABLE notification_config (
    event_id        SMALLINT PRIMARY KEY,      -- id fijo del catálogo (1-12)
    name            TEXT NOT NULL,             -- nombre visible del evento
    description     TEXT NULL,
    channel         TEXT NOT NULL DEFAULT 'email',
                    -- diseñado extensible: 'whatsapp' futuro (T2)
    mode            TEXT NOT NULL CHECK (mode IN
                      ('immediate','daily_digest')),
    digest_time     TIME NULL,                 -- solo si mode = daily_digest
    recipients      TEXT[] NOT NULL DEFAULT '{}',
                    -- texto libre, NO ligado a usuarios (puede incluir
                    -- personas externas al CMMS)
    extra_param     TEXT NULL,                 -- ej. días de anticipación
                    -- (Evento 7: global, default '0')
    is_active       BOOLEAN NOT NULL DEFAULT true,
                    -- silencia sin borrar la configuración
    updated_by      UUID NULL,                 -- FK → users
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Semilla de eventos (catálogo T2, fijo — 12 filas):
-- 1  OT afecta disponibilidad de venta   (inmediato)
-- 2  OT preventiva generada              (resumen diario)
-- 3  Stock bajo mínimo                   (resumen diario)
-- 4  Stock negativo                      (inmediato)
-- 5  Reporte de daño nuevo               (inmediato)
-- 6  OT preventiva vencida               (resumen diario)
-- 7  Garantía por vencer                 (resumen diario)   ← Módulo 1
-- 8  Certificación/permiso por vencer    (inmediato)
-- 9  Medición fuera de rango             (inmediato)
-- 10 Activo requiere reemplazo           (inmediato)         ← Módulo 1
-- 11 Contrato por vencer                 (resumen diario)
-- 12 Activo al fin de vida útil          (resumen diario)    ← Módulo 1
-- Los eventos daily_digest usan digest_time (default '08:00', editable
-- por evento en T2 — decisión T2.4).
```

## Reglas y notas

- **CRUD exclusivo del Administrador** (T2). Cambios registrados en `audit_log`.
- **Patrón obligatorio** para cualquier evento nuevo (spec): fila editable aquí — destinatarios, modo, parámetro — **nunca hardcodeado** en la lógica de negocio (así se creó el Evento 12).
- El **motor del Módulo 1** (F1.4, F1.3, F1.9) solo "dispara" `event_id` + entidades; destinatarios/modo los resuelve la Edge Function de envío leyendo esta tabla.
- **Push a técnicos NO está aquí** (mecanismo separado con destinatario dinámico).
