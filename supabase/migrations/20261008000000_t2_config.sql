-- Migración 4 — T2 Configuración del sistema: motor de notificaciones
-- Fuente: markdown/T2-configuracion.md + T2-configuracion-flujos.md + BD/{notification_config,notification_log,push_subscriptions}.md
-- Nota (decisión T2.9): el despacho usa pg_net.http_post en lugar de pg_notify
-- (Supabase no tiene listener persistente para pg_notify; pg_net es el
-- equivalente práctico y está soportado en el hosting).
-- La URL del proyecto está fija abajo (project ref estable); endurecer con
-- secreto compartido = open_pending.

-- ============ notification_config (BD/notification_config.md) ============
CREATE TABLE notification_config (
    event_id    SMALLINT PRIMARY KEY CHECK (event_id BETWEEN 1 AND 12),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    channel     TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
    mode        TEXT NOT NULL CHECK (mode IN ('immediate', 'daily_digest')),
    digest_time TIME NOT NULL DEFAULT '08:00',
    recipients  TEXT[] NOT NULL DEFAULT '{}',
    extra_param INTEGER CHECK (extra_param IS NULL OR extra_param >= 0),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE notification_config IS
  'Catálogo FIJO de 12 eventos (spec no_crud de altas/bajas); el Admin solo edita modo/hora/destinatarios/parámetro/activo.';
COMMENT ON COLUMN notification_config.extra_param IS
  'Parámetro adicional en días (solo eventos 8 y 11). El evento 7 usa el GLOBAL system_parameters.dias_anticipacion_garantia.';

INSERT INTO notification_config (event_id, name, description, mode, extra_param) VALUES
  (1,  'OT afecta disponibilidad de venta', 'Cada alta/cierre de OT con afecta_disponibilidad de venta.', 'immediate', NULL),
  (2,  'OT preventiva generada',            'Resumen agrupado por plan con las OTs preventivas generadas.', 'daily_digest', NULL),
  (3,  'Stock bajo mínimo',                 'Resumen diario por bodega de ítems bajo su mínimo.', 'daily_digest', NULL),
  (4,  'Stock negativo',                    'Salida/ajuste que dejó stock negativo en una bodega.', 'immediate', NULL),
  (5,  'Reporte de daño nuevo',             'Cada alta de reporte de daño (catálogo M1).', 'immediate', NULL),
  (6,  'OT preventiva vencida',             'Lista acumulada diaria de OTs preventivas vencidas sin cerrar.', 'daily_digest', NULL),
  (7,  'Garantía por vencer',               'Días = system_parameters.dias_anticipacion_garantia (global). Aviso único por garantía.', 'daily_digest', NULL),
  (8,  'Certificación/permiso por vencer',  'Aviso único con días de anticipación (extra_param).', 'immediate', NULL),
  (9,  'Medición fuera de rango',           'Medición registrada fuera del rango permitido.', 'immediate', NULL),
  (10, 'Activo requiere reemplazo',         'etapa_de_vida del activo cambió a "Requiere reemplazo".', 'immediate', NULL),
  (11, 'Contrato por vencer',               'Resumen diario de contratos por vencer (días = extra_param).', 'daily_digest', NULL),
  (12, 'Activo al fin de vida útil',        'Vida útil restante del activo llegó a 0 o menos.', 'daily_digest', NULL);

-- ============ notification_log (BD/notification_log.md) ============
CREATE TABLE notification_log (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id           SMALLINT NOT NULL REFERENCES notification_config(event_id),
    dedup_key          TEXT NULL,
    target_entity_type TEXT NULL,
    target_entity_id   UUID NULL,
    payload            JSONB NULL,
    channel            TEXT NOT NULL DEFAULT 'email',
    recipients         TEXT[] NULL,
    status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at            TIMESTAMPTZ NULL,
    error_detail       TEXT NULL
);

CREATE UNIQUE INDEX uq_notification_log_dedup ON notification_log(event_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX idx_notification_log_event   ON notification_log(event_id, created_at DESC);
CREATE INDEX idx_notification_log_pending ON notification_log(status) WHERE status = 'pending';

-- ============ push_subscriptions (BD/push_subscriptions.md) — tabla lista,
-- mecanismo F-T2.4 diferido a M2 (credenciales FCM + PWA) ============
CREATE TABLE push_subscriptions (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fcm_token    TEXT NOT NULL UNIQUE,
    device_info  TEXT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_push_subscriptions_active_user ON push_subscriptions(user_id) WHERE is_active;

-- ============ RLS ============
ALTER TABLE notification_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_config_select ON notification_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY notification_config_update_admin ON notification_config
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
-- INSERT/DELETE: sin policy → solo service role (altas por seed/migración;
-- borrado prohibido por spec).

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_log_select_admin ON notification_log
  FOR SELECT TO authenticated USING (public.is_admin());
-- INSERT/UPDATE: solo service role / SECURITY DEFINER (fn_notify, send-notifications).

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_subscriptions_select_own ON push_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY push_subscriptions_insert_own ON push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY push_subscriptions_update_own ON push_subscriptions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- DELETE prohibido (baja = is_active=false).

-- ============ Helper de auditoría genérico (patrón T3 fn_audit_row) ============
-- Misma semántica que fn_audit (service_role) pero invocable por triggers
-- SECURITY DEFINER con el actor resuelto por GUC o auth.uid().
CREATE OR REPLACE FUNCTION public.fn_audit_row(
    p_module        TEXT,
    p_entity_type   TEXT,
    p_action        TEXT,
    p_entity_id     UUID DEFAULT NULL,
    p_entity_label  TEXT DEFAULT NULL,
    p_changes       JSONB DEFAULT NULL,
    p_reason        TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO audit_log
        (user_id, module, entity_type, entity_id, entity_label, action, changes, reason)
    VALUES
        (COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), '')::UUID, auth.uid()),
         p_module, p_entity_type, p_entity_id, p_entity_label, p_action, p_changes, p_reason)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- ============ Triggers de notification_config (actor + auditoría) ============
CREATE OR REPLACE FUNCTION public.fn_notification_config_touch() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    NEW.updated_by := COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), '')::UUID, auth.uid());
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notification_config_touch
    BEFORE UPDATE ON public.notification_config
    FOR EACH ROW EXECUTE FUNCTION public.fn_notification_config_touch();

