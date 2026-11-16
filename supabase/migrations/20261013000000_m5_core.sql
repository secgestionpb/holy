-- Migración M5 — Módulo 5: Proveedores y Contratistas Externos
-- Fuente de verdad: markdown/BD/{providers,contracts}.md + 05-proveedores-contratistas-flujos.md
-- providers ya existe (migración M2); aquí se crea la estructura que falta
-- (provider_files, contracts), auditoría, guard de borrado, código PRO-####,
-- Evento 11 (contrato por vencer) y las políticas de Storage para proveedores/.

-- ============ provider_files (BD/providers.md — documentos con tipo) ============
CREATE TABLE provider_files (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id   UUID NOT NULL REFERENCES providers(id),
    doc_type      TEXT NOT NULL CHECK (doc_type IN
                    ('contract','certification','policy','other')),
    path          TEXT NOT NULL,            -- Storage bucket documentos, prefijo proveedores/
    original_name TEXT,
    uploaded_by   UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_files_provider ON provider_files (provider_id);

ALTER TABLE provider_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_files_select ON provider_files;
CREATE POLICY provider_files_select ON provider_files
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS provider_files_insert ON provider_files;
CREATE POLICY provider_files_insert ON provider_files
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));
DROP POLICY IF EXISTS provider_files_update ON provider_files;
CREATE POLICY provider_files_update ON provider_files
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento'))
    WITH CHECK (public.has_role('mantenimiento'));
DROP POLICY IF EXISTS provider_files_delete ON provider_files;
CREATE POLICY provider_files_delete ON provider_files
    FOR DELETE TO authenticated USING (public.has_role('mantenimiento'));

-- ============ contracts (BD/contracts.md — contratos con vigencia) ============
CREATE TABLE contracts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id     UUID NOT NULL REFERENCES providers(id),
    name            TEXT NOT NULL,
    scope           TEXT,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    CHECK (end_date > start_date),
    visit_frequency TEXT CHECK (visit_frequency IS NULL OR visit_frequency IN
                        ('weekly','biweekly','monthly','bimonthly',
                         'quarterly','semiannual','annual')),
    amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    amount_period   TEXT NOT NULL CHECK (amount_period IN
                        ('once','monthly','quarterly','semiannual','annual')),
    document_path   TEXT,
    notes           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contracts_provider ON contracts (provider_id);
CREATE INDEX idx_contracts_end      ON contracts (end_date);   -- Evento 11 (F5.5)

CREATE TRIGGER contracts_set_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: lectura para todos los autenticados (segmentación en app: el catálogo
-- es Mantenimiento CRUD / Admin-Calidad solo lectura / Técnico sin entrada de UI);
-- INSERT/UPDATE solo Mantenimiento; SIN policy DELETE → sin borrado físico
-- (is_active = false, patrón del sistema).
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contracts_select ON contracts;
CREATE POLICY contracts_select ON contracts
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS contracts_insert ON contracts;
CREATE POLICY contracts_insert ON contracts
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));
DROP POLICY IF EXISTS contracts_update ON contracts;
CREATE POLICY contracts_update ON contracts
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento'))
    WITH CHECK (public.has_role('mantenimiento'));

-- ============ Auditoría (T3 — module='providers' ya cubierto por el CHECK) ============
CREATE OR REPLACE FUNCTION public.fn_audit_providers() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
    v_label   TEXT;
    v_field   TEXT;
    v_old     TEXT;
    v_new     TEXT;
