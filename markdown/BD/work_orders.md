# work_orders

> Módulo 2 — Órdenes de Trabajo. Entidad central del módulo: ciclo de vida, ejecución y cierre.
> Flujos: F2.3, F2.4, F2.5, F2.6, F2.7, F2.8, F2.10 / Vistas: V2.1, V2.2, V2.3 — [02-ordenes-de-trabajo-flujos.md](../02-ordenes-de-trabajo-flujos.md)

```sql
CREATE SEQUENCE work_orders_number_seq START 1;

CREATE TABLE work_orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_number           TEXT NOT NULL UNIQUE,
                        -- "OT-0001": 'OT-' || lpad(nextval('work_orders_number_seq')::text, 4, '0')
                        -- secuencia PG propia (decisión: NO usa code_counters)
    asset_id            UUID NOT NULL REFERENCES assets(id),
                        -- activo afectado (instancia individual M1)
    component_id        UUID NULL REFERENCES assets(id),
                        -- componente específico (mini-ficha) o NULL = activo padre;
                        -- es la MISMA tabla assets (parent_id) que usa M1
    wo_type             TEXT NOT NULL DEFAULT 'corrective' CHECK (wo_type IN
                          ('corrective','preventive','inspection')),
                        -- Correctiva | Preventiva | Inspección/mejora
    priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN
                          ('urgent','normal','low')),
                        -- 100% MANUAL (spec: no se calcula por criticidad)
    description         TEXT NOT NULL,          -- descripción del problema
    origin              TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN
                          ('manual','damage_report','preventive','external_app')),
                        -- Manual | Reporte de daño | Motor preventivo (M3) | App externa (futuro)
    damage_report_id    UUID NULL UNIQUE REFERENCES damage_reports(id),
                        -- enlace reporte → OT (decisión: evita FK circular;
                        -- la bandeja V2.4 resuelve "Ver OT" por este índice)
    plan_id             UUID NULL REFERENCES maintenance_plans(id),
                        -- origen del plan cuando wo_type = 'preventive' (F2.10)
    external_ref        TEXT NULL,              -- N° de referencia externo (app futura)
    reported_by         UUID NULL REFERENCES users(id),
    reported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
                        -- fecha de apertura = filtro de fecha default de V2.1
    status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN
                          ('open','assigned','in_progress','waiting_parts',
                           'completed','closed','cancelled')),
                        -- Abierta → Asignada → En proceso → Pendiente de
                        -- repuesto/aprobación → Completada → Cerrada (rama: Cancelada);
                        -- reapertura: Cerrada/Cancelada → in_progress (solo Mantenimiento)
    scheduled_at        TIMESTAMPTZ NULL,       -- fecha programada (preventivas);
                        -- Evento 6 = scheduled_at + margen de gracia < now()
    assigned_at         TIMESTAMPTZ NULL,       -- primera asignación (automática)
    started_at          TIMESTAMPTZ NULL,       -- inicio de trabajo (lo registra el técnico)
    finished_at         TIMESTAMPTZ NULL,       -- fin de trabajo / Completada
    closed_at           TIMESTAMPTZ NULL,       -- último cierre formal; NULL al reabrir
    closed_by           UUID NULL REFERENCES users(id),
    affects_sale        BOOLEAN NOT NULL DEFAULT false,
                        -- ¿Afecta disponibilidad de venta? informativo (sin PMS);
                        -- true dispara Evento 1 en alta y/o cierre
    executed_by_type    TEXT NOT NULL DEFAULT 'internal' CHECK (executed_by_type IN
                          ('internal','external')),
                        -- Personal interno | Contratista externo
    provider_id         UUID NULL REFERENCES providers(id),
                        -- obligatorio AL CERRAR si executed_by_type = 'external'
                        -- (se elige desde el catálogo M5)
    external_cost       NUMERIC(12,2) NULL,     -- monto único servicio externo
    generates_warranty  BOOLEAN NULL,           -- respuesta del modal de cierre M2.1
                        -- (Sí/No, default No): NULL = aún no cerrada.
                        -- Solo si true se crea garantía (F1.5/M1 → warranties.origin_wo_id).
                        -- Regla de sesión: una correctiva NO siempre tiene garantía.
    reassigned          BOOLEAN NOT NULL DEFAULT false,
                        -- flag denormalizado para badge/filtro "Reasignadas" de V2.1;
                        -- la historia detallada (quién, obs.) vive en audit_log
    diagnosis           TEXT NULL,              -- diagnóstico/solución (obligatorio al cerrar)
    solution            TEXT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()  -- trigger global
);

CREATE INDEX idx_wo_asset        ON work_orders(asset_id);
CREATE INDEX idx_wo_component    ON work_orders(component_id) WHERE component_id IS NOT NULL;
CREATE INDEX idx_wo_status_date  ON work_orders(status, reported_at DESC);
CREATE INDEX idx_wo_list_tabs    ON work_orders(reported_at DESC) WHERE status NOT IN ('closed','cancelled');
CREATE INDEX idx_wo_scheduled    ON work_orders(scheduled_at) WHERE wo_type = 'preventive' AND status NOT IN ('closed','cancelled');
CREATE INDEX idx_wo_plan         ON work_orders(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX idx_wo_provider     ON work_orders(provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX idx_wo_reassigned   ON work_orders(reassigned) WHERE reassigned;
-- damage_report_id ya es UNIQUE (FK de enlace reporte → OT)
```

