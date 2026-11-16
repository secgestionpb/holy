# measurement_records

> Módulo 6 — Mediciones. Registro histórico de mediciones de control de calidad (**diseño completo del Módulo 6**).
> Flujos: [F6.4](../06-cumplimiento-mediciones-flujos.md) (registro + Evento 9), [F6.5](../06-cumplimiento-mediciones-flujos.md) (faltantes) · vista [V6.4](../06-cumplimiento-mediciones-flujos.md) / gráfico de tendencias.

```sql
CREATE TABLE measurement_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    measurement_type_id UUID NOT NULL REFERENCES measurement_types(id),
    asset_id            UUID NOT NULL REFERENCES assets(id),
                        -- el ACTIVO es el punto de medición (spec design_decision:
                        -- ej. PISC-01 — Piscina Principal; sin entidad nueva)
    measured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    value               NUMERIC(10,3) NOT NULL,
    result              TEXT NOT NULL CHECK (result IN
                          ('in_range','out_of_range')),
                        -- estado_calculado automático vs min/max del tipo (spec)
    recorded_by         UUID NULL REFERENCES users(id),  -- registrado por (automático)
    notes               TEXT,                            -- observaciones
    evidence_path       TEXT,                            -- evidencia fotográfica opcional (Storage bucket `documentos`, prefijo cumplimiento/)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mr_type_date  ON measurement_records (measurement_type_id, measured_at DESC);
CREATE INDEX idx_mr_asset_date ON measurement_records (asset_id, measured_at DESC);
CREATE INDEX idx_mr_out        ON measurement_records (measured_at DESC) WHERE result = 'out_of_range';
```

## Reglas de negocio

- **Resultado automático** al guardar: `in_range` | `out_of_range` comparando `value` contra `min_value`/`max_value` del tipo (spec `resultado_calculado`).
- **`out_of_range` → Evento 9 INMEDIATO** a Mantenimiento (intervenir) y Calidad (seguimiento) (spec `out_of_range_notification`).
- **Selección de activo filtrada** por la categoría aplicable del tipo.
- **Sin vínculo con OT** (spec `wo_link`): dato independiente; si Calidad lo requiere, crea un Reporte de Daño manual (M2) — sin referencia cruzada automática.
- **Append-only**: los registros NO se editan ni eliminan (patrón kardex/audit_log — `supabase_mapping`); corrección = registro nuevo (con nota).
- **Tendencias** (spec `trend_view`): gráfico de línea temporal por tipo y activo con banda min/max — consulta sobre esta tabla.

## Uso en el Módulo 1

- **Los activos SON los puntos de medición** — no existe entidad nueva (decisión de diseño de M6).
- `result = 'out_of_range'` → **Evento 9** (correo inmediato a Mantenimiento y Calidad).
- El Módulo 1 solo recibe lectura (posible futuro resumen de mediciones en la ficha).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Calidad | SELECT/INSERT (CRUD de registro — spec); UPDATE/DELETE prohibidos (append-only) |
| Mantenimiento / Administrador | SELECT (Mantenimiento: "recibe alertas, sin gestión") |
| Técnico | Sin acceso |
