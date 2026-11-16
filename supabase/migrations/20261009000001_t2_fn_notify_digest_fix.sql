-- Fix T2 (detectado al implementar M1): fn_notify despachaba SIEMPRE vía
-- pg_net con mode=immediate, incluso para eventos daily_digest — los eventos
-- 2/3/6/7/11/12 se enviaban solos en el momento en vez de agruparse en el
-- resumen diario (decisión T2.4). Ahora solo se dispara el http_post cuando
-- el modo del evento es 'immediate'; los digestos quedan pending y el cron
-- horario t2-digest (fn_enqueue_digest) los agrupa.

CREATE OR REPLACE FUNCTION public.fn_notify(
    p_event_id       SMALLINT,
    p_entity_type    TEXT DEFAULT NULL,
    p_entity_id      UUID DEFAULT NULL,
    p_dedup_key      TEXT DEFAULT NULL,
    p_payload        JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg  RECORD;
    v_id   UUID;
BEGIN
    SELECT is_active, mode INTO v_cfg
    FROM notification_config WHERE event_id = p_event_id FOR UPDATE;
    IF NOT FOUND OR v_cfg.is_active IS NOT TRUE THEN
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

    IF v_cfg.mode = 'immediate' THEN
        PERFORM net.http_post(
            url := 'https://wqqsaxoebrekdrmzjdod.supabase.co/functions/v1/send-notifications',
            headers := jsonb_build_object('Content-Type', 'application/json'),
            body := jsonb_build_object('mode', 'immediate', 'log_id', v_id)
        );
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notify(SMALLINT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_notify(SMALLINT, TEXT, UUID, TEXT, JSONB) TO authenticated, service_role;
