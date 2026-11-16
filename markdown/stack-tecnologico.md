# Stack Tecnológico — CMMS Hotelero

Decisión acordada: **Supabase Free por el momento** (costo $0 durante desarrollo y primera operación).

```xml
<stack_technology>
  <decision name="supabase_free_tier">
    El sistema se construye sobre el tier gratuito de Supabase (base de datos,
    autenticación, storage, edge functions y cron). Sin VPS ni servidor propio.
    Costo operativo $0 durante desarrollo y primera puesta en operación.
    Límites conocidos del tier gratuito: 500 MB de base de datos, 2 proyectos,
    pausa automática de proyectos tras 7 días sin actividad (requiere keep-alive
    periódico), límites de invocaciones de edge functions y de correos del
    proveedor transaccional. Cuando la operación 24/7 del hotel lo exija, el
    primer costo inevitable será Supabase Pro (migración sin cambiar código,
    solo cambiar credenciales).
  </decision>

  <architecture>
    <diagram>
      Frontend React + Vite (Web + PWA) — alojado en Cloudflare Pages
        (gratis — decisión cerrada)
          │
          ├─ Supabase Auth (JWT access en memoria, refresh en cookie httpOnly)
          ├─ Supabase Postgres (PostgREST + RLS + pg_cron + triggers)
          ├─ Supabase Edge Functions (lógica de negocio crítica, Deno/TypeScript)
          ├─ Supabase Storage (fotos, manuales, facturas, evidencias)
          ├─ FCM Web Push + Edge Function sender (push a técnicos)
          └─ Proveedor de correo transaccional (Brevo — 300 correos/día, tier
             gratis)
    </diagram>
    <hosting_frontend>Cloudflare Pages (tier gratis) — decisión cerrada.
      Build estático de Vite, sirve también como PWA.</hosting_frontend>
    <hosting_backend>SUPABASE — no hay backend propio hospedado.</hosting_backend>
  </architecture>

  <layers>

    <layer name="base_de_datos">
      <engine>Supabase PostgreSQL</engine>
      <orm>Tipado compartido vía tipos generados de Supabase + Zod en el front
        (sin ORM backend, ya que no hay servidor propio). Tipos de dominio
        derivados de la especificación viven en packages/shared.</orm>
      <features>
        <feature>Kardex de inventario con costo CONGELADO en cada movimiento
          (snapshot en la fila, no lookup al calcular).</feature>
        <feature>Log de auditoría como tabla append-only SIN update ni delete
          (refuerzo a nivel de permisos RLS, además de la lógica de aplicación).</feature>
        <feature>pg_cron para: generación de OTs preventivas, proyecciones de
          calendario, resúmenes diarios de correo, avisos por vencer
          (garantías/contratos/certificaciones), cálculo de estados calculados
          (Vigente/Por vencer/Vencido).</feature>
        <feature>Triggers PostgreSQL que escriben la auditoría — el cliente no
          puede falsear el log (cumple T3: toda modificación relevante queda
          registrada).</feature>
        <feature>Vistas materializadas/vistas para KPIs pesados (MTTR, MTBF,
          costo por categoría).</feature>
      </features>
    </layer>

    <layer name="seguridad_y_permisos">
      <first_line>RLS (Row Level Security) — la matriz de permisos de los 4
        roles se implementa como políticas RLS; el cliente nunca accede a datos
        sin pasar por ellas.</first_line>
      <roles>
        <note>Los roles de negocio (Mantenimiento, Técnico, Administrador,
          Calidad) NO son roles de Postgres por usuario — se modelan en tabla
          user_roles (muchos a muchos, unión de permisos, catálogo FIJO) y las
          políticas RLS leen los roles del usuario desde esa tabla.</note>
      </roles>
      <rls_coverage>Activos, OTs, reportes de daño, inventario, proveedores,
        planes PM, certificaciones, mediciones, usuarios, configuración,
        auditoría.</rls_coverage>
      <audit_immutability>Bloqueo de UPDATE/DELETE en tablas de auditoría por
        RLS + triggers.</audit_immutability>
    </layer>

    <layer name="autenticacion">
      <provider>Supabase Auth (GoTrue)</provider>
      <method>Correo + contraseña (correo = identificador de login)</method>
      <password_hashing>bcrypt interno de Supabase (nunca texto plano; no se
        maneja manualmente)</password_hashing>
      <session_management>
        <access_token>En memoria del front (contexto React), NO en
          localStorage — cumple T1.</access_token>
        <refresh_token>Cookie httpOnly + secure SETEADA POR EDGE FUNCTION:
          `login-custom` emite la cookie inicial al entrar y `auth/refresh`
          la renueva (una SPA estática no puede escribir cookies httpOnly
          desde JavaScript — por eso el intercambio es server-side);
          cumple T1.</refresh_token>
        <durations>Access corto / refresh de larga duración, alineados a los
          parámetros de Configuración (15-30 min / 7 días).</durations>
      </session_management>
      <api_protection>Cada Edge Function valida el JWT y los roles del usuario;
        PostgREST aplica RLS automáticamente. Todos los accesos sobre
        HTTPS.</api_protection>
      <password_policy>Mínimo 8 caracteres, mayúsculas y números: validado en el
        formulario de registro/cambio (y en el flujo de reseteo), ya que
        Supabase solo garantiza longitud mínima por configuración.</password_policy>
      <failed_login_lockout>
        5 intentos fallidos → bloqueo temporal 15 minutos. NO es nativo de
        Supabase: se implementa con tabla failed_logins + Edge Function de login
        custom que aplica el conteo y el bloqueo. Parámetros tomados de
        Configuración.
      </failed_login_lockout>
      <password_recovery>
        <self_service>NO implementado (decisión de la spec).</self_service>
        <admin_reset>Edge Function con service role: el Administrador aplica
          la contraseña predeterminada del sistema (decisión T1.9); Supabase
          obliga cambio en el siguiente inicio de sesión (flag de cambio
          pendiente). Registrado en auditoría.</admin_reset>
      </password_recovery>
      <two_factor_auth>NO implementado (decisión explícita del cliente).</two_factor_auth>
      <sso>NO implementado (el hotel no usa Google Workspace ni Microsoft 365).</sso>
    </layer>

    <layer name="api_y_logica_de_negocio">
      <pattern>API híbrida sin backend propio</pattern>
      <postgrest>CRUD estándar de entidades, protegido por RLS (lecturas y
        escrituras simples).</postgrest>
      <edge_functions>
        <engine>Supabase Edge Functions (Deno, TypeScript)</engine>
        <responsibilities>
          <item>Cierre de OT con la pregunta OBLIGATORIA de garantía (crea el
            registro de garantía vinculado a la OT).</item>
          <item>Reapertura de OT (solo Mantenimiento, motivo obligatorio,
            consecuencias sobre garantía/costos/planes).</item>
          <item>Reasignación de OT por técnico con todas sus restricciones
            + push.</item>
          <item>Consumos/devoluciones con costo congelado y stock negativo
            permitido + alerta inmediata.</item>
          <item>Ajustes, transferencias y conteos físicos (solo
            Mantenimiento).</item>
          <item>Conversión/descarte de Reportes de Daño.</item>
          <item>Generación/recalculo de OTs preventivas (invocado por
            pg_cron).</item>
          <item>Envío de correos (eventos inmediatos y resúmenes diarios) y
            push.</item>
          <item>Login custom con bloqueo por intentos fallidos.</item>
          <item>Generación del adjunto de los reportes PROGRAMADOS (M7 F7.3
            — server-side para adjuntar al correo). Las exportaciones bajo
            demanda (listados y reportes con filtros) son EXCLUSIVAMENTE en
            cliente (exceljs/jsPDF).</item>
        </responsibilities>
        <rule>La tabla de eventos de notificaciones (T2) es la ÚNICA fuente de
          configuración de envíos — nunca hardcodear destinatarios ni modos en
          la lógica de negocio.</rule>
      </edge_functions>
      <diameter_note>Reglas complejas de dominio que requieren transacciones
        múltiples se agrupan en una sola Edge Function (un solo request), con
        transacción en la base vía RPC/pg functions cuando haga falta.</diameter_note>
    </layer>

    <layer name="frontend">
      <framework>React 19 + TypeScript + Vite</framework>
      <ui>Tailwind CSS + shadcn/ui (formularios, tablas, modales)</ui>
      <state>TanStack Query (datos) + Zustand (sesión: access token en
        memoria)</state>
      <routing>React Router</routing>
      <forms>react-hook-form + zod (validación alineada a reglas de la
        spec)</forms>
      <calendar>FullCalendar — mes/semana/día, eventos clicables, drag &amp; drop
        con permisos (requisito del módulo 3)</calendar>
      <charts>Recharts — tendencias de mediciones con bandas min/max, KPIs del
        dashboard</charts>
      <export>exceljs + jsPDF en cliente (respetando filtros aplicados)</export>
      <design_tokens>
        <palette name="azul_corporativo_slate">DECISIÓN CERRADA — base de
          colores de toda la UI. Implementación: variables CSS oklch de
          shadcn/ui (--primary, --background, etc.).</palette>
        <base theme="light">
          <token name="primary">blue-600 #2563eb (hover blue-700) — botones,
            links, nav activa, serie principal de charts</token>
          <token name="background / card">white / white — fondo y paneles</token>
          <token name="text / muted">slate-900 #0f172a / slate-500 #64748b</token>
          <token name="border">slate-200 #e2e8f0 — tablas y separadores</token>
        </base>
        <base theme="dark">
          <token name="primary">blue-500 #3b82f6</token>
          <token name="background / card">slate-950 #020617 / slate-900
            #0f172a</token>
          <token name="text / muted">slate-100 #f1f5f9 / slate-400 #94a3b8</token>
          <token name="border">slate-800 #1e293b</token>
        </base>
        <semantic_fixed>
          <state color="verde #16a34a (dark: green-500)">OK · Cerrada ·
            Dentro de rango · Stock sano</state>
          <state color="ámbar #f59e0b">Pendiente · Por vencer (garantías,
            contratos, certificaciones)</state>
          <state color="rojo #dc2626 (dark: red-500)">Vencida · Fuera de
            rango (Evento 9) · Stock negativo · crítico</state>
          <state color="azul (primary)">En proceso (badges de OT)</state>
          <state color="slate-400">Inactiva / deshabilitada</state>
        </semantic_fixed>
        <calendar_m3>Preventiva futura = azul primario (sólido, clicable) ·
          VENCIDA = rojo (mismo color en calendario y lista — regla F3.4) ·
          Ejecutada/cerrada = verde · Correctiva = ámbar · Proyección sin
          OT = mismo azul en estilo tenue.</calendar_m3>
        <charts>Recharts: serie principal = azul primary; series secundarias
          = slate-500, teal-500, ámbar-500; bandas min/max de mediciones
          (M6): relleno verde/rojo al 20% de opacidad según dentro/fuera de
          rango.</charts>
        <dark_mode>Clase .dark en &lt;html&gt; + persistencia en localStorage;
          botón de toggle en el menú de usuario (header). shadcn/ui ya es
          dark-ready → sin coste extra por componente.</dark_mode>
        <a11y>Contraste AA (4.5:1 mínimo en texto); el color NUNCA es el
          único indicador — siempre badge/etiqueta + texto (la spec ya
          muestra badges de estado).</a11y>
      </design_tokens>
    </layer>

    <layer name="pwa_y_push">
      <pwa>vite-plugin-pwa + Workbox (instalable en dispositivos de técnicos,
        service worker, offline básico para lectura de OTs asignadas)</pwa>
      <push>
        <mechanism>Firebase Cloud Messaging (FCM) — plan gratuito, Web Push
          VAPID.</mechanism>
        <sender>Supabase Edge Function envía el push (suscripción del técnico
          almacenada en tabla push_subscriptions).</sender>
        <triggers>OT asignada, OT reasignada (entra y sale), OT propia
          modificada por otro usuario — según catálogo T2.</triggers>
        <non_triggers>OT reabierta, comentarios nuevos en la OT.</non_triggers>
        <dependency>Requiere la PWA instalada en el dispositivo del técnico
          (ya definido en la spec).</dependency>
      </push>
    </layer>

    <layer name="notificaciones_por_correo">
      <provider>Brevo (300 correos/día gratis ≈ 9.000/mes) — decisión
        cerrada; capa de envío aislada en una Edge Function para poder
        cambiar de proveedor sin tocar lógica.</provider>
      <modes>Inmediato / Resumen diario, por evento, según la tabla de
        configuración T2 (modos, destinatarios texto libre, parámetros como
        días de anticipación).</modes>
      <scheduler>pg_cron dispara los resúmenes diarios a la hora configurada y
        los avisos por vencer (garantías, contratos, certificaciones, stock
        mínimo, OTs preventivas vencidas).</scheduler>
      <extensibility>El campo "canal" de T2 queda diseñado para agregar
        WhatsApp Business API en el futuro sin tocar la lógica de eventos
        (reemplazar solo el transport).</extensibility>
    </layer>

    <layer name="storage">
    <provider>Supabase Storage (bucket privados con RLS)</provider>
    <uses>Documentación de activos/componentes, fotos de evidencia OT
      (antes/después), adjuntos de garantías, contratos, certificaciones,
      facturas de entrada a inventario, fotos de perfil.</uses>
    <retention>LIMPIEZA AUTOMÁTICA (pg_cron + Edge Function): archivos
      TEMPORALES/evidencias (fotos de evidencia OT, adjuntos volátiles,
      exportes) con más de 60 días de antigüedad. La documentación
      permanente NO se toca (manuales, contratos, certificaciones,
      facturas, garantías, fotos de perfil).</retention>
    </layer>

    <layer name="monorepo">
      <tool>pnpm workspaces + Turborepo</tool>
      <structure>
        apps/web — React + Vite (sirve Web y PWA)
        packages/shared — tipos Zod/TS y constantes derivados de la
        especificación (estados de OT, catálogos fijos, reglas compartidas)
        supabase/functions — Edge Functions (Deno/TypeScript)
        supabase/migrations — esquema SQL, RLS, triggers, pg_cron
      </structure>
    </layer>

  </layers>

  <free_tier_constraints>
    <constraint>Supabase free: 500 MB de datos, 2 proyectos, edge functions con
      límite de invocaciones, proyecto PAUSADO tras 7 días de inactividad →
      keep-alive A CARGO DEL OPERADOR (el sistema estará en uso continuo;
      si se suspende el uso, basta un ping manual o cron-job.org).</constraint>
    <constraint>Entorno simple: los 2 proyectos del tier gratis = desarrollo
      y producción, SIN staging intermedio (migraciones vía Supabase CLI).</constraint>
    <constraint>Storage free: 1 GB de archivos → LIMPIEZA AUTOMÁTICA de
      archivos TEMPORALES/evidencias con más de 60 días de antigüedad
      (pg_cron + Edge Function). La documentación permanente NO se limpia:
      manuales de activos, contratos, certificaciones, facturas y
      garantías se conservan.</constraint>
    <constraint>Correo: Brevo 300/día — suficiente con el
      modo resumen diario; vigilar volumen de eventos inmediatos.</constraint>
    <constraint>FCM y Cloudflare Pages: sin límites prácticos para este
      volumen.</constraint>
    <constraint>Antes de operación 24/7 real del hotel, evaluar Supabase Pro
      (único costo previsible). Migración = cambiar credenciales, sin rediseño
      de arquitectura.</constraint>
  </free_tier_constraints>

  <explicitly_rejected>
    <item>VPS y NestJS/Django como backend hospedado — descartado por
      restricción de costo; solo viable si en el futuro se paga hosting.</item>
    <item>Supabase Auth con políticas de bloqueo nativas — no existen, se cubre
      con Edge Function custom.</item>
    <item>Servicios de push de terceros con tier limitado (OneSignal) — se usa
      FCM directo, sin dependencia de un tercero con cap de suscriptores.</item>
  </explicitly_rejected>

  <stack_summary>
    React 19 + Vite + TypeScript + Tailwind/shadcn + FullCalendar + Recharts
    | Supabase (Postgres + RLS + pg_cron + Auth + Storage + Edge Functions)
    | Cloudflare Pages | FCM push | Brevo correos | pnpm + Turborepo
    | COSTO: $0 (tier gratuito)
  </stack_summary>
</stack_technology>
```
