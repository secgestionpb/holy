-- Migración 8 — Módulo 3: Motor de Generación (m3_cron.sql)
-- F3.3 + Evento 2 (Notificación agrupada)

CREATE OR REPLACE FUNCTION public.m3_wo_generate() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $BODY$
DECLARE
    v_plan RECORD;
    v_asset RECORD;
    v_wo_id UUID;
    v_ots_generated INTEGER := 0;
BEGIN
    FOR v_plan IN SELECT * FROM maintenance_plans WHERE is_active = true LOOP
        v_ots_generated := 0;
        
        -- Obtener activos (unión activos + categoría)
        FOR v_asset IN 
            SELECT id, usage_counter FROM assets WHERE id IN (SELECT asset_id FROM plan_asset_links WHERE plan_id = v_plan.id)
            UNION
            SELECT id, usage_counter FROM assets WHERE category_id IN (SELECT category_id FROM plan_category_links WHERE plan_id = v_plan.id)
        LOOP
            
            -- Condición de disparo
            IF (v_plan.frequency_type = 'time' AND (v_plan.next_due_at - v_plan.lead_days) <= current_date)
               OR (v_plan.frequency_type = 'usage' AND v_asset.usage_counter >= (COALESCE(v_plan.last_run_counter, 0) + v_plan.interval_value))
            THEN
            
                -- Verificar si ya hay una OT abierta
                IF NOT EXISTS (SELECT 1 FROM work_orders WHERE plan_id = v_plan.id AND asset_id = v_asset.id AND status NOT IN ('closed', 'cancelled')) THEN
                    
                    INSERT INTO work_orders (
                        wo_number, asset_id, wo_type, priority, description, origin, plan_id, status, scheduled_at
                    ) VALUES (
                        'OT-' || lpad(nextval('work_orders_number_seq')::text, 4, '0'),
                        v_asset.id, 'preventive', v_plan.default_priority, v_plan.name, 'preventive', v_plan.id, 'open', 
                        CASE WHEN v_plan.frequency_type = 'time' THEN v_plan.next_due_at ELSE current_date END
                    ) RETURNING id INTO v_wo_id;

                    -- Snapshot de checklist
                    IF v_plan.checklist_template_id IS NOT NULL THEN
                        INSERT INTO wo_checklist_entries (wo_id, checklist_item_id, position, item_text)
                        SELECT v_wo_id, id, position, text
                        FROM checklist_items
                        WHERE template_id = v_plan.checklist_template_id;
                    END IF;
                    
                    v_ots_generated := v_ots_generated + 1;
                END IF;
            END IF;
        END LOOP;

        -- Actualizar estado del plan si se generaron OTs (sólo tiempo)
        IF v_plan.frequency_type = 'time' AND v_ots_generated > 0 THEN
            UPDATE maintenance_plans 
            SET next_due_at = v_plan.next_due_at + (v_plan.interval_value || ' days')::INTERVAL
            WHERE id = v_plan.id;
        END IF;
        
        -- Evento 2: Notificación agrupada
        IF v_ots_generated > 0 THEN
            INSERT INTO notification_log (event_id, message, metadata)
            VALUES (2, 'Se generaron ' || v_ots_generated || ' OTs preventivas para el plan: ' || v_plan.name, jsonb_build_object('plan_id', v_plan.id));
        END IF;
        
    END LOOP;
END;
$BODY$;

-- Job diario a las 02:00
SELECT cron.schedule('m3-wo-generate-daily', '0 2 * * *', 'SELECT public.m3_wo_generate()');

