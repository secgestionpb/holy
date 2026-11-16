-- Migración 5 — Módulo 2: Órdenes de Trabajo (tablas + RLS + storage)
-- Fuente de verdad: markdown/BD/{providers,work_orders,damage_reports,wo_technicians,wo_comments,wo_evidence,wo_checklist_entries}.md
-- + 02-ordenes-de-trabajo-flujos.md <rls> y <supabase_mapping>.
-- Resuelve además los impl_pending de M1: FKs reales de warranties
-- (origin_wo_id → work_orders, provider_id → providers).

-- ============ providers (BD/providers.md — creada aquí por dependencia de M2) ============
-- Solo la tabla catálogo: CRUD/documentos/código PRO-#### (code_counters) es M5.
CREATE TABLE providers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                TEXT NOT NULL UNIQUE,        -- "PRO-0042" (auto-gen en M5)
    name                TEXT NOT NULL,
    provider_type       TEXT NOT NULL CHECK (provider_type IN
                          ('supplier','contractor','both')),
    service_category_id UUID REFERENCES categories(id),
    contact_name        TEXT,
    contact_phone       TEXT,
    contact_email       TEXT,
    address             TEXT,
    notes               TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES users(id),
    updated_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_providers_type   ON providers (provider_type);
CREATE INDEX idx_providers_active ON providers (is_active) WHERE is_active;

CREATE TRIGGER providers_set_updated_at
    BEFORE UPDATE ON providers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS (BD/providers.md resumen): Mantenimiento CRUD · Admin/Calidad SELECT ·
-- Técnico SIN acceso al catálogo (ve "Ejecutado por" vía la vista v2_work_orders,
-- que resuelve el nombre con SECURITY DEFINER — m2_provider_label en m2_core).
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY providers_select ON providers
    FOR SELECT TO authenticated
    USING (public.has_role('mantenimiento') OR public.has_role('administrador')
           OR public.has_role('calidad'));

CREATE POLICY providers_insert_mantenimiento ON providers
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

CREATE POLICY providers_update_mantenimiento ON providers
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

-- ============ sequence de número de OT (decisión: propia, NO code_counters) ============
CREATE SEQUENCE work_orders_number_seq START 1;

-- ============ damage_reports (BD/damage_reports.md) ============
CREATE TABLE damage_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES assets(id),
    component_id    UUID NULL REFERENCES assets(id),
    description     TEXT NOT NULL,
    reported_by     UUID NOT NULL REFERENCES users(id),
    reported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN
                      ('pending_review','converted','discarded')),
    reviewed_by     UUID NULL REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ NULL,
    discarded_by    UUID NULL REFERENCES users(id),
    discarded_at    TIMESTAMPTZ NULL,
    discard_reason  TEXT NULL,
    origin          TEXT NOT NULL DEFAULT 'internal' CHECK (origin IN
                      ('internal','external_app')),
    external_ref    TEXT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dr_status     ON damage_reports(status, reported_at DESC);
CREATE INDEX idx_dr_asset      ON damage_reports(asset_id);
CREATE INDEX idx_dr_reporter   ON damage_reports(reported_by, reported_at DESC);

