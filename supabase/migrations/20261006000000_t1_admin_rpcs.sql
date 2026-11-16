-- Migración 3 — Backbone T1/T3: RPC fn_audit + operaciones atómicas de admin-users
-- Fuente: T3-flujos decisión T3.2b (fn_audit solo service role), T1-flujos F-T1.1/F-T1.2/F-T1.3.
-- Patrón de actor: las RPC fijan app.actor_user_id (txn-local) para que los TRIGGERS
-- existentes (fn_audit_user_roles, fn_audit_system_parameters) registren al Admin actuante
-- aunque la escritura venga de la Edge Function con service role.

-- ============ fn_audit (RPC semántica — T3.2b) ============
CREATE OR REPLACE FUNCTION public.fn_audit(
    p_module        TEXT,
    p_entity_type   TEXT,
    p_action        TEXT,
    p_entity_id     UUID DEFAULT NULL,
    p_entity_label  TEXT DEFAULT NULL,
    p_changes       JSONB DEFAULT NULL,
    p_reason        TEXT DEFAULT NULL,
    p_user_id       UUID DEFAULT NULL,
    p_ip_address    TEXT DEFAULT NULL,
    p_user_agent    TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO audit_log
        (user_id, module, entity_type, entity_id, entity_label,
         action, changes, reason, ip_address, user_agent)
    VALUES
        (COALESCE(p_user_id,
                  NULLIF(current_setting('app.actor_user_id', TRUE), '')::UUID,
                  auth.uid()),
         p_module, p_entity_type, p_entity_id, p_entity_label,
         p_action, p_changes, p_reason, p_ip_address, p_user_agent)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_audit(TEXT, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_audit(TEXT, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, UUID, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit(TEXT, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, UUID, TEXT, TEXT) TO service_role;

-- ============ admin_create_user (F-T1.1 — alta atómica) ============
CREATE OR REPLACE FUNCTION public.admin_create_user(
    p_id            UUID,
    p_email         TEXT,
    p_full_name     TEXT,
    p_phone         TEXT,
    p_hourly_rate   NUMERIC,
    p_roles         JSONB,
    p_category_ids  JSONB,
    p_actor         UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_role TEXT;
    v_snapshot JSONB;
BEGIN
    PERFORM set_config('app.actor_user_id', p_actor::TEXT, TRUE);

    INSERT INTO public.users
        (id, full_name, email, phone, hourly_rate,
         is_active, must_change_password, created_by, updated_by)
    VALUES
        (p_id, p_full_name, p_email, p_phone, p_hourly_rate,
         TRUE, TRUE, p_actor, p_actor);

    FOR v_role IN SELECT jsonb_array_elements_text(p_roles) LOOP
        INSERT INTO public.user_roles (user_id, role, assigned_by)
        VALUES (p_id, v_role, p_actor);
    END LOOP;

    IF p_category_ids IS NOT NULL AND jsonb_array_length(p_category_ids) > 0 THEN
        INSERT INTO public.user_category_assignments (user_id, category_id, assigned_by)
        SELECT p_id, x.value::UUID, p_actor
        FROM jsonb_array_elements_text(p_category_ids) AS x(value)
        ON CONFLICT DO NOTHING;
    END IF;

    v_snapshot := jsonb_build_object(
        'full_name', jsonb_build_object('old', NULL, 'new', p_full_name),
        'email',     jsonb_build_object('old', NULL, 'new', p_email),
        'phone',     jsonb_build_object('old', NULL, 'new', p_phone),
        'hourly_rate', jsonb_build_object('old', NULL, 'new', p_hourly_rate),
        'is_active', jsonb_build_object('old', NULL, 'new', TRUE),
        'roles',     jsonb_build_object('old', NULL, 'new', p_roles)
    );
    PERFORM public.fn_audit('users', 'user', 'create', p_id, p_email, v_snapshot, NULL, p_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user(UUID, TEXT, TEXT, TEXT, NUMERIC, JSONB, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_user(UUID, TEXT, TEXT, TEXT, NUMERIC, JSONB, JSONB, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_user(UUID, TEXT, TEXT, TEXT, NUMERIC, JSONB, JSONB, UUID) TO service_role;

-- ============ admin_update_user (F-T1.1 — edición + sync N:N + guards T1.5) ============
CREATE OR REPLACE FUNCTION public.admin_update_user(
    p_user_id       UUID,
    p_email         TEXT,
    p_full_name     TEXT,
    p_phone         TEXT,
    p_hourly_rate   NUMERIC,
    p_is_active     BOOLEAN,
    p_avatar_path   TEXT,
    p_roles         JSONB,
    p_category_ids  JSONB,
    p_actor         UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_old      public.users%ROWTYPE;
    v_role     TEXT;
    v_changes  JSONB := '{}'::JSONB;
    v_action   TEXT := 'update';
    v_old_cats JSONB;
    v_new_cats JSONB;
BEGIN
    PERFORM set_config('app.actor_user_id', p_actor::TEXT, TRUE);

    SELECT * INTO v_old FROM public.users WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario inexistente';
    END IF;

    IF p_actor = p_user_id AND p_is_active = FALSE AND v_old.is_active = TRUE THEN
        RAISE EXCEPTION 'Guard T1.5: no puedes desactivar tu propia cuenta';
    END IF;

    IF jsonb_array_length(p_roles) = 0 THEN
        RAISE EXCEPTION 'Guard T1.5: un usuario no puede quedarse sin roles (baje con is_active = false)';
    END IF;

    IF v_old.email IS DISTINCT FROM p_email THEN
        v_changes := v_changes || jsonb_build_object('email', jsonb_build_object('old', v_old.email, 'new', p_email));
    END IF;
    IF v_old.full_name IS DISTINCT FROM p_full_name THEN
        v_changes := v_changes || jsonb_build_object('full_name', jsonb_build_object('old', v_old.full_name, 'new', p_full_name));
    END IF;
    IF v_old.phone IS DISTINCT FROM p_phone THEN
        v_changes := v_changes || jsonb_build_object('phone', jsonb_build_object('old', v_old.phone, 'new', p_phone));
    END IF;
    IF v_old.hourly_rate IS DISTINCT FROM p_hourly_rate THEN
        v_changes := v_changes || jsonb_build_object('hourly_rate', jsonb_build_object('old', v_old.hourly_rate, 'new', p_hourly_rate));
    END IF;
    IF v_old.avatar_path IS DISTINCT FROM p_avatar_path THEN
        v_changes := v_changes || jsonb_build_object('avatar_path', jsonb_build_object('old', v_old.avatar_path, 'new', p_avatar_path));
    END IF;
    IF v_old.is_active IS DISTINCT FROM p_is_active THEN
        v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('old', v_old.is_active, 'new', p_is_active));
        IF v_old.is_active = TRUE AND p_is_active = FALSE THEN
            v_action := 'deactivate';
        END IF;
    END IF;

    UPDATE public.users SET
        email = p_email,
        full_name = p_full_name,
        phone = p_phone,
        hourly_rate = p_hourly_rate,
        is_active = p_is_active,
        avatar_path = p_avatar_path,
        updated_by = p_actor
    WHERE id = p_user_id;

    FOR v_role IN SELECT jsonb_array_elements_text(p_roles) LOOP
        INSERT INTO public.user_roles (user_id, role, assigned_by)
        VALUES (p_user_id, v_role, p_actor)
        ON CONFLICT DO NOTHING;
    END LOOP;

    DELETE FROM public.user_roles
    WHERE user_id = p_user_id
      AND NOT (role IN (SELECT jsonb_array_elements_text(p_roles)));

    SELECT COALESCE(jsonb_agg(category_id ORDER BY category_id), '[]'::JSONB)
    INTO v_old_cats
    FROM public.user_category_assignments WHERE user_id = p_user_id;

    DELETE FROM public.user_category_assignments WHERE user_id = p_user_id;

    IF p_category_ids IS NOT NULL AND jsonb_array_length(p_category_ids) > 0 THEN
        INSERT INTO public.user_category_assignments (user_id, category_id, assigned_by)
        SELECT p_user_id, x.value::UUID, p_actor
        FROM jsonb_array_elements_text(p_category_ids) AS x(value)
        ON CONFLICT DO NOTHING;
    END IF;

    SELECT COALESCE(jsonb_agg(category_id ORDER BY category_id), '[]'::JSONB)
    INTO v_new_cats
    FROM public.user_category_assignments WHERE user_id = p_user_id;

    IF v_old_cats IS DISTINCT FROM v_new_cats THEN
        v_changes := v_changes || jsonb_build_object(
            'categories', jsonb_build_object('old', v_old_cats, 'new', v_new_cats));
    END IF;

    IF v_changes <> '{}'::JSONB THEN
        PERFORM public.fn_audit('users', 'user', v_action, p_user_id, p_email, v_changes, NULL, p_actor);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user(UUID, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, JSONB, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_user(UUID, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, JSONB, JSONB, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(UUID, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, JSONB, JSONB, UUID) TO service_role;

-- ============ admin_password_event (F-T1.2 reset / F-T1.3 cambio propio) ============
CREATE OR REPLACE FUNCTION public.admin_password_event(
    p_user_id     UUID,
    p_must_change BOOLEAN,
    p_event       TEXT,           -- 'password_reset' | 'update'
    p_reason      TEXT,
    p_actor       UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_email TEXT;
    v_old_flag BOOLEAN;
BEGIN
    PERFORM set_config('app.actor_user_id', p_actor::TEXT, TRUE);

    SELECT email, must_change_password INTO v_email, v_old_flag
    FROM public.users WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario inexistente';
    END IF;

    UPDATE public.users
    SET must_change_password = p_must_change, updated_by = p_actor
    WHERE id = p_user_id;

    IF p_event = 'password_reset' THEN
        -- spec F-T1.2: user_id = usuario reseteado
        PERFORM public.fn_audit('users', 'user', 'password_reset', p_user_id, v_email,
                                NULL, p_reason, p_user_id);
    ELSE
        PERFORM public.fn_audit('users', 'user', 'update', p_user_id, v_email,
                                jsonb_build_object('must_change_password',
                                    jsonb_build_object('old', v_old_flag, 'new', p_must_change)),
                                NULL, p_actor);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_password_event(UUID, BOOLEAN, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_password_event(UUID, BOOLEAN, TEXT, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_password_event(UUID, BOOLEAN, TEXT, TEXT, UUID) TO service_role;

-- ============ Corrección de actores en triggers existentes ============
CREATE OR REPLACE FUNCTION public.fn_audit_user_roles() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid     UUID := COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), '')::UUID, auth.uid());
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

CREATE OR REPLACE FUNCTION public.fn_audit_system_parameters() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.value IS DISTINCT FROM OLD.value THEN
        INSERT INTO public.audit_log
            (user_id, module, entity_type, entity_id, entity_label, action, changes)
        VALUES
            (COALESCE(NULLIF(current_setting('app.actor_user_id', TRUE), '')::UUID, auth.uid()),
             'configuration', 'system_parameter', NULL, OLD.key, 'update',
             jsonb_build_object('value', jsonb_build_object('old', OLD.value, 'new', NEW.value)));
    END IF;
    RETURN NEW;
END;
$$;

-- ============ Storage: escritura de avatares por Admin (T1: "escritura solo con sesión Admin") ============
CREATE POLICY "usuarios_insert_admin" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'usuarios' AND public.is_admin());

CREATE POLICY "usuarios_update_admin" ON storage.objects
    FOR UPDATE TO authenticated
    WITH CHECK (bucket_id = 'usuarios' AND public.is_admin());

CREATE POLICY "usuarios_delete_admin" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'usuarios' AND public.is_admin());
