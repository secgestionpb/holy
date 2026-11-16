-- Migración 9 — M3 fixes tras verificación integral del módulo:
--  1) RLS de plan_asset_links / plan_category_links (quedaron sin habilitar:
--     grants default permitían INSERT/DELETE a anon y authenticated sin policy).
--  2) FK work_orders.plan_id → maintenance_plans (pendiente desde M2; 0 filas
--     no nulas, seguro).
--  3) Políticas duplicadas de wo_checklist_entries (M2 creó wo_checklist_* y
--     m3_core creó wo_checklist_entries_*; idénticas → se elimina el par M2).
--  4) FK de snapshot wo_checklist_entries.checklist_item_id → ON DELETE SET
--     NULL: la spec exige editar plantillas sin romper OTs ya generadas
--     (snapshot inmutable), el FK RESTRICT impedía reemplazar ítems.
--  5) Motor m3_wo_generate v2: el INSERT en notification_log usaba columnas
--     inexistentes (message/metadata) → el motor FALLABA al notificar; ahora
--     usa fn_notify (config + dedup + digest). Añade Evento 6 (F3.6, una
--     notificación acumulada/día de OTs vencidas). Scheduled_at se toma de
--     next_due_at (secuencia no se desfasa) y sin next_due_at nulo.
--  6) F3.5: m3_plan_close_recalc invocado desde m2_close_wo → next_due_at =
--     fecha PROGRAMADA + intervalo (tiempo) / last_run_counter = contador
--     actual (uso) al cerrar OT preventiva, con auditoría.
--  7) Auditoría F3.2/F3.7: trigger de auditoría en maintenance_plans
--     (module = preventive_maintenance, ya contemplado en el CHECK de
--     audit_log).

-- ============ 1) RLS de vínculos de alcance ============
ALTER TABLE plan_asset_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_asset_links_select ON plan_asset_links;
CREATE POLICY plan_asset_links_select ON plan_asset_links
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS plan_asset_links_cud ON plan_asset_links;
CREATE POLICY plan_asset_links_cud ON plan_asset_links
    FOR ALL TO authenticated
    USING (public.has_role('mantenimiento'))
    WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE plan_category_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_category_links_select ON plan_category_links;
CREATE POLICY plan_category_links_select ON plan_category_links
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS plan_category_links_cud ON plan_category_links;
CREATE POLICY plan_category_links_cud ON plan_category_links
    FOR ALL TO authenticated
    USING (public.has_role('mantenimiento'))
    WITH CHECK (public.has_role('mantenimiento'));

-- ============ 2) FK plan_id en work_orders ============
ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_plan_fkey
    FOREIGN KEY (plan_id) REFERENCES maintenance_plans(id);

-- ============ 3) Políticas duplicadas de wo_checklist_entries ============
DROP POLICY IF EXISTS wo_checklist_select ON wo_checklist_entries;
DROP POLICY IF EXISTS wo_checklist_update ON wo_checklist_entries;

-- ============ 4) Snapshot: FK con ON DELETE SET NULL ============
ALTER TABLE wo_checklist_entries DROP CONSTRAINT wo_checklist_entries_item_fkey;
ALTER TABLE wo_checklist_entries
    ADD CONSTRAINT wo_checklist_entries_item_fkey
    FOREIGN KEY (checklist_item_id) REFERENCES checklist_items(id)
    ON DELETE SET NULL;

-- ============ 5) Motor de generación v2 (F3.3 + F3.6) ============
CREATE OR REPLACE FUNCTION public.m3_wo_generate() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $BODY$
DECLARE
    v_plan          RECORD;
    v_asset         RECORD;
    v_wo_id         UUID;
    v_ots_generated INTEGER;
    v_numbers       TEXT[];
    v_wo_number     TEXT;
    v_overdue       JSONB;
