# user_dashboard_kpis

> Módulo 7 — Reportes/KPIs. Preferencias de visibilidad de widgets del dashboard, **por usuario** (decisión 7.1/7.2: set del rol + personalización individual).
> Flujos: [F7.1](../07-reportes-kpis-flujos.md) (personalizar), [F7.2](../07-reportes-kpis-flujos.md) (render) · vista [V7.1](../07-reportes-kpis-flujos.md) / modal [M7.1](../07-reportes-kpis-flujos.md).

```sql
CREATE TABLE user_dashboard_kpis (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kpi_key     TEXT NOT NULL,          -- clave estable del catálogo (27 — ver
                -- kpi_keys en 07-reportes-kpis-flujos: 'mttr','inventory_value',...)
    visible     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, kpi_key)
);

CREATE INDEX idx_udk_user ON user_dashboard_kpis (user_id) WHERE visible;
```

## Reglas de negocio

- **Seed LAZY** (F7.2): al primer acceso al dashboard se insertan los KPIs del set del rol (decisión 7.1) como `visible = true`; usuarios multi-rol reciben la UNIÓN de sus sets. La tabla solo guarda el estado (incluido el default — evita reconstruirlo en cada carga).
- **Orden NO se almacena**: el orden de widgets es fijo por grupo (spec `widget_order`) — aquí solo visibilidad.
- **Dato de UI, no de negocio**: cambios NO generan `audit_log` (decisión F7.1).
- Alta/baja de rol → el seed agrega los KPIs nuevos del set como visibles; los KPIs fuera del set dejan de renderizarse (filas huérfanas se ignoran; se limpian en el próximo upsert).
- `ON DELETE CASCADE` con `users` (borrado lógico de usuarios = el registro sobrevive; ver users.md).

## Uso en el Módulo 1

- Ninguno (Módulo 1 es solo fuente de datos para los KPIs).

## RLS (resumen)

| Rol | Permiso |
|---|---|
| Cualquier usuario | SELECT/INSERT/UPDATE/DELETE solo de sus propias filas (`auth.uid() = user_id`) |
| Admin (sobre filas de otros) | Sin acceso especial (preferencias son individuales por spec) |
