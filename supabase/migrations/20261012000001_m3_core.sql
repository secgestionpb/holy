-- Migración 7 — Módulo 3: Lógica y RLS (m3_core.sql)

-- ============ RLS ============
-- maintenance_plans: Mant (CRUD), Admin/Calidad (SELECT), Técnico (SELECT)
ALTER TABLE maintenance_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maintenance_plans_select ON maintenance_plans;
CREATE POLICY maintenance_plans_select ON maintenance_plans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS maintenance_plans_cud ON maintenance_plans;
CREATE POLICY maintenance_plans_cud ON maintenance_plans FOR ALL TO authenticated USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

-- checklist_templates: Mant (CRUD), Admin/Calidad (SELECT)
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklist_templates_select ON checklist_templates;
CREATE POLICY checklist_templates_select ON checklist_templates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS checklist_templates_cud ON checklist_templates;
CREATE POLICY checklist_templates_cud ON checklist_templates FOR ALL TO authenticated USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

-- checklist_items: Mismo acceso que templates
ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklist_items_select ON checklist_items;
CREATE POLICY checklist_items_select ON checklist_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS checklist_items_cud ON checklist_items;
CREATE POLICY checklist_items_cud ON checklist_items FOR ALL TO authenticated USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

-- checklist_item_items: Mismo acceso que templates
ALTER TABLE checklist_item_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklist_item_items_select ON checklist_item_items;
CREATE POLICY checklist_item_items_select ON checklist_item_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS checklist_item_items_cud ON checklist_item_items;
CREATE POLICY checklist_item_items_cud ON checklist_item_items FOR ALL TO authenticated USING (public.has_role('mantenimiento')) WITH CHECK (public.has_role('mantenimiento'));

-- wo_checklist_entries: SELECT (todo), UPDATE (Técnico asignado o Mantenimiento)
ALTER TABLE wo_checklist_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wo_checklist_entries_select ON wo_checklist_entries;
CREATE POLICY wo_checklist_entries_select ON wo_checklist_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS wo_checklist_entries_update ON wo_checklist_entries;
CREATE POLICY wo_checklist_entries_update ON wo_checklist_entries 
    FOR UPDATE TO authenticated 
    USING (public.has_role('mantenimiento') OR public.is_assigned_wo(wo_id))
    WITH CHECK (public.has_role('mantenimiento') OR public.is_assigned_wo(wo_id));

-- ============ RPC: Validación de cierre ============
CREATE OR REPLACE FUNCTION public.m3_wo_checklist_validate(p_wo_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_missing INTEGER;
BEGIN
    -- Busca filas pendientes
    SELECT COUNT(*) INTO v_missing 
    FROM wo_checklist_entries 
    WHERE wo_id = p_wo_id 
      AND status = 'pending';
    
    RETURN v_missing = 0;
END;
$$;
