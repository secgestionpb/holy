# certifications (incluye certification_history)

> Módulo 6 — Cumplimiento Normativo. Certificaciones y obligaciones legales ante autoridades (distinto de garantías comerciales y contratos de servicio). Opción A de la spec: módulo INDEPENDIENTE del motor de Plan de Mantenimiento — NO genera OT automáticamente.
> Flujos: [F6.1](../06-cumplimiento-mediciones-flujos.md) (CRUD) · [F6.2](../06-cumplimiento-mediciones-flujos.md) (renovación con historial) · [F6.3](../06-cumplimiento-mediciones-flujos.md) (Evento 8) · vista [V6.2](../06-cumplimiento-mediciones-flujos.md).

```sql
CREATE TABLE certifications (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL,            -- nombre de la certificación/obligación
    asset_id                UUID REFERENCES assets(id),   -- activo vinculado; NULL = "General" (todo el hotel, ej. permiso de bomberos)
    compliance_category_id  UUID NOT NULL REFERENCES compliance_categories(id),  -- categoría normativa (catálogo CRUD M6)

    issuing_entity          TEXT,                     -- entidad emisora
    certificate_number      TEXT,                     -- número de certificado/permiso
    issued_at               DATE,                     -- fecha de emisión
    expires_at              DATE NOT NULL,            -- fecha de vencimiento
    renewal_period          TEXT CHECK (renewal_period IS NULL OR renewal_period IN
                            ('monthly','bimonthly','quarterly','semiannual','annual','other')),
                            -- periodicidad de renovación (ENUM — decisión de sesión; informativo)

    lead_days               INTEGER CHECK (lead_days IS NULL OR lead_days >= 0),
                            -- días de anticipación POR CERTIFICACIÓN (nullable → fallback a config global Evento 8 — spec)

    responsible_provider_id UUID REFERENCES providers(id),  -- contratista/entidad responsable de renovarlo (Módulo 5)
    document_path           TEXT,                     -- documento adjunto vigente (Storage bucket `documentos`, prefijo cumplimiento/)
    notes                   TEXT,                     -- observaciones

    is_active               BOOLEAN NOT NULL DEFAULT true,

    -- estado_calculado NO es columna: se DERIVA en consulta/vista (patrón contracts M5):
    --   Vencido    : current_date >  expires_at
    --   Por vencer : current_date >  expires_at − lead (lead = lead_days propio, o config global Evento 8)
    --   Vigente    : en otro caso

    -- Auditoría (patrón del sistema)
    created_by              UUID REFERENCES users(id),
    updated_by              UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (expires_at > issued_at)
);

CREATE INDEX idx_certifications_expires ON certifications (expires_at);   -- Evento 8 (F6.3)
CREATE INDEX idx_certifications_asset   ON certifications (asset_id);

-- Historial de vigencias (spec history): NO se sobrescribe el padre sin dejar rastro.
CREATE TABLE certification_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certification_id    UUID NOT NULL REFERENCES certifications(id),
    issued_at           DATE NOT NULL,               -- emisión de la VIGENCIA ARCHIVADA
    expires_at          DATE NOT NULL,               -- vencimiento de esa vigencia
    renewed_at          DATE NOT NULL DEFAULT current_date,  -- fecha en que se renovó
    responsible_provider_id UUID REFERENCES providers(id),
    document_path       TEXT,                        -- documento de esa vigencia (Storage bucket `documentos`, prefijo cumplimiento/)
    note                TEXT,                        -- nota de renovación
    archived_by         UUID REFERENCES users(id),
    archived_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cert_history_cert ON certification_history (certification_id, expires_at DESC);
```

## Reglas de negocio

- **Estado derivado** (Vigente | Por vencer | Vencido) — patrón `contracts` (M5); ventana de "Por vencer" = `lead_days` propio o **config global del Evento 8** (spec: "configurable por certificación/global").
- **Renovación (F6.2)**: acción "Renovar" → INSERT de la vigencia ACTUAL en `certification_history` → UPDATE del padre. El historial acumula emisiones/vencimientos/renovaciones → **auditar períodos sin certificado vigente** (spec: el hueco = `vencimiento anterior → nueva emisión`).
- **Evento 8** (F6.3): AVISO ÚNICO (no escalonado ni diario) por certificación **por vigencia** (dedup vía notification_log); renovar resetea el dedup; los Vencidos no reenvían.
- **Sin automatismo de OT** (spec Opción A): coordinar renovación = manual (Mantenimiento coordina contratista/crea OT si aplica).
- **Permisos** (spec): Calidad CRUD completo · Mantenimiento solo "Renovar" (renovación operativa) + lectura · Administrador lectura · Técnico sin acceso.
- Sin borrado físico: `is_active = false` (patrón del sistema).

## Relaciones

- **[assets](assets.md)**: `asset_id` FK opcional (M1 enlaza lectura desde la ficha).
- **[providers](providers.md)**: responsable de la renovación (M5).
- **[compliance_categories](compliance_categories.md)**: categoría normativa (CRUD M6).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Calidad | SELECT/INSERT/UPDATE + inactivar (CRUD completo — spec) |
| Mantenimiento | SELECT + UPDATE SOLO vía acción "Renovar" (no crea/edita catálogo) |
| Administrador | SELECT |
| Técnico | Sin acceso |
