-- Migración 6 — Módulo 3: Mantenimiento Preventivo (Estructura)
-- Fuente de verdad: markdown/BD/{maintenance_plans,checklist_templates,wo_checklist_entries}.md

-- ============ maintenance_plans (BD/maintenance_plans.md) ============
CREATE TABLE maintenance_plans (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT NOT NULL,
    description           TEXT,
    frequency_type        TEXT NOT NULL CHECK (frequency_type IN ('time','usage')),
    interval_value        INTEGER NOT NULL CHECK (interval_value > 0),
    checklist_template_id UUID,
    suggested_role        TEXT,
    default_priority      TEXT NOT NULL DEFAULT 'normal' CHECK (default_priority IN ('urgent','normal','low')),
    lead_days             INTEGER NOT NULL DEFAULT 0 CHECK (lead_days >= 0),
    grace_days            INTEGER NOT NULL CHECK (grace_days >= 0),
    is_active             BOOLEAN NOT NULL DEFAULT true,
    next_due_at           DATE,
    last_run_date         DATE,
    last_run_counter      BIGINT,
    created_by            UUID REFERENCES users(id),
    updated_by            UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER maintenance_plans_set_updated_at
    BEFORE UPDATE ON maintenance_plans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE plan_asset_links (
    plan_id         UUID NOT NULL REFERENCES maintenance_plans(id),
    asset_id        UUID NOT NULL REFERENCES assets(id),
    PRIMARY KEY (plan_id, asset_id)
);

CREATE TABLE plan_category_links (
    plan_id         UUID NOT NULL REFERENCES maintenance_plans(id),
    category_id     UUID NOT NULL REFERENCES categories(id),
    PRIMARY KEY (plan_id, category_id)
);

-- ============ checklist_templates (BD/checklist_templates.md) ============
CREATE TABLE checklist_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    category_id     UUID REFERENCES categories(id),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER checklist_templates_set_updated_at
    BEFORE UPDATE ON checklist_templates
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE checklist_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     UUID NOT NULL REFERENCES checklist_templates(id),
    position        INTEGER NOT NULL,
    text            TEXT NOT NULL,
    UNIQUE (template_id, position)
);

CREATE TABLE checklist_item_items (
    checklist_item_id   UUID NOT NULL REFERENCES checklist_items(id),
    item_id             UUID NOT NULL REFERENCES items(id),
    qty_suggested       INTEGER CHECK (qty_suggested IS NULL OR qty_suggested > 0),
    PRIMARY KEY (checklist_item_id, item_id)
);

-- FK entre plans y templates
ALTER TABLE maintenance_plans
    ADD CONSTRAINT maintenance_plans_checklist_fkey
    FOREIGN KEY (checklist_template_id) REFERENCES checklist_templates(id);

-- FK para wo_checklist_entries (creada en M2)
ALTER TABLE wo_checklist_entries
    ADD CONSTRAINT wo_checklist_entries_item_fkey
    FOREIGN KEY (checklist_item_id) REFERENCES checklist_items(id);
