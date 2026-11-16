-- Migración 6 — Módulo 2 core: helpers + guards + auditoría + notificaciones
-- + RPCs + vistas. Fuente: 02-ordenes-de-trabajo-flujos.md (F2.1–F2.8, V2.1–V2.5,
-- M2.1/M2.2, <supabase_mapping>) + BD/{work_orders,damage_reports,wo_*}.md
-- Decisiones de sesión aplicadas (documentadas en implementation_notes):
--  · Calidad comenta en OTs (desviación de BD/wo_comments.md — V2.3 manda).
--  · Contador de uso: cierre suma +1 si assets.has_usage_counter.
--  · Reemplazo de técnico: cualquier técnico asignado reemplaza a cualquier
--    técnico activo de la OT (incluido él mismo) por otro no asignado; obs. obligatoria.
--  · Alta/conversión de OT vía RPC transaccional m2_create_wo (cubre el
--    mapeo "damage_report_convert" — desviación documentada).
--  · Cierre: EF wo_close_engine valida el modal y llama a la RPC atómica
--    m2_close_wo (garantía create-or-edit + Evento 1 + contador + snapshot).

-- ============ Helpers ============

-- Nombre de proveedor para vistas (los Técnicos no tienen SELECT sobre
-- providers — resuelve v2_work_orders sin exponer el catálogo).
CREATE OR REPLACE FUNCTION public.m2_provider_name(p_id UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT name FROM providers WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.m2_provider_name(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_provider_name(UUID) TO authenticated, service_role;

-- Referencia corta de reporte de daño ("RD-1A2B3C") para labels y UI.
CREATE OR REPLACE FUNCTION public.m2_dr_ref(p_id UUID) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT 'RD-' || upper(substr(replace(p_id::TEXT, '-', ''), 1, 6));
$$;

-- Validación de asignación multi-técnico: usuarios con rol Técnico activo,
-- sin duplicados (usada por m2_create_wo / m2_assign_wo).
CREATE OR REPLACE FUNCTION public.m2_validate_technicians(p_ids UUID[]) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_bad    INT;
    v_dup    INT;
    v_total  INT;
    v_uniq   INT;
BEGIN
    IF p_ids IS NULL OR coalesce(array_length(p_ids, 1), 0) = 0 THEN
        RETURN;
    END IF;

    SELECT COUNT(*), COUNT(DISTINCT u)
    INTO v_total, v_uniq
    FROM unnest(p_ids) AS u;
    IF v_total <> v_uniq THEN
        RAISE EXCEPTION 'Hay técnicos duplicados en la selección';
    END IF;

    SELECT COUNT(*) INTO v_bad
    FROM unnest(p_ids) AS u
    WHERE NOT EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN users us ON us.id = ur.user_id
        WHERE ur.user_id = u AND ur.role = 'tecnico' AND us.is_active
    );
    IF v_bad > 0 THEN
        RAISE EXCEPTION '% usuario(s) seleccionados no son Técnicos activos', v_bad;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.m2_validate_technicians(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_validate_technicians(UUID[]) TO authenticated, service_role;

-- Despacho de push (F-T2.4 / M2 <push>): llama a la EF wo_dispatch_push
-- vía pg_net. Sin tokens activos o sin credenciales FCM → no-op elegante.
CREATE OR REPLACE FUNCTION public.m2_dispatch_push(
    p_action   TEXT,
    p_wo_id    UUID,
    p_user_ids UUID[]
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_user_ids IS NULL OR coalesce(array_length(p_user_ids, 1), 0) = 0 THEN
        RETURN;
    END IF;
    PERFORM net.http_post(
        url := 'https://wqqsaxoebrekdrmzjdod.supabase.co/functions/v1/wo_dispatch_push',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
            'action',   p_action,
            'wo_id',    p_wo_id,
            'user_ids', p_user_ids,
            'actor',    COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), ''), NULL)::UUID
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.m2_dispatch_push(TEXT, UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_dispatch_push(TEXT, UUID, UUID[]) TO authenticated, service_role;

-- ============ Guard: transiciones de estado + columnas por rol (F2.4–F2.8) ============
-- Las RPCs (m2_*) setean app.wo_rpc='1' y saltan este guard (ya validaron
-- con mensajes precisos). UPDATE directo del front: mapa de transiciones +
-- roles + columnas editables del Técnico (V2.2: descripción, prioridad,
-- estados de trabajo — nunca origen ni tipo).
CREATE OR REPLACE FUNCTION public.fn_wo_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF current_setting('app.wo_rpc', TRUE) = '1' THEN
        RETURN NEW;
    END IF;

    -- Columnas protegidas para roles distintos de Mantenimiento
    -- (Técnico asignado: description, priority, status, started_at, finished_at)
    IF NOT public.has_role('mantenimiento') THEN
        IF NEW.wo_number     IS DISTINCT FROM OLD.wo_number
        OR NEW.asset_id      IS DISTINCT FROM OLD.asset_id
        OR NEW.component_id  IS DISTINCT FROM OLD.component_id
        OR NEW.wo_type       IS DISTINCT FROM OLD.wo_type
        OR NEW.origin        IS DISTINCT FROM OLD.origin
        OR NEW.damage_report_id IS DISTINCT FROM OLD.damage_report_id
        OR NEW.plan_id       IS DISTINCT FROM OLD.plan_id
        OR NEW.external_ref  IS DISTINCT FROM OLD.external_ref
        OR NEW.reported_by   IS DISTINCT FROM OLD.reported_by
        OR NEW.reported_at   IS DISTINCT FROM OLD.reported_at
        OR NEW.scheduled_at  IS DISTINCT FROM OLD.scheduled_at
        OR NEW.assigned_at   IS DISTINCT FROM OLD.assigned_at
        OR NEW.closed_at     IS DISTINCT FROM OLD.closed_at
        OR NEW.closed_by     IS DISTINCT FROM OLD.closed_by
        OR NEW.affects_sale  IS DISTINCT FROM OLD.affects_sale
        OR NEW.executed_by_type IS DISTINCT FROM OLD.executed_by_type
        OR NEW.provider_id   IS DISTINCT FROM OLD.provider_id
        OR NEW.external_cost IS DISTINCT FROM OLD.external_cost
        OR NEW.generates_warranty IS DISTINCT FROM OLD.generates_warranty
        OR NEW.reassigned    IS DISTINCT FROM OLD.reassigned
        OR NEW.diagnosis     IS DISTINCT FROM OLD.diagnosis
        OR NEW.solution      IS DISTINCT FROM OLD.solution
        OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Sin permiso para modificar este campo';
        END IF;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- Estados terminales: solo la reapertura formal (RPC m2_reopen_wo)
        IF OLD.status IN ('closed', 'cancelled') THEN
            RAISE EXCEPTION 'Use la reapertura formal (motivo obligatorio) para modificar una OT %', OLD.status;
        END IF;
        -- Rol por destino
        IF NEW.status = 'cancelled' AND NOT public.has_role('mantenimiento') THEN
            RAISE EXCEPTION 'Solo Mantenimiento cancela OTs';
        END IF;
        IF NEW.status = 'closed' AND NOT public.has_role('mantenimiento') THEN
            RAISE EXCEPTION 'Solo Mantenimiento cierra OTs';
        END IF;
        IF NEW.status NOT IN ('closed', 'cancelled')
           AND NOT (public.has_role('mantenimiento') OR public.is_assigned_wo(OLD.id)) THEN
            RAISE EXCEPTION 'Debe estar asignado a la OT para cambiar su estado';
        END IF;
        -- Mapa de transiciones (F2.3–F2.8 / lifecycle BD/work_orders.md)
        IF NOT (
               (OLD.status = 'open'          AND NEW.status IN ('assigned','in_progress','waiting_parts','completed','cancelled'))
            OR (OLD.status = 'assigned'      AND NEW.status IN ('open','in_progress','waiting_parts','completed','cancelled'))
            OR (OLD.status = 'in_progress'   AND NEW.status IN ('waiting_parts','completed','cancelled'))
            OR (OLD.status = 'waiting_parts' AND NEW.status IN ('in_progress','completed','cancelled'))
            OR (OLD.status = 'completed'     AND NEW.status IN ('closed','in_progress'))
        ) THEN
            RAISE EXCEPTION 'Transición de estado no válida (% → %)', OLD.status, NEW.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wo_guard
    BEFORE UPDATE ON work_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_wo_guard();

-- ============ Guard: filas de wo_technicians (horas propias / Mantenimiento) ============
CREATE OR REPLACE FUNCTION public.fn_wo_tech_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF current_setting('app.wo_rpc', TRUE) = '1' THEN
        RETURN NEW;
    END IF;
    IF public.has_role('mantenimiento') THEN
        RETURN NEW;
    END IF;
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Solo puedes editar tu propia fila de horas';
    END IF;
    IF NEW.wo_id       IS DISTINCT FROM OLD.wo_id
    OR NEW.user_id     IS DISTINCT FROM OLD.user_id
    OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
    OR NEW.removed_at  IS DISTINCT FROM OLD.removed_at
    OR NEW.removed_by  IS DISTINCT FROM OLD.removed_by
    OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Solo puedes actualizar tus horas de trabajo';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wo_tech_guard
    BEFORE UPDATE ON wo_technicians
    FOR EACH ROW EXECUTE FUNCTION public.fn_wo_tech_guard();

-- ============ Guard: checklist (solo lectura en OT cerrada + marcas) ============
CREATE OR REPLACE FUNCTION public.fn_wo_checklist_before() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_wo_status TEXT;
BEGIN
    IF current_setting('app.wo_rpc', TRUE) = '1' THEN
        RETURN NEW;
    END IF;
    SELECT status INTO v_wo_status FROM work_orders WHERE id = OLD.wo_id;
    IF v_wo_status = 'closed' THEN
        RAISE EXCEPTION 'El checklist es de solo lectura: la OT está Cerrada';
    END IF;
    IF NEW.status = 'done' AND NEW.done_at IS NULL THEN
        NEW.done_by  := COALESCE(auth.uid(), NEW.done_by);
        NEW.done_at  := now();
    ELSIF NEW.status = 'pending' THEN
        NEW.done_by  := NULL;
        NEW.done_at  := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wo_checklist_before
    BEFORE UPDATE ON wo_checklist_entries
    FOR EACH ROW EXECUTE FUNCTION public.fn_wo_checklist_before();

-- ============ Guard: evidencia nunca se borra de una OT Cerrada (V2.3) ============
CREATE OR REPLACE FUNCTION public.fn_wo_evidence_delete_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF OLD.work_order_id IS NOT NULL THEN
        SELECT status INTO v_status FROM work_orders WHERE id = OLD.work_order_id;
        IF v_status = 'closed' THEN
            RAISE EXCEPTION 'No se puede borrar evidencia de una OT Cerrada';
        END IF;
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_wo_evidence_delete_guard
    BEFORE DELETE ON wo_evidence
    FOR EACH ROW EXECUTE FUNCTION public.fn_wo_evidence_delete_guard();

-- ============ Auditoría M2 (audit_log.md: triggers PG, append-only) ============

CREATE OR REPLACE FUNCTION public.fn_audit_work_orders() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT;
    v_label   TEXT;
    v_reason  TEXT := NULLIF(current_setting('app.audit_reason', TRUE), '');
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_action := 'create';
        v_changes := jsonb_build_object(
            'wo_number',     jsonb_build_object('old', NULL, 'new', NEW.wo_number),
            'asset_id',      jsonb_build_object('old', NULL, 'new', NEW.asset_id),
            'component_id',  jsonb_build_object('old', NULL, 'new', NEW.component_id),
            'wo_type',       jsonb_build_object('old', NULL, 'new', NEW.wo_type),
            'priority',      jsonb_build_object('old', NULL, 'new', NEW.priority),
            'description',   jsonb_build_object('old', NULL, 'new', NEW.description),
            'origin',        jsonb_build_object('old', NULL, 'new', NEW.origin),
            'damage_report_id', jsonb_build_object('old', NULL, 'new', NEW.damage_report_id),
            'reported_by',   jsonb_build_object('old', NULL, 'new', NEW.reported_by),
            'status',        jsonb_build_object('old', NULL, 'new', NEW.status),
            'scheduled_at',  jsonb_build_object('old', NULL, 'new', NEW.scheduled_at),
            'affects_sale',  jsonb_build_object('old', NULL, 'new', NEW.affects_sale),
            'executed_by_type', jsonb_build_object('old', NULL, 'new', NEW.executed_by_type),
            'provider_id',   jsonb_build_object('old', NULL, 'new', NEW.provider_id)
        );
    ELSE
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
        END IF;
        IF NEW.priority IS DISTINCT FROM OLD.priority THEN
            v_changes := v_changes || jsonb_build_object('priority', jsonb_build_object('old', OLD.priority, 'new', NEW.priority));
        END IF;
        IF NEW.description IS DISTINCT FROM OLD.description THEN
            v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', OLD.description, 'new', NEW.description));
        END IF;
        IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
            v_changes := v_changes || jsonb_build_object('scheduled_at', jsonb_build_object('old', OLD.scheduled_at, 'new', NEW.scheduled_at));
        END IF;
        IF NEW.wo_type IS DISTINCT FROM OLD.wo_type THEN
            v_changes := v_changes || jsonb_build_object('wo_type', jsonb_build_object('old', OLD.wo_type, 'new', NEW.wo_type));
        END IF;
        IF NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN
            v_changes := v_changes || jsonb_build_object('asset_id', jsonb_build_object('old', OLD.asset_id, 'new', NEW.asset_id));
        END IF;
        IF NEW.component_id IS DISTINCT FROM OLD.component_id THEN
            v_changes := v_changes || jsonb_build_object('component_id', jsonb_build_object('old', OLD.component_id, 'new', NEW.component_id));
        END IF;
        IF NEW.affects_sale IS DISTINCT FROM OLD.affects_sale THEN
            v_changes := v_changes || jsonb_build_object('affects_sale', jsonb_build_object('old', OLD.affects_sale, 'new', NEW.affects_sale));
        END IF;
        IF NEW.executed_by_type IS DISTINCT FROM OLD.executed_by_type THEN
            v_changes := v_changes || jsonb_build_object('executed_by_type', jsonb_build_object('old', OLD.executed_by_type, 'new', NEW.executed_by_type));
        END IF;
        IF NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
            v_changes := v_changes || jsonb_build_object('provider_id', jsonb_build_object('old', OLD.provider_id, 'new', NEW.provider_id));
        END IF;
        IF NEW.external_cost IS DISTINCT FROM OLD.external_cost THEN
            v_changes := v_changes || jsonb_build_object('external_cost', jsonb_build_object('old', OLD.external_cost, 'new', NEW.external_cost));
        END IF;
        IF NEW.generates_warranty IS DISTINCT FROM OLD.generates_warranty THEN
            v_changes := v_changes || jsonb_build_object('generates_warranty', jsonb_build_object('old', OLD.generates_warranty, 'new', NEW.generates_warranty));
        END IF;
        IF NEW.reassigned IS DISTINCT FROM OLD.reassigned THEN
            v_changes := v_changes || jsonb_build_object('reassigned', jsonb_build_object('old', OLD.reassigned, 'new', NEW.reassigned));
        END IF;
        IF NEW.diagnosis IS DISTINCT FROM OLD.diagnosis THEN
            v_changes := v_changes || jsonb_build_object('diagnosis', jsonb_build_object('old', OLD.diagnosis, 'new', NEW.diagnosis));
        END IF;
        IF NEW.solution IS DISTINCT FROM OLD.solution THEN
            v_changes := v_changes || jsonb_build_object('solution', jsonb_build_object('old', OLD.solution, 'new', NEW.solution));
        END IF;
        IF NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
            v_changes := v_changes || jsonb_build_object('closed_at', jsonb_build_object('old', OLD.closed_at, 'new', NEW.closed_at));
        END IF;
        IF v_changes = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
        v_action := CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'state_change' ELSE 'update' END;
    END IF;

    v_label := 'OT ' || COALESCE(NEW.wo_number, OLD.wo_number);
    PERFORM public.fn_audit_row('work_orders', 'work_order', v_action,
        COALESCE(NEW.id, OLD.id), v_label, v_changes, v_reason);
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_work_orders
    AFTER INSERT OR UPDATE ON work_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_work_orders();

CREATE OR REPLACE FUNCTION public.fn_audit_damage_reports() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB := '{}'::jsonb;
    v_action  TEXT;
    v_label   TEXT := 'Reporte de daño ' || public.m2_dr_ref(COALESCE(NEW.id, OLD.id));
    v_reason  TEXT := NULLIF(current_setting('app.audit_reason', TRUE), '');
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_action := 'create';
        v_changes := jsonb_build_object(
            'asset_id',     jsonb_build_object('old', NULL, 'new', NEW.asset_id),
            'component_id', jsonb_build_object('old', NULL, 'new', NEW.component_id),
            'description',  jsonb_build_object('old', NULL, 'new', NEW.description),
            'reported_by',  jsonb_build_object('old', NULL, 'new', NEW.reported_by),
            'status',       jsonb_build_object('old', NULL, 'new', NEW.status)
        );
    ELSE
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
            v_action := CASE
                WHEN NEW.status = 'converted' THEN 'convert'
                WHEN NEW.status = 'discarded' THEN 'discard'
                ELSE 'state_change'
            END;
        END IF;
        IF NEW.discard_reason IS DISTINCT FROM OLD.discard_reason THEN
            v_changes := v_changes || jsonb_build_object('discard_reason', jsonb_build_object('old', OLD.discard_reason, 'new', NEW.discard_reason));
        END IF;
        IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN
            v_changes := v_changes || jsonb_build_object('reviewed_by', jsonb_build_object('old', OLD.reviewed_by, 'new', NEW.reviewed_by));
        END IF;
        IF v_changes = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
        IF v_action IS NULL THEN v_action := 'update'; END IF;
    END IF;

    PERFORM public.fn_audit_row('work_orders', 'damage_report', v_action,
        COALESCE(NEW.id, OLD.id), v_label, v_changes, v_reason);
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_damage_reports
    AFTER INSERT OR UPDATE ON damage_reports
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_damage_reports();

CREATE OR REPLACE FUNCTION public.fn_audit_wo_technicians() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_changes JSONB;
    v_action  TEXT;
    v_label   TEXT;
BEGIN
    SELECT 'OT ' || wo_number INTO v_label FROM work_orders
    WHERE id = COALESCE(NEW.wo_id, OLD.wo_id);

    IF TG_OP = 'INSERT' THEN
        v_action := 'assign';
        v_changes := jsonb_build_object(
            'user_id',     jsonb_build_object('old', NULL, 'new', NEW.user_id),
            'assigned_by', jsonb_build_object('old', NULL, 'new', NEW.assigned_by));
    ELSIF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
        v_action := 'unassign';
        v_changes := jsonb_build_object(
            'user_id',   jsonb_build_object('old', OLD.user_id, 'new', NULL),
            'removed_by', jsonb_build_object('old', NULL, 'new', NEW.removed_by));
    ELSIF NEW.hours_worked IS DISTINCT FROM OLD.hours_worked THEN
        v_action := 'update';
        v_changes := jsonb_build_object(
            'hours_worked', jsonb_build_object('old', OLD.hours_worked, 'new', NEW.hours_worked),
            'user_id', jsonb_build_object('old', OLD.user_id, 'new', NEW.user_id));
    ELSIF NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
        v_action := 'update';
        v_changes := jsonb_build_object(
            'started_at',  jsonb_build_object('old', OLD.started_at, 'new', NEW.started_at),
            'finished_at', jsonb_build_object('old', OLD.finished_at, 'new', NEW.finished_at),
            'user_id', jsonb_build_object('old', OLD.user_id, 'new', NEW.user_id));
    ELSE
        RETURN COALESCE(NEW, OLD);
    END IF;

    PERFORM public.fn_audit_row('work_orders', 'wo_technician', v_action,
        COALESCE(NEW.wo_id, OLD.wo_id), v_label, v_changes,
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_wo_technicians
    AFTER INSERT OR UPDATE ON wo_technicians
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_wo_technicians();

CREATE OR REPLACE FUNCTION public.fn_audit_wo_comments() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_label TEXT;
BEGIN
    SELECT 'OT ' || wo_number INTO v_label FROM work_orders WHERE id = NEW.wo_id;
    PERFORM public.fn_audit_row('work_orders', 'wo_comment', 'create',
        NEW.wo_id, v_label,
        jsonb_build_object('comment_id', jsonb_build_object('old', NULL, 'new', NEW.id),
                           'author_id',  jsonb_build_object('old', NULL, 'new', NEW.author_id)),
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_wo_comments
    AFTER INSERT ON wo_comments
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_wo_comments();

CREATE OR REPLACE FUNCTION public.fn_audit_wo_evidence() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_entity_id UUID;
    v_label     TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_entity_id := COALESCE(NEW.work_order_id, NEW.damage_report_id);
    ELSE
        v_entity_id := COALESCE(OLD.work_order_id, OLD.damage_report_id);
    END IF;

    IF v_entity_id IS NOT NULL AND (TG_OP = 'DELETE' OR NEW.work_order_id IS NOT NULL) THEN
        SELECT 'OT ' || wo_number INTO v_label FROM work_orders WHERE id = v_entity_id;
    END IF;
    v_label := COALESCE(v_label, 'Reporte de daño ' || public.m2_dr_ref(v_entity_id));

    PERFORM public.fn_audit_row('work_orders', 'wo_evidence',
        CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'delete' END,
        v_entity_id, v_label,
        jsonb_build_object('storage_path', jsonb_build_object(
            'old', CASE WHEN TG_OP = 'DELETE' THEN (SELECT storage_path FROM wo_evidence WHERE id = OLD.id) END,
            'new', CASE WHEN TG_OP = 'INSERT' THEN NEW.storage_path END)),
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_wo_evidence
    AFTER INSERT OR DELETE ON wo_evidence
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_wo_evidence();

CREATE OR REPLACE FUNCTION public.fn_audit_wo_checklist() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_label TEXT;
    v_changes JSONB;
BEGIN
    SELECT 'OT ' || wo_number INTO v_label FROM work_orders WHERE id = NEW.wo_id;
    IF TG_OP = 'INSERT' THEN
        v_changes := jsonb_build_object('item_text', jsonb_build_object('old', NULL, 'new', NEW.item_text),
                                        'position', jsonb_build_object('old', NULL, 'new', NEW.position));
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        v_changes := jsonb_build_object('checklist_status', jsonb_build_object(
            'old', OLD.status, 'new', NEW.status),
            'position', jsonb_build_object('old', OLD.position, 'new', NEW.position),
            'item_text', jsonb_build_object('old', OLD.item_text, 'new', NEW.item_text));
    ELSIF NEW.note IS DISTINCT FROM OLD.note THEN
        v_changes := jsonb_build_object('checklist_note', jsonb_build_object('old', OLD.note, 'new', NEW.note),
                                        'position', jsonb_build_object('old', OLD.position, 'new', NEW.position));
    ELSE
        RETURN COALESCE(NEW, OLD);
    END IF;

    PERFORM public.fn_audit_row('work_orders', 'wo_checklist',
        CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END,
        NEW.wo_id, v_label, v_changes,
        NULLIF(current_setting('app.audit_reason', TRUE), ''));
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_wo_checklist
    AFTER INSERT OR UPDATE ON wo_checklist_entries
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_wo_checklist();

-- ============ Notificaciones y push (02-flujos <notifications>) ============

-- Evento 1 al ALTA de OT con afecta_sale (dedup distinto al cierre).
CREATE OR REPLACE FUNCTION public.fn_wo_notify_insert() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.affects_sale THEN
        PERFORM public.fn_notify(1, 'work_order', NEW.id,
            'wo-open:' || NEW.id,
            jsonb_build_object('wo_number', NEW.wo_number, 'stage', 'open'));
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wo_notify_insert
    AFTER INSERT ON work_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_wo_notify_insert();

-- Evento 5 al alta de reporte de daño (F2.1 paso 3).
CREATE OR REPLACE FUNCTION public.fn_dr_notify_insert() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.fn_notify(5, 'damage_report', NEW.id,
        'damage-report:' || NEW.id,
        jsonb_build_object('ref', public.m2_dr_ref(NEW.id),
                           'asset_id', NEW.asset_id,
                           'reported_by', NEW.reported_by));
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dr_notify_insert
    AFTER INSERT ON damage_reports
    FOR EACH ROW EXECUTE FUNCTION public.fn_dr_notify_insert();

-- Push: asignación (INSERT fila activa) y salida (removed_at) — F2.4.
CREATE OR REPLACE FUNCTION public.fn_wo_tech_push() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.removed_at IS NULL THEN
        PERFORM public.m2_dispatch_push('assigned', NEW.wo_id, ARRAY[NEW.user_id]);
    ELSIF TG_OP = 'UPDATE' AND NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
        PERFORM public.m2_dispatch_push('removed', OLD.wo_id, ARRAY[OLD.user_id]);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_wo_tech_push
    AFTER INSERT OR UPDATE ON wo_technicians
    FOR EACH ROW EXECUTE FUNCTION public.fn_wo_tech_push();

-- Push: "OT propia modificada por otro usuario" (F2.5) — solo cambios de
-- estado; SIN push en cierre/cancelación/reapertura (exclusiones T2) y sin
-- push si modifica el propio técnico (se excluye al actor).
CREATE OR REPLACE FUNCTION public.fn_wo_status_push() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor UUID := COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), ''), NULL)::UUID;
    v_techs UUID[];
BEGIN
    IF v_actor IS NULL OR NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;
    IF NEW.status IN ('closed', 'cancelled') OR OLD.status IN ('closed', 'cancelled') THEN
        RETURN NEW;
    END IF;
    SELECT coalesce(array_agg(user_id), '{}') INTO v_techs
    FROM wo_technicians
    WHERE wo_id = NEW.id AND removed_at IS NULL AND user_id <> v_actor;
    PERFORM public.m2_dispatch_push('wo_status', NEW.id, v_techs);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wo_status_push
    AFTER UPDATE OF status ON work_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_wo_status_push();

-- ============ RPC m2_create_wo — alta manual o desde reporte (F2.2/F2.3) ============
CREATE OR REPLACE FUNCTION public.m2_create_wo(
    p_asset_id         UUID,
    p_description      TEXT,
    p_component_id     UUID DEFAULT NULL,
    p_wo_type          TEXT DEFAULT 'corrective',
    p_priority         TEXT DEFAULT 'normal',
    p_origin           TEXT DEFAULT 'manual',
    p_damage_report_id UUID DEFAULT NULL,
    p_external_ref     TEXT DEFAULT NULL,
    p_reported_by      UUID DEFAULT NULL,
    p_scheduled_at     TIMESTAMPTZ DEFAULT NULL,
    p_affects_sale     BOOLEAN DEFAULT FALSE,
    p_executed_by_type TEXT DEFAULT 'internal',
    p_provider_id      UUID DEFAULT NULL,
    p_external_cost    NUMERIC DEFAULT NULL,
    p_technicians      UUID[] DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id     UUID;
    v_number TEXT;
    v_status TEXT;
    v_dr     RECORD;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF NULLIF(trim(COALESCE(p_description, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La descripción es obligatoria';
    END IF;
    IF p_wo_type NOT IN ('corrective', 'preventive', 'inspection') THEN
        RAISE EXCEPTION 'Tipo de OT inválido';
    END IF;
    IF p_priority NOT IN ('urgent', 'normal', 'low') THEN
        RAISE EXCEPTION 'Prioridad inválida';
    END IF;
    IF p_origin NOT IN ('manual', 'damage_report', 'preventive', 'external_app') THEN
        RAISE EXCEPTION 'Origen inválido';
    END IF;
    IF p_executed_by_type NOT IN ('internal', 'external') THEN
        RAISE EXCEPTION 'Ejecución inválida';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM assets WHERE id = p_asset_id) THEN
        RAISE EXCEPTION 'Activo inexistente';
    END IF;
    IF p_component_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM assets WHERE id = p_component_id AND parent_id = p_asset_id
    ) THEN
        RAISE EXCEPTION 'El componente no pertenece al activo seleccionado';
    END IF;

    IF p_executed_by_type = 'external' AND p_provider_id IS NULL THEN
        RAISE EXCEPTION 'El proveedor es obligatorio cuando la ejecución es externa';
    END IF;
    IF p_provider_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM providers WHERE id = p_provider_id AND is_active
    ) THEN
        RAISE EXCEPTION 'Proveedor inexistente o inactivo';
    END IF;

    -- Conversión desde bandeja (F2.2): hereda activo/componente y valida revisión
    IF p_damage_report_id IS NOT NULL THEN
        SELECT * INTO v_dr FROM damage_reports WHERE id = p_damage_report_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Reporte de daño inexistente';
        END IF;
        IF v_dr.status <> 'pending_review' THEN
            RAISE EXCEPTION 'El reporte ya fue revisado';
        END IF;
        IF v_dr.asset_id <> p_asset_id OR v_dr.component_id IS DISTINCT FROM p_component_id THEN
            RAISE EXCEPTION 'El reporte corresponde a otro activo/componente';
        END IF;
        IF p_origin <> 'damage_report' THEN
            RAISE EXCEPTION 'Una OT desde reporte debe usar origen "damage_report"';
        END IF;
    END IF;

    PERFORM public.m2_validate_technicians(p_technicians);

    v_status := CASE WHEN coalesce(array_length(p_technicians, 1), 0) > 0
                     THEN 'assigned' ELSE 'open' END;
    v_number := 'OT-' || lpad(nextval('work_orders_number_seq')::TEXT, 4, '0');

    INSERT INTO work_orders (
        wo_number, asset_id, component_id, wo_type, priority, description, origin,
        damage_report_id, external_ref, reported_by, status, scheduled_at,
        assigned_at, affects_sale, executed_by_type, provider_id, external_cost
    ) VALUES (
        v_number, p_asset_id, p_component_id, p_wo_type, p_priority, p_description, p_origin,
        p_damage_report_id, p_external_ref, COALESCE(p_reported_by, auth.uid()),
        v_status, p_scheduled_at,
        CASE WHEN v_status = 'assigned' THEN now() ELSE NULL END,
        COALESCE(p_affects_sale, FALSE), p_executed_by_type, p_provider_id, p_external_cost
    ) RETURNING id INTO v_id;

    IF coalesce(array_length(p_technicians, 1), 0) > 0 THEN
        INSERT INTO wo_technicians (wo_id, user_id, assigned_by)
        SELECT v_id, u, auth.uid() FROM unnest(p_technicians) AS u;
    END IF;

    IF p_damage_report_id IS NOT NULL THEN
        UPDATE damage_reports
        SET status = 'converted', reviewed_by = auth.uid(), reviewed_at = now()
        WHERE id = p_damage_report_id;
    END IF;

    RETURN jsonb_build_object('id', v_id, 'wo_number', v_number, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.m2_create_wo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TIMESTAMPTZ, BOOLEAN, TEXT, UUID, NUMERIC, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_create_wo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TIMESTAMPTZ, BOOLEAN, TEXT, UUID, NUMERIC, UUID[]) TO authenticated, service_role;

-- ============ RPC m2_assign_wo — set completo de técnicos (F2.4 Mantenimiento) ============
CREATE OR REPLACE FUNCTION public.m2_assign_wo(
    p_wo_id       UUID,
    p_technicians UUID[]
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor    UUID := COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), ''), NULL)::UUID;
    v_status   TEXT;
    v_existing UUID[];
    v_to_remove UUID[];
    v_to_add   UUID[];
    v_target   UUID[] := coalesce(p_technicians, '{}'::UUID[]);
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    v_actor := COALESCE(v_actor, auth.uid());

    SELECT status INTO v_status FROM work_orders WHERE id = p_wo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OT inexistente';
    END IF;
    IF v_status IN ('closed', 'cancelled') THEN
        RAISE EXCEPTION 'La OT está en estado terminal: no admite asignaciones';
    END IF;

    PERFORM public.m2_validate_technicians(v_target);

    SELECT coalesce(array_agg(user_id), '{}') INTO v_existing
    FROM wo_technicians
    WHERE wo_id = p_wo_id AND removed_at IS NULL;

    SELECT coalesce(array_agg(x), '{}') INTO v_to_remove
    FROM unnest(v_existing) AS x WHERE NOT (v_target @> ARRAY[x]);

    SELECT coalesce(array_agg(x), '{}') INTO v_to_add
    FROM unnest(v_target) AS x WHERE NOT (v_existing @> ARRAY[x]);

    PERFORM set_config('app.wo_rpc', '1', TRUE);

    IF coalesce(array_length(v_to_remove, 1), 0) > 0 THEN
        UPDATE wo_technicians
        SET removed_at = now(), removed_by = v_actor
        WHERE wo_id = p_wo_id AND removed_at IS NULL AND user_id = ANY(v_to_remove);
    END IF;
    IF coalesce(array_length(v_to_add, 1), 0) > 0 THEN
        INSERT INTO wo_technicians (wo_id, user_id, assigned_by)
        SELECT p_wo_id, x, v_actor FROM unnest(v_to_add) AS x;
    END IF;

    -- Estado derivado: open ↔ assigned (solo si no avanzó)
    IF v_status = 'open' AND coalesce(array_length(v_target, 1), 0) > 0 THEN
        UPDATE work_orders
        SET status = 'assigned', assigned_at = COALESCE(assigned_at, now())
        WHERE id = p_wo_id;
    ELSIF v_status = 'assigned' AND coalesce(array_length(v_target, 1), 0) = 0 THEN
        UPDATE work_orders SET status = 'open', assigned_at = NULL WHERE id = p_wo_id;
    END IF;

    PERFORM set_config('app.wo_rpc', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.m2_assign_wo(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_assign_wo(UUID, UUID[]) TO authenticated, service_role;

-- ============ RPC m2_technician_replace — reemplazo con observación (F2.4 por_tecnico) ============
CREATE OR REPLACE FUNCTION public.m2_technician_replace(
    p_wo_id       UUID,
    p_out_user    UUID,
    p_in_user     UUID,
    p_observation TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_status TEXT;
    v_actor  UUID := auth.uid();
    v_label  TEXT;
    v_rest   UUID[];
BEGIN
    -- Rol: Mantenimiento o técnico ASIGNADO a esta OT (is_assigned_wo usa auth.uid())
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Requiere sesión activa';
    END IF;
    IF NOT (public.has_role('mantenimiento') OR public.is_assigned_wo(p_wo_id)) THEN
        RAISE EXCEPTION 'Solo los técnicos asignados (o Mantenimiento) pueden reemplazar';
    END IF;
    IF NULLIF(trim(COALESCE(p_observation, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La observación es obligatoria';
    END IF;

    SELECT status INTO v_status FROM work_orders WHERE id = p_wo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OT inexistente';
    END IF;
    IF v_status NOT IN ('assigned', 'in_progress', 'waiting_parts') THEN
        RAISE EXCEPTION 'Reemplazo no permitido en estado %', v_status;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM wo_technicians
        WHERE wo_id = p_wo_id AND user_id = p_out_user AND removed_at IS NULL
    ) THEN
        RAISE EXCEPTION 'El técnico saliente no está asignado a la OT';
    END IF;
    IF p_out_user = p_in_user THEN
        RAISE EXCEPTION 'El técnico entrante debe ser distinto al saliente';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN users us ON us.id = ur.user_id
        WHERE ur.user_id = p_in_user AND ur.role = 'tecnico' AND us.is_active
    ) THEN
        RAISE EXCEPTION 'El técnico entrante no es un Técnico activo';
    END IF;
    IF EXISTS (
        SELECT 1 FROM wo_technicians
        WHERE wo_id = p_wo_id AND user_id = p_in_user AND removed_at IS NULL
    ) THEN
        RAISE EXCEPTION 'El técnico entrante ya está asignado a la OT';
    END IF;

    SELECT 'OT ' || wo_number INTO v_label FROM work_orders WHERE id = p_wo_id;

    PERFORM set_config('app.wo_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', p_observation, TRUE);

    UPDATE wo_technicians
    SET removed_at = now(), removed_by = v_actor
    WHERE wo_id = p_wo_id AND user_id = p_out_user AND removed_at IS NULL;

    INSERT INTO wo_technicians (wo_id, user_id, assigned_by)
    VALUES (p_wo_id, p_in_user, v_actor);

    UPDATE work_orders SET reassigned = TRUE WHERE id = p_wo_id;

    -- Auditoría con observación (el trigger de wo_technicians ya registró
    -- assign/unassign individuales; esta fila alimenta el timeline con obs.)
    PERFORM public.fn_audit_row('work_orders', 'work_order', 'replace',
        p_wo_id, v_label,
        jsonb_build_object('from', jsonb_build_object('old', p_out_user, 'new', NULL),
                           'to',   jsonb_build_object('old', NULL, 'new', p_in_user)),
        p_observation);

    -- Push a los que permanecen (entrante y saliente ya cubiertos por
    -- trg_wo_tech_push) — F2.4: 3 polos.
    SELECT coalesce(array_agg(user_id), '{}') INTO v_rest
    FROM wo_technicians
    WHERE wo_id = p_wo_id AND removed_at IS NULL
      AND user_id NOT IN (p_out_user, p_in_user);
    PERFORM public.m2_dispatch_push('reassigned', p_wo_id, v_rest);

    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.wo_rpc', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.m2_technician_replace(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_technician_replace(UUID, UUID, UUID, TEXT) TO authenticated, service_role;

-- ============ RPC m2_cancel_wo — cancelación con motivo (F2.8, solo Mantenimiento) ============
CREATE OR REPLACE FUNCTION public.m2_cancel_wo(
    p_wo_id  UUID,
    p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La cancelación requiere un motivo';
    END IF;

    SELECT status INTO v_status FROM work_orders WHERE id = p_wo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OT inexistente';
    END IF;
    IF v_status NOT IN ('open', 'assigned', 'in_progress', 'waiting_parts') THEN
        RAISE EXCEPTION 'No se puede cancelar desde el estado %', v_status;
    END IF;

    PERFORM set_config('app.wo_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', p_reason, TRUE);
    UPDATE work_orders SET status = 'cancelled' WHERE id = p_wo_id;
    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.wo_rpc', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.m2_cancel_wo(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_cancel_wo(UUID, TEXT) TO authenticated, service_role;

-- ============ RPC m2_reopen_wo — reapertura con motivo (F2.7, solo Mantenimiento) ============
CREATE OR REPLACE FUNCTION public.m2_reopen_wo(
    p_wo_id  UUID,
    p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La reapertura requiere un motivo';
    END IF;

    SELECT status INTO v_status FROM work_orders WHERE id = p_wo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OT inexistente';
    END IF;
    IF v_status NOT IN ('closed', 'cancelled') THEN
        RAISE EXCEPTION 'Solo se reabren OTs Cerradas o Canceladas (estado actual: %)', v_status;
    END IF;

    PERFORM set_config('app.wo_rpc', '1', TRUE);
    PERFORM set_config('app.audit_reason', p_reason, TRUE);

    -- F2.7: closed_at/closed_by → NULL; la garantía NO se elimina (queda
    -- marcada "OT origen reabierta"); no revierte próxima fecha (M3).
    UPDATE work_orders
    SET status = 'in_progress', closed_at = NULL, closed_by = NULL,
        generates_warranty = NULL
    WHERE id = p_wo_id;

    UPDATE warranties SET is_origin_reopened = TRUE WHERE origin_wo_id = p_wo_id;

    PERFORM set_config('app.audit_reason', '', TRUE);
    PERFORM set_config('app.wo_rpc', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.m2_reopen_wo(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_reopen_wo(UUID, TEXT) TO authenticated, service_role;

-- ============ RPC m2_discard_damage_report — descartar con motivo (F2.2) ============
CREATE OR REPLACE FUNCTION public.m2_discard_damage_report(
    p_report_id UUID,
    p_reason    TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'El descarte requiere un motivo';
    END IF;

    PERFORM set_config('app.audit_reason', p_reason, TRUE);
    UPDATE damage_reports
    SET status = 'discarded', discarded_by = auth.uid(), discarded_at = now(),
        discard_reason = p_reason
    WHERE id = p_report_id AND status = 'pending_review';
    IF NOT FOUND THEN
        PERFORM set_config('app.audit_reason', '', TRUE);
        RAISE EXCEPTION 'Reporte inexistente o ya revisado';
    END IF;
    PERFORM set_config('app.audit_reason', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.m2_discard_damage_report(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_discard_damage_report(UUID, TEXT) TO authenticated, service_role;

-- ============ RPC m2_close_wo — cierre formal atómico (F2.6 / modal M2.1) ============
-- Invocada por la EF wo_close_engine (p_actor = usuario Mantenimiento) o
-- directamente por Mantenimiento. Efectos: estado Cerrada + diagnóstico/
-- solución + ejecutada por/contratista/costo + genera_o_extiende_garantia
-- (create-or-edit en warranties con origin_wo_id) + Evento 1 si afectó
-- disponibilidad + assets.usage_counter +1 + snapshot de cierre.
CREATE OR REPLACE FUNCTION public.m2_close_wo(
    p_wo_id            UUID,
    p_diagnosis        TEXT,
    p_solution         TEXT,
    p_actor            UUID DEFAULT NULL,
    p_executed_by_type TEXT DEFAULT NULL,
    p_provider_id      UUID DEFAULT NULL,
    p_external_cost    NUMERIC DEFAULT NULL,
    p_affects_sale     BOOLEAN DEFAULT NULL,
    p_generates_warranty BOOLEAN DEFAULT NULL,
    p_warranty         JSONB DEFAULT NULL,
    p_warranty_document_path TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_actor     UUID := COALESCE(p_actor, auth.uid());
    v_wo        work_orders%ROWTYPE;
    v_exec      TEXT;
    v_provider  UUID;
    v_cost      NUMERIC;
    v_warranty_id UUID := NULL;
    v_w_start   DATE;
    v_w_end     DATE;
    v_w_cover   TEXT;
    v_w_prov    UUID;
    v_w_prov_name TEXT;
    v_w_notes   TEXT;
    v_w_doc     TEXT;
    v_label     TEXT;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Se requiere el usuario que ejecuta el cierre';
    END IF;
    IF auth.uid() IS NOT NULL AND NOT public.has_role('mantenimiento') THEN
        RAISE EXCEPTION 'Requiere rol Mantenimiento';
    END IF;
    IF p_generates_warranty IS NULL THEN
        RAISE EXCEPTION 'Debe responder genera_o_extiende_garantia (Sí/No)';
    END IF;
    IF NULLIF(trim(COALESCE(p_diagnosis, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_solution, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Diagnóstico y solución son obligatorios al cierre';
    END IF;

    SELECT * INTO v_wo FROM work_orders WHERE id = p_wo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OT inexistente';
    END IF;
    IF v_wo.status IN ('closed', 'cancelled') THEN
        RAISE EXCEPTION 'La OT ya está en estado %', v_wo.status;
    END IF;

    v_exec     := COALESCE(p_executed_by_type, v_wo.executed_by_type);
    v_provider := COALESCE(p_provider_id, v_wo.provider_id);
    v_cost     := COALESCE(p_external_cost, v_wo.external_cost);
    IF v_exec NOT IN ('internal', 'external') THEN
        RAISE EXCEPTION 'Ejecución inválida';
    END IF;
    IF v_exec = 'external' THEN
        IF v_provider IS NULL THEN
            RAISE EXCEPTION 'El proveedor es obligatorio al cerrar una OT externa';
        END IF;
        IF v_cost IS NULL THEN
            RAISE EXCEPTION 'El costo del servicio externo es obligatorio al cierre';
        END IF;
    END IF;

    -- Checklist: todos los ítems resueltos (si la OT tiene — preventivas M3)
    IF EXISTS (
        SELECT 1 FROM wo_checklist_entries
        WHERE wo_id = p_wo_id AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'Hay ítems de checklist pendientes';
    END IF;

    -- Garantía: sub-formulario V1.5 obligatorio si la respuesta es Sí
    IF p_generates_warranty THEN
        IF p_warranty IS NULL
           OR NULLIF(p_warranty->>'start_date', '') IS NULL
           OR NULLIF(p_warranty->>'end_date', '') IS NULL
           OR NULLIF(p_warranty->>'coverage', '') IS NULL THEN
            RAISE EXCEPTION 'Datos de garantía incompletos (fechas y cobertura son obligatorios)';
        END IF;
        v_w_start := (p_warranty->>'start_date')::DATE;
        v_w_end   := (p_warranty->>'end_date')::DATE;
        v_w_cover := p_warranty->>'coverage';
        IF v_w_cover NOT IN ('parts', 'labor', 'both') THEN
            RAISE EXCEPTION 'Cobertura de garantía inválida';
        END IF;
        IF v_w_end < v_w_start THEN
            RAISE EXCEPTION 'La fecha final debe ser mayor o igual a la inicial';
        END IF;
        v_w_prov      := COALESCE(NULLIF(p_warranty->>'provider_id', '')::UUID, v_provider);
        v_w_prov_name := COALESCE(NULLIF(p_warranty->>'provider_name', ''),
            (SELECT name FROM providers WHERE id = v_w_prov));
        v_w_notes := p_warranty->>'notes';
        v_w_doc   := COALESCE(p_warranty_document_path, NULLIF(p_warranty->>'document_path', ''));
    END IF;

    SELECT 'OT ' || v_wo.wo_number INTO v_label;

    PERFORM set_config('app.wo_rpc', '1', TRUE);
    PERFORM set_config('app.actor_user_id', v_actor::TEXT, TRUE);

    UPDATE work_orders
    SET status = 'closed', closed_at = now(), closed_by = v_actor,
        finished_at = COALESCE(finished_at, now()),
        diagnosis = p_diagnosis, solution = p_solution,
        executed_by_type = v_exec, provider_id = v_provider, external_cost = v_cost,
        affects_sale = COALESCE(p_affects_sale, affects_sale),
        generates_warranty = p_generates_warranty
    WHERE id = p_wo_id;

    -- Garantía create-or-edit (origin_wo_id UNIQUE — nunca duplicar; F1.5/M1)
    IF p_generates_warranty THEN
        SELECT id INTO v_warranty_id FROM warranties WHERE origin_wo_id = p_wo_id;
        IF v_warranty_id IS NOT NULL THEN
            UPDATE warranties
            SET start_date = v_w_start, end_date = v_w_end, coverage = v_w_cover,
                provider_id = v_w_prov, provider_name = v_w_prov_name,
                notes = v_w_notes, document_path = v_w_doc,
                status = CASE WHEN v_w_end >= CURRENT_DATE THEN 'active' ELSE 'expired' END
            WHERE id = v_warranty_id;
        ELSE
            INSERT INTO warranties (
                asset_id, warranty_type, provider_id, provider_name,
                start_date, end_date, coverage, notes, document_path,
                origin_wo_id, created_by
            ) VALUES (
                v_wo.asset_id, 'repair', v_w_prov, v_w_prov_name,
                v_w_start, v_w_end, v_w_cover, v_w_notes, v_w_doc,
                p_wo_id, v_actor
            ) RETURNING id INTO v_warranty_id;
        END IF;
    END IF;

    -- Evento 1 al cierre (dedup distinto al alta)
    IF COALESCE(p_affects_sale, v_wo.affects_sale) THEN
        PERFORM public.fn_notify(1, 'work_order', p_wo_id,
            'wo-close:' || p_wo_id,
            jsonb_build_object('wo_number', v_wo.wo_number, 'stage', 'close'));
    END IF;

    -- Contador de uso: +1 por OT cerrada si el activo lo usa (decisión de sesión)
    UPDATE assets
    SET usage_counter = coalesce(usage_counter, 0) + 1
    WHERE id = v_wo.asset_id AND has_usage_counter IS TRUE;

    -- Snapshot de cierre (M2.1: respuesta de garantía queda en auditoría)
    PERFORM public.fn_audit_row('work_orders', 'work_order', 'close',
        p_wo_id, v_label,
        jsonb_build_object(
            'generates_warranty', jsonb_build_object('old', v_wo.generates_warranty, 'new', p_generates_warranty),
            'warranty_id', jsonb_build_object('old', NULL, 'new', v_warranty_id),
            'executed_by_type', jsonb_build_object('old', v_wo.executed_by_type, 'new', v_exec),
            'provider_id', jsonb_build_object('old', v_wo.provider_id, 'new', v_provider),
            'external_cost', jsonb_build_object('old', v_wo.external_cost, 'new', v_cost)),
        NULL);

    PERFORM set_config('app.actor_user_id', '', TRUE);
    PERFORM set_config('app.wo_rpc', '', TRUE);

    RETURN jsonb_build_object(
        'wo_number', v_wo.wo_number,
        'closed_at', now(),
        'generates_warranty', p_generates_warranty,
        'warranty_id', v_warranty_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.m2_close_wo(UUID, TEXT, TEXT, UUID, TEXT, UUID, NUMERIC, BOOLEAN, BOOLEAN, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m2_close_wo(UUID, TEXT, TEXT, UUID, TEXT, UUID, NUMERIC, BOOLEAN, BOOLEAN, JSONB, TEXT) TO authenticated, service_role;

-- ============ Vista V2.1 — listado de OTs (security_invoker aplica RLS) ============
CREATE OR REPLACE VIEW public.v2_work_orders WITH (security_invoker = true) AS
WITH RECURSIVE loc_path AS (
    SELECT id, name::TEXT AS path FROM locations WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, p.path || ' / ' || c.name
    FROM locations c JOIN loc_path p ON c.parent_id = p.id
),
asset_loc AS (
    SELECT a.id AS asset_id, lp.path
    FROM assets a LEFT JOIN loc_path lp ON lp.id = a.location_id
),
wo_techs AS (
    SELECT wo_id,
           string_agg(u.full_name, ', ' ORDER BY wt.assigned_at) AS tech_names,
           count(*) AS tech_count
    FROM wo_technicians wt
    JOIN users u ON u.id = wt.user_id
    WHERE wt.removed_at IS NULL
    GROUP BY wo_id
)
SELECT
    wo.id, wo.wo_number, wo.asset_id, wo.component_id, wo.wo_type, wo.priority,
    wo.description, wo.origin, wo.damage_report_id,
    public.m2_dr_ref(wo.damage_report_id) AS damage_report_ref,
    wo.plan_id, wo.external_ref, wo.reported_by, wo.reported_at, wo.status,
    wo.scheduled_at, wo.assigned_at, wo.started_at, wo.finished_at,
    wo.closed_at, wo.closed_by, wo.affects_sale, wo.executed_by_type,
    wo.provider_id, public.m2_provider_name(wo.provider_id) AS provider_name,
    wo.external_cost, wo.generates_warranty, wo.reassigned,
    wo.diagnosis, wo.solution, wo.created_at, wo.updated_at,
    a.code AS asset_code, a.name AS asset_name, a.location_id,
    c2.code AS component_code, c2.name AS component_name,
    al.path AS location_path,
    c.name AS category_name,
    rb.full_name AS reported_by_name,
    cb.full_name AS closed_by_name,
    t.tech_names, t.tech_count,
    COALESCE(d.report_count, 0) > 1 AS multi_open
FROM work_orders wo
LEFT JOIN assets a   ON a.id = wo.asset_id
LEFT JOIN assets c2  ON c2.id = wo.component_id
LEFT JOIN asset_loc al ON al.asset_id = wo.asset_id
LEFT JOIN categories c ON c.id = a.category_id
LEFT JOIN users rb   ON rb.id = wo.reported_by
LEFT JOIN users cb   ON cb.id = wo.closed_by
LEFT JOIN wo_techs t ON t.wo_id = wo.id
LEFT JOIN LATERAL (
    SELECT count(*) AS report_count
    FROM work_orders w2
    WHERE w2.asset_id = wo.asset_id
      AND w2.status NOT IN ('closed', 'cancelled')
) AS d ON TRUE;

GRANT SELECT ON public.v2_work_orders TO authenticated, service_role;

-- ============ Vista V2.4 — bandeja de reportes de daño ============
CREATE OR REPLACE VIEW public.v2_damage_reports WITH (security_invoker = true) AS
WITH RECURSIVE loc_path AS (
    SELECT id, name::TEXT AS path FROM locations WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, p.path || ' / ' || c.name
    FROM locations c JOIN loc_path p ON c.parent_id = p.id
)
SELECT
    dr.id,
    public.m2_dr_ref(dr.id) AS report_ref,
    dr.asset_id, dr.component_id, dr.description, dr.reported_by, dr.reported_at,
    dr.status, dr.reviewed_by, dr.reviewed_at, dr.discarded_by, dr.discarded_at,
    dr.discard_reason, dr.origin, dr.external_ref, dr.created_at, dr.updated_at,
    a.code AS asset_code, a.name AS asset_name, a.category_id,
    c2.code AS component_code, c2.name AS component_name,
    lp.path AS location_path,
    cat.name AS category_name,
    rb.full_name AS reporter_name,
    wo.id AS wo_id, wo.wo_number
FROM damage_reports dr
LEFT JOIN assets a   ON a.id = dr.asset_id
LEFT JOIN assets c2  ON c2.id = dr.component_id
LEFT JOIN loc_path lp ON lp.id = a.location_id
LEFT JOIN categories cat ON cat.id = a.category_id
LEFT JOIN users rb    ON rb.id = dr.reported_by
LEFT JOIN work_orders wo ON wo.damage_report_id = dr.id;

GRANT SELECT ON public.v2_damage_reports TO authenticated, service_role;

-- ============ Vista V1.1 (recreada con badge "OTs abiertas") ============
-- Cross-flow Activo ↔ OT: conteo de OTs no cerradas del activo + sus
-- componentes + sus ancestros (una OT del padre con componente = este activo
-- también cuenta). Mismo contenido que la versión M1 + open_wo_count.
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
),
reach_asset AS (
    SELECT w.id AS wo_id, a.id AS hit_id, a.parent_id
    FROM work_orders w
    JOIN assets a ON a.id = w.asset_id
    WHERE w.status NOT IN ('closed', 'cancelled')
    UNION ALL
    SELECT r.wo_id, p.id, p.parent_id
    FROM reach_asset r
    JOIN assets p ON p.id = r.parent_id
),
reach_component AS (
    SELECT w.id AS wo_id, a.id AS hit_id, a.parent_id
    FROM work_orders w
    JOIN assets a ON a.id = w.component_id
    WHERE w.component_id IS NOT NULL
      AND w.status NOT IN ('closed', 'cancelled')
    UNION ALL
    SELECT r.wo_id, p.id, p.parent_id
    FROM reach_component r
    JOIN assets p ON p.id = r.parent_id
),
open_wo AS (
    SELECT hit_id AS id, COUNT(DISTINCT wo_id) AS open_wo_count
    FROM (
        SELECT wo_id, hit_id FROM reach_asset
        UNION
        SELECT wo_id, hit_id FROM reach_component
    ) x
    GROUP BY hit_id
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
         ) THEN true ELSE false END AS eol_reached,
    COALESCE(ow.open_wo_count, 0) AS open_wo_count      -- badge OTs abiertas (M2)
FROM assets a
LEFT JOIN categories c ON c.id = a.category_id
LEFT JOIN loc_path lp  ON lp.id = a.location_id
LEFT JOIN users u      ON u.id = a.responsible_user_id
LEFT JOIN wstat w      ON w.asset_id = a.id
LEFT JOIN open_wo ow   ON ow.id = a.id;

GRANT SELECT ON public.v1_assets TO authenticated, service_role;
