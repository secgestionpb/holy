-- Migración 7b — Módulo 4: quitar fila de stock vacía desde V4.2
-- La spec V4.2 ("Stock por bodega") incluye la acción "quitar" por fila.
-- RLS de warehouse_stock no tenía policy DELETE (04-flujos <rls_policy>:
-- "DELETE prohibido — kardex inmutable"), pero borrar una fila con qty = 0
-- NO toca el kardex (stock_movements no tiene FK a warehouse_stock) ni
-- rompe consistencia: es deshacer una pre-alta de mínimo sin existencias.
-- Filas con qty ≠ 0 siguen siendo inborrables (repara con movimientos).
-- Trigger fn_m4_stock_guard es BEFORE INSERT OR UPDATE: no interviene.

CREATE POLICY warehouse_stock_delete_mantenimiento ON warehouse_stock
    FOR DELETE TO authenticated
    USING (public.has_role('mantenimiento') AND qty = 0);