## Reglas y notas

- **Borrado físico PROHIBIDO** — la spec exige conservar historial; los estados `closed`/`cancelled` son bajas lógicas.
- **Transiciones de estado** (aplicadas por Edge Function/RLS): técnicos solo `open/assigned/in_progress/waiting_parts → completed` en sus OTs; Mantenimiento hace asignaciones, cancelación, cierre (`completed → closed`) y reapertura (`closed/cancelled → in_progress` con motivo obligatorio).
- **Horas por técnico**: NO viven aquí — se registran en `wo_technicians.hours_worked` (fila por par OT↔técnico); los totales de la pestaña Costos agregan esa tabla.
- **Asignaciones múltiples**: N:N en `wo_technicians` (una OT puede quedar sin técnicos — caso contratista).
- **Costo total**: no se almacena — se deriva en vista: mano de obra (`wo_technicians`) + repuestos (kardex M4, costo congelado, neto de devoluciones) + `external_cost`.
- **Checklist**: solo preventivas con `plan_id`; plantilla/ítems en tablas del Módulo 3 ([checklist_templates](checklist_templates.md) → snapshot en [wo_checklist_entries](wo_checklist_entries.md)).
- **Cierre** (modal M2.1 / F2.6): `diagnosis`+`solution` obligatorios; `generates_warranty` obligatorio (default false); si preventiva → próxima fecha del plan (M3, desde `scheduled_at`); si el activo tiene contador → `assets.usage_counter`.
- **Reapertura** (F2.7): `closed_at/closed_by → NULL`, `status = 'in_progress'`; la garantía ya creada NO se elimina (queda "OT origen reabierta"); NO revierte la próxima fecha del plan.
- **Eventos**: `affects_sale = true` → Evento 1 (correo inmediato, alta/cierre); `origin = 'preventive'` → Eventos 2 y 6 (resumen diario).

## Uso en el Módulo 1

- **Pestaña OTs** de la ficha (V1.3): OTs abiertas/históricas del activo y sus componentes.
- **Badge "OTs abiertas"** del listado V1.1 (contador de `status NOT IN ('closed','cancelled')`).
- `warranties.origin_wo_id` → OT que originó la garantía (F1.5, solo si `generates_warranty = true`).
- **Pestaña Costos**: `external_cost` + horas + consumos alimentan el costo acumulado por activo (Mto + Admin).
- Cierre de OT con contador → actualiza `assets.usage_counter` (F1.9 → Evento 12 al fin de vida útil).

## Uso en otros módulos

- **M3 (Preventivo)**: `plan_id` + `scheduled_at` alimentan calendario, generación (F2.10) y cálculo de próxima fecha al cierre.
- **M4 (Inventario)**: cada consumo/devolución referencia `work_orders(id)` desde el kardex ([stock_movements](stock_movements.md)).
- **M5 (Proveedores)**: `provider_id`/`external_cost` → ficha del contratista lista sus OTs.
- **M7 (KPIs)**: MTTR (`reported_at → closed_at`), MTBF, % PM a tiempo (`scheduled_at → closed_at`), OTs por origen, reasignadas (`reassigned`), desempeño por técnico (`wo_technicians`).
