-- ============================================================
-- M1 F1.12 — Importación masiva de activos.
-- 1) fn_audit_assets: durante una importación (GUC app.audit_import='1')
--    NO escribe entrada por fila — la entrada consolidada la escribe la
--    edge function m1-import-assets (una sola, action 'import').
-- 2) RPC m1_import_lot: inserta un lote de activos en UNA transacción
--    (PostgREST = una transacción por llamada), con savepoint por fila para
--    que una fila que reviente (p.ej. código duplicado por carrera) no
--    aborte el lote entero. Devuelve el resultado por fila.
-- ============================================================

-- ---- 1) fn_audit_assets con salto durante importación ----
-- (cuerpo base = 20261009000002_m1_fix_audit_jobs.sql + línea de salto)
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
    -- Importación masiva (F1.12): auditoría CONSOLIDADA, no por fila.
    IF current_setting('app.audit_import', TRUE) = '1' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

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

-- ---- 2) RPC de lote de importación ----
-- p_rows: arreglo jsonb con una entrada por fila ya validada por la edge
-- function m1-import-assets:
--   { row_num, code, name, category_id, location_id, criticality,
--     commissioning_date, expected_lifespan_value, lifespan_unit,
--     responsible_user_id, operational_status, life_stage, description, notes }
-- p_actor: usuario que ejecuta la importación (atribución del lote).
-- Retorna: [{ row, ok, id, code, error }] — 'row' es el número de fila del
-- archivo para poder armar el reporte de resultado.
CREATE OR REPLACE FUNCTION public.m1_import_lot(
    p_rows  JSONB,
    p_actor UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_results JSONB := '[]'::jsonb;
    v_rec     RECORD;
    v_id      UUID;
BEGIN
    -- Auditar como usuario y suprimir entradas por fila (ver arriba).
    PERFORM set_config('app.audit_import', '1', TRUE);
    PERFORM set_config('app.actor_user_id', COALESCE(p_actor::TEXT, ''), TRUE);

    FOR v_rec IN
        SELECT *
        FROM jsonb_to_recordset(p_rows) AS x(
            row_num                INTEGER,
            code                   TEXT,
            name                   TEXT,
            category_id            UUID,
            location_id            UUID,
            criticality            TEXT,
            commissioning_date     DATE,
            expected_lifespan_value NUMERIC,
            lifespan_unit          TEXT,
            responsible_user_id    UUID,
            operational_status     TEXT,
            life_stage             TEXT,
            description            TEXT,
            notes                  TEXT
        )
    LOOP
        BEGIN
            INSERT INTO assets (
                parent_id, location_id, category_id, code, name, description,
                criticality, operational_status, life_stage, commissioning_date,
                expected_lifespan_value, lifespan_unit, responsible_user_id,
                notes, created_by
            ) VALUES (
                NULL, v_rec.location_id, v_rec.category_id, v_rec.code, v_rec.name,
                v_rec.description, v_rec.criticality,
                COALESCE(v_rec.operational_status, 'operational'),
                COALESCE(v_rec.life_stage, 'no_warranty'),
                v_rec.commissioning_date, v_rec.expected_lifespan_value,
                v_rec.lifespan_unit, v_rec.responsible_user_id, v_rec.notes,
                p_actor
            )
            RETURNING id INTO v_id;

            v_results := v_results || jsonb_build_array(jsonb_build_object(
                'row', v_rec.row_num, 'ok', TRUE, 'id', v_id, 'code', v_rec.code));
        EXCEPTION WHEN OTHERS THEN
            -- Subtransacción por fila: el lote sigue; esta fila se reporta.
            v_results := v_results || jsonb_build_array(jsonb_build_object(
                'row', v_rec.row_num, 'ok', FALSE, 'error', SQLERRM));
        END;
    END LOOP;

    PERFORM set_config('app.audit_import', '', TRUE);
    PERFORM set_config('app.actor_user_id', '', TRUE);

    RETURN v_results;
END;
$$;

-- Solo la edge function (service role) debe invocarlo: revalida todo y
-- orquesta lotes/auditoría consolidada. El front no lo usa.
REVOKE ALL ON FUNCTION public.m1_import_lot(JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m1_import_lot(JSONB, UUID) TO postgres, service_role;
