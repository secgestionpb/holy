-- Migración 8 — Módulo 4 core: guards + auditoría + notificaciones + RPCs + vistas
-- Fuente: 04-inventario-flujos.md (F4.1–F4.9, V4.1–V4.4, M4.1–M4.4,
-- <notifications>, <supabase_mapping>) + BD/{items,warehouses,warehouse_stock,
-- stock_movements,physical_counts}.md
-- Decisiones de sesión aplicadas (documentadas en implementation_notes):
--  · Stock↔kardex consistente por RPCs transaccionales (app.m4_rpc GUC), NO
--    por trigger — <supabase_mapping><engine> (patrón de guards de M2).
--  · Transferencia = par de filas de kardex ATÓMICO (salida origen qty<0 +
--    entrada destino qty>0) — F4.7 paso 2 "INSERT salida + INSERT entrada".
--  · Devolución por LÍNEA de consumo: origin_movement_id (F4.5 + F2.9
--    "máx = consumido − ya devuelto").
--  · Evento 4 (inmediato): trigger AFTER INSERT sobre kardex cuando la fila
--    de stock resultante queda < 0 (sin dedup — cada movimiento notifica).
--  · Evento 3 (F4.9): pg_cron diario m4-low-stock → resumen POR BODEGA con
--    dedup por día; horario provisorio 06:40 UTC (open_pending: coordinar
--    con el job de M3).

-- ============ Touch: created_by / updated_by en catálogos (patrón del sistema) ============
CREATE OR REPLACE FUNCTION public.fn_m4_catalog_touch() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.created_by IS NULL THEN
            NEW.created_by := COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), '')::UUID, auth.uid());
        END IF;
        RETURN NEW;
    END IF;
    NEW.updated_by := COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), '')::UUID, auth.uid());
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_m4_items_touch
    BEFORE INSERT OR UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION public.fn_m4_catalog_touch();

CREATE TRIGGER trg_m4_warehouses_touch
    BEFORE INSERT OR UPDATE ON warehouses
    FOR EACH ROW EXECUTE FUNCTION public.fn_m4_catalog_touch();

CREATE TRIGGER trg_m4_item_categories_touch
    BEFORE INSERT OR UPDATE ON item_categories
    FOR EACH ROW EXECUTE FUNCTION public.fn_m4_catalog_touch();

