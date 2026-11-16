-- Migración 2 — Módulo 1: Gestión de Activos (tablas)
-- Fuente de verdad: markdown/BD/{locations,categories,assets,asset_files,code_counters,user_category_assignments}.md
-- RLS: 01-gestion-de-activos-flujos.md <rls> (SELECT 4 roles; INSERT/UPDATE solo
-- Mantenimiento; DELETE prohibido en el módulo — salvo asset_files, que permite
-- DELETE a Mantenimiento según su spec)

-- ============ locations (BD/locations.md) ============
CREATE TABLE locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id       UUID NULL REFERENCES locations(id),
                    -- NULL solo en la raíz (hotel/resort)
    name            TEXT NOT NULL,
                    -- "Pasillo Piso 1", "Habitación 101", "Exterior"
    kind            TEXT NOT NULL CHECK (kind IN
                      ('hotel','building','floor','zone')),
                    -- zone = ubicación libre (pasillo, habitación, baño,
                    -- exterior, área común, área técnica)
    zone_subtype    TEXT NULL CHECK (zone_subtype IN
                      ('room','corridor','bathroom','exterior',
                       'common_area','technical_area')),
    room_code       TEXT NULL,               -- código de habitación si aplica
    depth           SMALLINT NOT NULL,       -- nivel calculado
                    -- CHECK (depth <= 5)  ← profundidad máxima desde Resort
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      SMALLINT NULL,
    created_by      UUID NULL REFERENCES public.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (parent_id, name)                 -- nombres únicos entre hermanos
);

CREATE INDEX idx_locations_parent   ON locations(parent_id);
CREATE INDEX idx_locations_kind     ON locations(kind);
CREATE INDEX idx_locations_active   ON locations(is_active) WHERE is_active;

CREATE TRIGGER locations_set_updated_at
    BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.fn_locations_depth() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_parent_depth SMALLINT;
BEGIN
    IF NEW.parent_id IS NULL THEN
        NEW.depth := 0;
    ELSE
        SELECT depth INTO v_parent_depth FROM locations WHERE id = NEW.parent_id;
        IF v_parent_depth IS NULL THEN
            RAISE EXCEPTION 'Ubicación padre inexistente';
        END IF;
        NEW.depth := v_parent_depth + 1;
        IF NEW.depth > 5 THEN
            RAISE EXCEPTION 'Profundidad máxima permitida: 5 niveles desde la raíz';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_locations_depth
    BEFORE INSERT OR UPDATE OF parent_id ON locations
    FOR EACH ROW EXECUTE FUNCTION public.fn_locations_depth();

-- Raíz de arranque (locations.md: "Raíz insertada por migración de arranque")
INSERT INTO locations (name, kind, depth)
VALUES ('Hotel', 'hotel', 0);

-- ============ categories (BD/categories.md) ============
CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,
                    -- "Climatización (HVAC)", "Edificación/Infraestructura"
    description     TEXT NULL,
    code_prefix     TEXT NOT NULL UNIQUE,
                    -- "HVAC" → primer segmento del código de activo
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      SMALLINT NULL,
    created_by      UUID NULL REFERENCES public.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_active ON categories(is_active) WHERE is_active;

CREATE TRIGGER categories_set_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO categories (name, code_prefix, sort_order) VALUES
    ('Climatización (HVAC)',        'HVAC',  1),
    ('Eléctrico',                   'ELEC',  2),
    ('Plomería / Fontanería',       'PLOM',  3),
    ('Contra incendios',            'CINC',  4),
    ('Elevadores / Verticales',     'ELEV',  5),
    ('Cocina',                      'COC',   6),
    ('Lavandería',                  'LAV',   7),
    ('Piscina / Spa',               'PISC',  8),
    ('Seguridad y acceso',          'SEG',   9),
    ('Mobiliario técnico',          'MOB',   10),
    ('Edificación/Infraestructura', 'INFRA', 11);

-- ============ assets (BD/assets.md) ============
CREATE TABLE assets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id           UUID NULL REFERENCES assets(id),
                        -- componente → activo padre; NULL = activo raíz
    location_id         UUID NOT NULL REFERENCES locations(id),
                        -- en componentes: copia del padre (cascada al mover)
    category_id         UUID NULL REFERENCES categories(id),
                        -- NOT NULL si parent_id IS NULL (regla CHECK abajo);
                        -- en componentes: heredada, columna nullable
    code                TEXT NOT NULL UNIQUE,
                        -- editable: [Prefijo]-[Ubicación]-[Consecutivo]
    name                TEXT NOT NULL,
    description         TEXT NULL,
    criticality         TEXT NOT NULL CHECK (criticality IN
                          ('high','medium','low')),
    operational_status  TEXT NOT NULL DEFAULT 'operational'
                          CHECK (operational_status IN
                          ('operational','inactive')),
    life_stage          TEXT NOT NULL DEFAULT 'no_warranty'
                          CHECK (life_stage IN
                          ('no_warranty','under_warranty','operational',
                           'pending_repair','requires_replacement',
                           'decommissioned')),
                        -- 'decommissioned' = baja lógica (trigger fuerza
                        -- operational_status='inactive'; reversible)
    commissioning_date  DATE NOT NULL,
    expected_lifespan_value NUMERIC(10,2) NULL,   -- vida útil esperada
    lifespan_unit       TEXT NULL CHECK (lifespan_unit IN
                          ('years','hours','cycles')),
    has_usage_counter   BOOLEAN NOT NULL DEFAULT false,
    usage_counter       BIGINT NULL,           -- lo escribe una OT (Módulo 3)
    usage_counter_updated_at TIMESTAMPTZ NULL,
    usage_counter_updated_by UUID NULL REFERENCES public.users(id),
    responsible_user_id UUID NULL REFERENCES public.users(id),
                        -- NO obligatorio
    notes               TEXT NULL,
    created_by          UUID NULL REFERENCES public.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (parent_id IS NOT NULL OR category_id IS NOT NULL)
                        -- todo activo raíz debe tener categoría
);

