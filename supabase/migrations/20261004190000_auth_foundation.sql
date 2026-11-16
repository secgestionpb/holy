-- Migración 1 — Fundación Auth (T1)
-- Fuente de verdad: markdown/BD/{users,user_roles,failed_logins,audit_log,system_parameters}.md
-- (user_category_assignments/code_counters quedan fuera: dependen de categories/locations del M1)

-- ============ users (BD/users.md) ============
CREATE TABLE public.users (
    id                  UUID PRIMARY KEY REFERENCES auth.users (id),
                      -- = auth.users.id (Supabase Auth — el FK a auth.users
                      -- se crea como FK del esquema auth; sin DEFAULT propio)
    full_name           TEXT NOT NULL,
    email               TEXT NOT NULL UNIQUE,     -- identificador de login
    phone               TEXT NULL,                -- futuro WhatsApp (spec)
    avatar_path         TEXT NULL,                -- ruta en bucket `usuarios`
    is_active           BOOLEAN NOT NULL DEFAULT true,
                        -- nunca se elimina un usuario con historial (spec)
    must_change_password BOOLEAN NOT NULL DEFAULT false,
                        -- true en alta inicial y tras reset (F-T1.2/F-T1.3)
    last_sign_in_at     TIMESTAMPTZ NULL,
    hourly_rate         NUMERIC(10,2) NULL
                        CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
                        -- tarifa/h (M7 decisión 7.4; NULL = tarifa global
                        -- system_parameters.labor_hourly_rate)
    created_by          UUID NULL REFERENCES public.users (id),
    updated_by          UUID NULL REFERENCES public.users (id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ user_roles (BD/user_roles.md) ============
CREATE TABLE public.user_roles (
    user_id     UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN
                  ('mantenimiento','tecnico','administrador','calidad')),
                  -- catálogo FIJO de 4 roles (spec roles_catalog)
    assigned_by UUID NULL REFERENCES public.users (id),    -- quién asignó (Admin)
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, role)
);

CREATE INDEX idx_user_roles_role ON public.user_roles (role);

-- Guards T1.5 (decisión T1.5): ≥1 rol por usuario (la baja es is_active=false)
-- y ≥1 Administrador activo en todo momento.
CREATE OR REPLACE FUNCTION public.fn_user_roles_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_target  UUID;
    v_remaining INTEGER;
BEGIN
    v_target := COALESCE(NEW.user_id, OLD.user_id);

    SELECT COUNT(*) INTO v_remaining
    FROM public.user_roles WHERE user_id = v_target;
    IF v_remaining = 0 THEN
        RAISE EXCEPTION 'Guard T1.5: un usuario no puede quedarse sin roles (baje con is_active = false)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.users u ON u.id = ur.user_id
        WHERE ur.role = 'administrador' AND u.is_active
    ) THEN
        RAISE EXCEPTION 'Guard T1.5: debe existir al menos un Administrador activo';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_user_roles_guard
    AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
    FOR EACH ROW EXECUTE FUNCTION public.fn_user_roles_guard();

-- ============ failed_logins (BD/failed_logins.md) ============
CREATE TABLE failed_logins (
    email           TEXT PRIMARY KEY,        -- correo intentado (lowercase)
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until    TIMESTAMPTZ NULL         -- last_attempt_at + lockout_minutes
                    -- (NULL = no bloqueado)
);

CREATE INDEX idx_failed_logins_locked ON failed_logins (locked_until)
    WHERE locked_until IS NOT NULL;

-- ============ audit_log (BD/audit_log.md) ============
CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                    -- precisión de segundos
    user_id         UUID NULL,                -- FK → users; NULL = sistema
                    -- (motor de garantías, pg_cron, importación masiva)
    module          TEXT NOT NULL CHECK (module IN
                      ('assets','work_orders','damage_reports','inventory',
                       'warranties','providers','preventive_maintenance',
                       'compliance','measurements','users','configuration')),
    entity_type     TEXT NOT NULL,             -- 'asset','location','category',
                    -- 'warranty','asset_file','user',...
    entity_id       UUID NULL,
    entity_label    TEXT NULL,                 -- "Activo HVAC-305-001",
                    -- "Ubicación Pasillo Piso 1", "OT #1842"
    action          TEXT NOT NULL,
                    -- lista base de la spec: create, update, state_change,
                    -- deactivate, close, reopen, reassign, import,
                    -- password_reset, count_confirm, ... (la spec abre la
                    -- lista con '...' — cada módulo aporta las suyas)
    changes         JSONB NULL,                -- {"field":{"old":..,"new":..}}
    reason          TEXT NULL,                 -- motivo obligatorio cuando
                    -- el evento lo exige (bajas, reubicaciones, importación)
    ip_address      TEXT NULL,
    user_agent      TEXT NULL
);

CREATE INDEX idx_audit_entity  ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_user    ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_module  ON audit_log(module, created_at DESC);
CREATE INDEX idx_audit_date    ON audit_log(created_at DESC);

-- Inmutable (spec: UPDATE y DELETE prohibidos para TODOS los roles, incl. Admin)
CREATE OR REPLACE FUNCTION public.fn_audit_log_immutable() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log es inmutable (append-only): % prohibido en audit_log', TG_OP;
END;
$$;

CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_immutable();

