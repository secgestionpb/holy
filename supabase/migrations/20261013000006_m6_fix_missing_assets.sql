-- Fix M6: m6_missing_measurements usaba assets.is_active (inexistente).
-- El estado operativo del activo es operational_status = 'operational'.

CREATE OR REPLACE FUNCTION public.m6_missing_measurements()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_result JSONB := '[]'::jsonb;
    v_t      RECORD;
    v_a      RECORD;
    v_last   TIMESTAMPTZ;
    v_window INTEGER;
BEGIN
    FOR v_t IN
        SELECT t.id AS type_id, t.name AS type_name, t.frequency, t.category_id,
               t.min_value, t.max_value, t.unit
        FROM measurement_types t
        JOIN categories c ON c.id = t.category_id AND c.is_active = true
        WHERE t.is_active = true
    LOOP
        v_window := CASE v_t.frequency
            WHEN 'daily'       THEN 1
            WHEN 'every_2_days' THEN 2
            WHEN 'weekly'      THEN 7
            WHEN 'biweekly'    THEN 15
            WHEN 'monthly'     THEN 30
            ELSE 1
        END;

        FOR v_a IN
            SELECT id, code, name
            FROM assets
            WHERE category_id = v_t.category_id
              AND operational_status = 'operational'
        LOOP
            SELECT MAX(measured_at) INTO v_last
            FROM measurement_records
            WHERE measurement_type_id = v_t.type_id AND asset_id = v_a.id;

            IF v_last IS NULL OR v_last < now() - (v_window || ' days')::INTERVAL THEN
                v_result := v_result || jsonb_build_array(jsonb_build_object(
                    'type_id',          v_t.type_id,
                    'type_name',        v_t.type_name,
                    'asset_id',         v_a.id,
                    'asset_code',       v_a.code,
                    'asset_name',       v_a.name,
                    'unit',             v_t.unit,
                    'last_measured_at', v_last,
                    'window_days',      v_window,
                    'days_overdue',     CASE WHEN v_last IS NULL THEN NULL
                        ELSE GREATEST(0, (EXTRACT(EPOCH FROM (now() - v_last)) / 86400)::INTEGER - v_window)
                    END));
            END IF;
        END LOOP;
    END LOOP;
    RETURN v_result;
END;
$$;
