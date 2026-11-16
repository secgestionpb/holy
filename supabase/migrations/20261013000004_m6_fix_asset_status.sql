-- Fix M6: assets no tiene columna is_active — el estado operativo es operational_status.
-- Corrige m6_register_measurement (column inexistente rompía el RPC con 42703).

CREATE OR REPLACE FUNCTION public.m6_register_measurement(
    p_measurement_type_id UUID,
    p_asset_id            UUID,
    p_value               NUMERIC,
    p_measured_at         TIMESTAMPTZ DEFAULT now(),
    p_notes               TEXT DEFAULT NULL,
    p_evidence_path       TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_type   RECORD;
    v_asset  RECORD;
    v_result TEXT;
    v_id     UUID;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('calidad') THEN
        RAISE EXCEPTION 'Requiere rol Calidad';
    END IF;

    SELECT * INTO v_type FROM measurement_types WHERE id = p_measurement_type_id;
    IF NOT FOUND OR v_type.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'Tipo de medición no encontrado o inactivo';
    END IF;

    SELECT id, code, name, category_id, operational_status
    INTO v_asset FROM assets WHERE id = p_asset_id;
    IF NOT FOUND OR v_asset.operational_status IS DISTINCT FROM 'operational' THEN
        RAISE EXCEPTION 'Activo no encontrado o fuera de servicio';
    END IF;
    -- El tipo filtra por categoría aplicable (spec: los activos son los puntos)
    IF v_asset.category_id IS DISTINCT FROM v_type.category_id THEN
        RAISE EXCEPTION 'El activo no pertenece a la categoría aplicable del tipo de medición';
    END IF;

    v_result := CASE WHEN p_value BETWEEN v_type.min_value AND v_type.max_value
                     THEN 'in_range' ELSE 'out_of_range' END;

    INSERT INTO measurement_records (
        measurement_type_id, asset_id, measured_at, value, result,
        recorded_by, notes, evidence_path)
    VALUES (
        p_measurement_type_id, p_asset_id, p_measured_at, p_value, v_result,
        auth.uid(), p_notes, p_evidence_path)
    RETURNING id INTO v_id;

    -- Evento 9 INMEDIATO cuando fuera de rango (spec out_of_range_notification)
    IF v_result = 'out_of_range' THEN
        PERFORM public.fn_notify(9::SMALLINT, 'measurement', v_id, NULL, jsonb_build_object(
            'type_name',  v_type.name,
            'unit',       v_type.unit,
            'asset_code', v_asset.code,
            'asset_name', v_asset.name,
            'asset_id',   v_asset.id,
            'value',      p_value,
            'min_value',  v_type.min_value,
            'max_value',  v_type.max_value,
            'measured_at', p_measured_at));
    END IF;

    RETURN jsonb_build_object('id', v_id, 'result', v_result);
END;
$$;
