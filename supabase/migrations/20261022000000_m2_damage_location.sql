-- Migración: reportes de daño SIN activo + ubicación en texto libre (F2.1).
--  1) Nueva columna location (texto libre). Cada reporte debe tener activo
--     (histórico/externo) O ubicación escrita → CHECK dr_asset_or_location.
--  2) asset_id pasa a NULLABLE: los reportes antiguos conservan su activo;
--     los nuevos reportan solo ubicación.
--  3) Vista V2.4 (v2_damage_reports) expone dr.location.
--  4) Auditoría y notificación (Evento 5) registran location.
--  5) RPC m2_create_wo (F2.2): la validación de coincidencia activo↔reporte
--     solo aplica cuando el reporte SÍ tiene activo — si no lo tiene, el
--     técnico elige el activo en el formulario de OT.

-- ============ 1. Columna location + asset_id nullable + CHECK ============
ALTER TABLE damage_reports
    ADD COLUMN IF NOT EXISTS location TEXT NULL;

COMMENT ON COLUMN damage_reports.location IS
    'Ubicación del daño en texto libre (reportes sin activo del catálogo).';

ALTER TABLE damage_reports
    ALTER COLUMN asset_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dr_asset_or_location'
          AND conrelid = 'public.damage_reports'::regclass
    ) THEN
        ALTER TABLE public.damage_reports
            ADD CONSTRAINT dr_asset_or_location
            CHECK (asset_id IS NOT NULL
                   OR NULLIF(btrim(location), '') IS NOT NULL);
    END IF;
END $$;

-- ============ 2. Vista V2.4 — bandeja de reportes (expone location) ============
-- DROP + CREATE (no CREATE OR REPLACE): al insertar dr.location antes de
-- reported_by cambiaría el ORDEN de columnas y Postgres lo rechaza como
-- "rename" (error 42P16).
DROP VIEW IF EXISTS public.v2_damage_reports;

CREATE VIEW public.v2_damage_reports WITH (security_invoker = true) AS
WITH RECURSIVE loc_path AS (
    SELECT id, name::TEXT AS path FROM locations WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, p.path || ' / ' || c.name
    FROM locations c JOIN loc_path p ON c.parent_id = p.id
)
SELECT
    dr.id,
    public.m2_dr_ref(dr.id) AS report_ref,
    dr.asset_id, dr.component_id, dr.description, dr.location,
    dr.reported_by, dr.reported_at,
    dr.status, dr.reviewed_by, dr.reviewed_at, dr.discarded_by, dr.discarded_at,
    dr.discard_reason, dr.origin, dr.external_ref, dr.created_at, dr.updated_at,
    a.code AS asset_code, a.name AS asset_name, a.category_id,
    c2.code AS component_code, c2.name AS component_name,
    lp.path AS location_path,
    cat.name AS category_name,
    rb.full_name AS reporter_name,
    wo.id AS wo_id, wo.wo_number
FROM damage_reports dr
LEFT JOIN assets a   ON a.id = dr.asset_id
LEFT JOIN assets c2  ON c2.id = dr.component_id
LEFT JOIN loc_path lp ON lp.id = a.location_id
LEFT JOIN categories cat ON cat.id = a.category_id
LEFT JOIN users rb    ON rb.id = dr.reported_by
LEFT JOIN work_orders wo ON wo.damage_report_id = dr.id;

GRANT SELECT ON public.v2_damage_reports TO authenticated, service_role;

-- ============ 3. Auditoría — location en el alta ============
CREATE OR REPLACE FUNCTION public.fn_audit_damage_reports() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT;
    v_label   TEXT := 'Reporte de daño ' || public.m2_dr_ref(COALESCE(NEW.id, OLD.id));
    v_reason  TEXT := NULLIF(current_setting('app.audit_reason', TRUE), '');
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_action := 'create';
        v_changes := jsonb_build_object(
            'asset_id',     jsonb_build_object('old', NULL, 'new', NEW.asset_id),
            'component_id', jsonb_build_object('old', NULL, 'new', NEW.component_id),
            'location',     jsonb_build_object('old', NULL, 'new', NEW.location),
            'description',  jsonb_build_object('old', NULL, 'new', NEW.description),
            'reported_by',  jsonb_build_object('old', NULL, 'new', NEW.reported_by),
            'status',       jsonb_build_object('old', NULL, 'new', NEW.status)
        );
    ELSE
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
            v_action := CASE
                WHEN NEW.status = 'converted' THEN 'convert'
                WHEN NEW.status = 'discarded' THEN 'discard'
                ELSE 'state_change'
            END;
        END IF;
        IF NEW.discard_reason IS DISTINCT FROM OLD.discard_reason THEN
            v_changes := v_changes || jsonb_build_object('discard_reason', jsonb_build_object('old', OLD.discard_reason, 'new', NEW.discard_reason));
        END IF;
        IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN
            v_changes := v_changes || jsonb_build_object('reviewed_by', jsonb_build_object('old', OLD.reviewed_by, 'new', NEW.reviewed_by));
        END IF;
        IF v_changes = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
        IF v_action IS NULL THEN v_action := 'update'; END IF;
    END IF;

    PERFORM public.fn_audit_row('work_orders', 'damage_report', v_action,
        COALESCE(NEW.id, OLD.id), v_label, v_changes, v_reason);
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============ 4. Notificación (Evento 5) — payload con location ============
CREATE OR REPLACE FUNCTION public.fn_dr_notify_insert() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.fn_notify(5::SMALLINT, 'damage_report', NEW.id,
        'damage-report:' || NEW.id,
        jsonb_build_object('ref', public.m2_dr_ref(NEW.id),
            'asset_id', NEW.asset_id,
            'location', NEW.location,
            'reported_by', NEW.reported_by));
    RETURN NEW;