CREATE TRIGGER damage_reports_set_updated_at
    BEFORE UPDATE ON damage_reports
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ work_orders (BD/work_orders.md) ============
CREATE TABLE work_orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_number           TEXT NOT NULL UNIQUE,
                        -- "OT-0001": 'OT-' || lpad(nextval('work_orders_number_seq')::text, 4, '0')
    asset_id            UUID NOT NULL REFERENCES assets(id),
    component_id        UUID NULL REFERENCES assets(id),
    wo_type             TEXT NOT NULL DEFAULT 'corrective' CHECK (wo_type IN
                          ('corrective','preventive','inspection')),
    priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN
                          ('urgent','normal','low')),
    description         TEXT NOT NULL,
    origin              TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN
                          ('manual','damage_report','preventive','external_app')),
    damage_report_id    UUID NULL UNIQUE REFERENCES damage_reports(id),
    plan_id             UUID NULL,               -- FK → maintenance_plans (M3, pendiente)
    external_ref        TEXT NULL,
    reported_by         UUID NULL REFERENCES users(id),
    reported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN
                          ('open','assigned','in_progress','waiting_parts',
                           'completed','closed','cancelled')),
    scheduled_at        TIMESTAMPTZ NULL,
    assigned_at         TIMESTAMPTZ NULL,
    started_at          TIMESTAMPTZ NULL,
    finished_at         TIMESTAMPTZ NULL,
    closed_at           TIMESTAMPTZ NULL,
    closed_by           UUID NULL REFERENCES users(id),
    affects_sale        BOOLEAN NOT NULL DEFAULT false,
    executed_by_type    TEXT NOT NULL DEFAULT 'internal' CHECK (executed_by_type IN
                          ('internal','external')),
    provider_id         UUID NULL REFERENCES providers(id),
    external_cost       NUMERIC(12,2) NULL,
    generates_warranty  BOOLEAN NULL,             -- NULL = aún no cerrada (M2.1)
    reassigned          BOOLEAN NOT NULL DEFAULT false,
    diagnosis           TEXT NULL,
    solution            TEXT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (external_cost IS NULL OR external_cost >= 0)
);

CREATE INDEX idx_wo_asset        ON work_orders(asset_id);
CREATE INDEX idx_wo_component    ON work_orders(component_id) WHERE component_id IS NOT NULL;
CREATE INDEX idx_wo_status_date  ON work_orders(status, reported_at DESC);
CREATE INDEX idx_wo_list_tabs    ON work_orders(reported_at DESC) WHERE status NOT IN ('closed','cancelled');
CREATE INDEX idx_wo_scheduled    ON work_orders(scheduled_at) WHERE wo_type = 'preventive' AND status NOT IN ('closed','cancelled');
CREATE INDEX idx_wo_plan         ON work_orders(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX idx_wo_provider     ON work_orders(provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX idx_wo_reassigned   ON work_orders(reassigned) WHERE reassigned;
CREATE INDEX idx_wo_reported_by  ON work_orders(reported_by);

CREATE TRIGGER work_orders_set_updated_at
    BEFORE UPDATE ON work_orders
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ wo_technicians (BD/wo_technicians.md) ============
CREATE TABLE wo_technicians (
    wo_id           UUID NOT NULL REFERENCES work_orders(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    assigned_by     UUID NULL REFERENCES users(id),
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    removed_at      TIMESTAMPTZ NULL,
    removed_by      UUID NULL REFERENCES users(id),
    hours_worked    NUMERIC(6,2) NOT NULL DEFAULT 0,
    started_at      TIMESTAMPTZ NULL,
    finished_at     TIMESTAMPTZ NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (wo_id, user_id),
    CHECK (hours_worked >= 0)
);

CREATE INDEX idx_wot_active   ON wo_technicians(wo_id) WHERE removed_at IS NULL;
CREATE INDEX idx_wot_user     ON wo_technicians(user_id) WHERE removed_at IS NULL;

CREATE TRIGGER wo_technicians_set_updated_at
    BEFORE UPDATE ON wo_technicians
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ wo_comments (BD/wo_comments.md) ============
CREATE TABLE wo_comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_id           UUID NOT NULL REFERENCES work_orders(id),
    author_id       UUID NOT NULL REFERENCES users(id),
    body            TEXT NOT NULL,
    attachment_path TEXT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    -- SIN updated_at: los comentarios NO se editan ni se borran (spec)
);

CREATE INDEX idx_woc_wo ON wo_comments(wo_id, created_at);

-- ============ wo_evidence (BD/wo_evidence.md) ============
CREATE TABLE wo_evidence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id   UUID NULL REFERENCES work_orders(id),
    damage_report_id UUID NULL REFERENCES damage_reports(id),
    kind            TEXT NOT NULL DEFAULT 'other' CHECK (kind IN
                      ('before','after','other')),
    storage_path    TEXT NOT NULL,
    uploaded_by     UUID NOT NULL REFERENCES users(id),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wo_evidence_one_parent CHECK (
        (work_order_id IS NULL) <> (damage_report_id IS NULL)
    )
);

CREATE INDEX idx_woe_wo     ON wo_evidence(work_order_id, uploaded_at);
CREATE INDEX idx_woe_report ON wo_evidence(damage_report_id, uploaded_at);

-- ============ wo_checklist_entries (BD/wo_checklist_entries.md — M3 la puebla) ============
CREATE TABLE wo_checklist_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_id       UUID NOT NULL REFERENCES work_orders(id),
    checklist_item_id UUID,                    -- sin FK: checklist_items llega con M3
    position    INTEGER NOT NULL,
    item_text   TEXT NOT NULL,                 -- SNAPSHOT inmutable al generar
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','done','not_applicable')),
    note        TEXT,
    done_by     UUID REFERENCES users(id),
    done_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (wo_id, position),
    CHECK (status <> 'not_applicable' OR note IS NOT NULL)
);

