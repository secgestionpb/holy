# damage_reports

> Módulo 2 — Reporte de Daño. Entidad previa e independiente de la OT formal.
> Flujos: F2.1 (alta), F2.2 (revisión) / Vistas: V2.4 (bandeja), V2.5 (formulario) — [02-ordenes-de-trabajo-flujos.md](../02-ordenes-de-trabajo-flujos.md)

```sql
CREATE TABLE damage_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NULL REFERENCES assets(id),
                    -- nullable: el reporte interno ya NO pide activo; se
                    -- reporta solo la localización en texto libre. Se conserva
                    -- para reportes que sí refieren un activo del catálogo
                    -- (histórico y origen externo).
    component_id    UUID NULL REFERENCES assets(id),
    description     TEXT NOT NULL,             -- descripción del daño (obligatoria)
    location        TEXT NULL,                 -- localización en texto libre
                    -- (obligatoria cuando asset_id es NULL → CHECK
                    -- dr_asset_or_location). Ej.: "Piso 3, habitación 312 — A/C".
    reported_by     UUID NOT NULL REFERENCES users(id),
                    -- Técnico | Mantenimiento | Calidad (NO Administrador)
    reported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN
                      ('pending_review','converted','discarded')),
                    -- Pendiente de revisión | Convertido a OT | Descartado
                    -- (baja lógica: nunca se borra, queda como registro histórico)
    reviewed_by     UUID NULL REFERENCES users(id),   -- Mantenimiento
    reviewed_at     TIMESTAMPTZ NULL,
    discarded_by    UUID NULL REFERENCES users(id),
    discarded_at    TIMESTAMPTZ NULL,
    discard_reason  TEXT NULL,                 -- motivo OBLIGATORIO si se descarta
    origin          TEXT NOT NULL DEFAULT 'internal' CHECK (origin IN
                      ('internal','external_app')),
                    -- Formulario interno | App externa (futuro, vía API)
    external_ref    TEXT NULL,                 -- N° de referencia externo (futuro)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()   -- trigger global
);

CREATE INDEX idx_dr_status     ON damage_reports(status, reported_at DESC);
CREATE INDEX idx_dr_asset      ON damage_reports(asset_id);
CREATE INDEX idx_dr_reporter   ON damage_reports(reported_by, reported_at DESC);

-- Cada reporte debe tener activo (histórico/externo) O localización escrita.
ALTER TABLE damage_reports ADD CONSTRAINT dr_asset_or_location
    CHECK (asset_id IS NOT NULL OR NULLIF(btrim(location), '') IS NOT NULL);
-- Enlace convertido → OT: NO hay columna aquí; vive en
-- work_orders.damage_report_id (UNIQUE) — decisión de diseño para evitar
-- FK circular. La bandeja resuelve "Ver OT" con:
--   SELECT id FROM work_orders WHERE damage_report_id = damage_reports.id
```

## Reglas y notas

- **Ciclo**: alta (F2.1, Evento 5 correo inmediato) → Mantenimiento revisa (F2.2): *Convertir* (abre V2.2 con herencia → OT con `origin='damage_report'`) o *Descartar* (motivo obligatorio).
- **Formulario (F2.1)**: pide Descripción + Localización (texto libre, obligatoria) + evidencia opcional. **NO pide activo** (`asset_id` es NULL en el alta interna).
- **Conversión a OT (F2.2)**: si el reporte trajo activo, se hereda (solo lectura). Si no, el técnico elige el activo en V2.2 (el RPC `m2_create_wo` solo exige coincidencia cuando el reporte tiene activo).
- **Auditoría/notificación**: registran `location` además de `asset_id`.
- **Permisos**: INSERT = Técnico/Mantenimiento/Calidad (Admin NO — matriz T1); revisión (UPDATE de estado) = solo Mantenimiento; SELECT: los 4 roles (Técnico/Calidad ven solo los suyos por UI; Admin solo lectura — decisión de sesión).
- **Evidencia fotográfica**: tabla única `wo_evidence` con `damage_report_id` (FKs mutuamente excluyentes).
- **Borrado físico prohibido** — los descartados conservan fecha, motivo y quién.
- **Auditoría**: Crear (alta), Modificar (Pendiente → Convertido/Descartado con motivo) — entidad "Reporte de daño #N" (T3).
