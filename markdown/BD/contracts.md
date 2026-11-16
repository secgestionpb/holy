# contracts

> Módulo 5 — Proveedores y Contratistas Externos. Contratos con vigencia (nivel 3 de la spec: catálogo + historial + contratos).
> Flujos: [F5.2](../05-proveedores-contratistas-flujos.md) (CRUD + estado calculado), [F5.5](../05-proveedores-contratistas-flujos.md) (Evento 11 "Contrato por vencer"), vista [V5.4](../05-proveedores-contratistas-flujos.md).

```sql
CREATE TABLE contracts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id     UUID NOT NULL REFERENCES providers(id),
    name            TEXT NOT NULL,                   -- nombre/descripción del contrato
    scope           TEXT,                            -- alcance del servicio

    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    CHECK (end_date > start_date),

    visit_frequency TEXT CHECK (visit_frequency IS NULL OR visit_frequency IN
                        ('weekly','biweekly','monthly','bimonthly',
                         'quarterly','semiannual','annual')),
                        -- frecuencia de visitas pactadas (OPCIONAL, enum — decisión de sesión)

    amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),   -- monto del contrato
    amount_period   TEXT NOT NULL CHECK (amount_period IN
                        ('once','monthly','quarterly','semiannual','annual')),
                        -- periodicidad del monto: único | mensual | trimestral | semestral | anual

    document_path   TEXT,                        -- contrato adjunto (Storage bucket `documentos`, prefijo proveedores/)
    notes           TEXT,                            -- observaciones
    is_active       BOOLEAN NOT NULL DEFAULT true,

    -- estado_calculado NO es columna: se DERIVA en consulta/vista (decisión de sesión):
    --   Vencido    : current_date >  end_date
    --   Por vencer : current_date >  end_date − dias_anticipación (config Evento 11)
    --   Vigente    : en otro caso (incluye contratos aún no iniciados — spec define solo 3 estados)

    -- Auditoría (patrón del sistema)
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contracts_provider ON contracts (provider_id);
CREATE INDEX idx_contracts_end      ON contracts (end_date);   -- Evento 11 (F5.5)
```

## Reglas de negocio

- **`end_date > start_date`** obligatorio a nivel BD (validación de V5.4).
- **Estado calculado (derivado, no almacenado)** — decisión de sesión sobre el campo `estado_calculado` de la spec:
  - `Vencido` si `hoy > end_date`
  - `Por vencer` si `hoy > end_date − dias_anticipación` (días = **config del Evento 11** en [notification_config](notification_config.md), editable — mismo patrón que garantías, spec `contracts.notification`)
  - `Vigente` en otro caso (incluye preinicio)
- **Evento 11** (F5.5): resumen diario con los contratos en la ventana de anticipación; los ya vencidos NO reenvían (patrón garantías).
- **CRUD solo Mantenimiento** (spec M5 permissions); edición posterior NO afecta OTs ni garantías ya emitidas.
- Alta **solo desde la ficha del proveedor** (V5.2-Contratos — decisión de sesión).
- Sin borrado físico: `is_active = false` (patrón del sistema).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Mantenimiento | SELECT/INSERT/UPDATE + inactivar |
| Administrador / Calidad | SELECT |
| Técnico | Sin acceso (catálogo de M5) |
