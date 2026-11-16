# Módulo T1: Usuarios y Roles — Flujos, Interfaces y Mapeo Supabase

> Spec fuente: [T1-usuarios-y-roles.md](T1-usuarios-y-roles.md)
> **Tablas BD del Módulo T1:** [users](BD/users.md) (perfil + hourly_rate) · [user_roles](BD/user_roles.md) (N:N roles) · [user_category_assignments](BD/user_category_assignments.md) (N:N técnico↔categorías) · [failed_logins](BD/failed_logins.md) (lockout custom) — **compartidas:** [audit_log](BD/audit_log.md) (usuarios/roles/reset) — **referenciadas (otros módulos):** [categories](BD/categories.md) · [system_parameters](BD/system_parameters.md) (tarifa global fallback M7 + login_attempts/lockout_minutes T2)

```xml
<module id="T1" name="Usuarios y Roles — Flujos" type="transversal">

  <decisions_taken>
    <decision n="T1.1">RESET DE CONTRASEÑA (user confirmó; alcance
      ampliado por T1.9): contraseña PREDETERMINADA del sistema
      (PlayaBlanca2026) que el Admin confirma y transmite al usuario por
      el canal que prefiera — users.must_change_password = true obliga a
      cambiarla en el primer inicio de sesión; queda en audit_log (action
      password_reset). Sin autorecuperación por correo (spec
      password_recovery).</decision>
    <decision n="T1.2">MODELO DE DATOS: users = espejo 1:1 de auth.users
      (Supabase Auth) — id compartido; usuarios/rejilla/roles viven en el
      esquema público. Roles como tabla N:N user_roles (spec cardinality);
      el catálogo de roles NO tiene tabla (fijo, spec no_crud — CHECK enum en
      user_roles.role).</decision>
    <decision n="T1.3">AUTENTICACIÓN: hashing bcrypt y emisión de JWT
      delegados a Supabase Auth (GoTrue) — access 15-30 min en memoria del
      front + refresh 7 días en cookie httpOnly, HTTPS. Política de
      contraseña (8+ con mayúsculas y números) se valida en FORMULARIO/Edge
      Function (Supabase solo garantiza longitud). Lockout 5 intentos/15 min
      = NO nativo de Supabase (stack): Edge Function `login-custom` +
      tabla [failed_logins](BD/failed_logins.md) con parámetros editables
      en T2 (system_parameters: login_attempts, lockout_minutes — decisión
      T2.2 corregida, coherente con stack "Parámetros tomados de
      Configuración"). 2FA y SSO NO implementados (spec).</decision>
    <decision n="T1.4">CATEGORÍAS ASIGNADAS = user_category_assignments
      (N:N users↔categories de M1, solo para usuarios con rol Técnico, spec
      user_entity). Uso: FILTRO de especialidad al asignar OT (V2.2) y en
      listados — NO es restricción de permisos (Mantenimiento puede asignar
      fuera de categoría).</decision>
    <decision n="T1.5">GUARDS DE INTEGRIDAD (app + trigger): un usuario no
      puede desactivarse a sí mismo ni quitarse su último rol; debe existir
      SIEMPRE ≥1 usuario Activo con rol Administrador (bloqueo con mensaje);
      alta/edición = flujo único en modal (V-T1.1 → M-T1.1).</decision>
    <decision n="T1.6">AVATAR en bucket privado `usuarios` (lectura 4 roles,
      escritura solo vía política de storage/Edge Function; path en
      users.avatar_path) — patrón de los buckets `activos`/`ot_evidencias`.
      La foto se sube SOLO en edición (el path de storage requiere el id del
      usuario — el alta la deja vacía y se completa después, user
      confirmó). Teléfono queda cargado (spec lo define para futura
      integración WhatsApp — sin uso activo hoy).</decision>
    <decision n="T1.7">MULTI-ROL: sin selector de modo ni "rol activo" — la
      app opera con la UNIÓN de permisos de user_roles en todo momento (spec
      permission_combination); audit_log registra solo el usuario, nunca el
      rol bajo el que actuó.</decision>
    <decision n="T1.8">last_sign_in_at se actualiza en cada login exitoso
      (Edge Function `login-custom`) — campo informativo "Último acceso" en
      V-T1.1;
      los intentos fallidos de login NO generan audit_log (los gestiona
      Supabase Auth; el T3 lista creación/modificación/roles/desactivación/
      reset, no intentos).</decision>
    <decision n="T1.9">CONTRASEÑA INICIAL EN ALTA (user confirmó): la
      Edge Function `admin-users` usa por defecto la contraseña
      predeterminada `PlayaBlanca2026` para usuarios nuevos — se muestra al
      Administrador para transmisión por canal externo y el alta siempre
      fija must_change_password = true (S-T1.2 la obliga a cambiar en el
      primer inicio). Los RESETS (F-T1.2) usan la MISMA contraseña
      predeterminada (user confirmó — actualiza T1.1).</decision>
  </decisions_taken>

  <navigation>
    <lateral_menu admin_only="true">
      <item view="V-T1.1" label="Usuarios">Módulo T1 — ya declarado en
        admin_items de [02-ordenes-de-trabajo-flujos](02-ordenes-de-trabajo-flujos.md)
        (Usuarios | Configuración | Auditoría — solo rol Administrador).
        Con badge con el conteo de usuarios Activos.</item>
    </lateral_menu>
    <login_flow>Las pantallas de Login y Cambio de contraseña forzado son
      FULL-SCREEN (fuera de la app autenticada) — preceden a cualquier ítem
      de menú.</login_flow>
    <by_role>
      <administrador>Ítem completo (listado + CRUD + reset).</administrador>
      <otros_roles>Sin ítem (T1 es CRUD exclusivo de Administrador — spec
        user_entity; Mantenimiento/Calidad/Técnico sin acceso a Usuarios).
      </otros_roles>
    </by_role>
  </navigation>

  <views>
    <view id="V-T1.1" name="Usuarios" type="principal">
      <entry_point>Menú lateral → Usuarios (solo Admin).</entry_point>
      <columns>Nombre | Correo | Roles (badges) | Categorías (solo si tiene
        rol Técnico) | Estado (Activo/Inactivo) | Tarifa/h | Último acceso |
        acciones.</columns>
      <filters>Búsqueda por nombre/correo · Rol · Estado — + Exportar
        PDF/Excel (utilitario F7.3 del Módulo 7 con filtros
        aplicados).</filters>
      <actions>Nuevo usuario (→ M-T1.1) · fila → Editar (→ M-T1.1) · fila →
        Restablecer contraseña (→ M-T1.2) · fila → Historial (vista embebida
        del audit_log de la ficha — cross-module T3) · toggle Activo/Inactivo
        (con guards T1.5).</actions>
      <empty_state>Sin resultados con los filtros aplicados.</empty_state>
    </view>

    <modal id="M-T1.1" name="Nuevo / Editar usuario">
      <trigger>"Nuevo usuario" o fila → Editar en V-T1.1.</trigger>
      <fields>Nombre completo · Correo (único — bloquea si existe) · Teléfono
        (opcional) · Foto de perfil (upload a bucket `usuarios` — solo en
        edición, decisión T1.6) · Rol(es) —
        checkboxes de los 4 roles fijos (multi-selección, spec) · Categorías
        asignadas — selector N:M de categorías de activos, SOLO visible si
        tiene marcado el rol Técnico (decisión T1.4) · Estado
        (Activo/Inactivo) · Tarifa por hora (USD/h — column users.hourly_rate,
        M7; vacío = tarifa global).</fields>
      <save>Edge Function `admin-users` (service role): crea/actualiza
        auth.users (correo) + users + sincroniza user_roles y
        user_category_assignments → audit_log (create/update con cambios
        campo-a-campo; los roles se registran como
        "asignación de roles").</save>
      <guards>Ver decisión T1.5 (auto-desactivación, último rol, último
        Admin).</guards>
      <deactivate>Toggle Inactivo = is_active=false (audit action
        deactivate) — NUNCA DELETE: preserva historial completo (OTs,
        mediciones, movimientos — spec management).</deactivate>
    </modal>

    <modal id="M-T1.2" name="Restablecer contraseña">
      <trigger>Fila → "Restablecer contraseña" en V-T1.1 (solo
        Admin).</trigger>
      <content>Advertencia ("Se aplicará la contraseña predeterminada del
        sistema") → "Confirmar restablecimiento" → el sistema muestra la
        contraseña en texto con botón Copiar (una sola vez en pantalla —
        decisiones T1.1/T1.9).</content>
      <effect>Edge Function `admin-users`: auth.admin.updateUserById con la
        contraseña predeterminada + users.must_change_password = true →
        audit_log (action password_reset, reason "Reset por Administrador").
        La contraseña NO vive en ninguna tabla del sistema (se transmite por
        canal externo — decisión T1.1).</effect>
      <after>El usuario la usa en Login → pantalla de cambio forzado
        (F-T1.3).</after>
    </modal>

    <screen id="S-T1.1" name="Login (full-screen)">
      <fields>Correo + contraseña.</fields>
      <rules>Edge Function `login-custom` (único camino de login): valida
        correo+clave vía Supabase Auth (bcrypt), aplica lockout custom con
        failed_logins y los parámetros de T2 (5 intentos / 15 min —
        decisión T1.3) · HTTPS · sin 2FA/SSO · sin autorecuperación (el
        "¿Olvidaste tu contraseña?" indica contactar al Administrador —
        spec).</rules>
      <error_states>Credenciales inválidas · usuario Inactivo (bloqueo
        también en app) · cuenta bloqueada (mostrar tiempo restante del
        lockout).</error_states>
    </screen>

    <screen id="S-T1.2" name="Cambio de contraseña forzado (full-screen)">
      <trigger>Inicio de sesión con users.must_change_password = true (alta
        inicial, reset por Admin).</trigger>
      <fields>Nueva contraseña (×2) con la política visible.</fields>
      <success>Flag a false → entra a la app (V7.1 dashboard u home por
        rol) → audit_log (update: must_change_password).</success>
    </screen>
  </views>

  <flows>

    <flow id="F-T1.1" name="Alta / edición / desactivación de usuario" actor="Administrador">
      <entry>V-T1.1 → "Nuevo usuario" o fila → Editar → M-T1.1.</entry>
      <steps>
        <step>1. Completa perfil, roles (checkboxes), categorías (si Técnico),
          estado y tarifa; guarda.</step>
        <step>2. Edge Function `admin-users`: CREATE → auth.admin.createUser
          (contraseña inicial predeterminada PlayaBlanca2026, decisión
          T1.9; must_change_password=true) + INSERT users
          + user_roles + user_category_assignments; UPDATE → auth email +
          users + sync de roles/categorías (alta/baja de filas
          N:N).</step>
        <step>3. audit_log: create/update (cambios campo-a-campo incluyendo
          "asignación de roles"; desactivación = action deactivate).</step>
      </steps>
      <rules>CRUD exclusivo de Administrador (spec management) · correo
        UNIQUE · sin DELETE físico (solo baja lógica) · guards T1.5 ·
        rechazo de roles fuera del catálogo fijo (CHECK en
        user_roles).</rules>
      <tables written="[users](BD/users.md), [user_roles](BD/user_roles.md), [user_category_assignments](BD/user_category_assignments.md), [audit_log](BD/audit_log.md)" read="[categories](BD/categories.md), [audit_log](BD/audit_log.md)"/>
      <storage>Bucket `usuarios` para avatares (si cambia la foto).</storage>
    </flow>

    <flow id="F-T1.2" name="Restablecer contraseña" actor="Administrador">
      <entry>V-T1.1 → fila → Restablecer → M-T1.2.</entry>
      <steps>
        <step>1. "Confirmar restablecimiento": Edge Function `admin-users` →
          auth.admin.updateUserById (contraseña predeterminada, decisión
          T1.9) + users.must_change_password = true.</step>
        <step>2. La respuesta muestra la contraseña al Admin con botón
          Copiar (una sola vez en pantalla — decisión T1.1); no persiste en
          tablas.</step>
        <step>3. audit_log (action password_reset, user_id = usuario
          reseteado — spec T3 "Reseteo de contraseña").</step>
      </steps>
      <rules>La contraseña se transmite por canal externo (spec: no existe
        autorecuperación) · cualquier cambio de clave posterior solo vuelve
        a pasar por aquí.</rules>
      <tables written="[users](BD/users.md), [audit_log](BD/audit_log.md)" read="[]"/>
    </flow>

    <flow id="F-T1.3" name="Inicio de sesión y primer cambio de clave" actor="usuario">
      <entry>S-T1.1 Login → (si aplica) S-T1.2 → app.</entry>
      <steps>
        <step>1. Login vía Edge Function `login-custom`: si
          failed_logins.locked_until > now() → rechazo con tiempo restante;
          si no → Supabase Auth valida correo+clave (bcrypt) → falla =
          failed_attempts+1 y bloqueo al alcanzar system_parameters
          .login_attempts durante lockout_minutes (decisión T1.3) ·
          emite JWT (access 15-30 min en memoria + refresh 7 días en cookie
          httpOnly).</step>
        <step>2. Si users.is_active = false → rechazo ("Usuario
          inactivo").</step>
        <step>3. Login exitoso → limpia failed_logins; si
          must_change_password → S-T1.2: nueva clave (política validada en
          formulario) → auth.admin.updateUserById + flag false → audit_log
          (update).</step>
        <step>4. Ingreso a la app; hook → users.last_sign_in_at
          (decisión T1.8).</step>
      </steps>
      <rules>HTTPS obligatorio · sin 2FA/SSO (spec) · "¿Olvidaste tu
        contraseña?" = aviso de contactar al Admin (sin flujo self-service —
        spec password_recovery).</rules>
      <tables written="[users](BD/users.md) (flag/last_sign_in_at), [failed_logins](BD/failed_logins.md), [audit_log](BD/audit_log.md) (solo cambio forzado)" read="[users](BD/users.md), [user_roles](BD/user_roles.md), [system_parameters](BD/system_parameters.md) (login_attempts/lockout_minutes)"/>
    </flow>

    <flow id="F-T1.4" name="Autorización (multi-rol unión)" actor="sistema / middleware">
      <entry>Cada request y cada render de pantalla.</entry>
      <steps>
        <step>1. JWT (Supabase) → sesión; el front resuelve
          UNION(user_roles.role) del usuario = capacidades efectivas (spec
          permission_combination — sin selector de modo).</step>
        <step>2. Middleware de ruta: valida rol/permiso por endpoint (spec
          api_protection) — ej. Rutas de CRUD usuarios → solo
          administrador.</step>
        <step>3. RLS en Postgres como defensa profunda: helpers
          is_admin() / has_role('…') sobre user_roles + is_assigned_wo() (M2)
          — el Técnico solo escribe sus OTs; el Calidad toca solo
          cumplimiento/mediciones; etc.</step>
        <step>4. Dashboard: set de KPIs = unión de los sets de sus roles
          (spec dashboard_combination → M7).</step>
      </steps>
      <rules>Permisos del catálogo T1 = fuente de verdad funcional; RLS +
        middleware la refuerzan; audit_log nunca discrimina rol
        (T1.7).</rules>
      <tables read="[user_roles](BD/user_roles.md)" written="[]"/>
    </flow>

  </flows>

  <cross_module_flows>
    <to module="1">assets.responsible_user_id y autorías (created_by /
      usage_counter_updated_by) → users; categorías de
      user_category_assignments = categories (M1).</to>
    <to module="2">wo_technicians.user_id → users (los técnicos del sistema
      son usuarios con rol Técnico); V2.2 asignación usa el filtro de
      especialidad (decisión T1.4); reasignación notifica por push
      (T2).</to>
    <to module="3/4/5/6">Todas las autorías (created_by/updated_by/
      recorded_by) y los contadores de OTs por técnico (M7) dependen de
      users.</to>
    <to module="M7">users.hourly_rate (tarifa por usuario) + fallback
      system_parameters.labor_hourly_rate — decisión 7.4; los sets de KPIs
      por rol leen user_roles.</to>
    <to module="T2">Configuración y Usuarios son los dos ítems exclusivos
      del Administrador (mismo grupo admin_items); T2 no gestiona
      usuarios.</to>
    <to module="T3">audit_log.user_id referencia users (NULL = sistema);
      la vista embebida "Historial" de V-T1.1 muestra los cambios del
      propio usuario sobre fichas de usuarios (mismo log filtrado).</to>
  </cross_module_flows>

  <notifications>
    <event_changes>SIN eventos nuevos — alta, edición, reset y bloqueo por
      intentos NO generan correos (el catálogo T2 queda intacto; el reset
      justamente evita el correo de autorecuperación).</event_changes>
    <lockout_notice>El bloqueo por 5 intentos se informa EN la pantalla de
      login (mensaje local), no por correo.</lockout_notice>
  </notifications>

  <supabase_mapping>
    <tables written="[users](BD/users.md), [user_roles](BD/user_roles.md), [user_category_assignments](BD/user_category_assignments.md), [audit_log](BD/audit_log.md)" read="[user_roles](BD/user_roles.md), [categories](BD/categories.md)"/>
    <auth>Supabase Auth (auth.users) 1:1 con users.id · Edge Function
      `admin-users` (service role) encapsula createUser /
      updateUserById / resetPassword — ÚNICO camino para tocar auth.users
      desde la app · Edge Function `login-custom` aplica el lockout
      (failed_logins + parámetros T2) y la política de contraseña en
      formulario (decisión T1.3 corregida — coherente con stack);
      duraciones de token en Supabase Auth.</auth>
    <rls>
      users: SELECT (4 roles — el perfil es visible para nombres/audit) /
      UPDATE = Admin (o el propio usuario para su avatar/menores) /
      INSERT = Admin vía service role / DELETE prohibido. ·
      user_roles: SELECT (Admin + consultas de soporte) /
      INSERT/UPDATE/DELETE = solo service role (Admin vía M-T1.1). ·
      user_category_assignments: mismo patrón que user_roles. ·
      audit_log: ver T3 (append-only, vista general solo Admin).
    </rls>
    <storage>Bucket privado `usuarios` (avatars) — lectura 4 roles,
      escritura solo con sesión Admin (política de storage).</storage>
    <sequences>Sin sequences (UUID; el identificador es el de
      auth.users).</sequences>
    <cron>sin pg_cron en T1.</cron>
    <push>sin FCM en T1 (el push vive en T2 — asignación de OTs).</push>
  </supabase_mapping>

  <open_pending_items>
    <item>Exportar PDF/Excel de V-T1.1 (utilitario F7.3 del Módulo 7 con
      filtros aplicados) — pendiente de construir M7.</item>
    <item>Invitación por correo en el alta de usuario (en vez de la
      contraseña inicial predeterminada) — futuro; hoy el Admin transmite
      la contraseña por canal externo.</item>
    <item>Uso activo del teléfono cargado (integración WhatsApp Business
      API) — declarado futuro en stack.</item>
    <item>Reevaluar 2FA/SSO cuando el cliente lo solicite (decisión
      explícita del cliente, registrada en spec).</item>
    <item>user_roles: posibilidad futura de permisos granulares por
      usuario (hoy: catálogo fijo de 4 roles — spec no_crud).</item>
  </open_pending_items>

</module>
```
