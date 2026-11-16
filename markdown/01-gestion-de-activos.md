# Módulo 1: Gestión de Activos

> **Entregables:** spec (abajo) · **Flujos/Interfaces:** [01-gestion-de-activos-flujos.md](01-gestion-de-activos-flujos.md)
> **Tablas BD del Módulo 1:** [assets](BD/assets.md) · [locations](BD/locations.md) · [categories](BD/categories.md) · [warranties](BD/warranties.md) · [asset_files](BD/asset_files.md) · [code_counters](BD/code_counters.md) — **compartidas:** [audit_log](BD/audit_log.md) · [notification_log](BD/notification_log.md) · [notification_config](BD/notification_config.md) — **referenciadas:** [users](BD/users.md) · [work_orders](BD/work_orders.md) · [providers](BD/providers.md) · [maintenance_plans](BD/maintenance_plans.md) · [item_asset_links](BD/item_asset_links.md) · [certifications](BD/certifications.md) · [measurement_records](BD/measurement_records.md) · [measurement_types](BD/measurement_types.md)

```xml
<module id="1" name="Gestión de Activos">
  <model_decision>
    Cada equipo físico es una INSTANCIA INDIVIDUAL con ficha propia (no un
    "activo genérico" compartido). Ejemplo: el fan coil de la habitación 305 y
    el de la 512 son dos registros de activos distintos, cada uno con su propio
    historial, garantías y componentes.
    <!-- BD: assets.md -->
  </model_decision>

  <hierarchy> <!-- BD: locations.md -->
    Hotel → Torre/Edificio → Piso → Ubicación (Habitación / Área común / Área
    técnica) → Activo → Componente (opcional, anidado)
  </hierarchy>

  <categories> <!-- BD: categories.md -->
    <rule>Catálogo CRUD de categorías de activo, totalmente administrable (crear,
      editar, desactivar). Semilla inicial sugerida:</rule>
    <seed_list>
      <item>Climatización (HVAC)</item>
      <item>Eléctrico</item>
      <item>Plomería / Fontanería</item>
      <item>Contra incendios</item>
      <item>Elevadores / Verticales</item>
      <item>Cocina</item>
      <item>Lavandería</item>
      <item>Piscina / Spa</item>
      <item>Seguridad y acceso</item>
      <item>Mobiliario técnico</item>
    </seed_list>
    <rule_cardinality>UNA sola categoría por activo (no múltiples categorías
      simultáneas). Si un activo tiene naturaleza mixta, se resuelve con el
      desglose de componentes, no con múltiples categorías en el padre.</rule_cardinality>
    <category_fields>nombre, descripción, código corto (usado como prefijo del
      código único del activo), estado activa/inactiva</category_fields>
  </categories>

  <criticality>
    <rule>Catálogo FIJO de 3 niveles, no editable: Alta / Media / Baja.</rule>
    <criteria>
      <alta>Afecta seguridad, cumplimiento legal, o deja habitaciones/áreas de
        venta fuera de servicio.</alta>
      <media>Afecta confort pero no impide la operación.</media>
      <baja>Impacto estético o de bajo impacto operativo.</baja>
    </criteria>
  </criticality>

  <components>
    <rule>TODOS los activos (no solo los de alto valor) pueden tener desglose de
      componentes anidados.</rule>
    <behavior>
      Cada componente hereda la ubicación del activo padre, pero tiene su propio
      historial de OTs, garantías y documentación — funciona como un "mini-activo"
      anidado. Una Orden de Trabajo puede apuntar a un activo o a un componente
      específico dentro de él.
    </behavior>
  </components>

  <status_fields>
    <field name="estado_operativo">
      <values>Operativo | Inactivo</values>
      <note>Campo independiente, cambia con frecuencia.</note>
    </field>
    <field name="etapa_de_vida">
      <values>Sin garantía → En garantía → Operativo → Por Reparar → Requiere
        reemplazo → Dado de baja</values>
      <note>Campo independiente, cambia pocas veces. No es estrictamente lineal:
        un activo puede pasar de "En garantía" a "Sin garantía" automáticamente
        cuando la tabla de garantías <!-- BD: warranties.md --> indica que ya
        no hay garantía vigente.</note>
      <rule_automatica>Si etapa_de_vida = "Dado de baja", el sistema fuerza
        automáticamente estado_operativo = "Inactivo".</rule_automatica>
    </field>
  </status_fields>

  <useful_life>
    <field name="fecha_puesta_en_operacion">Fecha en que el activo entró en
      funcionamiento (no necesariamente igual a la fecha de compra).</field>
    <field name="vida_util_esperada">Valor numérico + unidad (años, o
      horas/ciclos de uso si el activo tiene contador — ej. generadores,
      ascensores).</field>
    <field name="vida_util_consumida" calculated="true">Fecha actual − fecha de
      puesta en operación.</field>
    <field name="vida_util_restante" calculated="true">Vida útil esperada − vida
      útil consumida.</field>
    <report>Alimenta un reporte de "activos próximos a fin de vida útil" para
      presupuesto CAPEX.</report>
  </useful_life>

  <documentation> <!-- BD: asset_files.md -->
    <rule>El activo y cada componente permiten subir múltiples archivos/imágenes
      (manual técnico, ficha, foto del equipo, factura de compra).</rule>
  </documentation>

  <warranties> <!-- BD: warranties.md -->
    <rule>Entidad en tabla SEPARADA <!-- BD: warranties.md --> (relación uno a
      muchos con el activo o
      componente), NO un simple campo de fecha en la ficha del activo.</rule>
    <rule_multiplicity>Un mismo activo puede tener múltiples garantías
      simultáneas o a lo largo del tiempo: garantía de COMPRA original y
      garantía(s) de REPARACIÓN posteriores.</rule_multiplicity>
    <fields>
      <field>activo/componente vinculado (FK)</field>
      <field>tipo de garantía: Compra | Reparación (catálogo simple, extensible)</field>
      <field>proveedor/fabricante/taller que otorga la garantía (puede vincularse
        automáticamente al contratista cuando la OT fue ejecutada por un externo)</field>
      <field>fecha de inicio</field>
      <field>fecha de vencimiento</field>
      <field>cobertura (piezas, mano de obra, ambas)</field>
      <field>observaciones (texto libre)</field>
      <field>documento adjunto</field>
      <field name="estado_calculado">Vigente / Vencida, calculado automáticamente
        según fecha actual vs. vencimiento</field>
    </fields>
    <critical_rule name="confirmacion_al_cerrar_ot">
      Al CERRAR cualquier OT (preventiva o correctiva), el sistema debe preguntar
      OBLIGATORIAMENTE si esa intervención genera o extiende una garantía. Si la
      respuesta es "Sí", se crea automáticamente un nuevo registro en la tabla de
      garantías (<!-- BD: warranties.md -->), vinculado a esa OT como origen.
    </critical_rule>
  </warranties>

  <responsible_field> <!-- BD: users.md (responsible_user_id) -->
    <rule>Campo "Responsable del activo", NO obligatorio, selección de
      usuario/técnico. No bloquea la creación del activo si se deja vacío.</rule>
  </responsible_field>

  <unique_code> <!-- BD: assets.md (UNIQUE) + code_counters.md -->
    <generation>Autogenerado al crear el activo, con lógica sugerida:
      [Prefijo categoría]-[Ubicación]-[Consecutivo]. Ejemplo: HVAC-305-001,
      ASC-CM-01.</generation>
    <editable>El campo es editable después de generado (para nomenclatura
      interna propia del equipo de mantenimiento).</editable>
    <validation>Debe validarse unicidad, incluso si se edita manualmente.</validation>
  </unique_code>

  <scope_rule>
    Solo entran al catálogo de activos los equipos con mantenimiento preventivo
    programado o valor de reemplazo relevante. Equipos de bajo costo sin PM (ej.
    secador de pelo) quedan fuera, gestionados como reposición simple.
  </scope_rule>
</module>
```