BEGIN
    FOR v_plan IN SELECT * FROM maintenance_plans WHERE is_active = true LOOP
        v_ots_generated := 0;
        v_numbers := '{}';

        -- Alcance efectivo = unión de activos puntuales + activos por categoría
        FOR v_asset IN
            SELECT id, COALESCE(usage_counter, 0) AS usage_counter
              FROM assets
             WHERE id IN (SELECT asset_id FROM plan_asset_links WHERE plan_id = v_plan.id)
            UNION
            SELECT id, COALESCE(usage_counter, 0) AS usage_counter
              FROM assets
             WHERE category_id IN (SELECT category_id FROM plan_category_links WHERE plan_id = v_plan.id)
        LOOP
            -- Condición de disparo (F3.3): tiempo con anticipación, o uso
            IF (v_plan.frequency_type = 'time'
                AND v_plan.next_due_at IS NOT NULL
                AND (v_plan.next_due_at - v_plan.lead_days) <= current_date)
               OR (v_plan.frequency_type = 'usage'
                   AND v_asset.usage_counter >= (COALESCE(v_plan.last_run_counter, 0) + v_plan.interval_value))
            THEN
                -- F3.6: no duplicar mientras exista OT abierta del mismo plan+activo
                IF NOT EXISTS (
                    SELECT 1 FROM work_orders
                     WHERE plan_id = v_plan.id
                       AND asset_id = v_asset.id
                       AND status NOT IN ('closed', 'cancelled')
                ) THEN
                    -- wo_number lo asigna trg_wo_number (secuencia, sin doble nextval)
                    INSERT INTO work_orders (
                        asset_id, wo_type, priority, description, origin, plan_id, status, scheduled_at
                    ) VALUES (
                        v_asset.id, 'preventive', v_plan.default_priority, v_plan.name,
                        'preventive', v_plan.id, 'open',
                        CASE WHEN v_plan.frequency_type = 'time'
                             THEN v_plan.next_due_at::timestamp
                             ELSE current_date::timestamp END
                    ) RETURNING id INTO v_wo_id;

                    -- Snapshot de checklist (F3.4)
                    IF v_plan.checklist_template_id IS NOT NULL THEN
                        INSERT INTO wo_checklist_entries (wo_id, checklist_item_id, position, item_text)
                        SELECT v_wo_id, id, position, text
                          FROM checklist_items
                         WHERE template_id = v_plan.checklist_template_id;
                    END IF;

                    SELECT wo_number INTO v_wo_number FROM work_orders WHERE id = v_wo_id;
                    v_ots_generated := v_ots_generated + 1;
                    v_numbers := v_numbers || v_wo_number;
                END IF;
            END IF;
        END LOOP;

        -- F3.3 paso 4: next_due_at = fecha programada + intervalo (solo tiempo)
        IF v_plan.frequency_type = 'time' AND v_ots_generated > 0 THEN
            PERFORM set_config('app.audit_reason', 'Recálculo F3.3 (generación preventiva)', TRUE);
            UPDATE maintenance_plans
               SET next_due_at = (v_plan.next_due_at + make_interval(days => v_plan.interval_value))::date
             WHERE id = v_plan.id;
            PERFORM set_config('app.audit_reason', '', TRUE);
        END IF;

        -- Evento 2 (T2): UNA notificación por plan con sus OTs (agrupada)
        IF v_ots_generated > 0 THEN
            PERFORM public.fn_notify(
                2::SMALLINT, 'maintenance_plan', v_plan.id,
                'm3-generate:' || v_plan.id || ':' || current_date,
                jsonb_build_object(
                    'plan', v_plan.name,
                    'total', v_ots_generated,
                    'ots', v_numbers));
        END IF;
    END LOOP;

    -- F3.6 — Evento 6: UNA notificación acumulada/día con TODAS las OTs
    -- preventivas vencidas (programada + margen de gracia < hoy, sin cerrar).
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'wo_number', wo.wo_number,
               'asset', a.name,
               'programada', wo.scheduled_at::date,
               'dias_vencida', current_date - wo.scheduled_at::date)), '[]'::jsonb)
      INTO v_overdue
      FROM work_orders wo
      JOIN maintenance_plans p ON p.id = wo.plan_id
      JOIN assets a ON a.id = wo.asset_id
     WHERE wo.wo_type = 'preventive'
       AND wo.status NOT IN ('closed', 'cancelled')
       AND wo.scheduled_at IS NOT NULL
       AND (wo.scheduled_at::date + p.grace_days) < current_date;

    IF jsonb_array_length(v_overdue) > 0 THEN
        PERFORM public.fn_notify(
            6::SMALLINT, 'work_order', NULL,
            'm3-overdue:' || current_date,
            jsonb_build_object('total', jsonb_array_length(v_overdue), 'ots', v_overdue));
    END IF;
END;
$BODY$;

REVOKE ALL ON FUNCTION public.m3_wo_generate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m3_wo_generate() TO authenticated, service_role;

