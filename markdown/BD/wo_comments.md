# wo_comments

> Módulo 2 — Comentarios manuales de la OT (pestaña "Historial y comentarios").
> Flujos: F2.5 / Vista: V2.3 — [02-ordenes-de-trabajo-flujos.md](../02-ordenes-de-trabajo-flujos.md)

```sql
CREATE TABLE wo_comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_id           UUID NOT NULL REFERENCES work_orders(id),
    author_id       UUID NOT NULL REFERENCES users(id),
    body            TEXT NOT NULL,             -- texto del comentario
    attachment_path TEXT NULL,                 -- adjunto opcional (Storage, bucket ot_evidencias)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    -- SIN updated_at: los comentarios NO se editan ni se borran (spec)
);

CREATE INDEX idx_woc_wo ON wo_comments(wo_id, created_at);
```

## Reglas y notas

- **Fuente de la pestaña Historial**: la línea de tiempo mezcla (a) eventos automáticos desde `audit_log` (cambios de estado, reasignaciones, campos, consumos, devoluciones, cierres, reaperturas, reprogramaciones — sin segunda fuente de verdad) y (b) estos comentarios manuales.
- **Permisos**: INSERT = técnicos asignados a la OT (fila activa en `wo_technicians`) + Mantenimiento; SELECT = los 4 roles (Admin solo lee); **sin UPDATE y sin DELETE** (RLS) — contenido inmutable una vez publicado.
- **Sin notificación**: un comentario nuevo NO genera push ni correo (regla explícita del catálogo T2).
- **Auditoría**: los INSERT se registran en `audit_log` (entidad "Comentario en OT #N") para que el timeline quede completo en una sola consulta.
