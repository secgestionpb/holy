-- Fix M6: m6_renew_certification referenciaba v_certification_id (inexistente)
-- en el RETURN — debía ser p_certification_id. Rompía toda renovación (42703).

CREATE OR REPLACE FUNCTION public.m6_renew_certification(
    p_certification_id   UUID,
    p_issued_at          DATE,
    p_expires_at         DATE,
    p_document_path      TEXT,
    p_provider_id        UUID DEFAULT NULL,
    p_note               TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cert     RECORD;
    v_provider UUID;
BEGIN
    IF auth.uid() IS NOT NULL
       AND NOT (public.has_role('calidad') OR public.has_role('mantenimiento')) THEN
        RAISE EXCEPTION 'Requiere rol Calidad o Mantenimiento';
    END IF;
    IF p_expires_at IS NULL OR p_expires_at <= p_issued_at THEN
        RAISE EXCEPTION 'La fecha de vencimiento debe ser posterior a la emisión';
    END IF;

    SELECT * INTO v_cert FROM certifications WHERE id = p_certification_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Certificación no encontrada';
    END IF;

    -- Snapshot de la vigencia ACTUAL antes de cambiar (spec history)
    INSERT INTO certification_history (
        certification_id, issued_at, expires_at, responsible_provider_id,
        document_path, note, archived_by)
    VALUES (
        v_cert.id, COALESCE(v_cert.issued_at, v_cert.expires_at), v_cert.expires_at,
        v_cert.responsible_provider_id, v_cert.document_path,
        COALESCE(p_note, 'Renovación'), auth.uid());

    v_provider := COALESCE(p_provider_id, v_cert.responsible_provider_id);

    UPDATE certifications SET
        issued_at              = p_issued_at,
        expires_at             = p_expires_at,
        document_path          = p_document_path,
        responsible_provider_id = v_provider
    WHERE id = p_certification_id;

    RETURN jsonb_build_object('id', p_certification_id, 'expires_at', p_expires_at);
END;
$$;