-- Audit de cambios de roles (user_roles.md: "cada cambio genera audit_log";
-- audit_log.md: "Poblada por TRIGGERS PG — el front nunca puede falsear el log")
CREATE OR REPLACE FUNCTION public.fn_audit_user_roles() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid     UUID := auth.uid();               -- NULL = sistema (service role)
    v_email   TEXT;
    v_changes JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT email INTO v_email FROM public.users WHERE id = NEW.user_id;
        v_changes := jsonb_build_object('role', jsonb_build_object('old', NULL, 'new', NEW.role));
    ELSIF TG_OP = 'DELETE' THEN
        SELECT email INTO v_email FROM public.users WHERE id = OLD.user_id;
        v_changes := jsonb_build_object('role', jsonb_build_object('old', OLD.role, 'new', NULL));
    END IF;

    INSERT INTO public.audit_log
        (user_id, module, entity_type, entity_id, entity_label, action, changes)
    VALUES
        (v_uid, 'users', 'user_role', COALESCE(NEW.user_id, OLD.user_id),
         v_email, 'update', v_changes);

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_user_roles
    AFTER INSERT OR DELETE ON public.user_roles
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_user_roles();

-- ============ system_parameters (BD/system_parameters.md) ============
CREATE TABLE system_parameters (
    key         TEXT PRIMARY KEY,          -- nombre estable del parámetro
                -- ej. 'labor_hourly_rate'
    value       TEXT NOT NULL,             -- valor en texto (cast en uso:
                -- NUMERIC/INTEGER/BOOLEAN según key)
    description TEXT,                      -- qué es / unidad (para la UI T2)
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Semillas:
INSERT INTO system_parameters (key, value, description) VALUES
  ('labor_hourly_rate', '0',
   'Tarifa global por hora de mano de obra (fallback cuando users.hourly_rate es NULL)'),
  ('dias_anticipacion_garantia', '0',
   'Días de anticipación del Evento 7 — campo GLOBAL único (spec T2 Parámetros generales)'),
  ('login_attempts', '5',
   'Intentos fallidos de login antes de bloquear la cuenta (lockout custom — failed_logins)'),
  ('lockout_minutes', '15',
   'Duración del bloqueo temporal por intentos fallidos, en minutos');

CREATE TRIGGER system_parameters_set_updated_at
    BEFORE UPDATE ON public.system_parameters
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Audit T2 (system_parameters.md: cambios = audit_log module configuration)
CREATE OR REPLACE FUNCTION public.fn_audit_system_parameters() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.value IS DISTINCT FROM OLD.value THEN
        INSERT INTO public.audit_log
            (user_id, module, entity_type, entity_id, entity_label, action, changes)
        VALUES
            (auth.uid(), 'configuration', 'system_parameter', NULL, OLD.key, 'update',
             jsonb_build_object('value', jsonb_build_object('old', OLD.value, 'new', NEW.value)));
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_system_parameters
    AFTER UPDATE ON public.system_parameters
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_system_parameters();

-- ============ Helpers RLS (referenciados en user_roles.md / T1 flujos F-T1.4) ============
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.users u ON u.id = ur.user_id
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'administrador'
          AND u.is_active
    );
$$;

CREATE OR REPLACE FUNCTION public.has_role(p_role TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.users u ON u.id = ur.user_id
        WHERE ur.user_id = auth.uid()
          AND ur.role = p_role
          AND u.is_active
    );
$$;

-- ============ RLS ============
-- users: Admin SELECT/UPDATE (INSERT/DELETE solo service role admin-users);
--        demás roles SELECT; UPDATE solo de la propia fila (avatar/datos menores)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_authenticated ON public.users
    FOR SELECT TO authenticated USING (true);

CREATE POLICY users_update_admin ON public.users
    FOR UPDATE TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY users_update_own ON public.users
    FOR UPDATE TO authenticated
    USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- user_roles: SELECT para todos (resuelven su unión de permisos);
--             escritura solo service role (admin-users)
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_roles_select_authenticated ON public.user_roles
    FOR SELECT TO authenticated USING (true);

-- failed_logins: sin policies — único escritor/lector la Edge Function login-custom
ALTER TABLE failed_logins ENABLE ROW LEVEL SECURITY;

-- audit_log: SELECT para todos (vista embebida por entidad); la vista general
--            se gatea con is_admin() en app (F-T3.2); escritura solo triggers
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select_authenticated ON audit_log
    FOR SELECT TO authenticated USING (true);

-- system_parameters: Admin SELECT/UPDATE; demás roles SELECT (T2)
ALTER TABLE public.system_parameters ENABLE ROW LEVEL SECURITY;

CREATE POLICY system_parameters_select_authenticated ON public.system_parameters
    FOR SELECT TO authenticated USING (true);

CREATE POLICY system_parameters_update_admin ON public.system_parameters
    FOR UPDATE TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============ Bucket `usuarios` (avatar — users.avatar_path) ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('usuarios', 'usuarios', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "usuarios_select" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'usuarios');

CREATE POLICY "usuarios_insert_own" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'usuarios' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "usuarios_update_own" ON storage.objects
    FOR UPDATE TO authenticated
    WITH CHECK (bucket_id = 'usuarios' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "usuarios_delete_own" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'usuarios' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============ Limpieza anti-crecimiento (failed_logins.md) ============
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule('cleanup_failed_logins', '17 3 * * *',
    $cron$
    DELETE FROM public.failed_logins
    WHERE last_attempt_at < now() - INTERVAL '24 hours'
      AND (locked_until IS NULL OR locked_until < now())
    $cron$);
