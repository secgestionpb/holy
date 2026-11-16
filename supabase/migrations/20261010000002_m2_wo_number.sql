-- Migración 7 — M2 fix: número de OT autogenerado también en INSERT directo
-- (spec V2.2 save_actions: "INSERT (RLS) → número autogenerado por la
-- secuencia"). La RPC m2_create_wo ya lo genera; este trigger cubre inserts
-- directos (Mantenimiento vía REST y futuro motor M3 con service role).
CREATE OR REPLACE FUNCTION public.fn_wo_number() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.wo_number IS NULL OR NEW.wo_number = '' THEN
        NEW.wo_number := 'OT-' || lpad(nextval('work_orders_number_seq')::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wo_number
    BEFORE INSERT ON work_orders
    FOR EACH ROW EXECUTE FUNCTION public.fn_wo_number();
