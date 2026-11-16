-- Migración 8 — M2 fix: marcas de tiempo en transiciones directas + reapertura
-- (V2.2/F2.5: el front solo envía `status` en el PATCH; started_at/finished_at
-- se derivan en el guarda cuando la actualización NO viene de una RPC — las
-- RPCs setean app.wo_rpc='1' y manejan sus propios tiempos). La reapertura
-- formal limpia finished_at (antes solo limpiaba closed_at/closed_by).

CREATE OR REPLACE FUNCTION public.fn_wo_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF current_setting('app.wo_rpc', TRUE) = '1' THEN
        RETURN NEW;
    END IF;

    -- Columnas protegidas para roles distintos de Mantenimiento
    -- (Técnico asignado: description, priority, status, started_at, finished_at)
    IF NOT public.has_role('mantenimiento') THEN
        IF NEW.wo_number     IS DISTINCT FROM OLD.wo_number
        OR NEW.asset_id      IS DISTINCT FROM OLD.asset_id
        OR NEW.component_id  IS DISTINCT FROM OLD.component_id
        OR NEW.wo_type       IS DISTINCT FROM OLD.wo_type
        OR NEW.origin        IS DISTINCT FROM OLD.origin
        OR NEW.damage_report_id IS DISTINCT FROM OLD.damage_report_id
        OR NEW.plan_id       IS DISTINCT FROM OLD.plan_id
        OR NEW.external_ref  IS DISTINCT FROM OLD.external_ref
        OR NEW.reported_by   IS DISTINCT FROM OLD.reported_by
        OR NEW.reported_at   IS DISTINCT FROM OLD.reported_at
        OR NEW.scheduled_at  IS DISTINCT FROM OLD.scheduled_at
        OR NEW.assigned_at   IS DISTINCT FROM OLD.assigned_at
        OR NEW.closed_at     IS DISTINCT FROM OLD.closed_at
        OR NEW.closed_by     IS DISTINCT FROM OLD.closed_by
        OR NEW.affects_sale  IS DISTINCT FROM OLD.affects_sale
        OR NEW.executed_by_type IS DISTINCT FROM OLD.executed_by_type
        OR NEW.provider_id   IS DISTINCT FROM OLD.provider_id
        OR NEW.external_cost IS DISTINCT FROM OLD.external_cost
        OR NEW.generates_warranty IS DISTINCT FROM OLD.generates_warranty
        OR NEW.reassigned    IS DISTINCT FROM OLD.reassigned
        OR NEW.diagnosis     IS DISTINCT FROM OLD.diagnosis
        OR NEW.solution      IS DISTINCT FROM OLD.solution
        OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Sin permiso para modificar este campo';
        END IF;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- Estados terminales: solo la reapertura formal (RPC m2_reopen_wo)
        IF OLD.status IN ('closed', 'cancelled') THEN
            RAISE EXCEPTION 'Use la reapertura formal (motivo obligatorio) para modificar una OT %', OLD.status;
        END IF;
        -- Rol por destino
        IF NEW.status = 'cancelled' AND NOT public.has_role('mantenimiento') THEN
            RAISE EXCEPTION 'Solo Mantenimiento cancela OTs';
        END IF;
        IF NEW.status = 'closed' AND NOT public.has_role('mantenimiento') THEN
            RAISE EXCEPTION 'Solo Mantenimiento cierra OTs';
        END IF;
        IF NEW.status NOT IN ('closed', 'cancelled')
           AND NOT (public.has_role('mantenimiento') OR public.is_assigned_wo(OLD.id)) THEN
            RAISE EXCEPTION 'Debe estar asignado a la OT para cambiar su estado';
        END IF;
        -- Mapa de transiciones (F2.3–F2.8 / lifecycle BD/work_orders.md)
        IF NOT (
               (OLD.status = 'open'          AND NEW.status IN ('assigned','in_progress','waiting_parts','completed','cancelled'))
            OR (OLD.status = 'assigned'      AND NEW.status IN ('open','in_progress','waiting_parts','completed','cancelled'))
            OR (OLD.status = 'in_progress'   AND NEW.status IN ('waiting_parts','completed','cancelled'))
            OR (OLD.status = 'waiting_parts' AND NEW.status IN ('in_progress','completed','cancelled'))
            OR (OLD.status = 'completed'     AND NEW.status IN ('closed','in_progress'))
        ) THEN
            RAISE EXCEPTION 'Transición de estado no válida (% → %)', OLD.status, NEW.status;
        END IF;

        -- Marcas de tiempo derivadas (después de validar la transición; solo
        -- en actualizaciones directas, nunca en caminos RPC)
        IF NEW.status IN ('in_progress', 'completed') AND NEW.started_at IS NULL THEN
            NEW.started_at := now();
        END IF;
        IF NEW.status = 'completed' THEN
            NEW.finished_at := COALESCE(NEW.finished_at, now());
        ELSIF NEW.status = 'in_progress' THEN
            NEW.finished_at := NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Reapertura: al volver a In progress limpia también finished_at (el cierre
-- formal lo había fijado; m2_close_wo lo restaura con COALESCE al re-cerrar).
CREATE OR REPLACE FUNCTION public.m2_reopen_wo(
    p_wo_id  UUID,
    p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La reapertura requiere un motivo';
    END IF;

    SELECT status INTO v_status FROM work_orders WHERE id = p_wo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OT inexistente';
    END IF;
    IF v_status NOT IN ('closed', 'cancelled') THEN
        RAISE EXCEPTION 'Solo se reabren OTs Cerradas o Canceladas (estado actual: %)', v_status;
    END IF;

    PERFORM set_config('app.wo_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', p_reason, TRUE);

    -- F2.7: closed_at/closed_by/finished_at → NULL; la garantía NO se elimina
    -- (queda marcada "OT origen reabierta"); no revierte próxima fecha (M3).
    UPDATE work_orders
    SET status = 'in_progress', closed_at = NULL, closed_by = NULL,
        finished_at = NULL,
        generates_warranty = NULL
    WHERE id = p_wo_id;

    UPDATE warranties SET is_origin_reopened = TRUE WHERE origin_wo_id = p_wo_id;

    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.wo_rpc', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.m2_reopen_wo(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_reopen_wo(UUID, TEXT) TO authenticated, service_role;
