# asset_files

> Módulo 1 — Gestión de Activos. Metadatos de documentación (manual, ficha, foto, factura) en Supabase Storage.
> Flujo: F1.8 / pestaña Documentación de V1.3 — [01-gestion-de-activos-flujos.md](../01-gestion-de-activos-flujos.md)

```sql
CREATE TABLE asset_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES assets(id),
                    -- activo o componente
    file_name       TEXT NOT NULL,             -- nombre original
    storage_path    TEXT NOT NULL UNIQUE,      -- path en bucket privado
                    -- 'activos' (subida: activos/{asset_id}/...)
    mime_type       TEXT NULL,
    file_size_bytes BIGINT NULL,
    uploaded_by     UUID NOT NULL DEFAULT auth.uid(),
                    -- FK → users; default = sesión actual (migración
                    -- 20261009000003); el front además lo envía explícito
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_files_asset ON asset_files(asset_id);
```

## Reglas y notas

- **Bucket `activos`** (privado): política de Storage separada — lectura/descarga los 4 roles; subida y borrado **solo Mantenimiento**.
- Permisos a nivel tabla: INSERT/DELETE solo Mantenimiento; SELECT los 4 roles; **sin UPDATE** (un archivo no se modifica — se borra y sube de nuevo).
- **Offline en PWA**: los archivos quedan cacheados por el service worker para consulta en campo sin señal (F1.8/V1.3).
- Tipos/tamaño validados en cliente (Edge Function como respaldo).
- **DELETE de la fila también borra el objeto del bucket** (Edge Function de borrado).
