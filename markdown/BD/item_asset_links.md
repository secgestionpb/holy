# item_asset_links

> Módulo 4 — Inventario de Repuestos. Relación N:N repuesto ↔ activo/categoría (**diseño completo del Módulo 4**).
> Tabla hermana: `item_category_links` (mismo patrón, FK a [categories](categories.md)). Flujos: [F4.1](../04-inventario-flujos.md) (vínculos desde V4.2).

```sql
CREATE TABLE item_asset_links (
    item_id         UUID NOT NULL,             -- FK → items (Módulo 4)
    asset_id        UUID NOT NULL REFERENCES assets(id),
    PRIMARY KEY (item_id, asset_id)
);

CREATE TABLE item_category_links (
    item_id         UUID NOT NULL,             -- FK → items (Módulo 4)
    category_id     UUID NOT NULL REFERENCES categories(id),
    PRIMARY KEY (item_id, category_id)
);
```

## Usos

- **Sugerir repuestos compatibles** al llenar una OT sobre un activo (lectura desde Módulo 2).
- **Asociar repuestos a ítems de checklist** de planes preventivos → la OT preventiva muestra repuestos probables y verifica disponibilidad antes de ejecutar (Módulo 3).
- Relación **N:N**: un repuesto sirve a varios activos/categorías y viceversa.
- Solo lectura desde el Módulo 1 (la gestión es del Módulo 4).
