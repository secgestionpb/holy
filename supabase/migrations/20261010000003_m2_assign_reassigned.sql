-- Migración 8 — M2: m2_assign_wo marca el flag reassigned (F2.4 / decisión
-- "se marca en la operación de reasignación"): cuando la operación quita y
-- agrega técnicos a la vez (re-asignación real), el badge/filtro "Reasignadas"
-- de V2.1 se activa. Reemplazo puro (m2_technician_replace) ya lo marcaba.
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
        SELECT p_wo_id, x, v_actor FROM unnest(v_to_add) AS x;
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
