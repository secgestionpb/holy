# maintenance_plans

> Módulo 3 — Mantenimiento Preventivo. Tabla principal: define QUÉ, CUÁNDO y CÓMO se ejecuta un mantenimiento preventivo.
> Flujos relacionados: [03-mantenimiento-preventivo-flujos.md](../03-mantenimiento-preventivo-flujos.md) (F3.2, F3.3, F3.5, F3.7b).

```sql
CREATE TABLE maintenance_plans (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT NOT NULL,               -- "Cambio de filtro FCU trimestral"
    description           TEXT,                        -- objetivo, alcance técnico, notas

    -- Frecuencia (spec: tipo_frecuencia = tiempo | uso)
    frequency_type        TEXT NOT NULL CHECK (frequency_type IN ('time','usage')),
    interval_value        INTEGER NOT NULL CHECK (interval_value > 0),
                        -- 'time'  = días entre ejecuciones
                        -- 'usage' = horas/ciclos entre ejecuciones (contador del activo)

    -- Alcance: al menos un vínculo en plan_asset_links y/o plan_category_links
    -- (unión de ambos = alcance efectivo — decisión de sesión)

    checklist_template_id UUID REFERENCES checklist_templates(id),   -- plantilla reutilizable; NULL = sin checklist
    suggested_role        TEXT,                        -- referencia ONLY: rol/técnico sugerido (spec; NUNCA auto-asigna)
    default_priority      TEXT NOT NULL DEFAULT 'normal'
                          CHECK (default_priority IN ('urgent','normal','low')),  -- heredada por la OT generada

    lead_days             INTEGER NOT NULL DEFAULT 0 CHECK (lead_days >= 0),
                          -- anticipación de generación: la OT se crea lead_days antes del vencimiento
    grace_days            INTEGER NOT NULL CHECK (grace_days >= 0),
                          -- margen de gracia OBLIGATORIO, individual por plan (spec: NO existe global)

    is_active             BOOLEAN NOT NULL DEFAULT true,
                          -- false = el motor lo salta; OTs ya generadas siguen su ciclo (decisión de sesión)

    -- Estado del ciclo (recalculado por F3.3 / F3.5)
    next_due_at           DATE,                        -- próxima fecha de ejecución (base del primer disparo y de las proyecciones)
    last_run_date         DATE,                        -- fecha programada de la última OT cerrada (frequency_type='time')
    last_run_counter      BIGINT,                      -- contador registrado en la última ejecución (frequency_type='usage')
    -- umbral de uso = last_run_counter + interval_value

    -- Auditoría (patrón del sistema)
    created_by            UUID REFERENCES users(id),
    updated_by            UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_maintenance_plans_active_due
    ON maintenance_plans (is_active, next_due_at);

-- Vinculación por activo INDIVIDUAL (selección estática):
CREATE TABLE plan_asset_links (
    plan_id         UUID NOT NULL REFERENCES maintenance_plans(id),
    asset_id        UUID NOT NULL REFERENCES assets(id),
    PRIMARY KEY (plan_id, asset_id)
);

-- Vinculación por CATEGORÍA (dinámica: activos actuales y futuros):
CREATE TABLE plan_category_links (
    plan_id         UUID NOT NULL REFERENCES maintenance_plans(id),
    category_id     UUID NOT NULL REFERENCES categories(id),
    PRIMARY KEY (plan_id, category_id)
);
```

## Reglas de negocio

- **Alcance efectivo** = `plan_asset_links ∪ plan_category_links` (ambos métodos coexisten en el mismo plan — decisión de sesión sobre el `ui_note` de la spec).
- **Disparo inicial**: al crear el plan, Mantenimiento indica `next_due_at` (próxima fecha) — decisión de sesión; desde ahí corre la secuencia `next_due_at = fecha programada + intervalo` (F3.5, base = `scheduled_at`, NO la fecha real de cierre — spec).
- **Umbral de uso**: OT se genera cuando `contador actual ≥ last_run_counter + interval_value`; el contador se registra **manualmente** en la OT (F3.8, validado en M1 F1.9).
- **Anticipación**: con `frequency_type='time'`, el motor genera cuando `hoy ≥ next_due_at − lead_days` (F3.3).
- **Vencida**: OT con `scheduled_at + grace_days del plan < hoy` que sigue `Abierta` → indicador visual + Evento 6 (F3.6); el estado formal NO cambia y **no se duplica** la OT hasta cerrar/cancelar.
- **Edición** del plan nunca modifica OTs ya generadas; **inactivar** solo detiene nuevas generaciones (F3.2).
- **Reprogramación de plan completo** (F3.7b): UPDATE de `next_due_at` con auditoría anterior→nuevo; el margen de gracia se cuenta desde la nueva fecha.
- Sin borrado físico: `is_active = false` (patrón del sistema).

## Uso en el Módulo 1

- **Vinculación dinámica por categoría**: un alta nueva en `assets.category_id` queda cubierta automáticamente por los planes que referencian esa categoría (F1.1/decisión cross-module).
- **Cambio de categoría del activo** (nota en V1.2) → sale/entra de los planes según la FK de `plan_category_links`.
- Un mismo activo puede tener **varios planes** simultáneos.
- `frequency_type='usage'` exige `assets.tiene_contador = true` (columna de [assets](assets.md)).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Mantenimiento | SELECT/INSERT/UPDATE/DELETE (DELETE = lógico vía `is_active`) |
| Administrador | SELECT (sin CRUD — T1) |
| Calidad | SELECT (solo lectura del módulo — spec) |
| Técnico | SELECT (consulta de planes sin editar — T1) |