-- ============ 6) F3.5 — Recálculo al cerrar OT preventiva ============
CREATE OR REPLACE FUNCTION public.m3_plan_close_recalc(p_wo_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_wo         work_orders%ROWTYPE;
    v_plan       maintenance_plans%ROWTYPE;
    v_old_due    DATE;
    v_new_due    DATE;
    v_old_count  BIGINT;
    v_new_count  BIGINT;
BEGIN
    SELECT * INTO v_wo FROM work_orders WHERE id = p_wo_id;
    IF NOT FOUND OR v_wo.wo_type <> 'preventive' OR v_wo.plan_id IS NULL THEN
        RETURN;
    END IF;
    SELECT * INTO v_plan FROM maintenance_plans WHERE id = v_wo.plan_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF v_plan.frequency_type = 'time' THEN
        -- Base = fecha PROGRAMADA de la OT cerrada (NO la de cierre — spec)
        IF v_wo.scheduled_at IS NULL THEN RETURN; END IF;
        v_old_due := v_plan.next_due_at;
        v_new_due := v_wo.scheduled_at::date + v_plan.interval_value;
        IF v_new_due IS DISTINCT FROM v_old_due THEN
            PERFORM set_config('app.audit_reason', 'Recálculo F3.5 al cerrar ' || v_wo.wo_number, TRUE);
            UPDATE maintenance_plans SET next_due_at = v_new_due WHERE id = v_plan.id;
            PERFORM set_config('app.audit_reason', '', TRUE);
        END IF;
    ELSE
        -- Uso: nuevo umbral = contador actual del activo (F3.5 + F3.8)
        SELECT usage_counter INTO v_new_count FROM assets WHERE id = v_wo.asset_id;
        v_new_count := GREATEST(COALESCE(v_plan.last_run_counter, 0), COALESCE(v_new_count, 0));
        IF v_new_count IS DISTINCT FROM v_plan.last_run_counter THEN
            PERFORM set_config('app.audit_reason', 'Recálculo F3.5 al cerrar ' || v_wo.wo_number, TRUE);
            UPDATE maintenance_plans SET last_run_counter = v_new_count WHERE id = v_plan.id;
            PERFORM set_config('app.audit_reason', '', TRUE);
        END IF;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.m3_plan_close_recalc(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m3_plan_close_recalc(UUID) TO authenticated, service_role;

-- ============ 7) Auditoría de maintenance_plans (F3.2 / F3.7) ============
CREATE OR REPLACE FUNCTION public.fn_audit_maintenance_plans() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
    v_label   TEXT;
    v_field   TEXT;
    v_old     TEXT;
    v_new     TEXT;
BEGIN
    v_label := 'Plan ' || COALESCE(NEW.name, OLD.name);

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'name',           jsonb_build_object('old', NULL, 'new', NEW.name),
            'frequency_type', jsonb_build_object('old', NULL, 'new', NEW.frequency_type),
            'interval_value', jsonb_build_object('old', NULL, 'new', NEW.interval_value),
            'lead_days',      jsonb_build_object('old', NULL, 'new', NEW.lead_days),
            'grace_days',     jsonb_build_object('old', NULL, 'new', NEW.grace_days),
            'next_due_at',    jsonb_build_object('old', NULL, 'new', NEW.next_due_at),
            'is_active',      jsonb_build_object('old', NULL, 'new', NEW.is_active));
    ELSE
        FOR v_field, v_old, v_new IN
            SELECT * FROM unnest(
                ARRAY['name','description','frequency_type','interval_value','lead_days',
                      'grace_days','default_priority','next_due_at','last_run_counter',
                      'checklist_template_id','suggested_role','is_active'],
                ARRAY[OLD.name, OLD.description, OLD.frequency_type, OLD.interval_value::text,
                      OLD.lead_days::text, OLD.grace_days::text, OLD.default_priority,
                      OLD.next_due_at::text, OLD.last_run_counter::text,
                      OLD.checklist_template_id::text, OLD.suggested_role, OLD.is_active::text],
                ARRAY[NEW.name, NEW.description, NEW.frequency_type, NEW.interval_value::text,
                      NEW.lead_days::text, NEW.grace_days::text, NEW.default_priority,
                      NEW.next_due_at::text, NEW.last_run_counter::text,
                      NEW.checklist_template_id::text, NEW.suggested_role, NEW.is_active::text]
            )
        LOOP
            IF v_old IS DISTINCT FROM v_new THEN
                v_changes := v_changes || jsonb_build_object(
                    v_field, jsonb_build_object('old', v_old, 'new', v_new));
            END IF;
        END LOOP;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NEW.is_active = false THEN
            v_action := 'deactivate';
        END IF;
        IF v_changes = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
    END IF;

    PERFORM public.fn_audit_row(
        'preventive_maintenance', 'maintenance_plan', v_action,
        COALESCE(NEW.id, OLD.id), v_label, v_changes,
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_maintenance_plans
    AFTER INSERT OR UPDATE ON maintenance_plans
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_maintenance_plans();

-- ============ 8) Gancho F3.5 en el cierre de CUALQUIER OT preventiva ============
-- Trigger en vez de tocar m2_close_wo: cubre la RPC, updates directos por
-- RLS y futuros caminos de cierre, sin duplicar la definición de M2.
CREATE OR REPLACE FUNCTION public.fn_wo_close_recalc() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.m3_plan_close_recalc(NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wo_close_recalc
    AFTER UPDATE ON work_orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM 'closed' AND NEW.status = 'closed')
    EXECUTE FUNCTION public.fn_wo_close_recalc();
