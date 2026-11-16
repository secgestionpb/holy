# warranties

> Módulo 1 — Gestión de Activos. Garantías de compra y reparación (tabla separada, 1↔N con activo/componente).
> Flujos: F1.4 (motor), F1.5 (origen en cierre de OT) / Vistas: V1.5, pestaña Garantías de V1.3 — [01-gestion-de-activos-flujos.md](../01-gestion-de-activos-flujos.md)

```sql
CREATE TABLE warranties (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id            UUID NOT NULL REFERENCES assets(id),
                        -- activo O componente (misma tabla)
    warranty_type       TEXT NOT NULL CHECK (warranty_type IN
                          ('purchase','repair')),
    provider_id         UUID NULL,            -- FK → providers (Módulo 5)
    provider_name       TEXT NULL,             -- texto libre si no está en
                        -- catálogo (fabricante/taller)
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    coverage            TEXT NOT NULL CHECK (coverage IN
                          ('parts','labor','both')),
    notes               TEXT NULL,
    document_path       TEXT NULL,             -- Storage bucket 'activos'
    status              TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','expired')),
                        -- estado_calculado: lo mantiene el motor F1.4 + pg_cron
    origin_wo_id        UUID NULL UNIQUE,      -- FK → work_orders (Módulo 2);
                        -- NULL = alta manual; NOT NULL = creada al cerrar OT;
                        -- UNIQUE evita duplicar al re-cerrar (F1.5)
    is_origin_reopened  BOOLEAN NOT NULL DEFAULT false,
                        -- marca "OT origen reabierta"
    notified_at         TIMESTAMPTZ NULL,      -- aviso ÚNICO Evento 7 (dedup)
    created_by          UUID NULL,             -- FK → users; 'sistema' en auto
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_warranties_asset  ON warranties(asset_id);
CREATE INDEX idx_warranties_status ON warranties(status);
CREATE INDEX idx_warranties_end    ON warranties(end_date)
    WHERE status = 'active';                  -- motor de avisos por vencer
CREATE INDEX idx_warranties_origin ON warranties(origin_wo_id)
    WHERE origin_wo_id IS NOT NULL;
```

## Reglas y notas

- **Múltiples garantías simultáneas** por activo: compra original + reparaciones posteriores.
- **Al cerrar OT con `genera_o_extiende_garantia = 'Sí'`** se crea el registro (F1.5): tipo `repair`, proveedor = contratista si la OT fue externa, `origin_wo_id` = la OT.
- **Reapertura de OT**: no se borra; `is_origin_reopened = true`. Al re-cerrar se **edita** el registro (no se duplica — UNIQUE).
- **Motor F1.4** (hook + pg_cron diario): recalcula `status`; si el activo está en `no_warranty`/`under_warranty` alterna `life_stage` accordingly; agenda **Evento 7** (resumen diario, días globales en T2, aviso único vía `notified_at`).
- **DELETE prohibido** (RLS) — historial comercial preservado; edición de fechas recalcula el aviso.
