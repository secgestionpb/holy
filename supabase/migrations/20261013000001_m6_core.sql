-- Migración M6 — Módulo 6: Cumplimiento Normativo y Mediciones
-- Fuente de verdad: markdown/BD/{certifications,compliance_categories,measurement_types,measurement_records}.md
-- + 06-cumplimiento-mediciones-flujos.md
-- Eventos 8 (certificación por vencer — aviso único por vigencia) y 9
-- (medición fuera de rango — inmediato) ya sembrados en T2; aquí solo se
-- agrega el lead_days global del Evento 8.

-- ============ compliance_categories (BD/compliance_categories.md) ============
CREATE TABLE compliance_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER compliance_categories_set_updated_at
    BEFORE UPDATE ON compliance_categories
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Semillas de la spec (extensibles sin migración)
INSERT INTO compliance_categories (name, description) VALUES
    ('Seguridad estructural', 'Inspecciones y certificaciones de estructura'),
    ('Contra incendios', 'Sistemas de detección/extinción, bomberos'),
    ('Sanitaria/agua', 'Potabilidad, tanques, piscinas'),
    ('Ambiental', 'Vertidos, residuos, ruido'),
    ('Eléctrica', 'Puestas a tierra, tableros, termografías'),
    ('Elevadores', 'Ascensores y montacargas')
ON CONFLICT (name) DO NOTHING;

-- RLS: Calidad CRUD · Mant/Admin lectura · Técnico sin acceso (spec)
ALTER TABLE compliance_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compliance_categories_select ON compliance_categories;
CREATE POLICY compliance_categories_select ON compliance_categories
    FOR SELECT TO authenticated
    USING (public.has_role('calidad') OR public.has_role('mantenimiento')
           OR public.has_role('administrador'));
DROP POLICY IF EXISTS compliance_categories_insert ON compliance_categories;
CREATE POLICY compliance_categories_insert ON compliance_categories
    FOR INSERT TO authenticated WITH CHECK (public.has_role('calidad'));
DROP POLICY IF EXISTS compliance_categories_update ON compliance_categories;
CREATE POLICY compliance_categories_update ON compliance_categories
    FOR UPDATE TO authenticated
    USING (public.has_role('calidad'))
    WITH CHECK (public.has_role('calidad'));

-- ============ certifications (BD/certifications.md) ============
CREATE TABLE certifications (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL,
    asset_id                UUID REFERENCES assets(id),   -- NULL = "General" (todo el hotel)
    compliance_category_id  UUID NOT NULL REFERENCES compliance_categories(id),
    issuing_entity          TEXT,
    certificate_number      TEXT,
    issued_at               DATE,
    expires_at              DATE NOT NULL,
    renewal_period          TEXT CHECK (renewal_period IS NULL OR renewal_period IN
                            ('monthly','bimonthly','quarterly','semiannual','annual','other')),
    lead_days               INTEGER CHECK (lead_days IS NULL OR lead_days >= 0),
    responsible_provider_id UUID REFERENCES providers(id),
    document_path           TEXT,           -- bucket documentos, prefijo cumplimiento/
    notes                   TEXT,
    is_active               BOOLEAN NOT NULL DEFAULT true,
    created_by              UUID REFERENCES users(id),
    updated_by              UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expires_at > issued_at)
);

CREATE INDEX idx_certifications_expires ON certifications (expires_at);   -- Evento 8 (F6.3)
CREATE INDEX idx_certifications_asset   ON certifications (asset_id);

CREATE TRIGGER certifications_set_updated_at
    BEFORE UPDATE ON certifications
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: Calidad CRUD · Mant renovación+lectura · Admin lectura · Técnico sin acceso
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS certifications_select ON certifications;
CREATE POLICY certifications_select ON certifications
    FOR SELECT TO authenticated
    USING (public.has_role('calidad') OR public.has_role('mantenimiento')
           OR public.has_role('administrador'));
DROP POLICY IF EXISTS certifications_insert ON certifications;
CREATE POLICY certifications_insert ON certifications
    FOR INSERT TO authenticated WITH CHECK (public.has_role('calidad'));
DROP POLICY IF EXISTS certifications_update ON certifications;
CREATE POLICY certifications_update ON certifications
    FOR UPDATE TO authenticated
    USING (public.has_role('calidad'))
    WITH CHECK (public.has_role('calidad'));
-- Sin policy DELETE → sin borrado físico (is_active = false, patrón del sistema)