-- ============ Helper interno: aplicar variación de stock (solo RPCs) ============
-- REVOKE total a authenticated: el front no puede invocarla (consistencia
-- stock↔kardex garantizada en m4_*). Upsert + lock implícito por la fila.
CREATE OR REPLACE FUNCTION public.m4_apply_stock(
    p_warehouse_id UUID,
    p_item_id      UUID,
    p_delta        NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_qty NUMERIC;
BEGIN
    INSERT INTO warehouse_stock (warehouse_id, item_id, qty)
    VALUES (p_warehouse_id, p_item_id, p_delta)
    ON CONFLICT (warehouse_id, item_id)
    DO UPDATE SET qty = warehouse_stock.qty + p_delta, updated_at = now()
    RETURNING qty INTO v_qty;
    RETURN v_qty;
END;
$$;

REVOKE ALL ON FUNCTION public.m4_apply_stock(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m4_apply_stock(UUID, UUID, NUMERIC) TO service_role;

-- ============ Código de ítem REP-#### (F4.1 / code_counters, patrón EF M1) ============
-- preview: propone sin reservar · allocate: reserva consecutivo · check: unicidad.
CREATE OR REPLACE FUNCTION public.m4_item_code(
    p_action  TEXT DEFAULT 'preview',
    p_code    TEXT DEFAULT NULL,
    p_item_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_max     BIGINT := 0;
    v_next    BIGINT;
    v_code    TEXT;
    v_counter BIGINT;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF p_action NOT IN ('preview', 'allocate', 'check') THEN
        RAISE EXCEPTION 'Acción inválida';
    END IF;

    IF p_action = 'check' THEN
        IF NULLIF(trim(COALESCE(p_code, '')), '') IS NULL THEN
            RAISE EXCEPTION 'Falta el código';
        END IF;
        RETURN jsonb_build_object('available', NOT EXISTS (
            SELECT 1 FROM items
            WHERE code = trim(p_code) AND (p_item_id IS NULL OR id <> p_item_id)
        ));
    END IF;

    -- Toma MAX del patrón para saltar códigos editados manualmente (spec)
    SELECT COALESCE(MAX((substring(code FROM '^REP-([0-9]+)$'))::BIGINT), 0)
    INTO v_max
    FROM items
    WHERE code ~ '^REP-[0-9]+$';

    SELECT next_value INTO v_counter
    FROM code_counters
    WHERE prefix = 'REP' AND location_id IS NULL
    FOR UPDATE;

    v_next := GREATEST(v_max + 1, COALESCE(v_counter, 1));
    v_code := 'REP-' || lpad(v_next::TEXT, 4, '0');
    WHILE EXISTS (SELECT 1 FROM items WHERE code = v_code) LOOP
        v_next := v_next + 1;
        v_code := 'REP-' || lpad(v_next::TEXT, 4, '0');
    END LOOP;

    IF p_action = 'allocate' THEN
        -- UPDATE primero: ON CONFLICT (prefix, location_id) no cubre el
        -- índice parcial con location_id IS NULL.
        UPDATE code_counters SET next_value = v_next + 1
        WHERE prefix = 'REP' AND location_id IS NULL;
        IF NOT FOUND THEN
            INSERT INTO code_counters (prefix, location_id, next_value)
            VALUES ('REP', NULL, v_next + 1);
        END IF;
    END IF;

    RETURN jsonb_build_object('code', v_code, 'action', p_action);
END;
$$;

REVOKE ALL ON FUNCTION public.m4_item_code(TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m4_item_code(TEXT, TEXT, UUID) TO authenticated, service_role;

-- ============ Guards (patrón m2: los RPCs setean app.m4_rpc='1') ============

-- Stock: qty solo vía RPC; el front pre-alta filas (V4.2) con qty=0 y edita
-- min_stock (decisión de sesión: mínimo pre-definible sin existencias).
CREATE OR REPLACE FUNCTION public.fn_m4_stock_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF current_setting('app.m4_rpc', TRUE) = '1' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
           OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
            RAISE EXCEPTION 'La fila de stock no cambia de bodega/ítem';
        END IF;
        IF NEW.qty IS DISTINCT FROM OLD.qty THEN
            RAISE EXCEPTION 'El stock solo cambia vía movimientos (entrada/ajuste/transferencia/consumo/devolución)';
        END IF;
    ELSE
        IF NEW.qty <> 0 THEN
            RAISE EXCEPTION 'La fila de stock se crea con qty 0; el stock entra vía movimientos (RPC m4_*)';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_m4_stock_guard
    BEFORE INSERT OR UPDATE ON warehouse_stock
    FOR EACH ROW EXECUTE FUNCTION public.fn_m4_stock_guard();

-- Ítems: el costo unitario SOLO lo actualiza una Entrada (F4.3 / valuation).
CREATE OR REPLACE FUNCTION public.fn_m4_items_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF current_setting('app.m4_rpc', TRUE) = '1' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.unit_cost <> 0 THEN
            RAISE EXCEPTION 'El costo inicial es 0: regístralo con una Entrada (F4.3)';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost THEN
        RAISE EXCEPTION 'El costo unitario solo lo actualiza una Entrada (F4.3)';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Sin permiso para modificar created_at';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_m4_items_guard
    BEFORE INSERT OR UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION public.fn_m4_items_guard();

-- Kardex append-only: patrón audit_log (una corrección es un NUEVO ajuste).
CREATE OR REPLACE FUNCTION public.fn_m4_kardex_immutable() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'El kardex es append-only: % prohibido en stock_movements (corrige con un Ajuste)', TG_OP;
END;
$$;

CREATE TRIGGER trg_m4_kardex_immutable
    BEFORE UPDATE OR DELETE ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION public.fn_m4_kardex_immutable();

-- Conteo físico: identidad fija al crear; confirmar/cancelar SOLO vía RPC
-- (generan los ajustes en la misma transacción); estados terminales inmutables.
CREATE OR REPLACE FUNCTION public.fn_m4_count_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Los conteos físicos no se eliminan (usa Cancelar con motivo)';
    END IF;
    IF OLD.status <> 'in_progress' THEN
        RAISE EXCEPTION 'El conteo está %: es inmutable (corrección = nuevo conteo o ajuste manual)', OLD.status;
    END IF;
    IF NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
       OR NEW.scope_type IS DISTINCT FROM OLD.scope_type
       OR NEW.scope_category_id IS DISTINCT FROM OLD.scope_category_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'No se modifica la identidad del conteo';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND COALESCE(current_setting('app.m4_rpc', TRUE), '') <> '1' THEN
        RAISE EXCEPTION 'Confirma o cancela el conteo vía RPC (m4_count_confirm / m4_count_cancel)';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_m4_count_guard
    BEFORE UPDATE OR DELETE ON physical_counts
    FOR EACH ROW EXECUTE FUNCTION public.fn_m4_count_guard();

-- Detalle del conteo: teórico CONGELADO; contado/observación solo mientras
-- el conteo está En proceso; sin altas/bajas de renglones (alcance fijo).
CREATE OR REPLACE FUNCTION public.fn_m4_count_items_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'El detalle del conteo no se modifica (alcance congelado al iniciar)';
    END IF;
    IF NEW.theoretical IS DISTINCT FROM OLD.theoretical
       OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
        RAISE EXCEPTION 'El teórico congelado y el ítem del conteo no se modifican';
    END IF;
    SELECT status INTO v_status FROM physical_counts WHERE id = OLD.count_id;
    IF v_status IS DISTINCT FROM 'in_progress' THEN
        RAISE EXCEPTION 'El conteo está %: su detalle es de solo lectura', COALESCE(v_status, '???');
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_m4_count_items_guard
    BEFORE UPDATE OR DELETE ON physical_count_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_m4_count_items_guard();

-- ============ Auditoría M4 (T3 — module 'inventory', append-only) ============

CREATE OR REPLACE FUNCTION public.fn_audit_items() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'code',  jsonb_build_object('old', NULL, 'new', NEW.code),
            'name',  jsonb_build_object('old', NULL, 'new', NEW.name),
            'unit',  jsonb_build_object('old', NULL, 'new', NEW.unit),
            'item_category_id', jsonb_build_object('old', NULL, 'new', NEW.item_category_id),
            'is_active', jsonb_build_object('old', NULL, 'new', NEW.is_active));
    ELSE
        IF NEW.code IS DISTINCT FROM OLD.code THEN
            v_changes := v_changes || jsonb_build_object('code', jsonb_build_object('old', OLD.code, 'new', NEW.code));
        END IF;
        IF NEW.name IS DISTINCT FROM OLD.name THEN
            v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
        END IF;
        IF NEW.description IS DISTINCT FROM OLD.description THEN
            v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', OLD.description, 'new', NEW.description));
        END IF;
        IF NEW.item_category_id IS DISTINCT FROM OLD.item_category_id THEN
            v_changes := v_changes || jsonb_build_object('item_category_id', jsonb_build_object('old', OLD.item_category_id, 'new', NEW.item_category_id));
        END IF;
        IF NEW.unit IS DISTINCT FROM OLD.unit THEN
            v_changes := v_changes || jsonb_build_object('unit', jsonb_build_object('old', OLD.unit, 'new', NEW.unit));
        END IF;
        IF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost THEN
            v_changes := v_changes || jsonb_build_object('unit_cost', jsonb_build_object('old', OLD.unit_cost, 'new', NEW.unit_cost));
        END IF;
        IF NEW.bin_location IS DISTINCT FROM OLD.bin_location THEN
            v_changes := v_changes || jsonb_build_object('bin_location', jsonb_build_object('old', OLD.bin_location, 'new', NEW.bin_location));
        END IF;
        IF NEW.preferred_provider_id IS DISTINCT FROM OLD.preferred_provider_id THEN
            v_changes := v_changes || jsonb_build_object('preferred_provider_id', jsonb_build_object('old', OLD.preferred_provider_id, 'new', NEW.preferred_provider_id));
        END IF;
        IF NEW.image_path IS DISTINCT FROM OLD.image_path THEN
            v_changes := v_changes || jsonb_build_object('image_path', jsonb_build_object('old', OLD.image_path, 'new', NEW.image_path));
        END IF;
        IF NEW.technical_sheet_path IS DISTINCT FROM OLD.technical_sheet_path THEN
            v_changes := v_changes || jsonb_build_object('technical_sheet_path', jsonb_build_object('old', OLD.technical_sheet_path, 'new', NEW.technical_sheet_path));
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('old', OLD.is_active, 'new', NEW.is_active));
            IF NEW.is_active = false THEN v_action := 'deactivate'; END IF;
        END IF;
        IF v_changes = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
    END IF;

    PERFORM public.fn_audit_row('inventory', 'item', v_action,
        COALESCE(NEW.id, OLD.id),
        'Repuesto ' || COALESCE(NEW.code, OLD.code) || ' — ' || COALESCE(NEW.name, OLD.name),
        v_changes, NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_items
    AFTER INSERT OR UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_items();

CREATE OR REPLACE FUNCTION public.fn_audit_item_categories() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'name', jsonb_build_object('old', NULL, 'new', NEW.name),
            'is_active', jsonb_build_object('old', NULL, 'new', NEW.is_active));
    ELSE
        IF NEW.name IS DISTINCT FROM OLD.name THEN
            v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
        END IF;
        IF NEW.description IS DISTINCT FROM OLD.description THEN
            v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', OLD.description, 'new', NEW.description));
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('old', OLD.is_active, 'new', NEW.is_active));
            IF NEW.is_active = false THEN v_action := 'deactivate'; END IF;
        END IF;
        IF v_changes = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
    END IF;

    PERFORM public.fn_audit_row('inventory', 'item_category', v_action,
        COALESCE(NEW.id, OLD.id), COALESCE(NEW.name, OLD.name), v_changes,
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_item_categories
    AFTER INSERT OR UPDATE ON item_categories
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_item_categories();

CREATE OR REPLACE FUNCTION public.fn_audit_warehouses() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'name', jsonb_build_object('old', NULL, 'new', NEW.name),
            'is_active', jsonb_build_object('old', NULL, 'new', NEW.is_active));
    ELSE
        IF NEW.name IS DISTINCT FROM OLD.name THEN
            v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
        END IF;
        IF NEW.description IS DISTINCT FROM OLD.description THEN
            v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', OLD.description, 'new', NEW.description));
        END IF;
        IF NEW.responsible_id IS DISTINCT FROM OLD.responsible_id THEN
            v_changes := v_changes || jsonb_build_object('responsible_id', jsonb_build_object('old', OLD.responsible_id, 'new', NEW.responsible_id));
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('old', OLD.is_active, 'new', NEW.is_active));
            IF NEW.is_active = false THEN v_action := 'deactivate'; END IF;
        END IF;
        IF v_changes = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
    END IF;

    PERFORM public.fn_audit_row('inventory', 'warehouse', v_action,
        COALESCE(NEW.id, OLD.id), 'Bodega ' || COALESCE(NEW.name, OLD.name),
        v_changes, NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_warehouses
    AFTER INSERT OR UPDATE ON warehouses
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_warehouses();

-- Cada fila de kardex genera su auditoría (usuario/fecha/referencia ya viven
-- en la fila; el audit_log alimenta el historial consultable por T3).
CREATE OR REPLACE FUNCTION public.fn_audit_stock_movements() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_action TEXT;
    v_label  TEXT;
BEGIN
    v_action := CASE NEW.type
        WHEN 'entrada'      THEN 'entry'
        WHEN 'salida_ot'    THEN 'exit'
        WHEN 'ajuste'       THEN 'adjust'
        WHEN 'devolucion'   THEN 'return'
        WHEN 'transferencia' THEN 'transfer'
        ELSE 'update'
    END;
    SELECT 'Repuesto ' || code || ' — ' || name INTO v_label
    FROM items WHERE id = NEW.item_id;

    PERFORM public.fn_audit_row('inventory', 'stock_movement', v_action,
        NEW.id, v_label,
        jsonb_build_object(
            'type',        jsonb_build_object('old', NULL, 'new', NEW.type),
            'item_id',     jsonb_build_object('old', NULL, 'new', NEW.item_id),
            'warehouse_id', jsonb_build_object('old', NULL, 'new', NEW.warehouse_id),
            'destiny_warehouse_id', jsonb_build_object('old', NULL, 'new', NEW.destiny_warehouse_id),
            'qty',         jsonb_build_object('old', NULL, 'new', NEW.qty),
            'unit_cost',   jsonb_build_object('old', NULL, 'new', NEW.unit_cost),
            'line_total',  jsonb_build_object('old', NULL, 'new', NEW.line_total),
            'wo_id',       jsonb_build_object('old', NULL, 'new', NEW.wo_id),
            'document_number', jsonb_build_object('old', NULL, 'new', NEW.document_number),
            'count_id',    jsonb_build_object('old', NULL, 'new', NEW.count_id)),
        NEW.reason);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_stock_movements
    AFTER INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_stock_movements();

CREATE OR REPLACE FUNCTION public.fn_audit_physical_counts() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'state_change' END;
    v_label   TEXT;
    v_wh      TEXT;
BEGIN
    SELECT name INTO v_wh FROM warehouses WHERE id = COALESCE(NEW.warehouse_id, OLD.warehouse_id);
    v_label := 'Conteo físico ' || COALESCE(NEW.count_date, OLD.count_date)::TEXT || ' — ' || COALESCE(v_wh, '?');

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'warehouse_id', jsonb_build_object('old', NULL, 'new', NEW.warehouse_id),
            'scope_type',   jsonb_build_object('old', NULL, 'new', NEW.scope_type),
            'scope_category_id', jsonb_build_object('old', NULL, 'new', NEW.scope_category_id),
            'count_date',   jsonb_build_object('old', NULL, 'new', NEW.count_date),
            'responsible_id', jsonb_build_object('old', NULL, 'new', NEW.responsible_id));
    ELSE
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
            v_action := CASE NEW.status
                WHEN 'confirmed' THEN 'confirm'
                WHEN 'cancelled' THEN 'cancel'
                ELSE 'state_change'
            END;
        END IF;
        IF NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
            v_changes := v_changes || jsonb_build_object('cancel_reason', jsonb_build_object('old', OLD.cancel_reason, 'new', NEW.cancel_reason));
        END IF;
        IF NEW.responsible_id IS DISTINCT FROM OLD.responsible_id THEN
            v_changes := v_changes || jsonb_build_object('responsible_id', jsonb_build_object('old', OLD.responsible_id, 'new', NEW.responsible_id));
        END IF;
        IF NEW.count_date IS DISTINCT FROM OLD.count_date THEN
            v_changes := v_changes || jsonb_build_object('count_date', jsonb_build_object('old', OLD.count_date, 'new', NEW.count_date));
        END IF;
        IF v_changes = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
    END IF;

    PERFORM public.fn_audit_row('inventory', 'physical_count', v_action,
        COALESCE(NEW.id, OLD.id), v_label, v_changes,
        COALESCE(NULLIF(current_setting('app.audit_reason', TRUE), ''), NEW.cancel_reason));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_physical_counts
    AFTER INSERT OR UPDATE ON physical_counts
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_physical_counts();

