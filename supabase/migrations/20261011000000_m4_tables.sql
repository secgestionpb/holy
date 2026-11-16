-- Migración 7 — Módulo 4: Inventario de Repuestos y Suministros (tablas + RLS + storage)
-- Fuente de verdad: markdown/BD/{items,item_categories,warehouses,warehouse_stock,
-- stock_movements,physical_counts,item_asset_links}.md
-- + 04-inventario-flujos.md <rls_policy> y <supabase_mapping>.
-- Notas de implementación:
--  · stock_movements.origin_movement_id completa el borrador SQL de la spec:
--    F4.5 exige "referencia al movimiento de salida original" (devoluciones
--    por línea de consumo — F2.9 valida máx = consumido − ya devuelto).
--  · La consistencia stock↔kardex NO se hace con trigger: es aplicación
--    transaccional vía RPCs m4_* (<supabase_mapping><engine>).
--  · Semilla de categorías de ítem = contenido PROVISIONAL del hotel
--    (open_pending de 04-flujos: validar con contenido real).

-- ============ item_categories (BD/item_categories.md — lista PLANA) ============
CREATE TABLE item_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,         -- "Repuestos HVAC", "Ferretería"
    description     TEXT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,-- baja lógica (patrón del sistema)
    created_by      UUID NULL REFERENCES users(id),
    updated_by      UUID NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_item_categories_active ON item_categories (is_active) WHERE is_active;

CREATE TRIGGER item_categories_set_updated_at
    BEFORE UPDATE ON item_categories
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Semilla provisional (open_pending: contenido real del hotel)
INSERT INTO item_categories (name, description) VALUES
    ('Repuestos HVAC',      'Filtros, bandas, válvulas y componentes de climatización.'),
    ('Repuestos eléctricos','Contactor, relés, luminarias y componentes eléctricos.'),
    ('Químicos de piscina', 'Cloro, pH y tratamientos para piscina/spa.'),
    ('Lubricantes',         'Aceites, grasas y deslizantes industriales.'),
    ('Ferretería',          'Tornillería, anclajes y herramientas menores.'),
    ('General',             'Suministros técnicos varios.');

-- ============ items (BD/items.md) ============
CREATE TABLE items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                  TEXT NOT NULL UNIQUE,   -- "REP-0042" autogenerado editable (code_counters)
    name                  TEXT NOT NULL,
    description           TEXT NULL,
    item_category_id      UUID NULL REFERENCES item_categories(id),
    unit                  TEXT NOT NULL
                          CHECK (unit IN (
                            'unidad','par','juego','caja','litro','galon','kg','g',
                            'm','m2','rollo','tubo','filtro','otro'
                          )),
                          -- ENUM FIJO (decisión de sesión; no texto libre)
    unit_cost             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
                          -- ÚLTIMO COSTO DE COMPRA: solo lo actualiza una Entrada (F4.3)
    bin_location          TEXT NULL,             -- ubicación en bodega (estante/zona)
    preferred_provider_id UUID NULL REFERENCES providers(id),
    image_path            TEXT NULL,             -- Storage bucket `documentos`, prefijo items/
    technical_sheet_path  TEXT NULL,             -- ficha técnica (mismo bucket/prefijo)
    is_active             BOOLEAN NOT NULL DEFAULT true,
    created_by            UUID NULL REFERENCES users(id),
    updated_by            UUID NULL REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_category ON items (item_category_id);
CREATE INDEX idx_items_active   ON items (is_active) WHERE is_active;
CREATE INDEX idx_items_provider ON items (preferred_provider_id) WHERE preferred_provider_id IS NOT NULL;

CREATE TRIGGER items_set_updated_at
    BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ warehouses (BD/warehouses.md) ============
CREATE TABLE warehouses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,         -- "Bodega central"
    description     TEXT NULL,
    responsible_id  UUID NULL REFERENCES users(id),
    is_active       BOOLEAN NOT NULL DEFAULT true,-- baja lógica
    created_by      UUID NULL REFERENCES users(id),
    updated_by      UUID NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_warehouses_active ON warehouses (is_active) WHERE is_active;
CREATE INDEX idx_warehouses_resp   ON warehouses (responsible_id) WHERE responsible_id IS NOT NULL;

CREATE TRIGGER warehouses_set_updated_at
    BEFORE UPDATE ON warehouses
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ warehouse_stock (BD/warehouse_stock.md) ============
CREATE TABLE warehouse_stock (
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
    item_id         UUID NOT NULL REFERENCES items(id),
    qty             NUMERIC(12,3) NOT NULL DEFAULT 0, -- NEGATIVA permitida (spec)
    min_stock       NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
                    -- stock mínimo POR ÍTEM Y POR BODEGA (capturado en V4.2)
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (warehouse_id, item_id)
);

CREATE INDEX idx_warehouse_stock_item ON warehouse_stock (item_id);
-- Bajo mínimo (F4.9):
CREATE INDEX idx_warehouse_stock_low ON warehouse_stock (warehouse_id)
    WHERE qty < min_stock;

