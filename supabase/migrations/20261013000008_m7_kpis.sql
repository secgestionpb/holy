-- Migración 2 — Módulo 7: KPIs en vivo (decisión 7.5) + seed lazy (F7.2)
-- 5 RPCs SECURITY INVOKER (RLS hereda): kpi_operativos / kpi_inventario /
-- kpi_proveedores / kpi_cumplimiento / kpi_activos
-- + m7_seed_dashboard_kpis (sets por rol — decisión 7.1)

-- ============ Seed lazy de visibilidad por usuario (F7.2 paso 1) ============
CREATE OR REPLACE FUNCTION public.m7_seed_dashboard_kpis() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid  UUID := auth.uid();
    v_keys TEXT[];
    v_count INTEGER;
BEGIN
    IF v_uid IS NULL THEN RETURN 0; END IF;

    SELECT COALESCE(ARRAY_AGG(k), '{}') INTO v_keys
    FROM unnest(ARRAY[
        'mttr','mtbf','pm_on_time_pct','overdue_pms','avg_response_time','cost_per_asset',
        'cost_per_category','cost_per_location','failure_ranking','ots_by_origin','reassigned_ots','technician_performance',
        'inventory_value','low_stock_items','negative_stock_items','parts_consumption','count_history',
        'provider_cost','contracts_expiring','contractor_history',
        'certification_status','certification_history','out_of_range_measurements','measurement_trends',
        'assets_by_stage','remaining_life','warranty_status'
    ]) AS k
    WHERE public.has_role('administrador')
       OR (public.has_role('mantenimiento') AND k IN (
            'mttr','mtbf','pm_on_time_pct','overdue_pms','avg_response_time','cost_per_asset',
            'cost_per_category','cost_per_location','failure_ranking','ots_by_origin','reassigned_ots','technician_performance',
            'inventory_value','low_stock_items','negative_stock_items','parts_consumption','count_history',
            'provider_cost','contracts_expiring','contractor_history',
            'assets_by_stage','remaining_life','warranty_status'))
       OR (public.has_role('calidad') AND k IN (
            'pm_on_time_pct','overdue_pms',
            'certification_status','certification_history','out_of_range_measurements','measurement_trends'))
       OR (public.has_role('tecnico') AND k IN (
            'technician_performance','overdue_pms'));

    INSERT INTO user_dashboard_kpis (user_id, kpi_key, visible)
    SELECT v_uid, k, true
    FROM unnest(v_keys) AS k
    ON CONFLICT (user_id, kpi_key) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.m7_seed_dashboard_kpis() TO authenticated;