CREATE OR REPLACE FUNCTION public.fn_audit_notification_config() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::JSONB;
BEGIN
    IF NEW.mode IS DISTINCT FROM OLD.mode THEN
        v_changes := v_changes || jsonb_build_object('mode', jsonb_build_object('old', OLD.mode, 'new', NEW.mode));
    END IF;
    IF NEW.digest_time IS DISTINCT FROM OLD.digest_time THEN
        v_changes := v_changes || jsonb_build_object('digest_time', jsonb_build_object('old', OLD.digest_time, 'new', NEW.digest_time));
    END IF;
    IF NEW.recipients IS DISTINCT FROM OLD.recipients THEN
        v_changes := v_changes || jsonb_build_object('recipients', jsonb_build_object('old', OLD.recipients, 'new', NEW.recipients));
    END IF;
    IF NEW.extra_param IS DISTINCT FROM OLD.extra_param THEN
        v_changes := v_changes || jsonb_build_object('extra_param', jsonb_build_object('old', OLD.extra_param, 'new', NEW.extra_param));
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('old', OLD.is_active, 'new', NEW.is_active));
    END IF;
    IF v_changes = '{}'::JSONB THEN
        RETURN NULL;
    END IF;
    PERFORM public.fn_audit_row(
        'configuration', 'notification_event', 'update', NULL,
        format('Evento %s — %s', OLD.event_id, OLD.name), v_changes, NULL);
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_audit_notification_config
    AFTER UPDATE ON public.notification_config
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_notification_config();

-- ============ updated_by en system_parameters ============
CREATE OR REPLACE FUNCTION public.fn_system_parameters_actor() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    NEW.updated_by := COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), '')::UUID, auth.uid(), NEW.updated_by);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_system_parameters_actor
    BEFORE UPDATE ON public.system_parameters
    FOR EACH ROW EXECUTE FUNCTION public.fn_system_parameters_actor();

-- ============ fn_notify (F-T2.2 — disparo desde módulos) ============
-- SECURITY DEFINER: los módulos (autenticados) encolan; el front nunca escribe
-- notification_log directamente (RLS). is_active=false silencia sin encolar;
-- dedup_key con UNIQUE parcial evita duplicados (decisión T2.5).
CREATE OR REPLACE FUNCTION public.fn_notify(
    p_event_id       SMALLINT,
    p_entity_type    TEXT DEFAULT NULL,
    p_entity_id      UUID DEFAULT NULL,
    p_dedup_key      TEXT DEFAULT NULL,
    p_payload        JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_active BOOLEAN;
    v_id     UUID;
BEGIN
    SELECT is_active INTO v_active FROM notification_config WHERE event_id = p_event_id FOR UPDATE;
    IF NOT FOUND OR v_active IS NOT TRUE THEN
        RETURN NULL;
    END IF;

    IF p_dedup_key IS NOT NULL AND EXISTS (
        SELECT 1 FROM notification_log WHERE event_id = p_event_id AND dedup_key = p_dedup_key
    ) THEN
        RETURN NULL;
    END IF;

    INSERT INTO notification_log (event_id, dedup_key, target_entity_type, target_entity_id, payload)
    VALUES (p_event_id, p_dedup_key, p_entity_type, p_entity_id, p_payload)
    RETURNING id INTO v_id;

    -- Despacho inmediato vía pg_net (decisión T2.9). Falla silenciosa aquí:
    -- la fila queda pending y el digest/reintento la cubre.
    PERFORM net.http_post(
        url := 'https://wqqsaxoebrekdrmzjdod.supabase.co/functions/v1/send-notifications',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('mode', 'immediate', 'log_id', v_id)
    );

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notify(SMALLINT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_notify(SMALLINT, TEXT, UUID, TEXT, JSONB) TO authenticated, service_role;

-- ============ fn_enqueue_digest (F-T2.3 — pg_cron horario) ============
-- Encola un digesto por evento activo en modo daily_digest con pendientes del
-- día (UTC — zona horaria del hotel = open_pending).
CREATE OR REPLACE FUNCTION public.fn_enqueue_digest() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg   RECORD;
    v_count INTEGER := 0;
    v_today DATE := (now() AT TIME ZONE 'utc')::date;
BEGIN
    FOR v_cfg IN
        SELECT event_id FROM notification_config
        WHERE is_active AND mode = 'daily_digest' AND digest_time <= (now() AT TIME ZONE 'utc')::time
    LOOP
        IF EXISTS (
            SELECT 1 FROM notification_log
            WHERE event_id = v_cfg.event_id AND status = 'pending' AND created_at >= v_today
        ) THEN
            PERFORM net.http_post(
                url := 'https://wqqsaxoebrekdrmzjdod.supabase.co/functions/v1/send-notifications',
                headers := jsonb_build_object('Content-Type', 'application/json'),
                body := jsonb_build_object('mode', 'digest', 'event_id', v_cfg.event_id)
            );
            v_count := v_count + 1;
        END IF;
    END LOOP;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_enqueue_digest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_digest() TO postgres, service_role, authenticated;

SELECT cron.schedule('t2-digest', '0 * * * *', $$SELECT public.fn_enqueue_digest()$$);