-- ============ certification_history (append-only — spec history) ============
CREATE TABLE certification_history (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certification_id        UUID NOT NULL REFERENCES certifications(id),
    issued_at               DATE NOT NULL,
    expires_at              DATE NOT NULL,
    renewed_at              DATE NOT NULL DEFAULT current_date,
    responsible_provider_id UUID REFERENCES providers(id),
    document_path           TEXT,
    note                    TEXT,
    archived_by             UUID REFERENCES users(id),
    archived_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cert_history_cert ON certification_history (certification_id, expires_at DESC);

-- RLS: lectura (calidad/mant/admin); escritura SOLO vía RPC m6_renew_certification
ALTER TABLE certification_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS certification_history_select ON certification_history;
CREATE POLICY certification_history_select ON certification_history
    FOR SELECT TO authenticated
    USING (public.has_role('calidad') OR public.has_role('mantenimiento')
           OR public.has_role('administrador'));
-- Sin policies INSERT/UPDATE/DELETE (append-only, patrón kardex)

-- ============ measurement_types (BD/measurement_types.md) ============
CREATE TABLE measurement_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    category_id     UUID NOT NULL REFERENCES categories(id),
    unit            TEXT NOT NULL
                    CHECK (unit IN ('unidad','pH','ppm','mg_l','porcentaje','celsius','litro','kg','m3','otro')),
    min_value       NUMERIC(10,3) NOT NULL,
    max_value       NUMERIC(10,3) NOT NULL,
    frequency       TEXT NOT NULL DEFAULT 'daily'
                    CHECK (frequency IN ('daily','every_2_days','weekly','biweekly','monthly')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (max_value > min_value)
);

CREATE INDEX idx_measurement_types_category ON measurement_types (category_id);
CREATE INDEX idx_measurement_types_active ON measurement_types (is_active) WHERE is_active;

CREATE TRIGGER measurement_types_set_updated_at
    BEFORE UPDATE ON measurement_types
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: Calidad CRUD · Mant/Admin lectura · Técnico sin acceso
ALTER TABLE measurement_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS measurement_types_select ON measurement_types;
CREATE POLICY measurement_types_select ON measurement_types
    FOR SELECT TO authenticated
    USING (public.has_role('calidad') OR public.has_role('mantenimiento')
           OR public.has_role('administrador'));
DROP POLICY IF EXISTS measurement_types_insert ON measurement_types;
CREATE POLICY measurement_types_insert ON measurement_types
    FOR INSERT TO authenticated WITH CHECK (public.has_role('calidad'));
DROP POLICY IF EXISTS measurement_types_update ON measurement_types;
CREATE POLICY measurement_types_update ON measurement_types
    FOR UPDATE TO authenticated
    USING (public.has_role('calidad'))
    WITH CHECK (public.has_role('calidad'));

-- ============ measurement_records (append-only, resultado automático) ============
CREATE TABLE measurement_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    measurement_type_id UUID NOT NULL REFERENCES measurement_types(id),
    asset_id            UUID NOT NULL REFERENCES assets(id),
    measured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    value               NUMERIC(10,3) NOT NULL,
    result              TEXT NOT NULL CHECK (result IN ('in_range','out_of_range')),
    recorded_by         UUID NULL REFERENCES users(id),
    notes               TEXT,
    evidence_path       TEXT,               -- bucket documentos, prefijo cumplimiento/
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mr_type_date  ON measurement_records (measurement_type_id, measured_at DESC);
CREATE INDEX idx_mr_asset_date ON measurement_records (asset_id, measured_at DESC);
CREATE INDEX idx_mr_out        ON measurement_records (measured_at DESC) WHERE result = 'out_of_range';

-- RLS: lectura (calidad/mant/admin); escritura SOLO vía RPC m6_register_measurement
-- (garantiza resultado automático + Evento 9; append-only sin UPDATE/DELETE)
ALTER TABLE measurement_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS measurement_records_select ON measurement_records;
CREATE POLICY measurement_records_select ON measurement_records
    FOR SELECT TO authenticated
    USING (public.has_role('calidad') OR public.has_role('mantenimiento')
           OR public.has_role('administrador'));

-- ============ Auditoría (T3 — module='compliance' ya en el CHECK) ============
CREATE OR REPLACE FUNCTION public.fn_audit_compliance_categories() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
    v_field   TEXT;
    v_old     TEXT;
    v_new     TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'name',      jsonb_build_object('old', NULL, 'new', NEW.name),
            'is_active', jsonb_build_object('old', NULL, 'new', NEW.is_active));
    ELSE
        FOR v_field, v_old, v_new IN
            SELECT * FROM unnest(
                ARRAY['name','description','is_active'],
                ARRAY[OLD.name, OLD.description, OLD.is_active::text],
                ARRAY[NEW.name, NEW.description, NEW.is_active::text])
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
    PERFORM public.fn_audit_row('compliance', 'compliance_category', v_action,
        COALESCE(NEW.id, OLD.id), 'Categoría normativa ' || COALESCE(NEW.name, OLD.name),
        v_changes, NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_compliance_categories
    AFTER INSERT OR UPDATE ON compliance_categories
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_compliance_categories();

CREATE OR REPLACE FUNCTION public.fn_audit_certifications() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
    v_field   TEXT;
    v_old     TEXT;
    v_new     TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'name',                  jsonb_build_object('old', NULL, 'new', NEW.name),
            'compliance_category_id', jsonb_build_object('old', NULL, 'new', NEW.compliance_category_id::text),
            'asset_id',              jsonb_build_object('old', NULL, 'new', NEW.asset_id::text),
            'expires_at',            jsonb_build_object('old', NULL, 'new', NEW.expires_at::text),
            'is_active',             jsonb_build_object('old', NULL, 'new', NEW.is_active));
    ELSE
        FOR v_field, v_old, v_new IN
            SELECT * FROM unnest(
                ARRAY['name','asset_id','compliance_category_id','issuing_entity',
                      'certificate_number','issued_at','expires_at','renewal_period',
                      'lead_days','responsible_provider_id','document_path','notes','is_active'],
                ARRAY[OLD.name, OLD.asset_id::text, OLD.compliance_category_id::text,
                      OLD.issuing_entity, OLD.certificate_number, OLD.issued_at::text,
                      OLD.expires_at::text, OLD.renewal_period, OLD.lead_days::text,
                      OLD.responsible_provider_id::text, OLD.document_path, OLD.notes,
                      OLD.is_active::text],
                ARRAY[NEW.name, NEW.asset_id::text, NEW.compliance_category_id::text,
                      NEW.issuing_entity, NEW.certificate_number, NEW.issued_at::text,
                      NEW.expires_at::text, NEW.renewal_period, NEW.lead_days::text,
                      NEW.responsible_provider_id::text, NEW.document_path, NEW.notes,
                      NEW.is_active::text])
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
    PERFORM public.fn_audit_row('compliance', 'certification', v_action,
        COALESCE(NEW.id, OLD.id), 'Certificación ' || COALESCE(NEW.name, OLD.name),
        v_changes, NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_certifications
    AFTER INSERT OR UPDATE ON certifications
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_certifications();

CREATE OR REPLACE FUNCTION public.fn_audit_certification_history() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.fn_audit_row('compliance', 'certification_history', 'create',
        NEW.certification_id, 'Renovación de certificación',
        jsonb_build_object(
            'issued_at',  jsonb_build_object('old', NULL, 'new', NEW.issued_at::text),
            'expires_at', jsonb_build_object('old', NULL, 'new', NEW.expires_at::text),
            'renewed_at', jsonb_build_object('old', NULL, 'new', NEW.renewed_at::text)),
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_certification_history
    AFTER INSERT ON certification_history
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_certification_history();

CREATE OR REPLACE FUNCTION public.fn_audit_measurement_types() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
    v_field   TEXT;
    v_old     TEXT;
    v_new     TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'name',        jsonb_build_object('old', NULL, 'new', NEW.name),
            'category_id', jsonb_build_object('old', NULL, 'new', NEW.category_id::text),
            'unit',        jsonb_build_object('old', NULL, 'new', NEW.unit),
            'min_value',   jsonb_build_object('old', NULL, 'new', NEW.min_value::text),
            'max_value',   jsonb_build_object('old', NULL, 'new', NEW.max_value::text),
            'is_active',   jsonb_build_object('old', NULL, 'new', NEW.is_active));
    ELSE
        FOR v_field, v_old, v_new IN
            SELECT * FROM unnest(
                ARRAY['name','category_id','unit','min_value','max_value','frequency','is_active'],
                ARRAY[OLD.name, OLD.category_id::text, OLD.unit, OLD.min_value::text,
                      OLD.max_value::text, OLD.frequency, OLD.is_active::text],
                ARRAY[NEW.name, NEW.category_id::text, NEW.unit, NEW.min_value::text,
                      NEW.max_value::text, NEW.frequency, NEW.is_active::text])
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
    PERFORM public.fn_audit_row('compliance', 'measurement_type', v_action,
        COALESCE(NEW.id, OLD.id), 'Tipo de medición ' || COALESCE(NEW.name, OLD.name),
        v_changes, NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_measurement_types
    AFTER INSERT OR UPDATE ON measurement_types
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_measurement_types();

CREATE OR REPLACE FUNCTION public.fn_audit_measurement_records() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.fn_audit_row('compliance', 'measurement_record', 'create',
        NEW.id, 'Medición registrada',
        jsonb_build_object(
            'measurement_type_id', jsonb_build_object('old', NULL, 'new', NEW.measurement_type_id::text),
            'asset_id',            jsonb_build_object('old', NULL, 'new', NEW.asset_id::text),
            'value',               jsonb_build_object('old', NULL, 'new', NEW.value::text),
            'result',              jsonb_build_object('old', NULL, 'new', NEW.result)),
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_measurement_records
    AFTER INSERT ON measurement_records
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_measurement_records();

-- ============ RPC m6_renew_certification (F6.2 — renovación con historial) ============
CREATE OR REPLACE FUNCTION public.m6_renew_certification(
    p_certification_id   UUID,
    p_issued_at          DATE,
    p_expires_at         DATE,
    p_document_path      TEXT,
    p_provider_id        UUID DEFAULT NULL,
    p_note               TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cert     RECORD;
    v_provider UUID;
BEGIN
    IF auth.uid() IS NOT NULL
       AND NOT (public.has_role('calidad') OR public.has_role('mantenimiento')) THEN
        RAISE EXCEPTION 'Requiere rol Calidad o Mantenimiento';
    END IF;
    IF p_expires_at IS NULL OR p_expires_at <= p_issued_at THEN
        RAISE EXCEPTION 'La fecha de vencimiento debe ser posterior a la emisión';
    END IF;

    SELECT * INTO v_cert FROM certifications WHERE id = p_certification_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Certificación no encontrada';
    END IF;

    -- Snapshot de la vigencia ACTUAL antes de cambiar (spec history)
    INSERT INTO certification_history (
        certification_id, issued_at, expires_at, responsible_provider_id,
        document_path, note, archived_by)
    VALUES (
        v_cert.id, COALESCE(v_cert.issued_at, v_cert.expires_at), v_cert.expires_at,
        v_cert.responsible_provider_id, v_cert.document_path,
        COALESCE(p_note, 'Renovación'), auth.uid());

    v_provider := COALESCE(p_provider_id, v_cert.responsible_provider_id);

    UPDATE certifications SET
        issued_at              = p_issued_at,
        expires_at             = p_expires_at,
        document_path          = p_document_path,
        responsible_provider_id = v_provider
    WHERE id = p_certification_id;

    RETURN jsonb_build_object('id', v_certification_id, 'expires_at', p_expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.m6_renew_certification(UUID, DATE, DATE, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m6_renew_certification(UUID, DATE, DATE, TEXT, UUID, TEXT) TO authenticated, service_role;

-- ============ RPC m6_register_measurement (F6.4 — resultado + Evento 9) ============
CREATE OR REPLACE FUNCTION public.m6_register_measurement(
    p_measurement_type_id UUID,
    p_asset_id            UUID,
    p_value               NUMERIC,
    p_measured_at         TIMESTAMPTZ DEFAULT now(),
    p_notes               TEXT DEFAULT NULL,
    p_evidence_path       TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_type   RECORD;
    v_asset  RECORD;
    v_result TEXT;
    v_id     UUID;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('calidad') THEN
        RAISE EXCEPTION 'Requiere rol Calidad';
    END IF;

    SELECT * INTO v_type FROM measurement_types WHERE id = p_measurement_type_id;
    IF NOT FOUND OR v_type.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'Tipo de medición no encontrado o inactivo';
    END IF;

    SELECT id, code, name, category_id, is_active
    INTO v_asset FROM assets WHERE id = p_asset_id;
    IF NOT FOUND OR v_asset.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'Activo no encontrado o inactivo';
    END IF;
    -- El tipo filtra por categoría aplicable (spec: los activos son los puntos)
    IF v_asset.category_id IS DISTINCT FROM v_type.category_id THEN
        RAISE EXCEPTION 'El activo no pertenece a la categoría aplicable del tipo de medición';
    END IF;

    v_result := CASE WHEN p_value BETWEEN v_type.min_value AND v_type.max_value
                     THEN 'in_range' ELSE 'out_of_range' END;

    INSERT INTO measurement_records (
        measurement_type_id, asset_id, measured_at, value, result,
        recorded_by, notes, evidence_path)
    VALUES (
        p_measurement_type_id, p_asset_id, p_measured_at, p_value, v_result,
        auth.uid(), p_notes, p_evidence_path)
    RETURNING id INTO v_id;

    -- Evento 9 INMEDIATO cuando fuera de rango (spec out_of_range_notification)
    IF v_result = 'out_of_range' THEN
        PERFORM public.fn_notify(9::SMALLINT, 'measurement', v_id, NULL, jsonb_build_object(
            'type_name',  v_type.name,
            'unit',       v_type.unit,
            'asset_code', v_asset.code,
            'asset_name', v_asset.name,
            'asset_id',   v_asset.id,
            'value',      p_value,
            'min_value',  v_type.min_value,
            'max_value',  v_type.max_value,
            'measured_at', p_measured_at));
    END IF;

    RETURN jsonb_build_object('id', v_id, 'result', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.m6_register_measurement(UUID, UUID, NUMERIC, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m6_register_measurement(UUID, UUID, NUMERIC, TIMESTAMPTZ, TEXT, TEXT) TO authenticated, service_role;

-- ============ Evento 8 — Certificación/permiso por vencer (F6.3, aviso único) ============
-- Ventana = lead_days propio o config global (notification_config.extra_param).
-- AVISO ÚNICO por vigencia: dedup_key incluye expires_at — renovar cambia el
-- vencimiento y resetea el dedup. Los ya vencidos NO reenvían.
CREATE OR REPLACE FUNCTION public.fn_m6_certification_jobs() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg   RECORD;
    v_lead  INTEGER;
    v_c     RECORD;
    v_days  INTEGER;
BEGIN
    SELECT extra_param, is_active INTO v_cfg
    FROM notification_config WHERE event_id = 8 FOR UPDATE;
    IF NOT FOUND OR v_cfg.is_active IS NOT TRUE THEN
        RETURN;
    END IF;
    v_lead := COALESCE(v_cfg.extra_param, 30);

    FOR v_c IN
        SELECT c.id, c.name, c.expires_at, c.lead_days, c.issuing_entity,
               c.certificate_number, c.responsible_provider_id,
               p.name AS provider_name
        FROM certifications c
        LEFT JOIN providers p ON p.id = c.responsible_provider_id
        WHERE c.is_active = true
          AND c.expires_at >= CURRENT_DATE          -- vencidos NO reenvían
          AND CURRENT_DATE > c.expires_at - COALESCE(c.lead_days, v_lead)
    LOOP
        v_days := v_c.expires_at - CURRENT_DATE;
        PERFORM public.fn_notify(8::SMALLINT, 'certification', v_c.id,
            'cert-window:' || v_c.id::TEXT || ':' || v_c.expires_at::TEXT,
            jsonb_build_object(
                'name',           v_c.name,
                'issuing_entity', v_c.issuing_entity,
                'certificate_number', v_c.certificate_number,
                'expires_at',     v_c.expires_at,
                'days_left',      v_days,
                'provider_name',  v_c.provider_name));
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_m6_certification_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_m6_certification_jobs() TO postgres, service_role;

-- Días de anticipación global del Evento 8 (configurable en Configuración)
UPDATE notification_config
SET extra_param = 30
WHERE event_id = 8 AND extra_param IS NULL;

-- pg_cron diario (junto a los jobs de M3/M4/M5 en la franja 02:xx)
SELECT cron.schedule('m6-certification-jobs', '25 2 * * *',
    $$SELECT public.fn_m6_certification_jobs()$$);

-- ============ Storage: prefijo cumplimiento/ en bucket documentos ============
DROP POLICY IF EXISTS documentos_insert_cumplimiento ON storage.objects;
CREATE POLICY documentos_insert_cumplimiento ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'documentos'
        AND (storage.foldername(name))[1] = 'cumplimiento'
        AND public.has_role('calidad')
    );

DROP POLICY IF EXISTS documentos_delete_cumplimiento ON storage.objects;
CREATE POLICY documentos_delete_cumplimiento ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'documentos'
        AND (storage.foldername(name))[1] = 'cumplimiento'
        AND public.has_role('calidad')
    );