-- ============ Grupo 1: operativos de mantenimiento ============
CREATE OR REPLACE FUNCTION public.kpi_operativos(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_result JSONB := '{}'::jsonb;
    v_rate   NUMERIC;
BEGIN
    SELECT COALESCE((SELECT value::NUMERIC FROM system_parameters WHERE key = 'labor_hourly_rate'), 0)
    INTO v_rate;

    -- mttr (horas): AVG(closed_at − reported_at) de correctivas CERRADAS en período
    v_result := v_result || jsonb_build_object('mttr', jsonb_build_object(
        'value', COALESCE((
            SELECT ROUND(AVG(EXTRACT(EPOCH FROM (wo.closed_at - wo.reported_at)) / 3600), 1)
            FROM work_orders wo
            WHERE wo.wo_type = 'corrective' AND wo.status = 'closed'
              AND wo.closed_at >= p_from AND wo.closed_at < (p_to + 1)
        ), 0),
        'unit', 'h'
    ));

    -- mtbf (días): AVG de días entre correctivas consecutivas del MISMO activo
    v_result := v_result || jsonb_build_object('mtbf', jsonb_build_object(
        'value', COALESCE((
            SELECT ROUND(AVG(EXTRACT(EPOCH FROM gap) / 86400), 1)
            FROM (
                SELECT reported_at - LAG(reported_at) OVER (PARTITION BY asset_id ORDER BY reported_at) AS gap
                FROM work_orders
                WHERE wo_type = 'corrective' AND reported_at < (p_to + 1)
                  AND asset_id IS NOT NULL
            ) g
            WHERE gap IS NOT NULL
        ), 0),
        'unit', 'd'
    ));

    -- pm_on_time_pct: preventivas cerradas a tiempo / generadas en período
    v_result := v_result || jsonb_build_object('pm_on_time_pct', (
        SELECT jsonb_build_object(
            'value', CASE WHEN COUNT(*) = 0 THEN 0
                     ELSE ROUND(100.0 * COUNT(*) FILTER (
                        WHERE wo.closed_at IS NOT NULL
                          AND wo.closed_at <= (COALESCE(wo.scheduled_at, wo.reported_at) + COALESCE(mp.grace_days, 0) * INTERVAL '1 day')
                     ) / COUNT(*), 1) END,
            'total', COUNT(*),
            'on_time', COUNT(*) FILTER (
                WHERE wo.closed_at IS NOT NULL
                  AND wo.closed_at <= (COALESCE(wo.scheduled_at, wo.reported_at) + COALESCE(mp.grace_days, 0) * INTERVAL '1 day')
            ),
            'unit', '%'
        )
        FROM work_orders wo
        LEFT JOIN maintenance_plans mp ON mp.id = wo.plan_id
        WHERE wo.wo_type = 'preventive' AND wo.reported_at >= p_from AND wo.reported_at < (p_to + 1)
          AND wo.status <> 'cancelled'
    ));

    -- overdue_pms (snapshot): preventivas con vencimiento+gracia superado, status ≠ cerrada/cancelada
    v_result := v_result || jsonb_build_object('overdue_pms', (
        SELECT jsonb_build_object(
            'value', COUNT(*),
            'snapshot', true,
            'rows', COALESCE(jsonb_agg(jsonb_build_object(
                'id', wo.id, 'wo_number', wo.wo_number, 'asset_name', a.name,
                'scheduled_at', to_char(wo.scheduled_at, 'YYYY-MM-DD')
            ) ORDER BY wo.scheduled_at), '[]'::jsonb)
        )
        FROM work_orders wo
        JOIN assets a ON a.id = wo.asset_id
        LEFT JOIN maintenance_plans mp ON mp.id = wo.plan_id
        WHERE wo.wo_type = 'preventive'
          AND wo.status NOT IN ('closed', 'cancelled')
          AND wo.scheduled_at IS NOT NULL
          AND (wo.scheduled_at + COALESCE(mp.grace_days, 0) * INTERVAL '1 day') < CURRENT_DATE
    ));

    -- avg_response_time (horas): AVG(assigned_at − reported_at) por OT
    v_result := v_result || jsonb_build_object('avg_response_time', jsonb_build_object(
        'value', COALESCE((
            SELECT ROUND(AVG(EXTRACT(EPOCH FROM (assigned_at - reported_at)) / 3600), 1)
            FROM work_orders
            WHERE assigned_at IS NOT NULL AND reported_at >= p_from AND reported_at < (p_to + 1)
        ), 0),
        'unit', 'h'
    ));

    -- Costos: CTE base de OTs cerradas en período con mano de obra + repuestos + externo
    v_result := v_result || (
        WITH wo_costs AS (
            SELECT wo.id, wo.asset_id, COALESCE(wo.external_cost, 0) AS external_cost,
                   COALESCE((
                       SELECT SUM(wt.hours_worked * COALESCE(u.hourly_rate, v_rate))
                       FROM wo_technicians wt
                       JOIN users u ON u.id = wt.user_id
                       WHERE wt.wo_id = wo.id
                   ), 0) AS labor,
                   COALESCE((
                       SELECT SUM(CASE sm.type WHEN 'salida_ot' THEN sm.line_total
                                               WHEN 'devolucion' THEN -sm.line_total
                                               ELSE 0 END)
                       FROM stock_movements sm
                       WHERE sm.wo_id = wo.id
                   ), 0) AS parts
            FROM work_orders wo
            WHERE wo.status = 'closed'
              AND wo.closed_at >= p_from AND wo.closed_at < (p_to + 1)
        ),
        by_asset AS (
            SELECT a.id AS asset_id, a.code, a.name, a.category_id, a.location_id,
                   SUM(c.labor) AS labor, SUM(c.parts) AS parts,
                   SUM(c.external_cost) AS external,
                   SUM(c.labor + c.parts + c.external_cost) AS total
            FROM wo_costs c
            JOIN assets a ON a.id = c.asset_id
            GROUP BY a.id, a.code, a.name, a.category_id, a.location_id
        )
        SELECT jsonb_build_object(
            'cost_per_asset', jsonb_build_object(
                'value', COALESCE((SELECT ROUND(SUM(total), 2) FROM by_asset), 0),
                'unit', 'cur',
                'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'asset_id', asset_id, 'code', code, 'name', name,
                    'labor', ROUND(labor, 2), 'parts', ROUND(parts, 2),
                    'external', ROUND(external, 2), 'total', ROUND(total, 2)
                ) ORDER BY total DESC) FROM by_asset), '[]'::jsonb)
            ),
            'cost_per_category', jsonb_build_object(
                'value', COALESCE((SELECT ROUND(SUM(total), 2) FROM by_asset), 0),
                'unit', 'cur',
                'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'category_id', x.category_id, 'name', COALESCE(x.name, 'Sin categoría'),
                    'total', x.total
                ) ORDER BY x.total DESC)
                FROM (
                    SELECT b.category_id, cat.name, ROUND(SUM(b.total), 2) AS total
                    FROM by_asset b LEFT JOIN categories cat ON cat.id = b.category_id
                    GROUP BY b.category_id, cat.name
                ) x), '[]'::jsonb)
            ),
            'cost_per_location', jsonb_build_object(
                'value', COALESCE((SELECT ROUND(SUM(total), 2) FROM by_asset), 0),
                'unit', 'cur',
                'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'location_id', x.location_id, 'name', COALESCE(x.name, 'Sin ubicación'),
                    'total', x.total
                ) ORDER BY x.total DESC)
                FROM (
                    SELECT b.location_id, loc.name, ROUND(SUM(b.total), 2) AS total
                    FROM by_asset b LEFT JOIN locations loc ON loc.id = b.location_id
                    GROUP BY b.location_id, loc.name
                ) x), '[]'::jsonb)
            )
        )
    );

    -- failure_ranking: COUNT de correctivas por activo DESC
    v_result := v_result || jsonb_build_object('failure_ranking', jsonb_build_object(
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'asset_id', r.asset_id, 'code', a.code, 'name', a.name, 'count', r.cnt
            ) ORDER BY r.cnt DESC)
            FROM (
                SELECT wo.asset_id, COUNT(*) AS cnt
                FROM work_orders wo
                WHERE wo.wo_type = 'corrective' AND wo.reported_at >= p_from AND wo.reported_at < (p_to + 1)
                  AND wo.asset_id IS NOT NULL
                GROUP BY wo.asset_id
            ) r
            JOIN assets a ON a.id = r.asset_id
        ), '[]'::jsonb)
    ));

    -- ots_by_origin: GROUP BY work_orders.origin
    v_result := v_result || jsonb_build_object('ots_by_origin', jsonb_build_object(
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('origin', origin, 'count', cnt) ORDER BY cnt DESC)
            FROM (
                SELECT origin, COUNT(*) AS cnt
                FROM work_orders
                WHERE reported_at >= p_from AND reported_at < (p_to + 1)
                GROUP BY origin
            ) o
        ), '[]'::jsonb)
    ));

    -- reassigned_ots: COUNT de cambios del flag reassigned en audit_log (M2: action
    -- 'update'/'state_change' con changes.reassigned.new = true) + detalle
    v_result := v_result || jsonb_build_object('reassigned_ots', (
        SELECT jsonb_build_object(
            'value', COUNT(*),
            'rows', COALESCE(jsonb_agg(jsonb_build_object(
                'entity_id', al.entity_id, 'label', al.entity_label,
                'created_at', to_char(al.created_at, 'YYYY-MM-DD HH24:MI')
            ) ORDER BY al.created_at DESC), '[]'::jsonb)
        )
        FROM audit_log al
        WHERE al.module = 'work_orders' AND al.entity_type = 'work_order'
          AND al.created_at >= p_from AND al.created_at < (p_to + 1)
          AND al.changes ? 'reassigned'
          AND (al.changes->'reassigned'->>'new')::boolean = true
    ));

    -- technician_performance: OTs cerradas, tiempo promedio y horas por técnico (RLS limita)
    v_result := v_result || jsonb_build_object('technician_performance', jsonb_build_object(
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'user_id', t.user_id, 'name', t.full_name,
                'closed_count', t.closed_count,
                'avg_close_hours', t.avg_close_hours,
                'hours_worked', t.hours_worked
            ) ORDER BY t.closed_count DESC)
            FROM (
                SELECT wt.user_id, u.full_name,
                       COUNT(*) FILTER (WHERE wo.status = 'closed') AS closed_count,
                       ROUND(AVG(EXTRACT(EPOCH FROM (wo.closed_at - wo.reported_at)) / 3600)
                             FILTER (WHERE wo.closed_at IS NOT NULL), 1) AS avg_close_hours,
                       ROUND(COALESCE(SUM(wt.hours_worked), 0), 1) AS hours_worked
                FROM wo_technicians wt
                JOIN users u ON u.id = wt.user_id
                JOIN work_orders wo ON wo.id = wt.wo_id
                WHERE wo.reported_at >= p_from AND wo.reported_at < (p_to + 1)
                  AND wt.removed_at IS NULL
                GROUP BY wt.user_id, u.full_name
            ) t
        ), '[]'::jsonb)
    ));

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_operativos(DATE, DATE) TO authenticated;

