# push_subscriptions

> Módulo T2 — Dispositivos suscritos a notificaciones push (FCM). Mecanismo SEPARADO del correo (spec `push_notifications_separate_mechanism`): destinatario dinámico, no configurable en notification_config.
> Flujos: [F-T2.4](../T2-configuracion-flujos.md) (suscripción y envío) · disparos desde [F2.4](../02-ordenes-de-trabajo-flujos.md) (asignación/reasignación de OT).

```sql
CREATE TABLE push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fcm_token       TEXT NOT NULL UNIQUE,   -- token del dispositivo (FCM)
    device_info     TEXT NULL,              -- user agent / plataforma (PWA)
    is_active       BOOLEAN NOT NULL DEFAULT true,
                    -- logout o cambio de cuenta → false (no borrar fila:
                    -- permite detectar re-suscripción)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ps_user_active ON push_subscriptions (user_id) WHERE is_active;
```

## Reglas de negocio

- **N:1 usuario** — un técnico puede tener móvil + tablet; el envío usa todos los `is_active` del destinatario.
- **Destinatario DINÁMICO** (spec): el/los técnico(s) afectado(s) por la OT — NO es un campo configurable; por eso vive FUERA de notification_config/notification_log.
- **Triggers** (spec): OT asignada · OT reasignada (push al receptor y al que pierde la OT) · OT propia modificada por OTRO usuario (sin push si modifica el propio técnico).
- **No-triggers** (spec): OT reabierta · comentario nuevo en la OT.
- **Alta**: la PWA tras login pide permiso → token → upsert; **baja**: logout/cambio de cuenta → `is_active = false`. Tokens inválidos (FCM NOT_FOUND) → `is_active = false` (limpieza al implementar — pendiente T2).
- **Requisito**: PWA instalada en el dispositivo (spec `infrastructure_dependency`) — sin ella no hay push (y estos casos no tienen correo equivalente).
- Sin dedup propia: la semántica de "una OT" la resuelve el envío (un push por disparo).

## Uso en el Módulo 1

- Ninguno. Los disparos viven en M2 (asignación de OTs); FK a `users` (T1).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Técnico (dueño) | SELECT/INSERT/UPDATE de sus propias filas (`auth.uid() = user_id`) |
| Administrador | SELECT (diagnóstico) |
| Service role (Edge Function) | Lectura completa para enviar |
| Todos | DELETE directo prohibido (baja = is_active=false) |