BEGIN
    v_label := 'Proveedor ' || COALESCE(NEW.name, OLD.name);

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'code',                jsonb_build_object('old', NULL, 'new', NEW.code),
            'name',                jsonb_build_object('old', NULL, 'new', NEW.name),
            'provider_type',       jsonb_build_object('old', NULL, 'new', NEW.provider_type),
            'service_category_id', jsonb_build_object('old', NULL, 'new', NEW.service_category_id::text),
            'is_active',           jsonb_build_object('old', NULL, 'new', NEW.is_active));
    ELSE
        FOR v_field, v_old, v_new IN
            SELECT * FROM unnest(
                ARRAY['code','name','provider_type','service_category_id','contact_name',
                      'contact_phone','contact_email','address','notes','is_active'],
                ARRAY[OLD.code, OLD.name, OLD.provider_type, OLD.service_category_id::text,
                      OLD.contact_name, OLD.contact_phone, OLD.contact_email, OLD.address,
                      OLD.notes, OLD.is_active::text],
                ARRAY[NEW.code, NEW.name, NEW.provider_type, NEW.service_category_id::text,
                      NEW.contact_name, NEW.contact_phone, NEW.contact_email, NEW.address,
                      NEW.notes, NEW.is_active::text]
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
        'providers', 'provider', v_action,
        COALESCE(NEW.id, OLD.id), v_label, v_changes,
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_providers
    AFTER INSERT OR UPDATE ON providers
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_providers();

CREATE OR REPLACE FUNCTION public.fn_audit_contracts() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
    v_label   TEXT;
    v_field   TEXT;
    v_old     TEXT;
    v_new     TEXT;
BEGIN
    v_label := 'Contrato ' || COALESCE(NEW.name, OLD.name);

    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object(
            'name',          jsonb_build_object('old', NULL, 'new', NEW.name),
            'provider_id',   jsonb_build_object('old', NULL, 'new', NEW.provider_id::text),
            'start_date',    jsonb_build_object('old', NULL, 'new', NEW.start_date::text),
            'end_date',      jsonb_build_object('old', NULL, 'new', NEW.end_date::text),
            'amount',        jsonb_build_object('old', NULL, 'new', NEW.amount::text),
            'amount_period', jsonb_build_object('old', NULL, 'new', NEW.amount_period),
            'is_active',     jsonb_build_object('old', NULL, 'new', NEW.is_active));
    ELSE
        FOR v_field, v_old, v_new IN
            SELECT * FROM unnest(
                ARRAY['name','scope','start_date','end_date','visit_frequency','amount',
                      'amount_period','document_path','notes','is_active'],
                ARRAY[OLD.name, OLD.scope, OLD.start_date::text, OLD.end_date::text,
                      OLD.visit_frequency, OLD.amount::text, OLD.amount_period,
                      OLD.document_path, OLD.notes, OLD.is_active::text],
                ARRAY[NEW.name, NEW.scope, NEW.start_date::text, NEW.end_date::text,
                      NEW.visit_frequency, NEW.amount::text, NEW.amount_period,
                      NEW.document_path, NEW.notes, NEW.is_active::text]
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
        'providers', 'contract', v_action,
        COALESCE(NEW.id, OLD.id), v_label, v_changes,
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_contracts
    AFTER INSERT OR UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_contracts();

-- Documentos del proveedor (patrón trg_audit_asset_files)
CREATE OR REPLACE FUNCTION public.fn_audit_provider_files() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_prov  TEXT;
    v_act   TEXT := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'delete' END;
BEGIN
    SELECT name INTO v_prov FROM providers WHERE id = COALESCE(NEW.provider_id, OLD.provider_id);
    PERFORM public.fn_audit_row('providers', 'provider_file', v_act,
        COALESCE(NEW.provider_id, OLD.provider_id),
        'Documento de ' || COALESCE(v_prov, 'proveedor'),
        jsonb_build_object('file_name', jsonb_build_object(
            'old', CASE WHEN TG_OP = 'DELETE' THEN OLD.original_name ELSE NULL END,
            'new', CASE WHEN TG_OP = 'INSERT' THEN NEW.original_name ELSE NULL END)),
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_provider_files
    AFTER INSERT OR DELETE ON provider_files
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_provider_files();

-- ============ Guard de borrado de proveedores (F5.1: eliminar SOLO sin refs) ============
CREATE OR REPLACE FUNCTION public.fn_provider_delete_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_refs TEXT[] := ARRAY[]::TEXT[];
BEGIN
    IF EXISTS (SELECT 1 FROM work_orders      WHERE provider_id = OLD.id) THEN
        v_refs := v_refs || 'OTs';
    END IF;
    IF EXISTS (SELECT 1 FROM warranties        WHERE provider_id = OLD.id) THEN
        v_refs := v_refs || 'garantías';
    END IF;
    IF EXISTS (SELECT 1 FROM contracts         WHERE provider_id = OLD.id) THEN
        v_refs := v_refs || 'contratos';
    END IF;
    IF EXISTS (SELECT 1 FROM items             WHERE preferred_provider_id = OLD.id) THEN
        v_refs := v_refs || 'ítems';
    END IF;
    IF EXISTS (SELECT 1 FROM stock_movements   WHERE provider_id = OLD.id) THEN
        v_refs := v_refs || 'movimientos de stock';
    END IF;
    IF array_length(v_refs, 1) > 0 THEN
        RAISE EXCEPTION 'El proveedor tiene referencias (%); inactívello en lugar de eliminarlo',
            array_to_string(v_refs, ', ');
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_provider_delete_guard
    BEFORE DELETE ON providers
    FOR EACH ROW EXECUTE FUNCTION public.fn_provider_delete_guard();

-- Borrado físico permitido solo cuando el guard lo autoriza (patrón del sistema
-- "eliminar SOLO si no tiene referencias" — V5.2).
DROP POLICY IF EXISTS providers_delete ON providers;
CREATE POLICY providers_delete ON providers
    FOR DELETE TO authenticated USING (public.has_role('mantenimiento'));

-- ============ Código PRO-#### (F5.1 / code_counters, patrón m4_item_code) ============
CREATE OR REPLACE FUNCTION public.m5_provider_code(
    p_action      TEXT DEFAULT 'preview',
    p_code        TEXT DEFAULT NULL,
    p_provider_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_max     BIGINT := 0;
    v_next    BIGINT;
    v_code    TEXT;
    v_counter BIGINT;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF p_action NOT IN ('preview', 'allocate', 'check') THEN
        RAISE EXCEPTION 'Acción inválida';
    END IF;

    IF p_action = 'check' THEN
        IF NULLIF(trim(COALESCE(p_code, '')), '') IS NULL THEN
            RAISE EXCEPTION 'Falta el código';
        END IF;
        RETURN jsonb_build_object('available', NOT EXISTS (
            SELECT 1 FROM providers
            WHERE code = trim(p_code) AND (p_provider_id IS NULL OR id <> p_provider_id)
        ));
    END IF;

    SELECT COALESCE(MAX((substring(code FROM '^PRO-([0-9]+)$'))::BIGINT), 0)
    INTO v_max
    FROM providers
    WHERE code ~ '^PRO-[0-9]+$';

    SELECT next_value INTO v_counter
    FROM code_counters
    WHERE prefix = 'PRO' AND location_id IS NULL
    FOR UPDATE;

    v_next := GREATEST(v_max + 1, COALESCE(v_counter, 1));
    v_code := 'PRO-' || lpad(v_next::TEXT, 4, '0');
    WHILE EXISTS (SELECT 1 FROM providers WHERE code = v_code) LOOP
        v_next := v_next + 1;
        v_code := 'PRO-' || lpad(v_next::TEXT, 4, '0');
    END LOOP;

    IF p_action = 'allocate' THEN
        UPDATE code_counters SET next_value = v_next + 1
        WHERE prefix = 'PRO' AND location_id IS NULL;
        IF NOT FOUND THEN
            INSERT INTO code_counters (prefix, location_id, next_value)
            VALUES ('PRO', NULL, v_next + 1);
        END IF;
    END IF;

    RETURN jsonb_build_object('code', v_code, 'action', p_action);
END;
$$;

REVOKE ALL ON FUNCTION public.m5_provider_code(TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m5_provider_code(TEXT, TEXT, UUID) TO authenticated, service_role;

-- ============ Evento 11 — Contrato por vencer (F5.5, resumen diario) ============
-- Ventana = notification_config.extra_param (días; default 30). Los contratos
-- ya vencidos NO entran en la ventana → no reenvían (patrón garantías).
CREATE OR REPLACE FUNCTION public.fn_m5_contract_jobs() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg   RECORD;
    v_days  INTEGER;
    v_items JSONB := '[]'::jsonb;
    v_c     RECORD;
BEGIN
    SELECT extra_param, is_active INTO v_cfg
    FROM notification_config WHERE event_id = 11 FOR UPDATE;
    IF NOT FOUND OR v_cfg.is_active IS NOT TRUE THEN
        RETURN;
    END IF;
    v_days := COALESCE(v_cfg.extra_param, 30);

    FOR v_c IN
        SELECT c.id, c.name, c.end_date, p.name AS provider_name
        FROM contracts c
        JOIN providers p ON p.id = c.provider_id
        WHERE c.is_active = true
          AND c.end_date >= CURRENT_DATE
          AND c.end_date <= CURRENT_DATE + v_days
        ORDER BY c.end_date ASC
    LOOP
        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'id',            v_c.id,
            'name',          v_c.name,
            'provider_name', v_c.provider_name,
            'end_date',      v_c.end_date,
            'days_left',     v_c.end_date - CURRENT_DATE));
    END LOOP;

    IF jsonb_array_length(v_items) = 0 THEN
        RETURN;
    END IF;

    PERFORM public.fn_notify(11::SMALLINT, 'contract', NULL,
        'contract-window:' || CURRENT_DATE::TEXT,
        jsonb_build_object('items', v_items, 'days', v_days));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_m5_contract_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_m5_contract_jobs() TO postgres, service_role;

-- Días de anticipación del Evento 11 (editable en Configuración → Notificaciones)
UPDATE notification_config
SET extra_param = 30
WHERE event_id = 11 AND extra_param IS NULL;

-- pg_cron diario (junto a los jobs de M3 02:00 y M4 06:40; horario definitivo
-- pendiente de operativa del hotel — open_pending de 05-flujos)
SELECT cron.schedule('m5-contract-jobs', '10 2 * * *',
    $$SELECT public.fn_m5_contract_jobs()$$);

-- ============ Storage: prefijo proveedores/ en bucket documentos ============
-- (base documentos_select ya existe; items/ tiene sus policies desde M4)
DROP POLICY IF EXISTS documentos_insert_proveedores ON storage.objects;
CREATE POLICY documentos_insert_proveedores ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'documentos'
        AND (storage.foldername(name))[1] = 'proveedores'
        AND public.has_role('mantenimiento')
    );

DROP POLICY IF EXISTS documentos_delete_proveedores ON storage.objects;
CREATE POLICY documentos_delete_proveedores ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'documentos'
        AND (storage.foldername(name))[1] = 'proveedores'
        AND public.has_role('mantenimiento')
    );