-- ============ Grupo 2: inventario ============
CREATE OR REPLACE FUNCTION public.kpi_inventario(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_result JSONB := '{}'::jsonb;
BEGIN
    -- inventory_value: Σ warehouse_stock.qty × items.unit_cost por bodega (snapshot)
    v_result := v_result || jsonb_build_object('inventory_value', jsonb_build_object(
        'value', COALESCE((
            SELECT ROUND(SUM(ws.qty * i.unit_cost), 2)
            FROM warehouse_stock ws
            JOIN items i ON i.id = ws.item_id
        ), 0),
        'snapshot', true,
        'unit', 'cur',
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'warehouse_id', w.warehouse_id, 'name', w.name, 'total', w.total
            ) ORDER BY w.total DESC)
            FROM (
                SELECT wh.id AS warehouse_id, wh.name, ROUND(SUM(ws.qty * i.unit_cost), 2) AS total
                FROM warehouse_stock ws
                JOIN items i ON i.id = ws.item_id
                JOIN warehouses wh ON wh.id = ws.warehouse_id
                GROUP BY wh.id, wh.name
            ) w
        ), '[]'::jsonb)
    ));

    -- low_stock_items (snapshot): qty < min_stock AND qty >= 0
    v_result := v_result || jsonb_build_object('low_stock_items', jsonb_build_object(
        'value', (SELECT COUNT(*) FROM warehouse_stock WHERE qty < min_stock AND qty >= 0),
        'snapshot', true,
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'item_id', ws.item_id, 'code', i.code, 'name', i.name,
                'warehouse', wh.name, 'qty', ws.qty, 'min_stock', ws.min_stock
            ) ORDER BY (ws.min_stock - ws.qty) DESC)
            FROM warehouse_stock ws
            JOIN items i ON i.id = ws.item_id
            JOIN warehouses wh ON wh.id = ws.warehouse_id
            WHERE ws.qty < ws.min_stock AND ws.qty >= 0
        ), '[]'::jsonb)
    ));

    -- negative_stock_items (snapshot): qty < 0
    v_result := v_result || jsonb_build_object('negative_stock_items', jsonb_build_object(
        'value', (SELECT COUNT(*) FROM warehouse_stock WHERE qty < 0),
        'snapshot', true,
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'item_id', ws.item_id, 'code', i.code, 'name', i.name,
                'warehouse', wh.name, 'qty', ws.qty
            ) ORDER BY ws.qty)
            FROM warehouse_stock ws
            JOIN items i ON i.id = ws.item_id
            JOIN warehouses wh ON wh.id = ws.warehouse_id
            WHERE ws.qty < 0
        ), '[]'::jsonb)
    ));

    -- parts_consumption: Σ salidas (salida_ot − devolucion, line_total congelado) por item y activo
    v_result := v_result || jsonb_build_object('parts_consumption', (
        SELECT jsonb_build_object(
            'value', COALESCE(ROUND(SUM(net), 2), 0),
            'unit', 'cur',
            'rows', COALESCE(jsonb_agg(jsonb_build_object(
                'item_id', item_id, 'code', code, 'name', name, 'total', ROUND(total, 2)
            ) ORDER BY total DESC), '[]'::jsonb)
        )
        FROM (
            SELECT sm.item_id, i.code, i.name,
                   SUM(CASE sm.type WHEN 'salida_ot' THEN sm.line_total
                                    WHEN 'devolucion' THEN -sm.line_total
                                    ELSE 0 END) AS net,
                   SUM(CASE sm.type WHEN 'salida_ot' THEN sm.line_total
                                    WHEN 'devolucion' THEN -sm.line_total
                                    ELSE 0 END) AS total
            FROM stock_movements sm
            JOIN items i ON i.id = sm.item_id
            WHERE sm.occurred_at >= p_from AND sm.occurred_at < (p_to + 1)
              AND sm.type IN ('salida_ot', 'devolucion')
            GROUP BY sm.item_id, i.code, i.name
        ) c
    ));

    -- count_history: physical_counts confirmados en período + sus diferencias
    v_result := v_result || jsonb_build_object('count_history', jsonb_build_object(
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', pc.id, 'count_date', to_char(pc.count_date, 'YYYY-MM-DD'),
                'warehouse', wh.name,
                'diff_count', COALESCE(pci.diff_count, 0),
                'total_abs_diff', COALESCE(pci.total_abs_diff, 0)
            ) ORDER BY pc.count_date DESC)
            FROM physical_counts pc
            JOIN warehouses wh ON wh.id = pc.warehouse_id
            LEFT JOIN (
                SELECT count_id, COUNT(*) FILTER (WHERE difference <> 0) AS diff_count,
                       SUM(ABS(difference)) AS total_abs_diff
                FROM physical_count_items
                GROUP BY count_id
            ) pci ON pci.count_id = pc.id
            WHERE pc.status = 'confirmed' AND pc.confirmed_at >= p_from AND pc.confirmed_at < (p_to + 1)
        ), '[]'::jsonb)
    ));

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_inventario(DATE, DATE) TO authenticated;

