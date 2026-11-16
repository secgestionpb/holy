-- Migración 4 — Módulo 1 core: warranties + guards + auditoría + vistas + cron
-- Fuente: markdown/BD/warranties.md + 01-gestion-de-activos-flujos.md (F1.1–F1.12, V1.1–V1.7)
-- Nota: provider_id / origin_wo_id son UUID simples SIN FK (providers = M5,
-- work_orders = M2 — las FKs se agregan al implementar esos módulos; así lo
-- declara el propio BD/warranties.md con comentarios).

-- ============ warranties (BD/warranties.md) ============
CREATE TABLE warranties (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id            UUID NOT NULL REFERENCES assets(id),
    warranty_type       TEXT NOT NULL CHECK (warranty_type IN ('purchase','repair')),
    provider_id         UUID NULL,            -- FK → providers (M5, pendiente)
    provider_name       TEXT NULL,            -- texto libre (fabricante/taller)
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    coverage            TEXT NOT NULL CHECK (coverage IN ('parts','labor','both')),
    notes               TEXT NULL,
    document_path       TEXT NULL,            -- Storage bucket 'activos'
    status              TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','expired')),
                        -- estado_calculado: lo mantiene asset_warranty_engine + pg_cron
    origin_wo_id        UUID NULL UNIQUE,     -- FK → work_orders (M2, pendiente)
    is_origin_reopened  BOOLEAN NOT NULL DEFAULT false,
    notified_at         TIMESTAMPTZ NULL,     -- aviso Único Evento 7 (dedup)
    created_by          UUID NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_warranties_asset  ON warranties(asset_id);
CREATE INDEX idx_warranties_status ON warranties(status);
CREATE INDEX idx_warranties_end    ON warranties(end_date) WHERE status = 'active';
CREATE INDEX idx_warranties_origin ON warranties(origin_wo_id) WHERE origin_wo_id IS NOT NULL;

CREATE TRIGGER warranties_set_updated_at
    BEFORE UPDATE ON warranties
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: SELECT 4 roles / INSERT-UPDATE solo Mantenimiento / DELETE prohibido
ALTER TABLE warranties ENABLE ROW LEVEL SECURITY;

CREATE POLICY warranties_select ON warranties
    FOR SELECT TO authenticated USING (true);

CREATE POLICY warranties_insert_mantenimiento ON warranties
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

CREATE POLICY warranties_update_mantenimiento ON warranties
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

-- ============ Guard: baja forzada a Inactivo + fases de garantía solo motor ============
-- F1.3: mientras etapa = 'decommissioned', estado_operativo queda forzado a
-- 'inactive' en cada UPDATE (imposible sobreescribir). Al salir de la baja el
-- control se rehabilita. Además: 'no_warranty'/'under_warranty' solo las
-- asigna el motor (service role → auth.uid() NULL); un UPDATE con sesión de
-- usuario que intente entrar a esas fases se rechaza (INSERT en alta sí
-- permite 'under_warranty' — F1.1 paso 6).
CREATE OR REPLACE FUNCTION public.fn_assets_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.life_stage = 'decommissioned' THEN
            NEW.operational_status := 'inactive';
        END IF;
        IF NEW.life_stage IS DISTINCT FROM OLD.life_stage
           AND NEW.life_stage IN ('no_warranty', 'under_warranty')
           AND auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'Las fases "Sin garantía"/"En garantía" las asigna el motor de garantías.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assets_guard
    BEFORE INSERT OR UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION public.fn_assets_guard();

-- ============ Guard: al mover un activo, sus componentes heredan la ubicación ============
-- F1.2 paso 4: cascada lógica auditada (cada UPDATE hijo dispara su propio trigger).
CREATE OR REPLACE FUNCTION public.fn_assets_cascade_location() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    WITH RECURSIVE descendants AS (
        SELECT id FROM assets WHERE parent_id = NEW.id
        UNION ALL
        SELECT a.id FROM assets a JOIN descendants d ON a.parent_id = d.id
    )
    UPDATE assets SET location_id = NEW.location_id
    FROM descendants
    WHERE assets.id = descendants.id
      AND assets.location_id IS DISTINCT FROM NEW.location_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assets_cascade_location
    AFTER UPDATE OF location_id ON assets
    FOR EACH ROW
    WHEN (NEW.parent_id IS NULL AND OLD.location_id IS DISTINCT FROM NEW.location_id)
    EXECUTE FUNCTION public.fn_assets_cascade_location();

-- ============ Guard: desactivar ubicación solo sin activos en el subárbol ============
-- F1.11 paso 2: bloqueado si contiene activos o sub-ubicaciones con activos
-- (historial de OTs NO impide desactivar).
CREATE OR REPLACE FUNCTION public.fn_locations_deactivate_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_count BIGINT;
BEGIN
    IF NEW.is_active = false AND OLD.is_active = true THEN
        WITH RECURSIVE subtree AS (
            SELECT id FROM locations WHERE id = NEW.id
            UNION ALL
            SELECT l.id FROM locations l JOIN subtree s ON l.parent_id = s.id
        )
        SELECT COUNT(*) INTO v_count
        FROM assets a
        WHERE a.location_id IN (SELECT id FROM subtree);

        IF v_count > 0 THEN
            RAISE EXCEPTION 'La ubicación contiene % activo(s): reubíquelos antes de desactivarla.', v_count;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_locations_deactivate_guard
    BEFORE UPDATE OF is_active ON locations
    FOR EACH ROW EXECUTE FUNCTION public.fn_locations_deactivate_guard();

-- ============ Auditoría M1 (poblada por triggers — audit_log.md) ============
-- actor = GUC app.actor_user_id o auth.uid(); service role/motor → NULL = sistema.
-- motivo: GUC app.audit_reason (la RPC m1_set_life_stage la inyecta para bajas).

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

CREATE TRIGGER trg_audit_assets
    AFTER INSERT OR UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_assets();

CREATE OR REPLACE FUNCTION public.fn_audit_categories() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'name',        jsonb_build_object('old', NULL, 'new', NEW.name),
            'code_prefix', jsonb_build_object('old', NULL, 'new', NEW.code_prefix),
            'is_active',   jsonb_build_object('old', NULL, 'new', NEW.is_active));
    ELSE
        IF NEW.name IS DISTINCT FROM OLD.name THEN
            v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
        END IF;
        IF NEW.description IS DISTINCT FROM OLD.description THEN
            v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', OLD.description, 'new', NEW.description));
        END IF;
        IF NEW.code_prefix IS DISTINCT FROM OLD.code_prefix THEN
            v_changes := v_changes || jsonb_build_object('code_prefix', jsonb_build_object('old', OLD.code_prefix, 'new', NEW.code_prefix));
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('old', OLD.is_active, 'new', NEW.is_active));
            IF NEW.is_active = false THEN v_action := 'deactivate'; END IF;
        END IF;
        IF v_changes = '{}'::jsonb THEN RETURN NEW; END IF;
    END IF;

    PERFORM public.fn_audit_row('assets', 'category', v_action,
        COALESCE(NEW.id, OLD.id), COALESCE(NEW.name, OLD.name), v_changes,
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_categories
    AFTER INSERT OR UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_categories();

CREATE OR REPLACE FUNCTION public.fn_audit_locations() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'name',       jsonb_build_object('old', NULL, 'new', NEW.name),
            'kind',       jsonb_build_object('old', NULL, 'new', NEW.kind),
            'parent_id',  jsonb_build_object('old', NULL, 'new', NEW.parent_id));
    ELSE
        IF NEW.name IS DISTINCT FROM OLD.name THEN
            v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
        END IF;
        IF NEW.kind IS DISTINCT FROM OLD.kind
           OR NEW.zone_subtype IS DISTINCT FROM OLD.zone_subtype THEN
            v_changes := v_changes || jsonb_build_object('kind', jsonb_build_object('old', OLD.kind, 'new', NEW.kind));
        END IF;
        IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
            v_changes := v_changes || jsonb_build_object('parent_id', jsonb_build_object('old', OLD.parent_id, 'new', NEW.parent_id));
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('old', OLD.is_active, 'new', NEW.is_active));
            IF NEW.is_active = false THEN v_action := 'deactivate'; END IF;
        END IF;
        IF v_changes = '{}'::jsonb THEN RETURN NEW; END IF;
    END IF;

    PERFORM public.fn_audit_row('assets', 'location', v_action,
        COALESCE(NEW.id, OLD.id), 'Ubicación ' || COALESCE(NEW.name, OLD.name), v_changes,
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_locations
    AFTER INSERT OR UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_locations();

CREATE OR REPLACE FUNCTION public.fn_audit_warranties() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
    v_code    TEXT;
    v_label   TEXT;
BEGIN
    SELECT code INTO v_code FROM assets WHERE id = COALESCE(NEW.asset_id, OLD.asset_id);
    v_label := 'Garantía ' || COALESCE(v_code, '?');

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'warranty_type', jsonb_build_object('old', NULL, 'new', NEW.warranty_type),
            'start_date',    jsonb_build_object('old', NULL, 'new', NEW.start_date),
            'end_date',      jsonb_build_object('old', NULL, 'new', NEW.end_date),
            'coverage',      jsonb_build_object('old', NULL, 'new', NEW.coverage),
            'origin_wo_id',  jsonb_build_object('old', NULL, 'new', NEW.origin_wo_id));
    ELSE
        IF NEW.end_date IS DISTINCT FROM OLD.end_date THEN
            v_changes := v_changes || jsonb_build_object('end_date', jsonb_build_object('old', OLD.end_date, 'new', NEW.end_date));
        END IF;
        IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN
            v_changes := v_changes || jsonb_build_object('start_date', jsonb_build_object('old', OLD.start_date, 'new', NEW.start_date));
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
        END IF;
        IF NEW.coverage IS DISTINCT FROM OLD.coverage THEN
            v_changes := v_changes || jsonb_build_object('coverage', jsonb_build_object('old', OLD.coverage, 'new', NEW.coverage));
        END IF;
        IF NEW.provider_name IS DISTINCT FROM OLD.provider_name
           OR NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
            v_changes := v_changes || jsonb_build_object('provider', jsonb_build_object('old', OLD.provider_name, 'new', NEW.provider_name));
        END IF;
        IF NEW.is_origin_reopened IS DISTINCT FROM OLD.is_origin_reopened THEN
            v_changes := v_changes || jsonb_build_object('is_origin_reopened', jsonb_build_object('old', OLD.is_origin_reopened, 'new', NEW.is_origin_reopened));
        END IF;
        IF v_changes = '{}'::jsonb THEN RETURN NEW; END IF;
    END IF;

    PERFORM public.fn_audit_row('warranties', 'warranty', v_action,
        COALESCE(NEW.id, OLD.id), v_label, v_changes,
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_warranties
    AFTER INSERT OR UPDATE ON warranties
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_warranties();

CREATE OR REPLACE FUNCTION public.fn_audit_asset_files() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_code  TEXT;
    v_label TEXT;
    v_act   TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'delete' END;
BEGIN
    SELECT code INTO v_code FROM assets WHERE id = COALESCE(NEW.asset_id, OLD.asset_id);
    v_label := 'Documento del activo ' || COALESCE(v_code, '?');

    PERFORM public.fn_audit_row('assets', 'asset_file', v_act,
        COALESCE(NEW.asset_id, OLD.asset_id), v_label,
        jsonb_build_object('file_name', jsonb_build_object(
            'old', CASE WHEN TG_OP = 'DELETE' THEN OLD.file_name ELSE NULL END,
            'new', CASE WHEN TG_OP = 'INSERT' THEN NEW.file_name ELSE NULL END)),
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_asset_files
    AFTER INSERT OR DELETE ON asset_files
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_asset_files();

-- ============ RPC m1_set_life_stage (F1.3 — cambio de etapa con motivo) ============
-- Única vía del front para etapas MANUALES: valida rol, rechaza fases del
-- motor, exige motivo en la baja y publica app.audit_reason para el trigger.
CREATE OR REPLACE FUNCTION public.m1_set_life_stage(
    p_asset_id UUID,
    p_stage     TEXT,
    p_reason    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), '')::UUID, auth.uid());
