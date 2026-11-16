-- Limpieza de la fila de prueba usada para verificar trg_audit_log_immutable
-- (audit_log es append-only: el borrado requiere deshabilitar el trigger).
-- Idempotente.

BEGIN;

ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable;
DELETE FROM audit_log WHERE entity_type = 'trigger_test';
ALTER TABLE audit_log ENABLE TRIGGER trg_audit_log_immutable;

COMMIT;