CREATE TRIGGER warehouse_stock_set_updated_at
    BEFORE UPDATE ON warehouse_stock
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ physical_counts (BD/physical_counts.md) ============
CREATE TABLE physical_counts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
    scope_type      TEXT NOT NULL CHECK (scope_type IN ('warehouse','category')),
    scope_category_id UUID NULL REFERENCES item_categories(id),
    count_date      DATE NOT NULL DEFAULT current_date,
    responsible_id  UUID NOT NULL REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','confirmed','cancelled')),
    cancel_reason   TEXT NULL,
    confirmed_by    UUID NULL REFERENCES users(id),
    confirmed_at    TIMESTAMPTZ NULL,
    created_by      UUID NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (scope_type <> 'category' OR scope_category_id IS NOT NULL),
    CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
    CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL)
);

CREATE INDEX idx_physical_counts_warehouse ON physical_counts (warehouse_id, count_date DESC);
CREATE INDEX idx_physical_counts_status ON physical_counts (status);

CREATE TRIGGER physical_counts_set_updated_at
    BEFORE UPDATE ON physical_counts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Detalle por ítem (teórico congelado, contado, diferencia, observación)
CREATE TABLE physical_count_items (
    count_id        UUID NOT NULL REFERENCES physical_counts(id),
    item_id         UUID NOT NULL REFERENCES items(id),
    theoretical     NUMERIC(12,3) NOT NULL,
    counted         NUMERIC(12,3) NULL CHECK (counted IS NULL OR counted >= 0),
    difference      NUMERIC(12,3) GENERATED ALWAYS AS (counted - theoretical) STORED,
    observation     TEXT NULL,
    PRIMARY KEY (count_id, item_id)
);

CREATE INDEX idx_physical_count_items_item ON physical_count_items (item_id);

-- ============ stock_movements — Kardex (BD/stock_movements.md) ============
CREATE TABLE stock_movements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                TEXT NOT NULL
                        CHECK (type IN ('entrada','salida_ot','ajuste','devolucion','transferencia')),
    item_id             UUID NOT NULL REFERENCES items(id),
    warehouse_id        UUID NOT NULL REFERENCES warehouses(id),
                        -- bodega del movimiento (ORIGEN en transferencias de salida)
    destiny_warehouse_id UUID NULL REFERENCES warehouses(id),  -- SOLO transferencias
    qty                 NUMERIC(12,3) NOT NULL,  -- CON SIGNO: + entrada/devolucion, − salida_ot/transfer(−)/ajuste(±)
    unit_cost           NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
                        -- CONGELADO en salidas/devoluciones (freezing_rule)
    line_total          NUMERIC(14,2) NOT NULL,  -- |qty| × unit_cost
    wo_id               UUID NULL REFERENCES work_orders(id),
    document_number     TEXT NULL,               -- nº factura (OBLIGATORIO en entradas)
    provider_id         UUID NULL REFERENCES providers(id),
    reason              TEXT NULL,               -- motivo/nota (OBLIGATORIO en ajustes)
    count_id            UUID NULL REFERENCES physical_counts(id),
    origin_movement_id  UUID NULL REFERENCES stock_movements(id),
                        -- F4.5: movimiento de salida original de una devolución
    user_id             UUID NOT NULL REFERENCES users(id),
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Integridad por tipo (refuerza la spec a nivel BD)
    CHECK (type <> 'entrada'    OR (qty > 0 AND document_number IS NOT NULL AND destiny_warehouse_id IS NULL)),
    CHECK (type <> 'devolucion' OR (qty > 0 AND wo_id IS NOT NULL AND origin_movement_id IS NOT NULL AND destiny_warehouse_id IS NULL)),
    CHECK (type <> 'salida_ot'  OR (qty < 0 AND wo_id IS NOT NULL AND destiny_warehouse_id IS NULL)),
    CHECK (type <> 'ajuste'     OR (qty <> 0 AND reason IS NOT NULL AND destiny_warehouse_id IS NULL)),
    CHECK (type <> 'transferencia' OR (qty <> 0 AND destiny_warehouse_id IS NOT NULL AND destiny_warehouse_id <> warehouse_id)),
    -- La devolución siempre apunta a su salida original (F4.5)
    CHECK (origin_movement_id IS NULL OR type = 'devolucion')
);

CREATE INDEX idx_kardex_item_date    ON stock_movements (item_id, occurred_at DESC);
CREATE INDEX idx_kardex_warehouse    ON stock_movements (warehouse_id, occurred_at DESC);
CREATE INDEX idx_kardex_wo           ON stock_movements (wo_id);
CREATE INDEX idx_kardex_type_date    ON stock_movements (type, occurred_at DESC);
CREATE INDEX idx_kardex_count        ON stock_movements (count_id);
CREATE INDEX idx_kardex_origin       ON stock_movements (origin_movement_id) WHERE origin_movement_id IS NOT NULL;
CREATE INDEX idx_kardex_date         ON stock_movements (occurred_at DESC);