CREATE INDEX idx_assets_location   ON assets(location_id);
CREATE INDEX idx_assets_category   ON assets(category_id);
CREATE INDEX idx_assets_parent     ON assets(parent_id);
CREATE INDEX idx_assets_life_stage ON assets(life_stage);
CREATE INDEX idx_assets_status     ON assets(operational_status);
CREATE INDEX idx_assets_resp       ON assets(responsible_user_id);

CREATE TRIGGER assets_set_updated_at
    BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ asset_files (BD/asset_files.md) ============
CREATE TABLE asset_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES assets(id),
                    -- activo o componente
    file_name       TEXT NOT NULL,             -- nombre original
    storage_path    TEXT NOT NULL UNIQUE,      -- path en bucket privado
                    -- 'activos' (subida: activos/{asset_id}/...)
    mime_type       TEXT NULL,
    file_size_bytes BIGINT NULL,
    uploaded_by     UUID NOT NULL REFERENCES public.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_files_asset ON asset_files(asset_id);

-- ============ code_counters (BD/code_counters.md) ============
CREATE TABLE code_counters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prefix          TEXT NOT NULL,             -- prefijo de categoría ("HVAC") o de secuencia simple ("REP")
    location_id     UUID NULL REFERENCES locations(id),
                    -- segundo segmento del código ("305", "CM-01"); NULL para secuencias SIN segmento de ubicación (M4: ítems)
    next_value      BIGINT NOT NULL DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (prefix, location_id)
);

-- Secuencias simples sin ubicación (ej. M4 ítems): una sola fila por prefijo
CREATE UNIQUE INDEX idx_code_counters_simple
    ON code_counters(prefix) WHERE location_id IS NULL;

CREATE INDEX idx_code_counters_lookup
    ON code_counters(prefix, location_id);

CREATE TRIGGER code_counters_set_updated_at
    BEFORE UPDATE ON code_counters
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ user_category_assignments (BD/user_category_assignments.md) ============
CREATE TABLE user_category_assignments (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    assigned_by  UUID NULL REFERENCES users(id),
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, category_id)
);

CREATE INDEX idx_uca_category ON user_category_assignments (category_id);

-- ============ RLS M1 ============
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY locations_select ON locations
    FOR SELECT TO authenticated USING (true);

CREATE POLICY locations_insert_mantenimiento ON locations
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

CREATE POLICY locations_update_mantenimiento ON locations
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY categories_select ON categories
    FOR SELECT TO authenticated USING (true);

CREATE POLICY categories_insert_mantenimiento ON categories
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

CREATE POLICY categories_update_mantenimiento ON categories
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY assets_select ON assets
    FOR SELECT TO authenticated USING (true);

CREATE POLICY assets_insert_mantenimiento ON assets
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

CREATE POLICY assets_update_mantenimiento ON assets
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

-- asset_files: SELECT 4 roles; INSERT/DELETE solo Mantenimiento; sin UPDATE
ALTER TABLE asset_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY asset_files_select ON asset_files
    FOR SELECT TO authenticated USING (true);

CREATE POLICY asset_files_insert_mantenimiento ON asset_files
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

CREATE POLICY asset_files_delete_mantenimiento ON asset_files
    FOR DELETE TO authenticated USING (public.has_role('mantenimiento'));

-- code_counters: escrito solo por la Edge Function validate_asset_code (service role)
ALTER TABLE code_counters ENABLE ROW LEVEL SECURITY;

-- user_category_assignments: SELECT para resolver filtros/perfil; escritura solo service role
ALTER TABLE user_category_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_category_assignments_select ON user_category_assignments
    FOR SELECT TO authenticated USING (true);

-- ============ Bucket `activos` (asset_files.md + 01-flujos <storage_buckets>) ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('activos', 'activos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "activos_select" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'activos');

CREATE POLICY "activos_insert_mantenimiento" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'activos' AND public.has_role('mantenimiento'));

CREATE POLICY "activos_update_mantenimiento" ON storage.objects
    FOR UPDATE TO authenticated
    WITH CHECK (bucket_id = 'activos' AND public.has_role('mantenimiento'));

CREATE POLICY "activos_delete_mantenimiento" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'activos' AND public.has_role('mantenimiento'));
