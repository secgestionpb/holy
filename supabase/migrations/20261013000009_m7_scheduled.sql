-- Migración 3 — Módulo 7: envío mensual programado (F7.5)
-- fn_due_scheduled_reports (RPC SECURITY DEFINER) vía pg_cron diario 06:00
-- → Edge Function send-scheduled-report (genera adjunto, envía, loguea)

CREATE OR REPLACE FUNCTION public.fn_due_scheduled_reports() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_period TEXT := to_char(now() - INTERVAL '1 month', 'YYYY-MM');
    v_rec    RECORD;
    v_count  INTEGER := 0;
BEGIN
    FOR v_rec IN
        SELECT sr.id, sr.report_key, sr.report_name, sr.format, sr.recipients
        FROM scheduled_reports sr
        WHERE sr.is_active
          AND sr.send_day = EXTRACT(DAY FROM CURRENT_DATE)
          AND NOT EXISTS (
              SELECT 1 FROM report_send_log l
              WHERE l.report_id = sr.id AND l.period_ym = v_period
          )
    LOOP
        PERFORM net.http_post(
            url := 'https://wqqsaxoebrekdrmzjdod.supabase.co/functions/v1/send-scheduled-report',
            headers := jsonb_build_object('Content-Type', 'application/json'),
            body := jsonb_build_object(
                'action',    'dispatch',
                'report_id', v_rec.id,
                'period_ym', v_period
            )
        );
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- Solo postgres (pg_cron) y service_role; authenticated no la invoca directamente
REVOKE EXECUTE ON FUNCTION public.fn_due_scheduled_reports() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fn_due_scheduled_reports() TO postgres, service_role;

-- Job diario 06:00 (hora del proyecto — mismo criterio que los jobs existentes)
SELECT cron.schedule('m7-scheduled-reports', '0 6 * * *',
    'SELECT public.fn_due_scheduled_reports()');