-- ============ Evento 4 — Stock negativo (inmediato, sin dedup por movimiento) ============
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

    PERFORM public.fn_notify(4, 'stock_movement', NEW.id,
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

CREATE TRIGGER trg_m4_negative_stock
    AFTER INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION public.fn_m4_negative_stock();

-- ============ RPC m4_entry — Entrada de material (F4.3 / modal M4.1) ============
CREATE OR REPLACE FUNCTION public.m4_entry(
    p_item_id         UUID,
    p_warehouse_id    UUID,
    p_qty             NUMERIC,
    p_unit_cost       NUMERIC,
    p_document_number TEXT,
    p_occurred_at     TIMESTAMPTZ DEFAULT NULL,
    p_provider_id     UUID DEFAULT NULL,
    p_note            TEXT DEFAULT NULL,
    p_actor           UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor    UUID := COALESCE(auth.uid(), p_actor);
    v_item     items%ROWTYPE;
    v_wh       warehouses%ROWTYPE;
    v_qty      NUMERIC;
    v_mov_id   UUID;
    v_provider UUID;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Se requiere el usuario que registra la entrada';
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
    END IF;
    IF p_unit_cost IS NULL OR p_unit_cost <= 0 THEN
        RAISE EXCEPTION 'El costo unitario debe ser mayor a 0';
    END IF;
    IF NULLIF(trim(COALESCE(p_document_number, '')), '') IS NULL THEN
        RAISE EXCEPTION 'El nº de factura/documento es obligatorio';
    END IF;

    SELECT * INTO v_item FROM items WHERE id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ítem inexistente';
    END IF;
    IF NOT v_item.is_active THEN
        RAISE EXCEPTION 'El ítem está inactivo: no admite nuevas entradas';
    END IF;

    SELECT * INTO v_wh FROM warehouses WHERE id = p_warehouse_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bodega inexistente';
    END IF;
    IF NOT v_wh.is_active THEN
        RAISE EXCEPTION 'La bodega está inactiva: bloquea nuevas entradas';
    END IF;

    v_provider := COALESCE(p_provider_id, v_item.preferred_provider_id);

    PERFORM set_config('app.m4_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), ''), TRUE);

    v_qty := public.m4_apply_stock(p_warehouse_id, p_item_id, p_qty);

    -- Último costo de compra (spec valuation): lo escribe ESTA entrada
    UPDATE items SET unit_cost = p_unit_cost WHERE id = p_item_id;

    INSERT INTO stock_movements (
        type, item_id, warehouse_id, qty, unit_cost, line_total,
        document_number, provider_id, reason, user_id, occurred_at
    ) VALUES (
        'entrada', p_item_id, p_warehouse_id, p_qty, p_unit_cost,
        round(p_qty * p_unit_cost, 2),
        trim(p_document_number), v_provider,
        NULLIF(trim(COALESCE(p_note, '')), ''),
        v_actor, COALESCE(p_occurred_at, now())
    ) RETURNING id INTO v_mov_id;

    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.m4_rpc', '', TRUE);

    RETURN jsonb_build_object(
        'movement_id', v_mov_id,
        'new_qty', v_qty,
        'new_unit_cost', p_unit_cost);
END;
$$;

REVOKE ALL ON FUNCTION public.m4_entry(UUID, UUID, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m4_entry(UUID, UUID, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, UUID, TEXT, UUID) TO authenticated, service_role;

-- ============ RPC m4_adjust — Ajuste manual (F4.6 / modal M4.2) ============
CREATE OR REPLACE FUNCTION public.m4_adjust(
    p_item_id      UUID,
    p_warehouse_id UUID,
    p_delta        NUMERIC,
    p_reason       TEXT,
    p_note         TEXT DEFAULT NULL,
    p_actor        UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor   UUID := COALESCE(auth.uid(), p_actor);
    v_item    items%ROWTYPE;
    v_wh      warehouses%ROWTYPE;
    v_qty     NUMERIC;
    v_mov_id  UUID;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Se requiere el usuario que registra el ajuste';
    END IF;
    IF p_delta IS NULL OR p_delta = 0 THEN
        RAISE EXCEPTION 'La cantidad del ajuste debe ser distinta de 0';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'El motivo del ajuste es obligatorio';
    END IF;

    SELECT * INTO v_item FROM items WHERE id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ítem inexistente';
    END IF;
    SELECT * INTO v_wh FROM warehouses WHERE id = p_warehouse_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bodega inexistente';
    END IF;
    IF p_delta > 0 AND NOT v_wh.is_active THEN
        RAISE EXCEPTION 'La bodega está inactiva: bloquea nuevas entradas';
    END IF;

    PERFORM set_config('app.m4_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), ''), TRUE);

    v_qty := public.m4_apply_stock(p_warehouse_id, p_item_id, p_delta);

    INSERT INTO stock_movements (
        type, item_id, warehouse_id, qty, unit_cost, line_total,
        reason, user_id, occurred_at
    ) VALUES (
        'ajuste', p_item_id, p_warehouse_id, p_delta, v_item.unit_cost,
        round(abs(p_delta) * v_item.unit_cost, 2),
        trim(p_reason), v_actor, now()
    ) RETURNING id INTO v_mov_id;

    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.m4_rpc', '', TRUE);

    RETURN jsonb_build_object('movement_id', v_mov_id, 'new_qty', v_qty);
END;
$$;

REVOKE ALL ON FUNCTION public.m4_adjust(UUID, UUID, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m4_adjust(UUID, UUID, NUMERIC, TEXT, TEXT, UUID) TO authenticated, service_role;

-- ============ RPC m4_transfer — Transferencia atómica (F4.7 / modal M4.3) ============
-- Par de filas de kardex en una transacción: salida origen (qty<0) + entrada
-- destino (qty>0); costo unitario INTACTO en ambos (spec transfer_rule).
CREATE OR REPLACE FUNCTION public.m4_transfer(
    p_item_id      UUID,
    p_origin_id    UUID,
    p_destiny_id   UUID,
    p_qty          NUMERIC,
    p_note         TEXT DEFAULT NULL,
    p_actor        UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor   UUID := COALESCE(auth.uid(), p_actor);
    v_item    items%ROWTYPE;
    v_origin  warehouses%ROWTYPE;
    v_destiny warehouses%ROWTYPE;
    v_origin_qty   NUMERIC;
    v_destiny_qty  NUMERIC;
    v_mov_out UUID;
    v_mov_in  UUID;
    v_cost    NUMERIC;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Se requiere el usuario que transfiere';
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
    END IF;
    IF p_origin_id = p_destiny_id THEN
        RAISE EXCEPTION 'La bodega destino debe ser distinta al origen';
    END IF;

    SELECT * INTO v_item FROM items WHERE id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ítem inexistente';
    END IF;
    IF NOT v_item.is_active THEN
        RAISE EXCEPTION 'El ítem está inactivo: no admite nuevas entradas';
    END IF;
    SELECT * INTO v_origin FROM warehouses WHERE id = p_origin_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bodega origen inexistente';
    END IF;
    SELECT * INTO v_destiny FROM warehouses WHERE id = p_destiny_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bodega destino inexistente';
    END IF;
    IF NOT v_destiny.is_active THEN
        RAISE EXCEPTION 'La bodega destino está inactiva: bloquea nuevas entradas';
    END IF;
    -- Origen sin stock suficiente: se ADVIERTÉ en el modal pero se PERMITE
    -- (regla global de stock negativo → Evento 4 si queda < 0).

    v_cost := v_item.unit_cost;

    PERFORM set_config('app.m4_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), ''), TRUE);

    v_origin_qty  := public.m4_apply_stock(p_origin_id, p_item_id, -p_qty);
    v_destiny_qty := public.m4_apply_stock(p_destiny_id, p_item_id, p_qty);

    -- Salida en origen (qty<0): warehouse=origen, destiny=destino
    INSERT INTO stock_movements (
        type, item_id, warehouse_id, destiny_warehouse_id, qty, unit_cost,
        line_total, reason, user_id, occurred_at
    ) VALUES (
        'transferencia', p_item_id, p_origin_id, p_destiny_id, -p_qty, v_cost,
        round(p_qty * v_cost, 2), NULLIF(trim(COALESCE(p_note, '')), ''),
        v_actor, now()
    ) RETURNING id INTO v_mov_out;

    -- Entrada en destino (qty>0): warehouse=destino, destiny=origen (par)
    INSERT INTO stock_movements (
        type, item_id, warehouse_id, destiny_warehouse_id, qty, unit_cost,
        line_total, reason, user_id, occurred_at
    ) VALUES (
        'transferencia', p_item_id, p_destiny_id, p_origin_id, p_qty, v_cost,
        round(p_qty * v_cost, 2), NULLIF(trim(COALESCE(p_note, '')), ''),
        v_actor, now()
    ) RETURNING id INTO v_mov_in;

    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.m4_rpc', '', TRUE);

    RETURN jsonb_build_object(
        'origin_qty', v_origin_qty,
        'destiny_qty', v_destiny_qty,
        'movement_out_id', v_mov_out,
        'movement_in_id', v_mov_in);
END;
$$;

REVOKE ALL ON FUNCTION public.m4_transfer(UUID, UUID, UUID, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m4_transfer(UUID, UUID, UUID, NUMERIC, TEXT, UUID) TO authenticated, service_role;

-- ============ RPC m4_consume — Salida por OT (F4.4 / picker F2.5) ============
-- Técnico SOLO en sus OT asignadas (is_assigned_wo) o Mantenimiento en
-- cualquier OT. Costo CONGELADO al momento del consumo. Stock negativo
-- permitido (Evento 4 vía trigger).
CREATE OR REPLACE FUNCTION public.m4_consume(
    p_wo_id        UUID,
    p_item_id      UUID,
    p_warehouse_id UUID,
    p_qty          NUMERIC,
    p_note         TEXT DEFAULT NULL,
    p_actor        UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor  UUID := COALESCE(auth.uid(), p_actor);
    v_wo     work_orders%ROWTYPE;
    v_item   items%ROWTYPE;
    v_qty    NUMERIC;
    v_stock  NUMERIC;
    v_cost   NUMERIC;
    v_mov_id UUID;
BEGIN
    IF auth.uid() IS NOT NULL
       AND NOT (public.has_role('mantenimiento') OR public.is_assigned_wo(p_wo_id)) THEN
        RAISE EXCEPTION 'Solo Mantenimiento o técnicos asignados pueden consumir en esta OT';
    END IF;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Se requiere el usuario que consume';
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
    END IF;

    SELECT * INTO v_wo FROM work_orders WHERE id = p_wo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OT inexistente';
    END IF;
    IF v_wo.status = 'closed' THEN
        RAISE EXCEPTION 'La OT está Cerrada: los consumos son de solo lectura';
    END IF;
    IF v_wo.status = 'cancelled' THEN
        RAISE EXCEPTION 'La OT está Cancelada: no admite consumos';
    END IF;

    SELECT * INTO v_item FROM items WHERE id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ítem inexistente';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_warehouse_id) THEN
        RAISE EXCEPTION 'Bodega inexistente';
    END IF;
    -- Fila de stock debe existir (el ítem ya fue recepcionado en esa bodega)
    SELECT qty INTO v_stock FROM warehouse_stock
    WHERE warehouse_id = p_warehouse_id AND item_id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El ítem no tiene existencias registradas en esa bodega (registra una Entrada primero)';
    END IF;

    v_cost := v_item.unit_cost;

    PERFORM set_config('app.m4_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), ''), TRUE);

    v_qty := public.m4_apply_stock(p_warehouse_id, p_item_id, -p_qty);

    INSERT INTO stock_movements (
        type, item_id, warehouse_id, qty, unit_cost, line_total,
        wo_id, reason, user_id, occurred_at
    ) VALUES (
        'salida_ot', p_item_id, p_warehouse_id, -p_qty, v_cost,
        round(p_qty * v_cost, 2), p_wo_id,
        NULLIF(trim(COALESCE(p_note, '')), ''), v_actor, now()
    ) RETURNING id INTO v_mov_id;

    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.m4_rpc', '', TRUE);

    RETURN jsonb_build_object(
        'movement_id', v_mov_id,
        'new_qty', v_qty,
        'unit_cost', v_cost,
        'line_total', round(p_qty * v_cost, 2));
END;
$$;

REVOKE ALL ON FUNCTION public.m4_consume(UUID, UUID, UUID, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m4_consume(UUID, UUID, UUID, NUMERIC, TEXT, UUID) TO authenticated, service_role;

-- ============ RPC m4_return — Devolución a bodega por línea (F4.5 / modal V2.6) ============
-- Devuelve contra un movimiento de salida ORIGINAL (origin_movement_id):
-- máx = |consumido| − ya devuelto (F2.9). Costo = congelado del original.
CREATE OR REPLACE FUNCTION public.m4_return(
    p_movement_id         UUID,
    p_qty                 NUMERIC,
    p_destiny_warehouse_id UUID,
    p_reason              TEXT,
    p_actor               UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor    UUID := COALESCE(auth.uid(), p_actor);
    v_orig     stock_movements%ROWTYPE;
    v_wo       work_orders%ROWTYPE;
    v_returned NUMERIC;
    v_avail    NUMERIC;
    v_wh       warehouses%ROWTYPE;
    v_qty      NUMERIC;
    v_mov_id   UUID;
BEGIN
    SELECT * INTO v_orig FROM stock_movements WHERE id = p_movement_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Movimiento de salida inexistente';
    END IF;
    IF v_orig.type <> 'salida_ot' THEN
        RAISE EXCEPTION 'Solo se devuelve contra una Salida por OT';
    END IF;

    -- Permisos T1: Mantenimiento (cualquier OT) o técnico asignado (F4.5)
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        IF NOT public.is_assigned_wo(v_orig.wo_id) THEN
            RAISE EXCEPTION 'Solo puedes devolver desde tus OT asignadas';
        END IF;
    END IF;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Se requiere el usuario que devuelve';
    END IF;

    SELECT * INTO v_wo FROM work_orders WHERE id = v_orig.wo_id FOR UPDATE;
    IF v_wo.status = 'closed' THEN
        RAISE EXCEPTION 'La OT está Cerrada: no admite devoluciones';
    END IF;
    IF v_wo.status = 'cancelled'
       AND auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'La OT está Cancelada: solo Mantenimiento devuelve';
    END IF;

    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'El motivo de la devolución es obligatorio';
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'La cantidad a devolver debe ser mayor a 0';
    END IF;

    -- Máx por LÍNEA: consumido − ya devuelto (F2.9)
    SELECT COALESCE(SUM(qty), 0) INTO v_returned
    FROM stock_movements
    WHERE origin_movement_id = p_movement_id;
    v_avail := abs(v_orig.qty) - v_returned;
    IF p_qty > v_avail THEN
        RAISE EXCEPTION 'Solo puedes devolver % de esta línea (consumido %, ya devuelto %)',
            v_avail, abs(v_orig.qty), v_returned;
    END IF;

    SELECT * INTO v_wh FROM warehouses WHERE id = p_destiny_warehouse_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bodega destino inexistente';
    END IF;
    IF NOT v_wh.is_active THEN
        RAISE EXCEPTION 'La bodega destino está inactiva: bloquea nuevas entradas';
    END IF;

    PERFORM set_config('app.m4_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', trim(p_reason), TRUE);

    v_qty := public.m4_apply_stock(p_destiny_warehouse_id, v_orig.item_id, p_qty);

    -- Costo CONGELADO del movimiento original (conserva el histórico de la OT)
    INSERT INTO stock_movements (
        type, item_id, warehouse_id, qty, unit_cost, line_total,
        wo_id, reason, origin_movement_id, user_id, occurred_at
    ) VALUES (
        'devolucion', v_orig.item_id, p_destiny_warehouse_id, p_qty,
        v_orig.unit_cost, round(p_qty * v_orig.unit_cost, 2),
        v_orig.wo_id, trim(p_reason), p_movement_id, v_actor, now()
    ) RETURNING id INTO v_mov_id;

    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.m4_rpc', '', TRUE);

    RETURN jsonb_build_object(
        'movement_id', v_mov_id,
        'new_qty', v_qty,
        'line_total', round(p_qty * v_orig.unit_cost, 2),
        'remaining_available', v_avail - p_qty);
END;
$$;

REVOKE ALL ON FUNCTION public.m4_return(UUID, NUMERIC, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m4_return(UUID, NUMERIC, UUID, TEXT, UUID) TO authenticated, service_role;

-- ============ RPC m4_count_create — Crear conteo + congelar teórico (F4.8 p1–p2) ============
CREATE OR REPLACE FUNCTION public.m4_count_create(
    p_warehouse_id       UUID,
    p_scope_type         TEXT,
    p_scope_category_id  UUID DEFAULT NULL,
    p_count_date         DATE DEFAULT NULL,
    p_responsible_id     UUID DEFAULT NULL,
    p_actor              UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor      UUID := COALESCE(auth.uid(), p_actor);
    v_resp       UUID;
    v_id         UUID;
    v_snapshot   INTEGER;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF p_scope_type NOT IN ('warehouse', 'category') THEN
        RAISE EXCEPTION 'Alcance de conteo inválido';
    END IF;
    IF p_scope_type = 'category' AND p_scope_category_id IS NULL THEN
        RAISE EXCEPTION 'El alcance por categoría requiere la categoría';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_warehouse_id) THEN
        RAISE EXCEPTION 'Bodega inexistente';
    END IF;
    IF p_scope_type = 'category' AND NOT EXISTS (
        SELECT 1 FROM item_categories WHERE id = p_scope_category_id
    ) THEN
        RAISE EXCEPTION 'Categoría de ítem inexistente';
    END IF;

    v_resp := COALESCE(p_responsible_id, v_actor);
    IF v_resp IS NULL THEN
        RAISE EXCEPTION 'Se requiere el responsable del conteo';
    END IF;

    INSERT INTO physical_counts (
        warehouse_id, scope_type, scope_category_id, count_date,
        responsible_id, created_by
    ) VALUES (
        p_warehouse_id, p_scope_type, p_scope_category_id,
        COALESCE(p_count_date, current_date), v_resp, v_actor
    ) RETURNING id INTO v_id;

    -- Congela el stock TEÓRICO por ítem del alcance (snapshot — F4.8 p2).
    -- Alcance = filas existentes en warehouse_stock de la bodega: un ítem
    -- nunca stockeado aquí no es material de este conteo.
    INSERT INTO physical_count_items (count_id, item_id, theoretical)
    SELECT v_id, ws.item_id, ws.qty
    FROM warehouse_stock ws
    JOIN items i ON i.id = ws.item_id
    WHERE ws.warehouse_id = p_warehouse_id
      AND (p_scope_type = 'warehouse' OR i.item_category_id = p_scope_category_id);

    GET DIAGNOSTICS v_snapshot = ROW_COUNT;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.m4_count_create(UUID, TEXT, UUID, DATE, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m4_count_create(UUID, TEXT, UUID, DATE, UUID, UUID) TO authenticated, service_role;

-- ============ RPC m4_count_confirm — Confirma y genera ajustes (F4.8 p4–p5) ============
CREATE OR REPLACE FUNCTION public.m4_count_confirm(
    p_count_id UUID,
    p_actor    UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor   UUID := COALESCE(auth.uid(), p_actor);
    v_count   physical_counts%ROWTYPE;
    v_row     RECORD;
    v_cost    NUMERIC;
    v_moves   INTEGER := 0;
    v_counted INTEGER := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Se requiere el usuario que confirma';
    END IF;

    SELECT * INTO v_count FROM physical_counts WHERE id = p_count_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conteo inexistente';
    END IF;
    IF v_count.status <> 'in_progress' THEN
        RAISE EXCEPTION 'El conteo está %: solo se confirman conteos En proceso', v_count.status;
    END IF;

    PERFORM set_config('app.m4_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', 'Conteo físico', TRUE);

    FOR v_row IN
        SELECT item_id, theoretical, counted, difference
        FROM physical_count_items
        WHERE count_id = p_count_id
          AND counted IS NOT NULL
          AND difference <> 0
        ORDER BY item_id
    LOOP
        PERFORM public.m4_apply_stock(v_count.warehouse_id, v_row.item_id, v_row.difference);
        SELECT unit_cost INTO v_cost FROM items WHERE id = v_row.item_id;
        INSERT INTO stock_movements (
            type, item_id, warehouse_id, qty, unit_cost, line_total,
            reason, count_id, user_id, occurred_at
        ) VALUES (
            'ajuste', v_row.item_id, v_count.warehouse_id, v_row.difference,
            v_cost, round(abs(v_row.difference) * v_cost, 2),
            'Conteo físico', p_count_id, v_actor, now()
        );
        v_moves := v_moves + 1;
    END LOOP;

    SELECT COUNT(*) INTO v_counted
    FROM physical_count_items
    WHERE count_id = p_count_id AND counted IS NOT NULL;

    UPDATE physical_counts
    SET status = 'confirmed', confirmed_by = v_actor, confirmed_at = now()
    WHERE id = p_count_id;

    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.m4_rpc', '', TRUE);

    RETURN jsonb_build_object('adjustments', v_moves, 'counted_items', v_counted);
END;
$$;

REVOKE ALL ON FUNCTION public.m4_count_confirm(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m4_count_confirm(UUID, UUID) TO authenticated, service_role;

-- ============ RPC m4_count_cancel — Cancelar con motivo (F4.8 p6) ============
CREATE OR REPLACE FUNCTION public.m4_count_cancel(
    p_count_id UUID,
    p_reason   TEXT,
    p_actor    UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor UUID := COALESCE(auth.uid(), p_actor);
    v_status TEXT;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La cancelación requiere un motivo';
    END IF;

    SELECT status INTO v_status FROM physical_counts WHERE id = p_count_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conteo inexistente';
    END IF;
    IF v_status <> 'in_progress' THEN
        RAISE EXCEPTION 'El conteo está %: solo se cancelan conteos En proceso', v_status;
    END IF;

    PERFORM set_config('app.m4_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', trim(p_reason), TRUE);
    UPDATE physical_counts
    SET status = 'cancelled', cancel_reason = trim(p_reason)
    WHERE id = p_count_id;
    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.m4_rpc', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.m4_count_cancel(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m4_count_cancel(UUID, TEXT, UUID) TO authenticated, service_role;

-- ============ Evento 3 — F4.9: resumen diario de stock bajo mínimo ============
-- pg_cron diario inserta UNA fila pendiente POR BODEGA (dedup por día);
-- el cron horario t2-digest (fn_enqueue_digest) la agrupa al digest_time.
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

        PERFORM public.fn_notify(3, 'warehouse', v_wh.warehouse_id,
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

REVOKE ALL ON FUNCTION public.m4_low_stock_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m4_low_stock_summary() TO postgres, service_role, authenticated;

-- Horario PROVISORIO 06:40 UTC (open_pending: coordinar con el job de M3)
SELECT cron.schedule('m4-low-stock', '40 6 * * *', $$SELECT public.m4_low_stock_summary()$$);

-- ============ Vistas V4.1 (security_invoker aplica RLS de las tablas base) ============

-- Ítems con totales de stock y badges (negativo / bajo mínimo)
CREATE OR REPLACE VIEW public.v4_items WITH (security_invoker = true) AS
SELECT
    i.id, i.code, i.name, i.description, i.item_category_id, i.unit, i.unit_cost,
    i.bin_location, i.preferred_provider_id,
    public.m2_provider_name(i.preferred_provider_id) AS preferred_provider_name,
    i.image_path, i.technical_sheet_path, i.is_active,
    i.created_by, i.updated_by, i.created_at, i.updated_at,
    c.name AS category_name,
    COALESCE(s.stock_total, 0) AS stock_total,
    COALESCE(s.min_total, 0) AS min_total,
    COALESCE(s.has_negative, false) AS has_negative,
    COALESCE(s.has_low, false) AS has_low,
    COALESCE(s.warehouse_count, 0)::INTEGER AS warehouse_count
FROM items i
LEFT JOIN item_categories c ON c.id = i.item_category_id
LEFT JOIN (
    SELECT item_id,
           SUM(qty) AS stock_total,
           SUM(min_stock) AS min_total,
           BOOL_OR(qty < 0) AS has_negative,
           BOOL_OR(qty < min_stock) AS has_low,
           COUNT(*) AS warehouse_count
    FROM warehouse_stock
    GROUP BY item_id
) s ON s.item_id = i.id;

GRANT SELECT ON public.v4_items TO authenticated, service_role;

-- Matriz de stock por ítem × bodega (segmento "Stock actual")
CREATE OR REPLACE VIEW public.v4_stock WITH (security_invoker = true) AS
SELECT
    ws.warehouse_id, ws.item_id, ws.qty, ws.min_stock, ws.updated_at,
    (ws.qty < 0) AS is_negative,
    (ws.qty < ws.min_stock) AS is_low,
    i.code AS item_code, i.name AS item_name, i.unit,
    i.is_active AS item_is_active, i.item_category_id,
    c.name AS category_name,
    w.name AS warehouse_name, w.is_active AS warehouse_is_active
FROM warehouse_stock ws
JOIN items i ON i.id = ws.item_id
JOIN warehouses w ON w.id = ws.warehouse_id
LEFT JOIN item_categories c ON c.id = i.item_category_id;

GRANT SELECT ON public.v4_stock TO authenticated, service_role;

-- Kardex con referencias resueltas (segmento "Kardex" + modal M4.4)
CREATE OR REPLACE VIEW public.v4_kardex WITH (security_invoker = true) AS
SELECT
    sm.id, sm.type, sm.item_id, sm.warehouse_id, sm.destiny_warehouse_id,
    sm.qty, sm.unit_cost, sm.line_total, sm.wo_id, sm.document_number,
    sm.provider_id, public.m2_provider_name(sm.provider_id) AS provider_name,
    sm.reason, sm.count_id, sm.origin_movement_id, sm.user_id,
    sm.occurred_at, sm.created_at,
    i.code AS item_code, i.name AS item_name, i.unit,
    w.name AS warehouse_name,
    dw.name AS destiny_warehouse_name,
    wo.wo_number,
    u.full_name AS user_name
FROM stock_movements sm
JOIN items i ON i.id = sm.item_id
JOIN warehouses w ON w.id = sm.warehouse_id
LEFT JOIN warehouses dw ON dw.id = sm.destiny_warehouse_id
LEFT JOIN work_orders wo ON wo.id = sm.wo_id
LEFT JOIN users u ON u.id = sm.user_id;

GRANT SELECT ON public.v4_kardex TO authenticated, service_role;

-- Conteos con conteo de diferencias (pestaña Conteo físico)
CREATE OR REPLACE VIEW public.v4_counts WITH (security_invoker = true) AS
SELECT
    pc.id, pc.warehouse_id, pc.scope_type, pc.scope_category_id, pc.count_date,
    pc.responsible_id, pc.status, pc.cancel_reason, pc.confirmed_by,
    pc.confirmed_at, pc.created_by, pc.created_at, pc.updated_at,
    w.name AS warehouse_name,
    r.full_name AS responsible_name,
    cb.full_name AS confirmed_by_name,
    sc.name AS scope_category_name,
    COALESCE(d.total_items, 0)::INTEGER AS total_items,
    COALESCE(d.counted_items, 0)::INTEGER AS counted_items,
    COALESCE(d.diff_items, 0)::INTEGER AS diff_items
FROM physical_counts pc
JOIN warehouses w ON w.id = pc.warehouse_id
LEFT JOIN users r ON r.id = pc.responsible_id
LEFT JOIN users cb ON cb.id = pc.confirmed_by
LEFT JOIN item_categories sc ON sc.id = pc.scope_category_id
LEFT JOIN (
    SELECT count_id,
           COUNT(*) AS total_items,
           COUNT(*) FILTER (WHERE counted IS NOT NULL) AS counted_items,
           COUNT(*) FILTER (WHERE counted IS NOT NULL AND difference <> 0) AS diff_items
    FROM physical_count_items
    GROUP BY count_id
) d ON d.count_id = pc.id;

GRANT SELECT ON public.v4_counts TO authenticated, service_role;
