# warehouses

> Módulo 4 — Inventario. Catálogo CRUD de bodegas (MÚLTIPLES bodegas — spec `warehouses`).
> Flujos: [F4.2](../04-inventario-flujos.md) (CRUD), [F4.7](../04-inventario-flujos.md) (transferencias), [F4.8](../04-inventario-flujos.md) (conteos).

```sql
CREATE TABLE warehouses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,             -- "Bodega central", "Cuarto técnico piscina"
    description     TEXT,
    responsible_id  UUID REFERENCES users(id),        -- responsable opcional (spec)
    is_active       BOOLEAN NOT NULL DEFAULT true,    -- baja lógica (patrón del sistema)

    -- Auditoría (patrón del sistema)
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Reglas de negocio

- **CRUD solo Mantenimiento** (spec permissions_matrix: "CRUD de ítems y bodegas").
- **Inactivar NO borra**: bloquea nuevas entradas a la bodega; el stock existente permanece visible y sigue siendo transferible (decisión de sesión).
- Bodega con movimientos en kardex → solo inactivable, nunca borrable (kardex apunta por FK/`warehouse_id`).
- Sin borrado físico (patrón del sistema).

## Relaciones

- **Existencias por bodega**: [warehouse_stock](warehouse_stock.md).
- **Kardex**: [stock_movements](stock_movements.md) (`warehouse_id` + `destiny_warehouse_id` en transferencias).
- **Conteos**: [physical_counts](physical_counts.md).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Mantenimiento | SELECT/INSERT/UPDATE + inactivar |
| Técnico / Administrador / Calidad | SELECT |
