# wo_technicians

> Módulo 2 — Asignación de técnicos a OT (N:N con histórico) y horas de mano de obra POR TÉCNICO.
> Flujos: F2.4 (asignación/reasignación), F2.5 (horas) / Vista: V2.3 (pestaña Ejecución) — [02-ordenes-de-trabajo-flujos.md](../02-ordenes-de-trabajo-flujos.md)

```sql
CREATE TABLE wo_technicians (
    wo_id           UUID NOT NULL REFERENCES work_orders(id),
    user_id         UUID NOT NULL REFERENCES users(id),
                    -- debe ser rol Técnico (o Mantenimiento si se le asigna);
                    -- validado a nivel de aplicación/RLS
    assigned_by     UUID NULL REFERENCES users(id),   -- quién asignó (Mto o reemplazo del técnico)
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    removed_at      TIMESTAMPTZ NULL,           -- reasignación = marcar salida
                    -- el histórico NUNCA se borra (fila se conserva)
    removed_by      UUID NULL REFERENCES users(id),
    hours_worked    NUMERIC(6,2) NOT NULL DEFAULT 0,
                    -- horas registradas POR este técnico en esta OT
                    -- (decisión: fila única por par; múltiples sesiones = futura ampliación)
    started_at      TIMESTAMPTZ NULL,           -- marca de tiempo propia del técnico
    finished_at     TIMESTAMPTZ NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),   -- trigger global
    PRIMARY KEY (wo_id, user_id)
);

CREATE INDEX idx_wot_active   ON wo_technicians(wo_id) WHERE removed_at IS NULL;
CREATE INDEX idx_wot_user     ON wo_technicians(user_id) WHERE removed_at IS NULL;
-- Asignado activo = removed_at IS NULL. Reasignar al mismo técnico más
-- tarde = UPDATE que limpia removed_at/removed_by (la fila única lo permite).
```

## Reglas y notas

- **Asignación** (F2.4): Mantenimiento agrega/quita libremente (UPDATE `removed_at` en salientes, INSERT en entrantes). El Técnico solo puede REEMPLAZARSE por otro (nunca adicionar): restricciones de estado (`assigned/in_progress/waiting_parts`), observación obligatoria (queda en `audit_log`), efecto inmediato sin aceptación.
- **Efectos**: push FCM a los 3 polos (entra/sale/permanecen) vía Edge Function; `work_orders.reassigned = true` para el badge/filtro de V2.1; auditoría con técnico anterior → nuevo + observación (fuente del timeline de Historial).
- **Horas** (F2.5): cada técnico edita SOLO sus filas (`hours_worked`, `started_at`, `finished_at`); Mantenimiento edita las de cualquiera. El total de horas de la OT es una SUMA derivada (nunca editable a mano).
- **Unicity/estado**: `PRIMARY KEY (wo_id, user_id)` impide duplicados; una OT puede tener 0 filas activas (sin técnicos — caso contratista).
- **RLS**: SELECT (4 roles — la OT es visible a todos en lectura); UPDATE de horas = `user_id = auth.uid()` o rol Mantenimiento; INSERT/UPDATE de asignación = Mantenimiento, o el propio técnico dentro de las reglas de reemplazo (helper `is_assigned_wo`); DELETE prohibido.
- **N:M con reglas T1**: Técnico consume/devuelve repuestos y marca "Completada" solo en OTs con fila activa (`removed_at IS NULL`).
