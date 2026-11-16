# checklist_templates (incluye checklist_items y checklist_item_items)

> Módulo 3 — Mantenimiento Preventivo. Catálogo CRUD de plantillas de checklist reutilizables por los planes.
> Flujos: [F3.1](../03-mantenimiento-preventivo-flujos.md) (CRUD), [F3.2](../03-mantenimiento-preventivo-flujos.md) (selección desde el plan), [F3.3](../03-mantenimiento-preventivo-flujos.md) (snapshot al generar la OT).

```sql
CREATE TABLE checklist_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,               -- "Revisión FCU estacional"
    category_id     UUID REFERENCES categories(id),   -- categoría sugerida (Módulo 1; solo sugerencia de filtrado)
    is_active       BOOLEAN NOT NULL DEFAULT true,    -- false = no seleccionable en nuevos planes (sin borrado físico)

    -- Auditoría (patrón del sistema)
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checklist_templates_active ON checklist_templates (is_active);

-- Ítems de la plantilla (lista ordenada — spec: "lista de pasos/tareas"):
CREATE TABLE checklist_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     UUID NOT NULL REFERENCES checklist_templates(id),
    position        INTEGER NOT NULL,            -- orden en la lista (reordenable en M3.3)
    text            TEXT NOT NULL,               -- "Verificar presión de entrada (35–45 psi)"

    UNIQUE (template_id, position)
);

-- Consumibles (repuestos/insumos) PRESUNTOS por ítem de checklist:
-- spec M4: "Asociar repuestos a los ítems de un checklist de plan preventivo,
-- de modo que la OT preventiva pueda mostrar repuestos probables y verificar
-- disponibilidad antes de ejecutar". Decisión de sesión: es una PRESUNCIÓN NO
-- BLOQUEANTE (no restringe crear el PM ni ejecutar/cerrar la OT).
CREATE TABLE checklist_item_items (
    checklist_item_id   UUID NOT NULL REFERENCES checklist_items(id),
    item_id             UUID NOT NULL REFERENCES items(id),  -- repuesto/insumo del catálogo (Módulo 4 — FK resoluble desde el diseño de `items`)
    qty_suggested       INTEGER CHECK (qty_suggested IS NULL OR qty_suggested > 0),  -- cantidad presunta (opcional)
    PRIMARY KEY (checklist_item_id, item_id)
);
```

## Reglas de negocio

- **Reutilizable**: N planes pueden referenciar la misma plantilla (`maintenance_plans.checklist_template_id`).
- **Snapshot al generar la OT** (F3.3): los ítems se copian a `wo_checklist_entries` (`item_text` inmutable) — editar la plantilla después **NO** altera OTs ya generadas ni histórico (decisión de sesión).
- **Desactivar** una plantilla en uso: planes existentes y OTs generadas no se afectan; deja de ser opcional en `V3.3` para nuevos/edición de planes.
- **Baja lógica** (`is_active = false`) en vez de borrado físico — patrón del sistema; la FK desde `maintenance_plans` bloquearía el borrado en cualquier caso.
- **Consumibles presuntos** (`checklist_item_items`): asociación opcional repuesto/insumo ↔ ítem de checklist con cantidad sugerida. Se muestran en la OT (F3.4) con "verificar disponibilidad" (kardex Módulo 4) pero **jamás bloquean** la creación del PM, la ejecución ni el cierre de la OT (decisión de sesión). Picker de M3.3/F3.4 operativo desde el diseño completo del Módulo 4 (FK → `items`).
- Opción "Sin checklist": `maintenance_plans.checklist_template_id = NULL` → la OT se cierra sin requisito de ítems (F3.4).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Mantenimiento | SELECT/INSERT/UPDATE + desactivar (T1: CRUD de checklists) |
| Administrador / Calidad | SELECT (Calidad audita "checklists ejecutados" — spec) |
| Técnico | SELECT de plantillas referenciadas en sus OTs (la referencia visible es el snapshot, F3.4) |