END;
$$;

-- ============ 5. m2_create_wo — coincidencia de activo solo si el reporte lo trae ============
CREATE OR REPLACE FUNCTION public.m2_create_wo(
    p_asset_id         UUID,
    p_description      TEXT,
    p_component_id     UUID DEFAULT NULL,
    p_wo_type          TEXT DEFAULT 'corrective',
    p_priority         TEXT DEFAULT 'normal',
    p_origin           TEXT DEFAULT 'manual',
    p_damage_report_id UUID DEFAULT NULL,
    p_external_ref     TEXT DEFAULT NULL,
    p_reported_by      UUID DEFAULT NULL,
    p_scheduled_at     TIMESTAMPTZ DEFAULT NULL,
    p_affects_sale     BOOLEAN DEFAULT FALSE,
    p_executed_by_type TEXT DEFAULT 'internal',
    p_provider_id      UUID DEFAULT NULL,
    p_external_cost    NUMERIC DEFAULT NULL,
    p_technicians      UUID[] DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id     UUID;
    v_number TEXT;
    v_status TEXT;
    v_dr     RECORD;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF NULLIF(trim(COALESCE(p_description, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La descripción es obligatoria';
    END IF;
    IF p_wo_type NOT IN ('corrective', 'preventive', 'inspection') THEN
        RAISE EXCEPTION 'Tipo de OT inválido';
    END IF;
    IF p_priority NOT IN ('urgent', 'normal', 'low') THEN
        RAISE EXCEPTION 'Prioridad inválida';
    END IF;
    IF p_origin NOT IN ('manual', 'damage_report', 'preventive', 'external_app') THEN
        RAISE EXCEPTION 'Origen inválido';
    END IF;
    IF p_executed_by_type NOT IN ('internal', 'external') THEN
        RAISE EXCEPTION 'Ejecución inválida';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM assets WHERE id = p_asset_id) THEN
        RAISE EXCEPTION 'Activo inexistente';
    END IF;
    IF p_component_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM assets WHERE id = p_component_id AND parent_id = p_asset_id
    ) THEN
        RAISE EXCEPTION 'El componente no pertenece al activo seleccionado';
    END IF;

    IF p_executed_by_type = 'external' AND p_provider_id IS NULL THEN
        RAISE EXCEPTION 'El proveedor es obligatorio cuando la ejecución es externa';
    END IF;
    IF p_provider_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM providers WHERE id = p_provider_id AND is_active
    ) THEN
        RAISE EXCEPTION 'Proveedor inexistente o inactivo';
    END IF;

    -- Conversión desde bandeja (F2.2): hereda activo/componente y valida revisión.
    -- Si el reporte NO tiene activo (solo ubicación), el técnico lo elige en el
    -- formulario de OT: solo se exige coherencia cuando el reporte lo trae.
    IF p_damage_report_id IS NOT NULL THEN
        SELECT * INTO v_dr FROM damage_reports WHERE id = p_damage_report_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Reporte de daño inexistente';
        END IF;
        IF v_dr.status <> 'pending_review' THEN
            RAISE EXCEPTION 'El reporte ya fue revisado';
        END IF;
        IF v_dr.asset_id IS NOT NULL
           AND (v_dr.asset_id <> p_asset_id
                OR v_dr.component_id IS DISTINCT FROM p_component_id) THEN
            RAISE EXCEPTION 'El reporte corresponde a otro activo/componente';
        END IF;
        IF p_origin <> 'damage_report' THEN
            RAISE EXCEPTION 'Una OT desde reporte debe usar origen "damage_report"';
        END IF;
    END IF;

    PERFORM public.m2_validate_technicians(p_technicians);

    v_status := CASE WHEN coalesce(array_length(p_technicians, 1), 0) > 0
                     THEN 'assigned' ELSE 'open' END;
    v_number := 'OT-' || lpad(nextval('work_orders_number_seq')::TEXT, 4, '0');

    INSERT INTO work_orders (
        wo_number, asset_id, component_id, wo_type, priority, description, origin,
        damage_report_id, external_ref, reported_by, status, scheduled_at,
        assigned_at, affects_sale, executed_by_type, provider_id, external_cost
    ) VALUES (
        v_number, p_asset_id, p_component_id, p_wo_type, p_priority, p_description, p_origin,
        p_damage_report_id, p_external_ref, COALESCE(p_reported_by, auth.uid()),
        v_status, p_scheduled_at,
        CASE WHEN v_status = 'assigned' THEN now() ELSE NULL END,
        COALESCE(p_affects_sale, FALSE), p_executed_by_type, p_provider_id, p_external_cost
    ) RETURNING id INTO v_id;

    IF coalesce(array_length(p_technicians, 1), 0) > 0 THEN
        INSERT INTO wo_technicians (wo_id, user_id, assigned_by)
        SELECT v_id, u, auth.uid() FROM unnest(p_technicians) AS u;
    END IF;

    IF p_damage_report_id IS NOT NULL THEN
        UPDATE damage_reports
        SET status = 'converted', reviewed_by = auth.uid(), reviewed_at = now()
        WHERE id = p_damage_report_id;
    END IF;

    RETURN jsonb_build_object('id', v_id, 'wo_number', v_number, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.m2_create_wo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TIMESTAMPTZ, BOOLEAN, TEXT, UUID, NUMERIC, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_create_wo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TIMESTAMPTZ, BOOLEAN, TEXT, UUID, NUMERIC, UUID[]) TO authenticated, service_role;
