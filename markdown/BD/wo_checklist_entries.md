# wo_checklist_entries

> Módulo 3 — Mantenimiento Preventivo. Ejecución del checklist **por cada OT generada** (snapshot de los ítems al momento de generarla).
> Flujos: [F3.3](../03-mantenimiento-preventivo-flujos.md) (INSERT de filas al generar), [F3.4](../03-mantenimiento-preventivo-flujos.md) (marca de ítems y requisito de cierre).

```sql
CREATE TABLE wo_checklist_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_id       UUID NOT NULL REFERENCES work_orders(id),
    checklist_item_id UUID,                       -- ítem de plantilla de origen (traceabilidad; trae los consumibles presuntos de checklist_item_items)
    position    INTEGER NOT NULL,                 -- orden copiado de checklist_items.position
    item_text   TEXT NOT NULL,                    -- SNAPSHOT inmutable del ítem al generar la OT

    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','done','not_applicable')),
                -- pending = sin resolver; done = completado; not_applicable = requiere note

    note        TEXT,                             -- observación individual (OBLIGATORIA si status='not_applicable')
    done_by     UUID REFERENCES users(id),        -- técnico que marcó
    done_at     TIMESTAMPTZ,                      -- cuándo se marcó

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (wo_id, position),
    CHECK (status <> 'not_applicable' OR note IS NOT NULL)   -- refuerza la regla de F3.4 a nivel de BD
);

CREATE INDEX idx_wo_checklist_entries_wo ON wo_checklist_entries (wo_id, position);
```

## Reglas de negocio

- **Solo se crean filas** cuando la OT preventiva proviene de un plan con plantilla (F3.3 paso 3); OTs "Sin checklist", correctivas y preventivas sin plantilla no tienen filas (cierre normal, F3.4).
- **Snapshot**: `item_text`/`position` se copian de `checklist_items` al generar — ediciones posteriores de la plantilla no afectan esta tabla. `checklist_item_id` conserva el vínculo de ORIGEN (informativo) para traer los consumibles presuntos (`checklist_item_items`) en F3.4 sin depender de textos.
- **Requisito de cierre** (decisión de sesión, completa el campo "checklist completado" del modal M2.1): para pasar la OT a `Completada`, TODAS las filas deben estar `done` o `not_applicable` (con `note`); validado en F2.6/F3.4 — violación bloquea el cierre con "Faltan N ítems sin resolver".
- **Marcado**: solo el Técnico asignado o Mantenimiento (helper `is_assigned_wo`, patrón M2); cada cambio → `audit_log` (patrón del sistema).
- El estado de la OT **no** cambia por marcar ítems individualmente.

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Técnico | SELECT + UPDATE de `status`/`note`/`done_by`/`done_at` SOLO en sus OTs asignadas (helper `is_assigned_wo`) |
| Mantenimiento | SELECT + UPDATE (asignador del equipo) |
| Administrador / Calidad | SELECT (Calidad audita "checklists ejecutados" — spec) |
