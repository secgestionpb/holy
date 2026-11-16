-- Migración 1 — Módulo 7: tablas M7 (07-reportes-kpis + BD/user_dashboard_kpis,
-- BD/scheduled_reports, BD/report_send_log)

-- ============ user_dashboard_kpis (BD/user_dashboard_kpis.md) ============
CREATE TABLE user_dashboard_kpis (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kpi_key     TEXT NOT NULL,
    visible     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, kpi_key)
);

CREATE INDEX idx_udk_user ON user_dashboard_kpis (user_id) WHERE visible;

CREATE TRIGGER user_dashboard_kpis_set_updated_at
    BEFORE UPDATE ON user_dashboard_kpis
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE user_dashboard_kpis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_dashboard_kpis_own ON user_dashboard_kpis;
CREATE POLICY user_dashboard_kpis_own ON user_dashboard_kpis
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ============ scheduled_reports (BD/scheduled_reports.md) ============
CREATE TABLE scheduled_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_key      TEXT NOT NULL UNIQUE
                    CHECK (report_key IN (
                        'costos_mantenimiento',
                        'cumplimiento_pm',
                        'estado_certificaciones',
                        'consumo_inventario',
                        'ranking_fallas',
                        'costos_proveedor'
                    )),
    report_name     TEXT NOT NULL,
    frequency       TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (frequency IN ('monthly')),
    send_day        INTEGER NOT NULL DEFAULT 1
                    CHECK (send_day BETWEEN 1 AND 28),
    format          TEXT NOT NULL DEFAULT 'pdf'
                    CHECK (format IN ('pdf','excel')),
    recipients      TEXT NOT NULL DEFAULT '',
    is_active       BOOLEAN NOT NULL DEFAULT true,

    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sr_due ON scheduled_reports (send_day, is_active) WHERE is_active;

CREATE TRIGGER scheduled_reports_set_updated_at
    BEFORE UPDATE ON scheduled_reports
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scheduled_reports_select ON scheduled_reports;
CREATE POLICY scheduled_reports_select ON scheduled_reports
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS scheduled_reports_insert ON scheduled_reports;
CREATE POLICY scheduled_reports_insert ON scheduled_reports
    FOR INSERT TO authenticated
    WITH CHECK (public.has_role('administrador'));
DROP POLICY IF EXISTS scheduled_reports_update ON scheduled_reports;
CREATE POLICY scheduled_reports_update ON scheduled_reports
    FOR UPDATE TO authenticated
    USING (public.has_role('administrador'))
    WITH CHECK (public.has_role('administrador'));
-- Sin policy DELETE → prohibido (patrón del sistema)

-- ============ report_send_log (BD/report_send_log.md) ============
CREATE TABLE report_send_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID NOT NULL REFERENCES scheduled_reports(id),
    period_ym       TEXT NOT NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          TEXT NOT NULL
                    CHECK (status IN ('sent','failed','skipped_no_recipients')),
    recipients      TEXT NOT NULL,
    file_path       TEXT NULL,
    error_message   TEXT NULL,

    UNIQUE (report_id, period_ym)
);

CREATE INDEX idx_rsl_report ON report_send_log (report_id, sent_at DESC);

ALTER TABLE report_send_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_send_log_select ON report_send_log;
CREATE POLICY report_send_log_select ON report_send_log
    FOR SELECT TO authenticated
    USING (public.has_role('administrador') OR public.has_role('mantenimiento'));
-- Sin policies INSERT/UPDATE/DELETE para authenticated → solo service_role
-- (Edge Function); UPDATE/DELETE prohibidos (append-only — BD/report_send_log.md)

-- ============ Auditoría (T3 — module 'configuration' ya en el CHECK) ============
CREATE OR REPLACE FUNCTION public.fn_audit_scheduled_reports() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_label   TEXT := 'Reporte programado: ' || NEW.report_name;
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM public.fn_audit_row('configuration', 'scheduled_report', 'create',
            NEW.id, v_label, jsonb_build_object(
                'report_key',   jsonb_build_object('old', NULL, 'new', NEW.report_key),
                'report_name',  jsonb_build_object('old', NULL, 'new', NEW.report_name),
                'send_day',     jsonb_build_object('old', NULL, 'new', NEW.send_day),
                'format',       jsonb_build_object('old', NULL, 'new', NEW.format),
                'recipients',   jsonb_build_object('old', NULL, 'new', NEW.recipients),
                'is_active',    jsonb_build_object('old', NULL, 'new', NEW.is_active)
            ), NULL);
    ELSE
        IF NEW.send_day IS DISTINCT FROM OLD.send_day THEN
            v_changes := v_changes || jsonb_build_object('send_day', jsonb_build_object('old', OLD.send_day, 'new', NEW.send_day));
        END IF;
        IF NEW.format IS DISTINCT FROM OLD.format THEN
            v_changes := v_changes || jsonb_build_object('format', jsonb_build_object('old', OLD.format, 'new', NEW.format));
        END IF;
        IF NEW.recipients IS DISTINCT FROM OLD.recipients THEN
            v_changes := v_changes || jsonb_build_object('recipients', jsonb_build_object('old', OLD.recipients, 'new', NEW.recipients));
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('old', OLD.is_active, 'new', NEW.is_active));
        END IF;
        IF v_changes = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
        PERFORM public.fn_audit_row('configuration', 'scheduled_report', 'update',
            NEW.id, v_label, v_changes, NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_scheduled_reports
    AFTER INSERT OR UPDATE ON scheduled_reports
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_scheduled_reports();

-- ============ Seeds (los 6 de la spec — ACTIVOS POR DEFECTO) ============
-- recipients = correos de los usuarios rol Administrador activos (BD/scheduled_reports.md)
-- created_by NULL = sistema; el trigger de audit INSERT los registra como sistema.
INSERT INTO scheduled_reports (report_key, report_name, send_day, format, recipients, is_active, created_by)
SELECT s.report_key, s.report_name, 1, 'pdf', COALESCE(admins.emails, ''), true, NULL
FROM (VALUES
    ('costos_mantenimiento',   'Resumen de costos de mantenimiento'),
    ('cumplimiento_pm',        'Cumplimiento de PM del mes'),
    ('estado_certificaciones', 'Estado de certificaciones normativas'),
    ('consumo_inventario',     'Consumo e inventario'),
    ('ranking_fallas',         'Ranking de activos con más fallas del mes'),
    ('costos_proveedor',       'Costos por proveedor/contratista del mes')
) AS s(report_key, report_name)
CROSS JOIN LATERAL (
    SELECT string_agg(u.email, ', ') AS emails
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    WHERE ur.role = 'administrador' AND u.is_active = true
) admins
ON CONFLICT (report_key) DO NOTHING;

-- ============ Storage: bucket privado `reportes` ============
-- Adjuntos de reportes programados; lectura solo Admin (7.8/decisiones);
-- escritura solo service role (sin policies INSERT).
INSERT INTO storage.buckets (id, name, public)
VALUES ('reportes', 'reportes', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS reportes_select_admin ON storage.objects;
CREATE POLICY reportes_select_admin ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'reportes' AND public.has_role('administrador'));
-- Sin policies INSERT/UPDATE/DELETE → solo service_role sube/borra adjuntos
