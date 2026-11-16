# Módulo 8: Backup de Storage y Limpieza — Spec Detallado

> **Origen:** requerimiento operativo nuevo del cliente (no viene de cmmsProject.md) — `00-proyecto-general.md` open_pending_items.
> **Entregables:** este spec · flujos/decisiones (todo el contenido es de diseño propio, sin spec fuente externa).
> **Tablas referenciadas (solo lectura — detección de huérfanos):** [users](BD/users.md) · [asset_files](BD/asset_files.md) · [warranties](BD/warranties.md) · [wo_evidence](BD/wo_evidence.md) · [wo_comments](BD/wo_comments.md) · [items](BD/items.md) · [provider_files](BD/providers.md) · [contracts](BD/contracts.md) · [certifications](BD/certifications.md) · [certification_history](BD/certifications.md) · [measurement_records](BD/measurement_records.md) · [report_send_log](BD/report_send_log.md)
> **Buckets cubiertos:** `usuarios` · `activos` · `ot_evidencias` · `documentos` · `reportes` (los 5 privados del proyecto)

```xml
<module id="8" name="Backup de Storage y Limpieza" type="operativo">

  <goal>Respaldar localmente (carpeta/red del hotel) los archivos de los 5
    buckets de Supabase Storage con ejecución diaria, verificar integridad
    y purgar únicamente huérfanos y objetos de retención vencida — siempre
    en el orden backup → verificar → limpiar. Complemento: higiene en el
    origen (compresión de imágenes y límite de tamaño en subidas) para
    alargar la vida del tier gratuito (1 GB).</goal>

  <decisions_taken>
    <decision n="8.1">RETENCIÓN = 120 DÍAS SOLO PARA OBJETOS DEL BUCKET
      `ot_evidencias` (imágenes de evidencia de OTs) — user: "Subir la
      tolerancia a 120 días, luego la graduare de acuerdo a las
      necesidades" (configurable vía RETENTION_DAYS). Al vencer se borra
      SOLO el objeto de Storage; la fila wo_evidence queda intacta y la UI
      muestra "Archivo no disponible (retención)" (enlace roto con
      mensaje — decisión 8.3).</decision>
    <decision n="8.2">LOS DEMÁS BUCKETS NO SE TOCAN POR RETENCIÓN —
      "los documentos no se eliminarán": manuales/fichas (documentos/
      items), proveedores/contratos, cumplimiento (certificados y
      mediciones), avatares y reportes programados son documentación
      permanente. Su única vía de purga es la de huérfanos (objeto sin
      fila referenciada).</decision>
    <decision n="8.3">ENLACE ROTO EN UI: cuando una imagen de evidencia
      ya no exista en Storage (retención u otra causa), la galería de
      evidencias muestra un placeholder con el mensaje "Archivo no
      disponible (retención)" vía onError del &lt;img&gt; (sin romper la
      página ni la fila de historial).</decision>
    <decision n="8.4">HIGIENE EN ORIGEN (user): comprimir imágenes antes
      de subir — objetivo ≤ 500 KB por imagen, calidad reducible sin
      problema — y límite máximo de 5 MB por archivo documental. Se
      aplica en cliente (patrón del sistema: "validados en cliente") en
      todas las subidas; compresión específica en evidencias de OT
      (módulo 2).</decision>
    <decision n="8.5">APROBACIÓN SEMI-MANUAL: la purga NO es automática.
      Ejecución por defecto = dry-run que genera reporte (JSON) con
      huérfanos, candidatos a retención y referencias rotas. La purga se
      ejecuta con `--apply --report &lt;archivo&gt;` sobre el contenido de
      ese reporte (editado por el operador para acotar si lo desea).
      Orden SIEMPRE: backup → verificar → limpiar; sin verificación
      exitosa del bucket, no se purga nada de ese bucket.</decision>
    <decision n="8.6">TECNOLOGÍA: Python stdlib puro (urllib, json, os —
      patrón de scripts/smoke-*.py, sin dependencias externas), service
      role key desde .env.local (nunca en el front ni en el repo).
      Ejecución local en Windows agendada con Task Scheduler (diaria,
      registro a cargo del operador — comando de ejemplo en el
      encabezado del script).</decision>
    <decision n="8.7">BACKUP INCREMENTAL: espejo local por bucket con
      manifiesto JSON (path → size + eTag/updated_at). Solo se descargan
      objetos nuevos o cambiados; los existentes y verificados se
      omiten. Reintentos ×3 con backoff por objeto; log diario con
      resumen (contados, bytes, descargados, omitidos, fallidos).</decision>
    <decision n="8.8">HUÉRFANOS = objeto en Storage sin fila que lo
      referencie, en CUALQUIER bucket (mapa completo en
      reference_map). Casos conocidos de generación: reemplazo de
      avatar/item/certificado/contrato sin borrar el objeto anterior y
      fallos upload-then-persist. certification_history.document_path
      cuenta como referenciado (snapshot de la vigencia anterior).
      report_send_log.file_path se normaliza con prefijo `reportes/`
      antes de comparar.</decision>
    <decision n="8.9">REFERENCIAS ROTAS (fila → objeto ausente) se
      reportan SOLO como informativo, sin acción automática. Incluye
      columnas nunca escritas por el código actual
      (wo_comments.attachment_path, warranties.document_path) que se
      esperan todas NULL.</decision>
  </decisions_taken>

  <scope>

    <backup>
      <buckets>documentos · ot_evidencias · activos · usuarios · reportes
        (los 5 del proyecto, todos privados).</buckets>
      <api service_role="true">Lista: POST /storage/v1/object/list/{bucket}
        (paginado, sortBy name asc) → name, created_at, updated_at,
        metadata.size, metadata.eTag. Descarga: POST
        /storage/v1/object/{bucket}/{path}. Borrado (solo --apply): DELETE
        /storage/v1/object/{bucket} con {"prefixes":[…]} en lotes de
        ≤100.</api>
      <destino>BACKUP_DIR (env var, carpeta local o red del hotel):
        BACKUP_DIR/{bucket}/{ruta-del-objeto} + BACKUP_DIR/.manifests/
        {bucket}.json + BACKUP_DIR/logs/backup-&lt;timestamp&gt;.log +
        BACKUP_DIR/reports/backup-report-&lt;fecha&gt;.json.</destino>
      <incremental>Manifiesto por bucket; se omite descarga si el archivo
        local existe y su size coincide con el manifiesto. El manifiesto
        se actualiza solo tras descarga exitosa.</incremental>
      <reintentos>3 intentos por objeto con backoff exponencial (2s, 8s,
        20s); objeto fallido → se cuenta, se marca bucket como parcial y
        ese bucket NO entra en purga.</reintentos>
    </backup>

    <verification>
      <rule>Por bucket: objetos remotos (list) vs archivos locales
        espejados — igualdad de conteo y de bytes totales (tolerancia 0
        para objetos esperados; los fallidos del intento se reintentan
        antes de declarar).</rule>
      <on_fail>Bucket marcado failed → sin purga en ese bucket, exit≠0,
        detalle en log y reporte.</on_fail>
    </verification>

    <purge semi_manual="true">
      <mode>Default = dry-run (solo reporte). `--apply --report &lt;json&gt;`
        purga exactamente lo listado en ese reporte (el operador puede
        editar el JSON para acotar antes de aplicar).</mode>
      <order>SIEMPRE: backup → verificar → limpiar. `--apply` aborta la
        purga de un bucket cuya verificación falló.</order>
      <orphans>Objetos sin fila referenciada — cualquier bucket (decisión
        8.8).</orphans>
      <retention>Objetos de `ot_evidencias` con created_at &gt; RETENTION_DAYS
        (default 120) — SOLO el objeto (decisión 8.1). Los demás buckets
        nunca por retención (decisión 8.2).</retention>
      <logging>Cada borrado: bucket, path, tamaño, motivo (orphan|retention)
        → log + resumen del reporte aplicado.</logging>
    </purge>

  </scope>

  <reference_map> <!-- columnas → bucket; todas guardan "bucket/ruta" excepto report_send_log.file_path -->
    <ref table="users" column="avatar_path" bucket="usuarios" nullable="true"/>
    <ref table="asset_files" column="storage_path" bucket="activos" nullable="false"/>
    <ref table="warranties" column="document_path" bucket="activos" nullable="true" note="sin writer web actual — esperado NULL"/>
    <ref table="wo_evidence" column="storage_path" bucket="ot_evidencias" nullable="false"/>
    <ref table="wo_comments" column="attachment_path" bucket="ot_evidencias" nullable="true" note="columna muerta — sin writer"/>
    <ref table="items" column="image_path" bucket="documentos" prefix="items/" nullable="true"/>
    <ref table="items" column="technical_sheet_path" bucket="documentos" prefix="items/" nullable="true"/>
    <ref table="provider_files" column="path" bucket="documentos" prefix="proveedores/" nullable="false"/>
    <ref table="contracts" column="document_path" bucket="documentos" prefix="proveedores/" nullable="true"/>
    <ref table="certifications" column="document_path" bucket="documentos" prefix="cumplimiento/" nullable="true"/>
    <ref table="certification_history" column="document_path" bucket="documentos" prefix="cumplimiento/" nullable="true" note="C cuenta como referenciado (snapshot de renovación)"/>
    <ref table="measurement_records" column="evidence_path" bucket="documentos" prefix="cumplimiento/" nullable="true"/>
    <ref table="report_send_log" column="file_path" bucket="reportes" nullable="true" note="SIN prefijo de bucket en el valor — normalizar a 'reportes/'+valor"/>
  </reference_map>

  <origin_hygiene> <!-- decisión 8.4 — reduce el consumo del tier 1 GB -->
    <compression>
      <target>Imágenes (image/*): comprimir en cliente a ≤ 500 KB
        (calidad/resolución reducible), vía canvas (createImageBitmap →
        toBlob JPEG con calidad decreciente y reescalado). PDFs y otros:
        sin compresión, solo límite.</target>
      <where>Evidencias de OT (subida desde orden-detalle y diálogo de
        reporte de daño — bucket ot_evidencias). Patrón reusable
        (lib/upload-utils) para el resto de módulos si se desea
        extender.</where>
    </compression>
    <size_limit>
      <max>5 MB por archivo (antes de comprimir; toast de error si se
        excede — misma UX de validación del sistema).</max>
      <where>TODAS las subidas: asset_files (M1), evidencias OT (M2),
        imágenes/fichas de ítems (M4), provider_files y contratos (M5),
        certificados/mediciones (M6), avatar (T1).</where>
    </size_limit>
  </origin_hygiene>

  <ui_changes>
    <change>Galería de evidencias OT — pages/orden-detalle.tsx: &lt;img
      onError&gt; → placeholder "Archivo no disponible (retención)".</change>
    <change>Detalle de reporte de daño — components/ordenes/
      damage-detail-dialog.tsx: mismo placeholder onError.</change>
    <change>Sin cambios de navegación ni roles (módulo sin UI propia —
      operación por script + ajustes puntuales arriba).</change>
  </ui_changes>

  <config_and_scheduling>
    <env>.env.local (raíz, ya existe con SUPABASE_URL +
      SUPABASE_SERVICE_ROLE_KEY) + nuevas variables opcionales:
      BACKUP_DIR (obligatoria para ejecutar), RETENTION_DAYS (default
      120). .env.example se actualiza con las 2.</env>
    <scheduler>Task Scheduler (Windows) — diaria (p. ej. 02:00):
      schtasks /Create /TN "CMMS-Backup-Storage" /SC DAILY /ST 02:00
      /TR "python C:\ruta\al\repo\scripts\backup_storage.py" —
      registro a cargo del operador (no se automatiza desde el repo).</scheduler>
    <secrets>SERVICE_ROLE_KEY solo en .env.local (git-ignored); nunca en
      front ni en el script hardcodeada.</secrets>
  </config_and_scheduling>

  <acceptance>
    <case>Ejecución dry-run contra el proyecto vivo: lista los 5 buckets,
      descarga/omite según manifiesto, verifica conteo+bytes y genera
      reporte con (posibles) huérfanos reales (reemplazos de avatar de
      los smokes) y 0 candidatos de retención (proyecto &lt; 120 días).
      Log con resumen completo.</case>
    <case>--apply sobre el reporte: purga huérfanos listados, 0 retención,
      cada borrado en log; segunda corrida dry-run → huérfanos ya no
      aparecen.</case>
    <case>Front: subir foto de evidencia OT ≤ 500 KB comprimida; archivo
      &gt; 5 MB rechazado con toast; imagen de evidencia con objeto
      ausente muestra placeholder "Archivo no disponible (retención)"
      sin romper la página.</case>
    <case>typecheck / lint / build del web app ✓.</case>
  </acceptance>

  <out_of_scope>
    <item>Backup de la base de datos (Supabase la gestiona; fuera del
      alcance de este item — "archivos de Storage").</item>
    <item>Agendado automático de Task Scheduler desde el repo.</item>
    <item>Purga automática sin --apply (semi-manual por decisión 8.5;
      evaluar automático solo tras ganar confianza).</item>
    <item>Compresión server-side (Edge Function) — solo cliente por
      ahora.</item>
  </out_of_scope>

  <open_pending_items>
    <item>Graduar RETENTION_DAYS según operación real (user: "luego la
      graduare de acuerdo a las necesidades") — hoy 120.</item>
    <item>Extender compresión ≤ 500 KB a uploads de M1/M4/M5/M6 si el
      consumo de Storage lo justifica (el utilitario queda listo).</item>
    <item>Alerta por correo en fallos de backup (hoy: log + exit≠0;
      integrar con Brevo si el operador lo pide).</item>
  </open_pending_items>

  <implementation_notes>
    <status>IMPLEMENTADO Y CERRADO (2026-10-14) — verificación smoke
      contra proyecto vivo.</status>

    <script>
      <file>scripts/backup_storage.py (Python stdlib: urllib, json, os,
        argparse — sin dependencias externas).</file>
      <flow>dry-run por defecto → lista los 5 buckets (paginado) →
        descarga incremental (manifiesto JSON por bucket: path → size +
        eTag; omite existentes verificados) → VERIFICA conteo+bytes por
        bucket (objeto por objeto contra el manifiesto) → solo si la
        verificación del bucket es OK evalúa purga (huérfanos por
        reference_map de 13 columnas + retención &gt; 120d solo
        ot_evidencias + referencias rotas informativas) → reporte JSON
        en BACKUP_DIR/reports/ y log en BACKUP_DIR/logs/ → nada se borra
        sin --apply --report &lt;archivo&gt; (borrado por lotes ≤100
        prefixes, DELETE /storage/v1/object/&lt;bucket&gt;).</flow>
      <detail>Descarga vía GET /storage/v1/object/&lt;bucket&gt;/&lt;path&gt;
        (POST es upload → 400 KeyAlreadyExists; verificado en smoke).
        Reintentos ×3 backoff [2,8,20]s. stdout UTF-8 (reconfigure) por
        consola Windows cp1252.</detail>
      <smoke>Dry-run: 5/5 buckets listados y verificados OK (0,0,0,1,1
        obj — proyecto pequeño), 3 referencias activas, 0 huérfanos, 0
        retención, 1 referencia rota (smoke-renew.pdf de M6). 2ª corrida:
        incremental OK (omitidos 1+1). --apply sobre reporte: 0 borrados
        (sin candidatos), exit 0.</smoke>
    </script>

    <frontend>
      <util>lib/upload-utils.ts: MAX_DOCUMENT_BYTES=5MB,
        MAX_IMAGE_TARGET_BYTES=500KB, fileSizeError(), compressImage()
        (createImageBitmap + canvas, escalonado scale [1,.75,.5,.35] ×
        quality [.75,.6,.45,.3,.2], solo image/*, devuelve File
        .jpg ≤500KB).</util>
      <wiring>compressImage en m2.ts uploadEvidence; fileSizeError en
        uploads de m1 (asset file), m4 (item file), m5 (provider file),
        m6 (compliance file), admin-users (avatar) y contrato-form
        (pre-check con toast antes del upload).</wiring>
      <broken-link>orden-detalle.tsx y damage-detail-dialog.tsx:
        &lt;img onError&gt; → placeholder "Archivo no disponible
        (retención)"; además, fallo del SIGN (objeto ya ausente en
        Storage) marca broken y muestra el mismo placeholder/toast
        (ampliación sobre 8.3 — antes solo onError del img).</broken-link>
      <smoke>Navegador: BMP 12.96 MB subido como evidencia OT → objeto
        en ot_evidencias JPEG 499.212 B (≤500 KB) ✓. Objeto borrado vía
        API → "Preparar enlaces" muestra placeholder "Archivo no
        disponible (retención)" y "Firmar y abrir" → toast homónimo sin
        romper la página ✓. Limpieza smoke: objeto y fila wo_evidence
        eliminados.</smoke>
    </frontend>

    <tooling>
      <env>.env.example + .env.local (raíz): BACKUP_DIR (destino
        local/red del hotel) y RETENTION_DAYS (default 120). SERVICE_ROLE_KEY
        solo en .env.local (git-ignored).</env>
      <scheduler>Task Scheduler diaria (comando de ejemplo en
        config_and_scheduling del spec y en encabezado del script) —
        registro a cargo del operador.</scheduler>
    </tooling>

    <verification>typecheck ✓ · lint sin errores (solo warnings
      preexistentes de M6/M4) · build ✓ · validate_docs_xml 24/24 ✓.
      Orden backup→verificar→limpieza preservado en código (aborta
      purga de bucket si su verificación falla).</verification>
  </implementation_notes>

</module>
```
