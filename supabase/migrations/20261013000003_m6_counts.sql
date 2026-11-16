-- Migración M6 (3) — Conteo de registros por tipo de medición (columna "# de
-- registros" de V6.1-Mediciones-Tipos): agregado en BD, no en el front.

CREATE OR REPLACE FUNCTION public.m6_type_record_counts()
RETURNS TABLE (measurement_type_id UUID, n BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT measurement_type_id, COUNT(*)
    FROM public.measurement_records
    GROUP BY measurement_type_id
$$;

REVOKE ALL ON FUNCTION public.m6_type_record_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m6_type_record_counts() TO authenticated, service_role;