-- ============ item_asset_links / item_category_links (BD/item_asset_links.md) ============
CREATE TABLE item_asset_links (
    item_id     UUID NOT NULL REFERENCES items(id),
    asset_id    UUID NOT NULL REFERENCES assets(id),
    PRIMARY KEY (item_id, asset_id)
);

CREATE INDEX idx_ial_asset ON item_asset_links (asset_id);

CREATE TABLE item_category_links (
    item_id     UUID NOT NULL REFERENCES items(id),
    category_id UUID NOT NULL REFERENCES categories(id),
    PRIMARY KEY (item_id, category_id)
);

CREATE INDEX idx_icl_category ON item_category_links (category_id);

-- ============ RLS (04-flujos <rls_policy>) ============
-- Mantenimiento: SELECT/INSERT/UPDATE en todo el módulo (DELETE prohibido —
-- kardex inmutable, catálogos con baja lógica; ÚNICA excepción: las
-- tablas N:N de vínculos V4.2, que se reemplazan con DELETE+INSERT).
-- Técnico/Administrador/Calidad: SELECT (Técnico consume/devuelve solo vía
-- RPCs m4_consume/m4_return con is_assigned_wo).
-- Las mutaciones de stock/kardex NO tienen policies INSERT: pasan por RPCs
-- SECURITY DEFINER (consistencia transaccional stock↔kardex).

ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY item_categories_select ON item_categories
    FOR SELECT TO authenticated USING (true);

CREATE POLICY item_categories_insert_mantenimiento ON item_categories
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

CREATE POLICY item_categories_update_mantenimiento ON item_categories
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE items ENABLE ROW LEVEL SECURITY;

CREATE POLICY items_select ON items
    FOR SELECT TO authenticated USING (true);

CREATE POLICY items_insert_mantenimiento ON items
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

CREATE POLICY items_update_mantenimiento ON items
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY warehouses_select ON warehouses
    FOR SELECT TO authenticated USING (true);

CREATE POLICY warehouses_insert_mantenimiento ON warehouses
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

CREATE POLICY warehouses_update_mantenimiento ON warehouses
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE warehouse_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY warehouse_stock_select ON warehouse_stock
    FOR SELECT TO authenticated USING (true);

-- Solo Mantenimiento pre-alta filas (mínimos desde V4.2 con qty=0) o edita
-- min_stock; el guard fn_m4_stock_guard bloquea cambios de qty sin RPC.
CREATE POLICY warehouse_stock_insert_mantenimiento ON warehouse_stock
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

CREATE POLICY warehouse_stock_update_mantenimiento ON warehouse_stock
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE physical_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY physical_counts_select ON physical_counts
    FOR SELECT TO authenticated USING (true);

CREATE POLICY physical_counts_insert_mantenimiento ON physical_counts
    FOR INSERT TO authenticated WITH CHECK (public.has_role('mantenimiento'));

-- Solo Mantenimiento y solo conteos En proceso; confirmar/cancelar exige RPC
-- (fn_m4_count_guard) para generar los ajustes en la misma transacción.
CREATE POLICY physical_counts_update_mantenimiento ON physical_counts
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE physical_count_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY physical_count_items_select ON physical_count_items
    FOR SELECT TO authenticated USING (true);

-- Alta vía RPC m4_count_create (snapshot del teórico); edición del contado
-- solo Mantenimiento mientras el conteo está En proceso (guard).
CREATE POLICY physical_count_items_update_mantenimiento ON physical_count_items
    FOR UPDATE TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_movements_select ON stock_movements
    FOR SELECT TO authenticated USING (true);
-- Sin policies INSERT/UPDATE/DELETE: el kardex escribe solo vía RPCs.

ALTER TABLE item_asset_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY item_asset_links_select ON item_asset_links
    FOR SELECT TO authenticated USING (true);

CREATE POLICY item_asset_links_write_mantenimiento ON item_asset_links
    FOR ALL TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

ALTER TABLE item_category_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY item_category_links_select ON item_category_links
    FOR SELECT TO authenticated USING (true);

CREATE POLICY item_category_links_write_mantenimiento ON item_category_links
    FOR ALL TO authenticated
    USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

-- ============ Bucket `documentos` (04-flujos <storage_buckets>) ============
-- Bucket COMPARTIDO M4+M5+M6; aquí se crea con prefijo `items/` (solo
-- Mantenimiento). Prefijos `proveedores/` (M5) y `cumplimiento/` (M6)
-- agregarán sus policies al implementar esos módulos. Lectura: 4 roles.
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "documentos_select" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'documentos');

CREATE POLICY "documentos_insert_items" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'documentos'
                AND (storage.foldername(name))[1] = 'items'
                AND public.has_role('mantenimiento'));

-- Sin policy UPDATE (archivos inmutables).
CREATE POLICY "documentos_delete_items" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'documentos'
           AND (storage.foldername(name))[1] = 'items'
           AND public.has_role('mantenimiento'));
