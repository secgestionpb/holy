# providers (incluye provider_files)

> Módulo 5 — Proveedores y Contratistas Externos. Catálogo ÚNICO para ambos tipos (un mismo tercero puede ser proveedor de materiales, contratista de servicio o ambos — spec `catalog.single_table`).
> Flujos: [F5.1](../05-proveedores-contratistas-flujos.md) (CRUD + documentos), [F5.3](../05-proveedores-contratistas-flujos.md) (historial vía work_orders), [F5.4](../05-proveedores-contratistas-flujos.md) (garantía preseleccionada).

```sql
CREATE TABLE providers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                TEXT NOT NULL UNIQUE,        -- "PRO-0042" autogenerado editable (code_counters)
    name                TEXT NOT NULL,               -- nombre / razón social
    provider_type       TEXT NOT NULL CHECK (provider_type IN
                          ('supplier','contractor','both')),
                        -- Proveedor de materiales | Contratista de servicio | Ambos (spec)

    service_category_id UUID REFERENCES categories(id),
                        -- categoría de servicio vinculada al árbol de categorías de ACTIVO (Módulo 1) — spec

    contact_name        TEXT,                        -- contacto principal
    contact_phone       TEXT,
    contact_email       TEXT,
    address             TEXT,
    notes               TEXT,                        -- observaciones (spec)

    is_active           BOOLEAN NOT NULL DEFAULT true,

    -- Auditoría (patrón del sistema)
    created_by          UUID REFERENCES users(id),
    updated_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_providers_type    ON providers (provider_type);
CREATE INDEX idx_providers_active  ON providers (is_active) WHERE is_active;

-- Documentos (spec: "contrato marco, certificaciones de la empresa, pólizas"):
CREATE TABLE provider_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id),
    doc_type    TEXT NOT NULL CHECK (doc_type IN
                  ('contract','certification','policy','other')),
                -- Contrato marco | Certificación | Póliza | Otro
    path        TEXT NOT NULL,                       -- Storage (bucket `documentos`, prefijo proveedores/)
    original_name TEXT,
    uploaded_by UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_files_provider ON provider_files (provider_id);
```

## Reglas de negocio

- **Código**: autogenerado `PRO-####` vía [code_counters](code_counters.md) (fila `prefix='PRO'`, `location_id = NULL` — decisión de sesión, mismo patrón que activos e ítems).
- **Categoría de servicio**: FK ÚNICA a [categories](categories.md) (M1) — el proveedor se especializa en una categoría (spec: ej. contratista de "Elevadores/Verticales").
- **Documentos** en `provider_files` + Storage (patrón `asset_files`); sube/baja solo Mantenimiento.
- **Sin borrado físico** si tiene referencias (OTs, garantías, contratos, `items.preferred_provider_id`): inactivar; eliminar solo sin referencias (decisión de sesión).
- `is_active = false`: no seleccionable en nuevas OTs/contratos/garantías; histórico intacto.

## Relaciones (todas FK → providers)

- **[work_orders](work_orders.md).provider_id** — "Ejecutado por = Contratista externo" (M2) → alimenta el **historial de intervención** (F5.3, consulta sin tabla propia).
- **[warranties](warranties.md).provider_id** — proveedor que otorga la garantía (F1.5; preseleccionado desde OT de contratista — F5.4).
- **[contracts](contracts.md).provider_id** — contratos con vigencia (M5).
- **[items](items.md).preferred_provider_id** y proveedor de [stock_movements](stock_movements.md) (M4).

## Uso en el Módulo 1

- `warranties.provider_id` → proveedor/fabricante/taller otorgante de la garantía (selector del catálogo en V1.5; preseleccionado automáticamente cuando la garantía nace de una OT ejecutada por contratista externo — F1.5).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Mantenimiento | SELECT/INSERT/UPDATE + inactivar (CRUD completo — spec M5 permissions) |
| Administrador / Calidad | SELECT |
| Técnico | Sin acceso al catálogo (ve "Ejecutado por" solo dentro de una OT — vía RLS de work_orders) |
