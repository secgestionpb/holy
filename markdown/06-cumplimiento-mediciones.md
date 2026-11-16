# Módulo 6: Cumplimiento Normativo y Mediciones

> **Entregables:** spec (abajo) · **Flujos/Interfaces:** [06-cumplimiento-mediciones-flujos.md](06-cumplimiento-mediciones-flujos.md)
> **Tablas BD:** [certifications](BD/certifications.md) (incluye certification_history) · [compliance_categories](BD/compliance_categories.md) · [measurement_types](BD/measurement_types.md) · [measurement_records](BD/measurement_records.md) — **compartidas:** [audit_log](BD/audit_log.md) (module compliance) · [notification_config](BD/notification_config.md) (eventos 8 y 9) · [notification_log](BD/notification_log.md) — **referenciadas:** [assets](BD/assets.md) · [categories](BD/categories.md) · [providers](BD/providers.md)

```xml
<module id="6" name="Cumplimiento Normativo y Mediciones">

  <compliance_certifications> <!-- BD: certifications.md -->
    <description>
      Gestiona certificaciones y obligaciones legales ante autoridades —
      distinto de garantías (comerciales) y contratos (de servicio). Opción A:
      módulo/catálogo INDEPENDIENTE del motor de Plan de Mantenimiento. NO
      genera OT automáticamente; solo alerta, y la coordinación de renovación
      (agendar contratista, crear OT si aplica) es manual.
    </description>
    <fields>
      <field>nombre de la certificación/obligación</field>
      <field>activo o instalación vinculado (FK a activo, o general si aplica a
        todo el hotel, ej. permiso de bomberos)</field>
      <field>categoría normativa (catálogo: Seguridad estructural, Contra
        incendios, Sanitaria/agua, Ambiental, Eléctrica, Elevadores, etc.)
        <!-- BD: compliance_categories --></field>
      <field>entidad emisora</field>
      <field>número de certificado/permiso</field>
      <field>fecha de emisión</field>
      <field>fecha de vencimiento</field>
      <field>periodicidad de renovación</field>
      <field>contratista/entidad responsable de renovarlo (vinculado al módulo
        5)</field>
      <field>documento adjunto</field>
      <field name="estado_calculado">Vigente / Por vencer / Vencido</field>
      <field>observaciones</field>
    </fields>
    <history> <!-- BD: certification_history -->
      <rule>Se CONSERVA un registro histórico de cada renovación (vigencias
        anteriores, fechas de vencimiento y renovación) — NO se sobrescribe el
        registro. Tabla relacionada "Historial de vigencias", ligada a la
        certificación padre, para poder auditar si hubo períodos sin
        certificado vigente.</rule>
    </history>
    <notification>
      Evento "Certificación/permiso por vencer" → correo, AVISO ÚNICO (no
      escalonado) con días de anticipación CONFIGURABLE por certificación/global.
    </notification>
    <permissions>
      <role name="Calidad">CRUD completo del catálogo de certificaciones.</role>
      <role name="Mantenimiento">Gestiona la renovación operativa (coordina
        contratista, crea la OT si aplica) — no es dueño del catálogo.</role>
      <role name="Administrador">Solo consulta.</role>
      <role name="Técnico">Sin acceso.</role>
    </permissions>
  </compliance_certifications>

  <measurements> <!-- BD: measurement_types.md + measurement_records.md -->
    <description>
      Módulo propio para registro de mediciones periódicas de control de
      calidad. Caso inicial: pH de piscinas. Diseñado extensible a otros
      parámetros (cloro, temperatura, etc.).
    </description>
    <design_decision>
      Los "puntos de medición" NO son un concepto nuevo — se REUTILIZA el
      catálogo de ACTIVOS del módulo 1. Ejemplo: la piscina misma es un activo
      (ej. PISC-01 — Piscina Principal) dentro de la categoría "Piscina/Spa",
      funcionando como contenedor lógico de sus componentes (bomba, filtro) y
      ahora también como punto de medición. Si hay una segunda piscina, es
      simplemente otro activo más de esa categoría.
    </design_decision>
    <measurement_type_catalog> <!-- BD: measurement_types.md -->
      <fields>
        <field>nombre del tipo de medición (ej. "pH piscina")</field>
        <field>categoría de activo aplicable (ej. Piscina/Spa — filtra qué
          activos se pueden seleccionar al registrar)</field>
        <field>unidad de medida</field>
        <field>valor mínimo aceptable</field>
        <field>valor máximo aceptable</field>
        <field>frecuencia esperada (informativo, para detectar mediciones
          faltantes)</field>
        <field>estado (Activo/Inactivo)</field>
      </fields>
    </measurement_type_catalog>
    <measurement_record> <!-- BD: measurement_records.md -->
      <fields>
        <field>tipo de medición (del catálogo)</field>
        <field>activo (seleccionado del catálogo general de activos, filtrado
          por la categoría aplicable al tipo de medición)</field>
        <field>fecha y hora</field>
        <field>valor medido (numérico)</field>
        <field name="resultado_calculado">Dentro de rango / Fuera de rango
          (automático, comparando contra min/max del catálogo)</field>
        <field>registrado por (automático)</field>
        <field>observaciones</field>
        <field>evidencia fotográfica (opcional)</field>
      </fields>
    </measurement_record>
    <wo_link>NINGUNO — el registro de medición NO se vincula a ninguna OT,
      queda como dato histórico y de control independiente. Si Calidad lo
      considera necesario, crea un Reporte de Daño por separado (no hay
      automatismo ni referencia cruzada).</wo_link>
    <out_of_range_notification>
      Evento "Medición fuera de rango" → correo INMEDIATO a Mantenimiento (para
      intervenir) y Calidad (para seguimiento).
    </out_of_range_notification>
    <trend_view>
      Gráfico de línea temporal por tipo de medición y activo: eje X = fecha,
      eje Y = valor medido, con banda/líneas horizontales marcando el rango
      aceptable (min/max). Filtros por rango de fechas y por activo.
    </trend_view>
    <permissions>
      <role name="Calidad">CRUD completo (catálogo de tipos + registro de
        mediciones).</role>
      <role name="Mantenimiento">Recibe alertas, sin gestión del catálogo.</role>
      <role name="Administrador">Solo consulta.</role>
      <role name="Técnico">Sin acceso.</role>
    </permissions>
  </measurements>
</module>
```
