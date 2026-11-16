-- Limpieza de datos de prueba — solo quedan los seeds oficiales (decisión del usuario)
-- Backup previo (REST + auth.users): C:\Users\pbreg\AppData\Local\Temp\opencode\backup-limpieza
-- Idempotente: todos los DELETE son seguros de repetir.
--
-- Notas:
--  * audit_log, stock_movements, physical_counts y physical_count_items tienen
--    triggers BEFORE DELETE que bloquean el borrado (append-only / inmutables).
--    Se deshabilitan aquí y se re-habilitan al final.
--  * audit_log se vacía AL FINAL: los triggers AFTER DELETE de user_roles,
--    asset_files, wo_evidence y provider_files insertan filas nuevas.
--  * Orden FK crítico: stock_movements → physical_counts;
--    work_orders → maintenance_plans; wos → assets; certs → providers.
--  * Se conservan: categories (11), system_parameters (4), notification_config (12),
--    item_categories (6 semillas), compliance_categories (6), scheduled_reports (6),
--    locations 'Hotel', usuarios/roles del administrador y los buckets de storage.

BEGIN;

-- ============ 0. Deshabilitar triggers bloqueantes ============
ALTER TABLE audit_log             DISABLE TRIGGER trg_audit_log_immutable;
ALTER TABLE stock_movements       DISABLE TRIGGER trg_m4_kardex_immutable;
ALTER TABLE physical_counts       DISABLE TRIGGER trg_m4_count_guard;
ALTER TABLE physical_count_items  DISABLE TRIGGER trg_m4_count_items_guard;
-- Guard T1.5: "≥1 rol por usuario" — aborta al borrar los roles de los usuarios de prueba.
ALTER TABLE user_roles            DISABLE TRIGGER trg_user_roles_guard;

-- ============ 1. Logs de sistema ============
DELETE FROM report_send_log;
DELETE FROM notification_log;

-- ============ 2. Inventario (M4) ============
-- Orden: stock_movements referencia physical_counts(count_id) → kardex primero.
DELETE FROM stock_movements;
DELETE FROM physical_count_items;
DELETE FROM physical_counts;
DELETE FROM warehouse_stock;
DELETE FROM item_asset_links;
DELETE FROM item_category_links;
DELETE FROM items;
DELETE FROM warehouses;
DELETE FROM item_categories WHERE name = 'SmokeM4 Cat';  -- semillas: 6 restantes

-- ============ 3. Órdenes de trabajo (M2) ============
-- work_orders referencia maintenance_plans y assets → antes que ambos.
DELETE FROM wo_checklist_entries;
DELETE FROM wo_comments;
DELETE FROM wo_evidence;
DELETE FROM wo_technicians;
DELETE FROM work_orders;
DELETE FROM damage_reports;

-- ============ 4. Planes preventivos y checklists (M3) ============
DELETE FROM plan_asset_links;
DELETE FROM plan_category_links;
DELETE FROM maintenance_plans;
DELETE FROM checklist_item_items;
DELETE FROM checklist_items;
DELETE FROM checklist_templates;

-- ============ 5. Cumplimiento (M6) ============
-- certifications referencia providers → antes que proveedores.
DELETE FROM certification_history;
DELETE FROM measurement_records;
DELETE FROM certifications;
DELETE FROM measurement_types;

-- ============ 6. Proveedores y contratos (M5) ============
DELETE FROM provider_files;
DELETE FROM contracts;
DELETE FROM providers;

-- ============ 7. Activos (M1) ============
DELETE FROM warranties;
DELETE FROM asset_files;
DELETE FROM assets;

-- ============ 8. Contadores de código (FK → locations: antes que ubicaciones) ============
DELETE FROM code_counters;

-- ============ 9. Ubicaciones: todo salvo la raíz 'Hotel' ============
DELETE FROM locations
WHERE id IN (
    SELECT id FROM locations
    WHERE name <> 'Hotel'
    ORDER BY depth DESC   -- hijos antes que padres (self-FK parent_id)
);

-- ============ 10. Storage: NO se puede borrar por SQL (trigger de storage).
-- Se limpia aparte vía Storage API (service role) tras aplicar la migración.

-- ============ 11. Usuarios: solo 'Administrador Holy' ============
-- (antes que auth.users por la FK public.users → auth.users)
DELETE FROM push_subscriptions;                 -- 0 filas de test
DELETE FROM failed_logins;                      -- 0 filas de test
DELETE FROM user_category_assignments WHERE user_id <> '0217d325-b0e2-4ec4-a938-d4104c60c0c2';
DELETE FROM user_roles       WHERE user_id <> '0217d325-b0e2-4ec4-a938-d4104c60c0c2';
DELETE FROM user_dashboard_kpis WHERE user_id <> '0217d325-b0e2-4ec4-a938-d4104c60c0c2';
DELETE FROM public.users     WHERE id    <> '0217d325-b0e2-4ec4-a938-d4104c60c0c2';
DELETE FROM auth.users       WHERE id    <> '0217d325-b0e2-4ec4-a938-d4104c60c0c2';

-- ============ 12. audit_log al final (los triggers DELETE ya insertaron lo suyo) ============
DELETE FROM audit_log;

-- ============ 13. Re-habilitar triggers ============
ALTER TABLE audit_log             ENABLE TRIGGER trg_audit_log_immutable;
ALTER TABLE stock_movements       ENABLE TRIGGER trg_m4_kardex_immutable;
ALTER TABLE physical_counts       ENABLE TRIGGER trg_m4_count_guard;
ALTER TABLE physical_count_items  ENABLE TRIGGER trg_m4_count_items_guard;
ALTER TABLE user_roles            ENABLE TRIGGER trg_user_roles_guard;

COMMIT;