CREATE INDEX idx_wo_checklist_entries_wo ON wo_checklist_entries (wo_id, position);

-- ============ Helper RLS (referenciado por las policies de abajo) ============
CREATE OR REPLACE FUNCTION public.is_assigned_wo(p_wo_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM wo_technicians
        WHERE wo_id = p_wo_id
          AND user_id = auth.uid()
          AND removed_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.is_assigned_wo(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_wo(UUID) TO authenticated, service_role;

-- ============ FKs pendientes de M1 (impl_pending: 01-flujos fk_diferidas) ============
ALTER TABLE warranties
    ADD CONSTRAINT warranties_origin_wo_fkey
    FOREIGN KEY (origin_wo_id) REFERENCES work_orders(id);

ALTER TABLE warranties
    ADD CONSTRAINT warranties_provider_fkey
    FOREIGN KEY (provider_id) REFERENCES providers(id);

-- ============ RLS M2 (02-flujos <supabase_mapping><rls>) ============
-- DELETE PROHIBIDO en todas las tablas del módulo (bajas lógicas por estado),
-- salvo wo_evidence (patrón asset_files: quien subió o Mantenimiento).

ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY work_orders_select ON work_orders
    FOR SELECT TO authenticated USING (true);

-- Alta manual: solo Mantenimiento (el motor M3 usará service role; la
-- conversión de reportes pasa por la RPC m2_create_wo, SECURITY DEFINER).
CREATE POLICY work_orders_insert_mantenimiento ON work_orders
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

-- Técnico solo sobre OTs con fila activa en wo_technicians (is_assigned_wo);
-- los guardas de m2_core restringen columnas/estados por rol.
CREATE POLICY work_orders_update_assigned ON work_orders
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento') OR public.is_assigned_wo(id))
    WITH CHECK (public.has_role('mantenimiento') OR public.is_assigned_wo(id));

ALTER TABLE damage_reports ENABLE ROW LEVEL SECURITY;

-- Lectura: Mantenimiento y Administrador ven todos; Técnico y Calidad solo
-- los suyos (V2.4: filtro "mis reportes" NO desmontable — se garantiza aquí,
-- no solo en la UI).
CREATE POLICY damage_reports_select ON damage_reports
    FOR SELECT TO authenticated
    USING (public.has_role('mantenimiento') OR public.has_role('administrador')
           OR reported_by = auth.uid());

-- Crear reporte: Técnico, Mantenimiento, Calidad (NO Administrador — matriz T1).
CREATE POLICY damage_reports_insert_roles ON damage_reports
    FOR INSERT TO authenticated
    WITH CHECK (public.has_role('mantenimiento') OR public.has_role('tecnico')
                OR public.has_role('calidad'));

-- Revisión (convertir/descartar): solo Mantenimiento (F2.2).
CREATE POLICY damage_reports_update_mantenimiento ON damage_reports
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE wo_technicians ENABLE ROW LEVEL SECURITY;

CREATE POLICY wo_technicians_select ON wo_technicians
    FOR SELECT TO authenticated USING (true);

CREATE POLICY wo_technicians_insert_mantenimiento ON wo_technicians
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

-- Horas: el propio técnico (sobre su fila) o Mantenimiento; el guarda
-- fn_wo_tech_guard impide que el técnico cambie columnas de asignación.
CREATE POLICY wo_technicians_update_owner_or_mant ON wo_technicians
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento') OR user_id = auth.uid())
    WITH CHECK (public.has_role('mantenimiento') OR user_id = auth.uid());

ALTER TABLE wo_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY wo_comments_select ON wo_comments
    FOR SELECT TO authenticated USING (true);

-- Inserción: técnicos asignados + Mantenimiento + Calidad (decisión de sesión
-- V2.3 «Calidad puede comentar»; desviación de BD/wo_comments.md documentada).
CREATE POLICY wo_comments_insert ON wo_comments
    FOR INSERT TO authenticated
    WITH CHECK (public.has_role('mantenimiento') OR public.has_role('calidad')
                OR public.is_assigned_wo(wo_id));
-- Sin policies UPDATE/DELETE: inmutables (spec).

ALTER TABLE wo_evidence ENABLE ROW LEVEL SECURITY;

-- Evidencia de OT: visible para los 4 roles (la OT también lo es).
-- Evidencia de reporte: solo si el reporte es visible para el rol (misma
-- regla que damage_reports_select).
CREATE POLICY wo_evidence_select ON wo_evidence
    FOR SELECT TO authenticated
    USING (
        work_order_id IS NOT NULL
        OR (damage_report_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM damage_reports d WHERE d.id = wo_evidence.damage_report_id
        ))
    );

CREATE POLICY wo_evidence_insert ON wo_evidence
    FOR INSERT TO authenticated
    WITH CHECK (
        public.has_role('mantenimiento')
        OR (work_order_id IS NOT NULL AND public.is_assigned_wo(work_order_id))
        OR (damage_report_id IS NOT NULL
            AND (public.has_role('tecnico') OR public.has_role('calidad')))
    );

-- Borrado: quien subió o Mantenimiento; el trigger fn_wo_evidence_delete_guard
-- bloquea cuando la OT está cerrada (nunca en Cerrada).
CREATE POLICY wo_evidence_delete ON wo_evidence
    FOR DELETE TO authenticated
    USING (public.has_role('mantenimiento') OR uploaded_by = auth.uid());
-- Sin UPDATE: un archivo no se modifica (se borra y sube de nuevo).

ALTER TABLE wo_checklist_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY wo_checklist_select ON wo_checklist_entries
    FOR SELECT TO authenticated USING (true);

-- Solo técnicos asignados o Mantenimiento marcan ítems (F3.4 / RLS resumen BD).
CREATE POLICY wo_checklist_update ON wo_checklist_entries
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento') OR public.is_assigned_wo(wo_id))
    WITH CHECK (public.has_role('mantenimiento') OR public.is_assigned_wo(wo_id));
-- Sin INSERT (lo puebla el motor M3 con service role) ni DELETE.

-- ============ Bucket `ot_evidencias` (02-flujos <storage_buckets>) ============
-- Fotos antes/después de OT y de reportes de daño. Lectura: 4 roles.
-- Escritura: roles que reportan (Técnico, Calidad, Mantenimiento) — sin Admin;
-- mismo esquema de paths que M1 (carpeta por entidad padre).
INSERT INTO storage.buckets (id, name, public)
VALUES ('ot_evidencias', 'ot_evidencias', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "ot_evidencias_select" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'ot_evidencias');

CREATE POLICY "ot_evidencias_insert_roles" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'ot_evidencias'
                AND (public.has_role('mantenimiento') OR public.has_role('tecnico')
                     OR public.has_role('calidad')));

-- Sin policy UPDATE (archivos inmutables).
CREATE POLICY "ot_evidencias_delete_own" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'ot_evidencias'
           AND (public.has_role('mantenimiento') OR owner = auth.uid()));
