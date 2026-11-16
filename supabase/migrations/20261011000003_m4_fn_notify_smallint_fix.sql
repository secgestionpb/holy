-- Fix M4 (detectado al implementar el front / smoke-m4): los triggers de
-- Evento 4 (stock negativo) y la RPC de Evento 3 (resumen bajo mínimo)
-- llamaban fn_notify(4, ...) / fn_notify(3, ...) con literales INTEGER y la
-- firma es fn_notify(SMALLINT, TEXT, UUID, TEXT, JSONB): PostgreSQL no aplica
-- cast implícito int4→int2 en la resolución de funciones → error 42883 al
-- disparar. Mismo fix que 20261010000005_m2_notify_reassign_fix (cast explícito).

CREATE OR REPLACE FUNCTION public.fn_m4_negative_stock() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_qty  NUMERIC;
    v_code TEXT;
    v_name TEXT;
    v_wh   TEXT;
    v_wo   TEXT;
BEGIN
    SELECT qty INTO v_qty
    FROM warehouse_stock
    WHERE warehouse_id = NEW.warehouse_id AND item_id = NEW.item_id;

    IF v_qty IS NULL OR v_qty >= 0 THEN
        RETURN NEW;
    END IF;

    SELECT code, name INTO v_code, v_name FROM items WHERE id = NEW.item_id;
    SELECT name INTO v_wh FROM warehouses WHERE id = NEW.warehouse_id;
    IF NEW.wo_id IS NOT NULL THEN
        SELECT wo_number INTO v_wo FROM work_orders WHERE id = NEW.wo_id;
    END IF;

    PERFORM public.fn_notify(4::SMALLINT, 'stock_movement', NEW.id,
        'negative-stock:' || NEW.id,
        jsonb_build_object(
            'item_id',   NEW.item_id,
            'item_code', v_code,
            'item_name', v_name,
            'warehouse_id', NEW.warehouse_id,
            'warehouse', v_wh,
            'wo_id',  NEW.wo_id,
            'wo_number', v_wo,
            'movement_type', NEW.type,
            'qty_result', v_qty,
            'instruction', 'Realiza un Ajuste de stock (M4.2) para reparar la diferencia.'));
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.m4_low_stock_summary() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_count  INTEGER := 0;
    v_wh     RECORD;
    v_items  JSONB;
BEGIN
    FOR v_wh IN
        SELECT ws.warehouse_id, w.name AS warehouse_name
        FROM warehouse_stock ws
        JOIN warehouses w ON w.id = ws.warehouse_id
        WHERE ws.qty < ws.min_stock
        GROUP BY ws.warehouse_id, w.name
    LOOP
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'item_id', i.id,
                   'code', i.code,
                   'name', i.name,
                   'unit', i.unit,
                   'qty', ws.qty,
                   'min_stock', ws.min_stock)
                   ORDER BY i.code), '[]'::jsonb)
        INTO v_items
        FROM warehouse_stock ws
        JOIN items i ON i.id = ws.item_id
        WHERE ws.warehouse_id = v_wh.warehouse_id
          AND ws.qty < ws.min_stock;

        PERFORM public.fn_notify(3::SMALLINT, 'warehouse', v_wh.warehouse_id,
            'low-stock:' || v_wh.warehouse_id::TEXT || ':' || CURRENT_DATE::TEXT,
            jsonb_build_object(
                'warehouse', v_wh.warehouse_name,
                'warehouse_id', v_wh.warehouse_id,
                'date', CURRENT_DATE::TEXT,
                'items', v_items,
                'count', jsonb_array_length(v_items)));
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;