BEGIN
    IF NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF p_stage NOT IN ('operational','pending_repair','requires_replacement','decommissioned') THEN
        RAISE EXCEPTION 'Etapa no editable: solo el motor asigna "Sin garantía"/"En garantía"';
    END IF;
    IF p_stage = 'decommissioned' AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La baja requiere un motivo';
    END IF;

    PERFORM set_config('app.actor_user_id', COALESCE(v_uid::TEXT, ''), TRUE);
    PERFORM set_config('app.audit_reason', COALESCE(p_reason, ''), TRUE);

    UPDATE assets SET life_stage = p_stage WHERE id = p_asset_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Activo inexistente';
    END IF;

    PERFORM set_config('app.audit_reason', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.m1_set_life_stage(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m1_set_life_stage(UUID, TEXT, TEXT) TO authenticated;

-- ============ Vista V1.1 — listado/explorador (security_invoker aplica RLS) ============
CREATE OR REPLACE VIEW public.v1_assets WITH (security_invoker = true) AS
WITH RECURSIVE loc_path AS (
    SELECT id, name::TEXT AS path FROM locations WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, p.path || ' / ' || c.name
    FROM locations c JOIN loc_path p ON c.parent_id = p.id
),
wstat AS (
    SELECT asset_id,
           BOOL_OR(status = 'active' AND end_date >= CURRENT_DATE) AS has_active,
           BOOL_OR(TRUE) AS has_any
    FROM warranties
    GROUP BY asset_id
)
SELECT
    a.id, a.parent_id, a.location_id, a.category_id, a.code, a.name, a.description,
    a.criticality, a.operational_status, a.life_stage, a.commissioning_date,
    a.expected_lifespan_value, a.lifespan_unit, a.has_usage_counter, a.usage_counter,
    a.usage_counter_updated_at, a.responsible_user_id, a.notes,
    a.created_at, a.updated_at,
    c.name  AS category_name,
    c.code_prefix,
    c.is_active AS category_is_active,
    lp.path AS location_path,
    u.full_name AS responsible_name,
    COALESCE(w.has_active, false) AS warranty_active,   -- badge Vigente
    COALESCE(w.has_any, false)    AS has_warranty,      -- badge Vencida/Ninguna
    CASE WHEN a.lifespan_unit = 'years' AND a.expected_lifespan_value IS NOT NULL
         THEN ROUND((CURRENT_DATE - a.commissioning_date)::NUMERIC / 365.25, 2)
         ELSE NULL END AS lifespan_consumed,
    CASE WHEN a.lifespan_unit = 'years' AND a.expected_lifespan_value IS NOT NULL
         THEN ROUND(a.expected_lifespan_value - (CURRENT_DATE - a.commissioning_date)::NUMERIC / 365.25, 2)
         ELSE NULL END AS lifespan_remaining,
    CASE WHEN a.expected_lifespan_value IS NOT NULL AND (
             (a.lifespan_unit = 'years' AND (CURRENT_DATE - a.commissioning_date)::NUMERIC / 365.25 >= a.expected_lifespan_value)
          OR (a.has_usage_counter AND a.usage_counter IS NOT NULL AND a.usage_counter >= a.expected_lifespan_value)
         ) THEN true ELSE false END AS eol_reached
FROM assets a
LEFT JOIN categories c ON c.id = a.category_id
LEFT JOIN loc_path lp  ON lp.id = a.location_id
LEFT JOIN users u      ON u.id = a.responsible_user_id
LEFT JOIN wstat w      ON w.asset_id = a.id;

GRANT SELECT ON public.v1_assets TO authenticated, service_role;

-- ============ Jobs diarios M1 (F1.4 + F1.9) ============
-- pg_cron → engine (recálculo de estados/etapas) + digest (Evento 7) +
-- Evento 12 (activos al fin de vida útil, dedup por día). Zona: UTC.
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

SELECT cron.schedule('m1-warranty-jobs', '15 2 * * *',
    $$SELECT public.fn_m1_warranty_jobs()$$);
