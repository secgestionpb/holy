# wo_evidence

> Módulo 2 — Evidencia fotográfica: fotos antes/después de la OT Y evidencia del Reporte de Daño (tabla única, FKs mutuamente excluyentes).
> Flujos: F2.1, F2.5 / Vistas: V2.3 (pestaña Evidencia), V2.5 (reporte) — [02-ordenes-de-trabajo-flujos.md](../02-ordenes-de-trabajo-flujos.md)

```sql
CREATE TABLE wo_evidence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id   UUID NULL REFERENCES work_orders(id),
    damage_report_id UUID NULL REFERENCES damage_reports(id),
                    -- exactamente UNA entidad padre por fila (CHECK abajo);
                    -- decisión de sesión: una sola tabla en lugar de dos de archivos
    kind            TEXT NOT NULL DEFAULT 'other' CHECK (kind IN
                      ('before','after','other')),
                    -- antes | después | otro (para evidencia de OT);
                    -- en reportes de daño se usa 'other'
    storage_path    TEXT NOT NULL,             -- ruta en bucket ot_evidencias (Supabase Storage)
    uploaded_by     UUID NOT NULL REFERENCES users(id),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wo_evidence_one_parent CHECK (
        (work_order_id IS NULL) <> (damage_report_id IS NULL)
    )
);

CREATE INDEX idx_woe_wo     ON wo_evidence(work_order_id, uploaded_at);
CREATE INDEX idx_woe_report ON wo_evidence(damage_report_id, uploaded_at);
```

## Reglas y notas

- **Bucket**: `ot_evidencias` (privado). Lectura: los 4 roles. Escritura: técnicos asignados + Mantenimiento. Borrado: quien subió o Mantenimiento; **bloqueado cuando la OT está `closed`** (la evidencia del cierre se congela). Descarga lectura de los 4 roles.
- **Offline (PWA)**: miniaturas cacheadas por service worker para consulta en campo sin señal (igual que la documentación de activos en M1).
- **Permisos a nivel tabla**: INSERT = técnicos asignados/Mantenimiento; DELETE = uploader o Mantenimiento (solo si OT no cerrada); **sin UPDATE** (un archivo no se modifica — se borra y sube de nuevo, patrón de `asset_files`).
- **Auditoría**: Crear/eliminar con referencia a la OT o al reporte (entidad "Evidencia de OT #N" / "Evidencia de reporte #N").
- El Módulo 1 usa su propia tabla `asset_files` (documentación del activo: manuales, facturas) — esta tabla es solo de ejecución/reportes del Módulo 2.
