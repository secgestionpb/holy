-- Fix T2: headers de net.http_post debían ser jsonb_build_object, no un cast
-- de string inválido ('Content-Type: application/json'::jsonb fallaba con
-- "invalid input syntax for type json"). Reemplaza ambas funciones.

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
