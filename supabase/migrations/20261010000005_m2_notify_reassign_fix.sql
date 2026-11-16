-- Migración 9 — M2 fixes tras primera ejecución del smoke:
--  1) fn_notify: los triggers de OTs llamaban fn_notify(1, ...) / fn_notify(5, ...)
--     con literal integer y la firma es SMALLINT (42883). Convención del proyecto
--     (m1_fix_audit_jobs): cast explícito ::SMALLINT en los call sites.
--  2) Reasignar un técnico que ya tuvo fila en wo_technicians chocaba con la PK
--     (wo_id, user_id) — INSERT directo en m2_assign_wo / m2_technician_replace.
--     Ahora se "revive" la fila (removed_at → NULL) con ON CONFLICT.
--  3) Auditoría y push del revive: re-alta cuenta como 'assign' (timeline) y
--     dispara el push 'assigned' como cualquier alta.

-- ============ 1a. Evento 1 al alta de OT (trigger) ============
CREATE OR REPLACE FUNCTION public.fn_wo_notify_insert() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.affects_sale THEN
        PERFORM public.fn_notify(1::SMALLINT, 'work_order', NEW.id,
            'wo-open:' || NEW.id,
            jsonb_build_object('wo_number', NEW.wo_number, 'stage', 'open'));
    END IF;
    RETURN NEW;
END;
$$;

-- ============ 1b. Evento 5 al alta de reporte de daño (trigger) ============
CREATE OR REPLACE FUNCTION public.fn_dr_notify_insert() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.fn_notify(5::SMALLINT, 'damage_report', NEW.id,
        'damage-report:' || NEW.id,
        jsonb_build_object('ref', public.m2_dr_ref(NEW.id),
            'asset_id', NEW.asset_id,
            'reported_by', NEW.reported_by));
    RETURN NEW;
END;
$$;

