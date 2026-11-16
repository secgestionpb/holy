# Módulo T1: Usuarios y Roles (Transversal)

> **Entregables:** spec (abajo) · **Flujos/Interfaces:** [T1-usuarios-y-roles-flujos.md](T1-usuarios-y-roles-flujos.md)
> **Tablas BD:** [users](BD/users.md) · [user_roles](BD/user_roles.md) · [user_category_assignments](BD/user_category_assignments.md) · [failed_logins](BD/failed_logins.md) (lockout custom) — **compartidas:** [audit_log](BD/audit_log.md) (usuarios/roles/reset) — **referenciadas:** [categories](BD/categories.md) · [system_parameters](BD/system_parameters.md) (tarifa global fallback — M7; login_attempts/lockout_minutes — T2)

```xml
<module id="T1" name="Usuarios y Roles" type="transversal">
  <roles_catalog fixed="true">
    <role name="Mantenimiento">
      <description>Jefes de mantenimiento. Rol operativo de mayor alcance.</description>
      <permissions>
        CRUD de activos, CRUD/ejecuta/cierra/modifica OTs de cualquier técnico,
        reporta daños, CRUD de inventario (ítems, bodegas, entradas,
        transferencias, ajustes, conteos), consume/devuelve en cualquier OT,
        CRUD de proveedores/contratistas/contratos, CRUD de planes de PM y
        checklists, gestiona renovación operativa de certificaciones (consulta
        el catálogo, coordina contratista), sin acceso a Configuración ni a
        Usuarios.
      </permissions>
    </role>
    <role name="Técnico">
      <description>Ejecuta trabajo de campo.</description>
      <permissions>
        Consulta activos, ejecuta/cierra/modifica solo sus OTs asignadas,
        reasigna (reemplaza) sus propias OTs a otro técnico con observación
        obligatoria, reporta daños, consume/devuelve repuestos solo en sus OTs,
        consulta planes de PM (sin editar), sin acceso a proveedores,
        certificaciones, mediciones, usuarios ni configuración. Sin acceso a la
        vista de calendario de PM (sí a la vista de lista, limitada a sus OTs).
      </permissions>
    </role>
    <role name="Administrador">
      <description>Supervisión y gestión de usuarios.</description>
      <permissions>
        Solo CONSULTA en todos los módulos operativos (activos, OTs, inventario,
        proveedores, PM, cumplimiento, mediciones), dashboard completo
        consolidado de todos los KPIs, CRUD completo de Usuarios y Roles, CRUD
        completo de Configuración/Opciones, acceso exclusivo al Log de
        Auditoría. Sin capacidad de crear/modificar OTs, sin devoluciones, sin
        reportar daños.
      </permissions>
    </role>
    <role name="Calidad">
      <description>
        Asociado a Mantenimiento, pero enfocado exclusivamente en evaluar
        cumplimiento de obligaciones legales y estándares de calidad.
      </description>
      <permissions>
        CRUD completo de Cumplimiento Normativo (certificaciones) y de
        Mediciones (tipos y registros), consulta de Activos/OTs/Proveedores/PM,
        puede reportar daños pero NO puede crear OTs, sin acceso a Inventario,
        Usuarios ni Configuración.
      </permissions>
    </role>
    <no_crud>El catálogo de roles es FIJO — no existe CRUD para crear roles
      nuevos.</no_crud>
  </roles_catalog>

  <multi_role_support> <!-- BD: user_roles -->
    <cardinality>Un usuario puede tener MÚLTIPLES roles simultáneamente
      (relación muchos a muchos Usuario↔Rol).</cardinality>
    <permission_combination>UNIÓN — el usuario accede a todo lo permitido por
      CUALQUIERA de sus roles asignados, sin necesidad de "cambiar de modo" en
      la interfaz.</permission_combination>
    <dashboard_combination>El dashboard combina en un solo set de checkboxes
      todos los KPIs disponibles de todos sus roles.</dashboard_combination>
    <audit_logging>El log de auditoría <!-- BD: audit_log.md --> registra solo
      el USUARIO que ejecuta la
      acción, SIN distinguir bajo qué rol específico actuó.</audit_logging>
  </multi_role_support>

  <user_entity> <!-- BD: users.md -->
    <fields>
      <field>nombre completo</field>
      <field>correo electrónico (único, usado como identificador de login)</field>
      <field>teléfono (opcional, para futura integración WhatsApp)</field>
      <field>rol(es) asignado(s) — selección múltiple
        <!-- BD: user_roles --></field>
      <field>categorías asignadas (opcional, solo aplicable a Técnico, para
        filtrar especialidad) <!-- BD: user_category_assignments --></field>
      <field>estado (Activo/Inactivo — nunca se elimina un usuario con
        historial, solo se desactiva)</field>
      <field>fecha de creación / último acceso</field>
      <field>foto de perfil (opcional)</field>
    </fields>
    <management>CRUD exclusivo de Administrador. Toda acción queda en el log de
      auditoría. Desactivar un usuario preserva su historial completo (OTs,
      mediciones, movimientos, etc.).</management>
  </user_entity>

  <authentication>
    <method>Correo + contraseña</method>
    <password_hashing>bcrypt o argon2 (nunca texto plano)</password_hashing>
    <session_management>
      <token_type>JWT</token_type>
      <access_token_duration>Corta duración (ej. 15-30 min)</access_token_duration>
      <refresh_token_duration>Mayor duración (ej. 7 días)</refresh_token_duration>
      <refresh_token_storage>Cookie httpOnly + secure</refresh_token_storage>
      <access_token_storage>En memoria del front, NO en localStorage</access_token_storage>
    </session_management>
    <api_protection>Middleware de autenticación en cada endpoint, validando JWT
      y rol/permiso correspondiente a cada ruta.</api_protection>
    <failed_login_lockout>Ej. 5 intentos fallidos → bloqueo temporal de 15
      minutos. <!-- BD: failed_logins (lockout custom — Edge Function
      login-custom + system_parameters) --></failed_login_lockout>
    <password_policy>Mínimo 8 caracteres, combinación de mayúsculas y
      números.</password_policy>
    <https_required>Obligatorio en todo el sistema, sin excepción.</https_required>
    <two_factor_auth enabled="false">
      Explícitamente NO implementado por el momento (decisión del cliente,
      revaluable a futuro).
    </two_factor_auth>
    <sso enabled="false">
      NO se implementa SSO — el hotel no usa Google Workspace ni Microsoft
      365.
    </sso>
    <password_recovery>
      <self_service>NO existe flujo de autorecuperación por correo/enlace.</self_service>
      <admin_reset>Solo el rol ADMINISTRADOR puede resetear la contraseña de
        cualquier usuario desde el módulo de gestión de usuarios. Al resetear,
        se aplica la contraseña predeterminada del sistema (decisión T1.9,
        transmitida al usuario por canal externo) que el usuario debe cambiar
        en su primer inicio de sesión. Esta acción queda registrada en el log
        de auditoría. <!-- BD: users (must_change_password) --></admin_reset>
    </password_recovery>
  </authentication>
</module>
```