-- ============ Grupo 3: proveedores y contratistas ============
CREATE OR REPLACE FUNCTION public.kpi_proveedores(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_result JSONB := '{}'::jsonb;
    v_window INTEGER;
BEGIN
    SELECT COALESCE((SELECT extra_param FROM notification_config WHERE event_id = 11), 30)
    INTO v_window;

    -- provider_cost: SUM(external_cost) GROUP BY provider_id (OTs cerradas en período)
    v_result := v_result || jsonb_build_object('provider_cost', jsonb_build_object(
        'value', COALESCE((
            SELECT ROUND(SUM(wo.external_cost), 2)
            FROM work_orders wo
            WHERE wo.provider_id IS NOT NULL AND wo.external_cost IS NOT NULL
              AND wo.status = 'closed' AND wo.closed_at >= p_from AND wo.closed_at < (p_to + 1)
        ), 0),
        'unit', 'cur',
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'provider_id', c.provider_id, 'name', p.name,
                'wo_count', c.wo_count, 'total', ROUND(c.total, 2)
            ) ORDER BY c.total DESC)
            FROM (
                SELECT wo.provider_id, COUNT(*) AS wo_count, SUM(wo.external_cost) AS total
                FROM work_orders wo
                WHERE wo.provider_id IS NOT NULL AND wo.external_cost IS NOT NULL
                  AND wo.status = 'closed' AND wo.closed_at >= p_from AND wo.closed_at < (p_to + 1)
                GROUP BY wo.provider_id
            ) c
            JOIN providers p ON p.id = c.provider_id
        ), '[]'::jsonb)
    ));

    -- contracts_expiring (snapshot): contracts.end_date − hoy, ventana = Evento 11
    v_result := v_result || jsonb_build_object('contracts_expiring', jsonb_build_object(
        'value', (
            SELECT COUNT(*) FROM contracts
            WHERE is_active AND end_date >= CURRENT_DATE
              AND end_date < CURRENT_DATE + v_window
        ),
        'snapshot', true,
        'window_days', v_window,
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'provider', p.name,
                'end_date', to_char(c.end_date, 'YYYY-MM-DD'),
                'days_left', c.end_date - CURRENT_DATE
            ) ORDER BY c.end_date)
            FROM contracts c
            JOIN providers p ON p.id = c.provider_id
            WHERE c.is_active AND c.end_date >= CURRENT_DATE
              AND c.end_date < CURRENT_DATE + v_window
        ), '[]'::jsonb)
    ));

    -- contractor_history: link a la ficha del Módulo 5 (widget enlace — decisión 7.8/F7.2)
    v_result := v_result || jsonb_build_object('contractor_history', jsonb_build_object(
        'link', '/app/proveedores',
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'provider_id', c.provider_id, 'name', p.name,
                'wo_count', c.wo_count
            ) ORDER BY c.wo_count DESC)
            FROM (
                SELECT wo.provider_id, COUNT(*) AS wo_count
                FROM work_orders wo
                WHERE wo.provider_id IS NOT NULL
                  AND wo.reported_at >= p_from AND wo.reported_at < (p_to + 1)
                GROUP BY wo.provider_id
            ) c
            JOIN providers p ON p.id = c.provider_id
        ), '[]'::jsonb)
    ));

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_proveedores(DATE, DATE) TO authenticated;