-- ============ 1c. m2_close_wo — Evento 1 al cierre con cast ============
CREATE OR REPLACE FUNCTION public.m2_close_wo(
    p_wo_id            UUID,
    p_diagnosis        TEXT,
    p_solution         TEXT,
    p_actor            UUID DEFAULT NULL,
    p_executed_by_type TEXT DEFAULT NULL,
    p_provider_id      UUID DEFAULT NULL,
    p_external_cost    NUMERIC DEFAULT NULL,
    p_affects_sale     BOOLEAN DEFAULT NULL,
    p_generates_warranty BOOLEAN DEFAULT NULL,
    p_warranty         JSONB DEFAULT NULL,
    p_warranty_document_path TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor     UUID := COALESCE(p_actor, auth.uid());
    v_wo        work_orders%ROWTYPE;
    v_exec      TEXT;
    v_provider  UUID;
    v_cost      NUMERIC;
    v_warranty_id UUID := NULL;
    v_w_start   DATE;
    v_w_end     DATE;
    v_w_cover   TEXT;
    v_w_prov    UUID;
    v_w_prov_name TEXT;
    v_w_notes   TEXT;
    v_w_doc     TEXT;
    v_label     TEXT;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Se requiere el usuario que ejecuta el cierre';
    END IF;
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF p_generates_warranty IS NULL THEN
        RAISE EXCEPTION 'Debe responder genera_o_extiende_garantia (Sí/No)';
    END IF;
    IF NULLIF(trim(COALESCE(p_diagnosis, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_solution, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Diagnóstico y solución son obligatorios al cierre';
    END IF;

    SELECT * INTO v_wo FROM work_orders WHERE id = p_wo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OT inexistente';
    END IF;
    IF v_wo.status IN ('closed', 'cancelled') THEN
        RAISE EXCEPTION 'La OT ya está en estado %', v_wo.status;
    END IF;

    v_exec     := COALESCE(p_executed_by_type, v_wo.executed_by_type);
    v_provider := COALESCE(p_provider_id, v_wo.provider_id);
    v_cost     := COALESCE(p_external_cost, v_wo.external_cost);
    IF v_exec NOT IN ('internal', 'external') THEN
        RAISE EXCEPTION 'Ejecución inválida';
    END IF;
    IF v_exec = 'external' THEN
        IF v_provider IS NULL THEN
            RAISE EXCEPTION 'El proveedor es obligatorio al cerrar una OT externa';
        END IF;
        IF v_cost IS NULL THEN
            RAISE EXCEPTION 'El costo del servicio externo es obligatorio al cierre';
        END IF;
    END IF;

    -- Checklist: todos los ítems resueltos (si la OT tiene — preventivas M3)
    IF EXISTS (
        SELECT 1 FROM wo_checklist_entries
        WHERE wo_id = p_wo_id AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'Hay ítems de checklist pendientes';
    END IF;

    -- Garantía: sub-formulario V1.5 obligatorio si la respuesta es Sí
    IF p_generates_warranty THEN
        IF p_warranty IS NULL
           OR NULLIF(p_warranty->>'start_date', '') IS NULL
           OR NULLIF(p_warranty->>'end_date', '') IS NULL
           OR NULLIF(p_warranty->>'coverage', '') IS NULL THEN
            RAISE EXCEPTION 'Datos de garantía incompletos (fechas y cobertura son obligatorios)';
        END IF;
        v_w_start := (p_warranty->>'start_date')::DATE;
        v_w_end   := (p_warranty->>'end_date')::DATE;
        v_w_cover := p_warranty->>'coverage';
        IF v_w_cover NOT IN ('parts', 'labor', 'both') THEN
            RAISE EXCEPTION 'Cobertura de garantía inválida';
        END IF;
        IF v_w_end < v_w_start THEN
            RAISE EXCEPTION 'La fecha final debe ser mayor o igual a la inicial';
        END IF;
        v_w_prov      := COALESCE(NULLIF(p_warranty->>'provider_id', '')::UUID, v_provider);
        v_w_prov_name := COALESCE(NULLIF(p_warranty->>'provider_name', ''),
            (SELECT name FROM providers WHERE id = v_w_prov));
        v_w_notes := p_warranty->>'notes';
        v_w_doc   := COALESCE(p_warranty_document_path, NULLIF(p_warranty->>'document_path', ''));
    END IF;

    SELECT 'OT ' || v_wo.wo_number INTO v_label;

    PERFORM set_config('app.wo_rpc', '1', TRUE);
    PERFORM set_config('app.actor_user_id', v_actor::TEXT, TRUE);

    UPDATE work_orders
    SET status = 'closed', closed_at = now(), closed_by = v_actor,
        finished_at = COALESCE(finished_at, now()),
        diagnosis = p_diagnosis, solution = p_solution,
        executed_by_type = v_exec, provider_id = v_provider, external_cost = v_cost,
        affects_sale = COALESCE(p_affects_sale, affects_sale),
        generates_warranty = p_generates_warranty
    WHERE id = p_wo_id;

    -- Garantía create-or-edit (origin_wo_id UNIQUE — nunca duplicar; F1.5/M1)
    IF p_generates_warranty THEN
        SELECT id INTO v_warranty_id FROM warranties WHERE origin_wo_id = p_wo_id;
        IF v_warranty_id IS NOT NULL THEN
            UPDATE warranties
            SET start_date = v_w_start, end_date = v_w_end, coverage = v_w_cover,
                provider_id = v_w_prov, provider_name = v_w_prov_name,
                notes = v_w_notes, document_path = v_w_doc,
                status = CASE WHEN v_w_end >= CURRENT_DATE THEN 'active' ELSE 'expired' END
            WHERE id = v_warranty_id;
        ELSE
            INSERT INTO warranties (
                asset_id, warranty_type, provider_id, provider_name,
                start_date, end_date, coverage, notes, document_path,
                origin_wo_id, created_by
            ) VALUES (
                v_wo.asset_id, 'repair', v_w_prov, v_w_prov_name,
                v_w_start, v_w_end, v_w_cover, v_w_notes, v_w_doc,
                p_wo_id, v_actor
            ) RETURNING id INTO v_warranty_id;
        END IF;
    END IF;

    -- Evento 1 al cierre (dedup distinto al alta)
    IF COALESCE(p_affects_sale, v_wo.affects_sale) THEN
        PERFORM public.fn_notify(1::SMALLINT, 'work_order', p_wo_id,
            'wo-close:' || p_wo_id,
            jsonb_build_object('wo_number', v_wo.wo_number, 'stage', 'close'));
    END IF;

    -- Contador de uso: +1 por OT cerrada si el activo lo usa (decisión de sesión)
    UPDATE assets
    SET usage_counter = coalesce(usage_counter, 0) + 1
    WHERE id = v_wo.asset_id AND has_usage_counter IS TRUE;

    -- Snapshot de cierre (M2.1: respuesta de garantía queda en auditoría)
    PERFORM public.fn_audit_row('work_orders', 'work_order', 'close',
        p_wo_id, v_label,
        jsonb_build_object(
            'generates_warranty', jsonb_build_object('old', v_wo.generates_warranty, 'new', p_generates_warranty),
            'warranty_id', jsonb_build_object('old', NULL, 'new', v_warranty_id),
            'executed_by_type', jsonb_build_object('old', v_wo.executed_by_type, 'new', v_exec),
            'provider_id', jsonb_build_object('old', v_wo.provider_id, 'new', v_provider),
            'external_cost', jsonb_build_object('old', v_wo.external_cost, 'new', v_cost)),
        NULL);

    PERFORM set_config('app.actor_user_id', '', TRUE);
    PERFORM set_config('app.wo_rpc', '', TRUE);

    RETURN jsonb_build_object(
        'wo_number', v_wo.wo_number,
        'closed_at', now(),
        'generates_warranty', p_generates_warranty,
        'warranty_id', v_warranty_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.m2_close_wo(UUID, TEXT, TEXT, UUID, TEXT, UUID, NUMERIC, BOOLEAN, BOOLEAN, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_close_wo(UUID, TEXT, TEXT, UUID, TEXT, UUID, NUMERIC, BOOLEAN, BOOLEAN, JSONB, TEXT) TO authenticated, service_role;

-- ============ 2a. m2_assign_wo — re-alta con ON CONFLICT (revive) ============
CREATE OR REPLACE FUNCTION public.m2_assign_wo(
    p_wo_id       UUID,
    p_technicians UUID[]
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor    UUID := COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), ''), NULL)::UUID;
    v_status   TEXT;
    v_existing UUID[];
    v_to_remove UUID[];
    v_to_add   UUID[];
    v_target   UUID[] := coalesce(p_technicians, '{}'::UUID[]);
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    v_actor := COALESCE(v_actor, auth.uid());

    SELECT status INTO v_status FROM work_orders WHERE id = p_wo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OT inexistente';
    END IF;
    IF v_status IN ('closed', 'cancelled') THEN
        RAISE EXCEPTION 'La OT está en estado terminal: no admite asignaciones';
    END IF;

    PERFORM public.m2_validate_technicians(v_target);

    SELECT coalesce(array_agg(user_id), '{}') INTO v_existing
    FROM wo_technicians
    WHERE wo_id = p_wo_id AND removed_at IS NULL;

    SELECT coalesce(array_agg(x), '{}') INTO v_to_remove
    FROM unnest(v_existing) AS x WHERE NOT (v_target @> ARRAY[x]);

    SELECT coalesce(array_agg(x), '{}') INTO v_to_add
    FROM unnest(v_target) AS x WHERE NOT (v_existing @> ARRAY[x]);

    PERFORM set_config('app.wo_rpc', '1', TRUE);

    IF coalesce(array_length(v_to_remove, 1), 0) > 0 THEN
        UPDATE wo_technicians
        SET removed_at = now(), removed_by = v_actor
        WHERE wo_id = p_wo_id AND removed_at IS NULL AND user_id = ANY(v_to_remove);
    END IF;
    IF coalesce(array_length(v_to_add, 1), 0) > 0 THEN
        INSERT INTO wo_technicians (wo_id, user_id, assigned_by)
        SELECT p_wo_id, x, v_actor FROM unnest(v_to_add) AS x
        ON CONFLICT (wo_id, user_id) DO UPDATE
        SET removed_at = NULL, removed_by = NULL,
            assigned_at = now(), assigned_by = EXCLUDED.assigned_by
        WHERE wo_technicians.removed_at IS NOT NULL;
    END IF;

    -- Re-asignación real: quita y agrega a la vez → flag "Reasignadas" (V2.1)
    IF coalesce(array_length(v_to_remove, 1), 0) > 0
       AND coalesce(array_length(v_to_add, 1), 0) > 0 THEN
        UPDATE work_orders SET reassigned = TRUE WHERE id = p_wo_id;
    END IF;

    -- Estado derivado: open ↔ assigned (solo si no avanzó)
    IF v_status = 'open' AND coalesce(array_length(v_target, 1), 0) > 0 THEN
        UPDATE work_orders
        SET status = 'assigned', assigned_at = COALESCE(assigned_at, now())
        WHERE id = p_wo_id;
    ELSIF v_status = 'assigned' AND coalesce(array_length(v_target, 1), 0) = 0 THEN
        UPDATE work_orders SET status = 'open', assigned_at = NULL WHERE id = p_wo_id;
    END IF;

    PERFORM set_config('app.wo_rpc', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.m2_assign_wo(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_assign_wo(UUID, UUID[]) TO authenticated, service_role;

-- ============ 2b. m2_technician_replace — re-alta con ON CONFLICT (revive) ============
CREATE OR REPLACE FUNCTION public.m2_technician_replace(
    p_wo_id       UUID,
    p_out_user    UUID,
    p_in_user     UUID,
    p_observation TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_status TEXT;
    v_actor  UUID := auth.uid();
    v_label  TEXT;
    v_rest   UUID[];
BEGIN
    -- Rol: Mantenimiento o técnico ASIGNADO a esta OT (is_assigned_wo usa auth.uid())
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Requiere sesión activa';
    END IF;
    IF NOT (public.has_role('mantenimiento') OR public.is_assigned_wo(p_wo_id)) THEN
        RAISE EXCEPTION 'Solo los técnicos asignados (o Mantenimiento) pueden reemplazar';
    END IF;
    IF NULLIF(trim(COALESCE(p_observation, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La observación es obligatoria';
    END IF;

    SELECT status INTO v_status FROM work_orders WHERE id = p_wo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OT inexistente';
    END IF;
    IF v_status NOT IN ('assigned', 'in_progress', 'waiting_parts') THEN
        RAISE EXCEPTION 'Reemplazo no permitido en estado %', v_status;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM wo_technicians
        WHERE wo_id = p_wo_id AND user_id = p_out_user AND removed_at IS NULL
    ) THEN
        RAISE EXCEPTION 'El técnico saliente no está asignado a la OT';
    END IF;
    IF p_out_user = p_in_user THEN
        RAISE EXCEPTION 'El técnico entrante debe ser distinto al saliente';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN users us ON us.id = ur.user_id
        WHERE ur.user_id = p_in_user AND ur.role = 'tecnico' AND us.is_active
    ) THEN
        RAISE EXCEPTION 'El técnico entrante no es un Técnico activo';
    END IF;
    IF EXISTS (
        SELECT 1 FROM wo_technicians
        WHERE wo_id = p_wo_id AND user_id = p_in_user AND removed_at IS NULL
    ) THEN
        RAISE EXCEPTION 'El técnico entrante ya está asignado a la OT';
    END IF;

    SELECT 'OT ' || wo_number INTO v_label FROM work_orders WHERE id = p_wo_id;

    PERFORM set_config('app.wo_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', p_observation, TRUE);

    UPDATE wo_technicians
    SET removed_at = now(), removed_by = v_actor
    WHERE wo_id = p_wo_id AND user_id = p_out_user AND removed_at IS NULL;

    INSERT INTO wo_technicians (wo_id, user_id, assigned_by)
    VALUES (p_wo_id, p_in_user, v_actor)
    ON CONFLICT (wo_id, user_id) DO UPDATE
    SET removed_at = NULL, removed_by = NULL,
        assigned_at = now(), assigned_by = EXCLUDED.assigned_by
    WHERE wo_technicians.removed_at IS NOT NULL;

    UPDATE work_orders SET reassigned = TRUE WHERE id = p_wo_id;

    -- Auditoría con observación (el trigger de wo_technicians ya registró
    -- assign/unassign individuales; esta fila alimenta el timeline con obs.)
    PERFORM public.fn_audit_row('work_orders', 'work_order', 'replace',
        p_wo_id, v_label,
        jsonb_build_object('from', jsonb_build_object('old', p_out_user, 'new', NULL),
                           'to',   jsonb_build_object('old', NULL, 'new', p_in_user)),
        p_observation);

    -- Push a los que permanecen (entrante y saliente ya cubiertos por
    -- trg_wo_tech_push) — F2.4: 3 polos.
    SELECT coalesce(array_agg(user_id), '{}') INTO v_rest
    FROM wo_technicians
    WHERE wo_id = p_wo_id AND removed_at IS NULL
      AND user_id NOT IN (p_out_user, p_in_user);
    PERFORM public.m2_dispatch_push('reassigned', p_wo_id, v_rest);

    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.wo_rpc', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.m2_technician_replace(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_technician_replace(UUID, UUID, UUID, TEXT) TO authenticated, service_role;

-- ============ 3a. Auditoría del revive: cuenta como 'assign' ============
CREATE OR REPLACE FUNCTION public.fn_audit_wo_technicians() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB;
    v_action  TEXT;
    v_label   TEXT;
BEGIN
    SELECT 'OT ' || wo_number INTO v_label FROM work_orders
    WHERE id = COALESCE(NEW.wo_id, OLD.wo_id);

    IF TG_OP = 'INSERT' THEN
        v_action := 'assign';
        v_changes := jsonb_build_object(
            'user_id',     jsonb_build_object('old', NULL, 'new', NEW.user_id),
            'assigned_by', jsonb_build_object('old', NULL, 'new', NEW.assigned_by));
    ELSIF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
        v_action := 'unassign';
        v_changes := jsonb_build_object(
            'user_id',   jsonb_build_object('old', OLD.user_id, 'new', NULL),
            'removed_by', jsonb_build_object('old', NULL, 'new', NEW.removed_by));
    ELSIF NEW.removed_at IS NULL AND OLD.removed_at IS NOT NULL THEN
        -- Revive (ON CONFLICT de m2_assign_wo / m2_technician_replace)
        v_action := 'assign';
        v_changes := jsonb_build_object(
            'user_id',     jsonb_build_object('old', OLD.user_id, 'new', NEW.user_id),
            'assigned_by', jsonb_build_object('old', OLD.assigned_by, 'new', NEW.assigned_by));
    ELSIF NEW.hours_worked IS DISTINCT FROM OLD.hours_worked THEN
        v_action := 'update';
        v_changes := jsonb_build_object(
            'hours_worked', jsonb_build_object('old', OLD.hours_worked, 'new', NEW.hours_worked),
            'user_id', jsonb_build_object('old', OLD.user_id, 'new', NEW.user_id));
    ELSIF NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
        v_action := 'update';
        v_changes := jsonb_build_object(
            'started_at',  jsonb_build_object('old', OLD.started_at, 'new', NEW.started_at),
            'finished_at', jsonb_build_object('old', OLD.finished_at, 'new', NEW.finished_at),
            'user_id', jsonb_build_object('old', OLD.user_id, 'new', NEW.user_id));
    ELSE
        RETURN COALESCE(NEW, OLD);
    END IF;

    PERFORM public.fn_audit_row('work_orders', 'wo_technician', v_action,
        COALESCE(NEW.wo_id, OLD.wo_id), v_label, v_changes,
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============ 3b. Push del revive: 'assigned' igual que un alta ============
CREATE OR REPLACE FUNCTION public.fn_wo_tech_push() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.removed_at IS NULL THEN
        PERFORM public.m2_dispatch_push('assigned', NEW.wo_id, ARRAY[NEW.user_id]);
    ELSIF TG_OP = 'UPDATE' AND NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
        PERFORM public.m2_dispatch_push('removed', OLD.wo_id, ARRAY[OLD.user_id]);
    ELSIF TG_OP = 'UPDATE' AND NEW.removed_at IS NULL AND OLD.removed_at IS NOT NULL THEN
        PERFORM public.m2_dispatch_push('assigned', NEW.wo_id, ARRAY[NEW.user_id]);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
