-- ============================================================
-- M1 fix: fn_audit_assets referenciaba v_new.is_active (columna
-- inexistente en assets) y reventaba TODO UPDATE que no tocara
-- etapa/estado (ubicación, nombre, etc.). fn_m1_warranty_jobs:
-- URLs de EFs con guiones + cast 12::SMALLINT (firma fn_notify).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_audit_assets() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_old     public.assets%ROWTYPE;
    v_new     public.assets%ROWTYPE;
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT;
    v_label   TEXT;
    v_reason  TEXT := NULLIF(current_setting('app.audit_reason', TRUE), '');
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_label := 'Activo ' || NEW.code;
        v_changes := jsonb_build_object(
            'code',             jsonb_build_object('old', NULL, 'new', NEW.code),
            'name',             jsonb_build_object('old', NULL, 'new', NEW.name),
            'category_id',      jsonb_build_object('old', NULL, 'new', NEW.category_id),
            'location_id',      jsonb_build_object('old', NULL, 'new', NEW.location_id),
            'criticality',      jsonb_build_object('old', NULL, 'new', NEW.criticality),
            'life_stage',       jsonb_build_object('old', NULL, 'new', NEW.life_stage),
            'commissioning_date', jsonb_build_object('old', NULL, 'new', NEW.commissioning_date)
        );
        v_action := 'create';
    ELSE
        v_old := OLD; v_new := NEW;
        IF v_new.code IS DISTINCT FROM v_old.code THEN
            v_changes := v_changes || jsonb_build_object('code', jsonb_build_object('old', v_old.code, 'new', v_new.code));
        END IF;
        IF v_new.name IS DISTINCT FROM v_old.name THEN
            v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', v_old.name, 'new', v_new.name));
        END IF;
        IF v_new.description IS DISTINCT FROM v_old.description THEN
            v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', v_old.description, 'new', v_new.description));
        END IF;
        IF v_new.category_id IS DISTINCT FROM v_old.category_id THEN
            v_changes := v_changes || jsonb_build_object('category_id', jsonb_build_object('old', v_old.category_id, 'new', v_new.category_id));
        END IF;
        IF v_new.location_id IS DISTINCT FROM v_old.location_id THEN
            v_changes := v_changes || jsonb_build_object('location_id', jsonb_build_object('old', v_old.location_id, 'new', v_new.location_id));
        END IF;
        IF v_new.criticality IS DISTINCT FROM v_old.criticality THEN
            v_changes := v_changes || jsonb_build_object('criticality', jsonb_build_object('old', v_old.criticality, 'new', v_new.criticality));
        END IF;
        IF v_new.operational_status IS DISTINCT FROM v_old.operational_status THEN
            v_changes := v_changes || jsonb_build_object('operational_status', jsonb_build_object('old', v_old.operational_status, 'new', v_new.operational_status));
        END IF;
        IF v_new.life_stage IS DISTINCT FROM v_old.life_stage THEN
            v_changes := v_changes || jsonb_build_object('life_stage', jsonb_build_object('old', v_old.life_stage, 'new', v_new.life_stage));
        END IF;
        IF v_new.commissioning_date IS DISTINCT FROM v_old.commissioning_date THEN
            v_changes := v_changes || jsonb_build_object('commissioning_date', jsonb_build_object('old', v_old.commissioning_date, 'new', v_new.commissioning_date));
        END IF;
        IF v_new.expected_lifespan_value IS DISTINCT FROM v_old.expected_lifespan_value
           OR v_new.lifespan_unit IS DISTINCT FROM v_old.lifespan_unit THEN
            v_changes := v_changes || jsonb_build_object('lifespan', jsonb_build_object(
                'old', jsonb_build_object('value', v_old.expected_lifespan_value, 'unit', v_old.lifespan_unit),
                'new', jsonb_build_object('value', v_new.expected_lifespan_value, 'unit', v_new.lifespan_unit)));
        END IF;
        IF v_new.responsible_user_id IS DISTINCT FROM v_old.responsible_user_id THEN
            v_changes := v_changes || jsonb_build_object('responsible_user_id', jsonb_build_object('old', v_old.responsible_user_id, 'new', v_new.responsible_user_id));
        END IF;
        IF v_new.notes IS DISTINCT FROM v_old.notes THEN
            v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('old', v_old.notes, 'new', v_new.notes));
        END IF;

        IF v_changes = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
        END IF;

        IF v_new.life_stage IS DISTINCT FROM v_old.life_stage
           OR v_new.operational_status IS DISTINCT FROM v_old.operational_status THEN
            v_action := 'state_change';
        ELSE
            v_action := 'update';
        END IF;
        v_label := 'Activo ' || v_new.code;
    END IF;

    PERFORM public.fn_audit_row('assets', 'asset', v_action,
        COALESCE(NEW.id, OLD.id), v_label, v_changes, v_reason);
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_m1_warranty_jobs() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_url     TEXT := 'https://wqqsaxoebrekdrmzjdod.supabase.co/functions/v1';
    v_headers JSONB := jsonb_build_object('Content-Type', 'application/json');
    v_asset   RECORD;
BEGIN
    PERFORM net.http_post(url := v_url || '/asset-warranty-engine',
        headers := v_headers, body := jsonb_build_object('action', 'recalc'));
    PERFORM net.http_post(url := v_url || '/warranty-expiring-digest',
        headers := v_headers, body := jsonb_build_object('action', 'schedule'));

    -- Evento 12: vida útil consumida (F1.9) — NO cambia etapa; dedup por día.
    FOR v_asset IN
        SELECT id, code, name
        FROM assets
        WHERE life_stage <> 'decommissioned'
          AND expected_lifespan_value IS NOT NULL
          AND (
            (lifespan_unit = 'years'
             AND (CURRENT_DATE - commissioning_date)::NUMERIC / 365.25 >= expected_lifespan_value)
            OR (has_usage_counter AND usage_counter IS NOT NULL
                AND usage_counter >= expected_lifespan_value)
          )
    LOOP
        PERFORM public.fn_notify(12::SMALLINT, 'asset'::TEXT, v_asset.id,
            'eol:' || v_asset.id || ':' || CURRENT_DATE::TEXT,
            jsonb_build_object('code', v_asset.code, 'name', v_asset.name));
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_m1_warranty_jobs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_m1_warranty_jobs() TO postgres, service_role;