-- ============ Grupo 4: cumplimiento normativo y calidad ============
CREATE OR REPLACE FUNCTION public.kpi_cumplimiento(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_result JSONB := '{}'::jsonb;
    v_lead   INTEGER;
BEGIN
    SELECT COALESCE((SELECT extra_param FROM notification_config WHERE event_id = 8), 30)
    INTO v_lead;

    -- certification_status (snapshot): HOY vs expires_at con lead_days propio o global
    v_result := v_result || jsonb_build_object('certification_status', (
        SELECT jsonb_build_object(
            'snapshot', true,
            'vigor',  COUNT(*) FILTER (
                WHERE c.expires_at >= CURRENT_DATE
                  AND CURRENT_DATE <= c.expires_at - COALESCE(c.lead_days, v_lead)),
            'due',    COUNT(*) FILTER (
                WHERE c.expires_at >= CURRENT_DATE
                  AND CURRENT_DATE >  c.expires_at - COALESCE(c.lead_days, v_lead)),
            'expired', COUNT(*) FILTER (WHERE c.expires_at < CURRENT_DATE),
            'value',  COUNT(*) FILTER (WHERE c.expires_at < CURRENT_DATE),
            'rows', COALESCE(jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'expires_at', to_char(c.expires_at, 'YYYY-MM-DD'),
                'days_left', c.expires_at - CURRENT_DATE,
                'status', CASE WHEN c.expires_at < CURRENT_DATE THEN 'expired'
                               WHEN CURRENT_DATE > c.expires_at - COALESCE(c.lead_days, v_lead) THEN 'due'
                               ELSE 'vigente' END
            ) ORDER BY c.expires_at), '[]'::jsonb)
        )
        FROM certifications c
        WHERE c.is_active
    ));

    -- certification_history: barras de certificación_history por certificación
    v_result := v_result || jsonb_build_object('certification_history', jsonb_build_object(
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'certification_id', ch.certification_id, 'name', c.name,
                'issued_at', to_char(ch.issued_at, 'YYYY-MM-DD'),
                'expires_at', to_char(ch.expires_at, 'YYYY-MM-DD')
            ) ORDER BY ch.expires_at DESC)
            FROM certification_history ch
            JOIN certifications c ON c.id = ch.certification_id
            WHERE ch.expires_at >= p_from - INTERVAL '1 year'
        ), '[]'::jsonb)
    ));

    -- out_of_range_measurements: COUNT por punto de medición en período
    v_result := v_result || jsonb_build_object('out_of_range_measurements', jsonb_build_object(
        'value', (
            SELECT COUNT(*) FROM measurement_records mr
            WHERE mr.result = 'out_of_range'
              AND mr.measured_at >= p_from AND mr.measured_at < (p_to + 1)
        ),
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'type_id', o.measurement_type_id, 'name', mt.name, 'count', o.cnt
            ) ORDER BY o.cnt DESC)
            FROM (
                SELECT mr.measurement_type_id, COUNT(*) AS cnt
                FROM measurement_records mr
                WHERE mr.result = 'out_of_range'
                  AND mr.measured_at >= p_from AND mr.measured_at < (p_to + 1)
                GROUP BY mr.measurement_type_id
            ) o
            JOIN measurement_types mt ON mt.id = o.measurement_type_id
        ), '[]'::jsonb)
    ));

    -- measurement_trends: series temporales de value con banda min/max del tipo
    v_result := v_result || jsonb_build_object('measurement_trends', jsonb_build_object(
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'measured_at', to_char(mr.measured_at, 'YYYY-MM-DD HH24:MI'),
                'type', mt.name, 'asset', a.name,
                'value', mr.value, 'min_value', mt.min_value, 'max_value', mt.max_value,
                'result', mr.result
            ) ORDER BY mr.measured_at)
            FROM measurement_records mr
            JOIN measurement_types mt ON mt.id = mr.measurement_type_id
            LEFT JOIN assets a ON a.id = mr.asset_id
            WHERE mr.measured_at >= p_from AND mr.measured_at < (p_to + 1)
        ), '[]'::jsonb)
    ));

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_cumplimiento(DATE, DATE) TO authenticated;

