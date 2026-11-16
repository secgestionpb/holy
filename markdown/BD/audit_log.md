# audit_log

> Módulo T3 — Log de Auditoría (tabla compartida; el Módulo 1 escribe vía triggers).
> Retención indefinida, inmutable, vista general solo Administrador; vista embebida por entidad en pestañas "Historial".
> Flujos: [F-T3.1](../T3-log-auditoria-flujos.md) (registro), [F-T3.2](../T3-log-auditoria-flujos.md) (listado general), [F-T3.3](../T3-log-auditoria-flujos.md) (timeline embebida) · [01-gestion-de-activos-flujos.md](../01-gestion-de-activos-flujos.md)

```sql
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
    action          TEXT NOT NULL CHECK (action IN
                      ('create','update','state_change','deactivate',
                       'close','reopen','reassign','import',
                       'password_reset','count_confirm',...)),
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
```

## Reglas y notas

- **Poblada por TRIGGERS PG** (no por el cliente): el front nunca puede falsear el log.
- **Sin `updated_at`**; **UPDATE y DELETE prohibidos para TODOS los roles** (RLS) — incluido Administrador.
- **Usuario sin distinguir rol** actuado (aunque tenga multi-rol).
- Eventos del Módulo 1: creación/modificación de activos (campo anterior → nuevo), cambio de estado operativo y etapa de vida, baja, CRUD de categorías y ubicaciones, creación/edición de garantías, documentos, importación masiva (entrada consolidada).
- Las **dos vistas**: listado general (solo Admin, filtros + export PDF/Excel) y línea de tiempo embebida por entidad (pestaña Historial de V1.3 — misma fuente, filtrada).