-- ============ Grupo 5: activos (snapshots) ============
CREATE OR REPLACE FUNCTION public.kpi_activos() RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_result JSONB := '{}'::jsonb;
    v_warr   INTEGER;
BEGIN
    SELECT COALESCE((SELECT value::INTEGER FROM system_parameters WHERE key = 'dias_anticipacion_garantia'), 0)
    INTO v_warr;

    -- assets_by_stage: COUNT GROUP BY life_stage (snapshot)
    v_result := v_result || jsonb_build_object('assets_by_stage', jsonb_build_object(
        'snapshot', true,
        'value', (SELECT COUNT(*) FROM assets),
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('life_stage', life_stage, 'count', cnt) ORDER BY cnt DESC)
            FROM (SELECT life_stage, COUNT(*) AS cnt FROM assets GROUP BY life_stage) s
        ), '[]'::jsonb)
    ));

    -- remaining_life (snapshot): activos no dados de baja con vida útil ≥ 80% consumida
    -- o restante ≤ 1 (año/odómetro según lifespan_unit) — para presupuesto
    v_result := v_result || jsonb_build_object('remaining_life', jsonb_build_object(
        'snapshot', true,
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', v.id, 'code', v.code, 'name', v.name,
                'life_stage', v.life_stage, 'lifespan_unit', v.lifespan_unit,
                'consumed_pct', ROUND(v.consumed_pct, 1),
                'remaining', ROUND(v.remaining, 1)
            ) ORDER BY v.consumed_pct DESC)
            FROM (
                SELECT a.*,
                       CASE
                           WHEN a.lifespan_unit = 'years' AND a.expected_lifespan_value IS NOT NULL
                                AND a.commissioning_date IS NOT NULL AND a.expected_lifespan_value > 0
                           THEN 100.0 * EXTRACT(YEAR FROM age(CURRENT_DATE, a.commissioning_date)) / a.expected_lifespan_value
                           WHEN a.expected_lifespan_value IS NOT NULL AND a.expected_lifespan_value > 0
                           THEN 100.0 * a.usage_counter / a.expected_lifespan_value
                           ELSE NULL
                       END AS consumed_pct,
                       CASE
                           WHEN a.lifespan_unit = 'years' AND a.expected_lifespan_value IS NOT NULL
                                AND a.commissioning_date IS NOT NULL
                           THEN a.expected_lifespan_value - EXTRACT(YEAR FROM age(CURRENT_DATE, a.commissioning_date))
                           WHEN a.expected_lifespan_value IS NOT NULL
                           THEN a.expected_lifespan_value - a.usage_counter
                           ELSE NULL
                       END AS remaining
                FROM assets a
                WHERE a.life_stage <> 'decommissioned' AND a.expected_lifespan_value IS NOT NULL
            ) v
            WHERE v.consumed_pct >= 80 OR v.remaining <= 1
        ), '[]'::jsonb)
    ));

    -- warranty_status (snapshot): warranties vigentes / por vencer / vencidas (window = dias_anticipacion_garantia)
    v_result := v_result || jsonb_build_object('warranty_status', (
        SELECT jsonb_build_object(
            'snapshot', true,
            'window_days', v_warr,
            'vigente',  COUNT(*) FILTER (WHERE w.status = 'active' AND w.end_date >= CURRENT_DATE + v_warr),
            'por_vencer', COUNT(*) FILTER (WHERE w.status = 'active' AND w.end_date >= CURRENT_DATE
                                           AND w.end_date < CURRENT_DATE + v_warr),
            'vencida', COUNT(*) FILTER (WHERE w.status = 'active' AND w.end_date < CURRENT_DATE),
            'value', COUNT(*) FILTER (WHERE w.status = 'active' AND w.end_date < CURRENT_DATE),
            'rows', COALESCE(jsonb_agg(jsonb_build_object(
                'id', w.id, 'asset', a.name, 'provider', w.provider_name,
                'end_date', to_char(w.end_date, 'YYYY-MM-DD'),
                'days_left', w.end_date - CURRENT_DATE,
                'status', CASE WHEN w.end_date < CURRENT_DATE THEN 'vencida'
                               WHEN w.end_date < CURRENT_DATE + v_warr THEN 'por_vencer'
                               ELSE 'vigente' END
            ) ORDER BY w.end_date), '[]'::jsonb)
        )
        FROM warranties w
        LEFT JOIN assets a ON a.id = w.asset_id
        WHERE w.status = 'active'
    ));

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kpi_activos() TO authenticated;
