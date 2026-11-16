# Módulo 5: Proveedores y Contratistas Externos

> **Entregables:** spec (abajo) · **Flujos/Interfaces:** [05-proveedores-contratistas-flujos.md](05-proveedores-contratistas-flujos.md)
> **Tablas BD:** [providers](BD/providers.md) (incluye provider_files) · [contracts](BD/contracts.md) — **compartidas:** [code_counters](BD/code_counters.md) (PRO-) · [audit_log](BD/audit_log.md) · [notification_config](BD/notification_config.md) (evento 11 "Contrato por vencer") · [notification_log](BD/notification_log.md) — **referenciadas:** [work_orders](BD/work_orders.md) · [warranties](BD/warranties.md) · [items](BD/items.md) · [categories](BD/categories.md)

```xml
<module id="5" name="Proveedores y Contratistas Externos">
  <depth_level>NIVEL 3 (catálogo + historial de intervención + contratos con
    vigencia) — nivel más completo de los tres evaluados.</depth_level>

  <catalog> <!-- BD: providers (incluye provider_files) -->
    <single_table>Un solo catálogo para ambos tipos (proveedor de materiales y
      contratista de servicio), diferenciados por campo "tipo", ya que un mismo
      tercero puede ser ambos.</single_table>
    <fields>
      <field>código (autogenerado, editable)</field>
      <field>nombre/razón social</field>
      <field name="tipo">Proveedor de materiales | Contratista de servicio |
        Ambos</field>
      <field>categoría de servicio (vinculada al catálogo de categorías de
        activo del módulo 1, ej. contratista de "Elevadores/Verticales")</field>
      <field>contacto principal (nombre, teléfono, correo)</field>
      <field>dirección</field>
      <field>documentos (contrato marco, certificaciones de la empresa,
        pólizas)</field>
      <field>estado (Activo/Inactivo)</field>
      <field>observaciones</field>
    </fields>
  </catalog>

  <contracts>
    <entity_name>Contratos (tabla propia) <!-- BD: contracts --></entity_name>
    <fields>
      <field>proveedor/contratista vinculado (FK)</field>
      <field>nombre/descripción del contrato</field>
      <field>alcance del servicio</field>
      <field>fecha de inicio</field>
      <field>fecha de vencimiento</field>
      <field>frecuencia de visitas pactadas (opcional)</field>
      <field>costo del contrato (monto y periodicidad)</field>
      <field>documento adjunto</field>
      <field name="estado_calculado">Vigente / Por vencer / Vencido</field>
      <field>observaciones</field>
    </fields>
    <notification>Nuevo evento "Contrato por vencer" en la tabla de
      configuración <!-- BD: notification_config.md -->, con días de
      anticipación editable (mismo patrón que garantías).</notification>
  </contracts>

  <intervention_history> <!-- BD: work_orders.provider_id (consulta, sin tabla propia) -->
    Vista dentro de la ficha del proveedor/contratista que lista todas las OTs
    donde participó (fecha, activo, costo del servicio, estado), para evaluar
    desempeño sin reporte aparte.
  </intervention_history>

  <wo_integration> <!-- BD: work_orders (executed_by, provider_id, external_cost), warranties.provider_id -->
    <field>Campo "Ejecutada por" en la OT: Personal interno | Contratista
      externo (opcional).</field>
    <field>Campo "Costo del servicio externo": MONTO ÚNICO (no desglosado en
      mano de obra + materiales).</field>
    <cost_formula>Costo total de la OT = Mano de obra interna + Repuestos
      consumidos + Costo del servicio externo.</cost_formula>
    <unassigned_technician>Una OT ejecutada por contratista externo PUEDE
      quedar SIN técnico interno asignado; la gestiona directamente
      Mantenimiento.</unassigned_technician>
    <warranty_link>Al confirmar garantía al cierre de una OT con contratista
      externo, el registro de garantía puede tomar automáticamente ese
      contratista como "proveedor que otorga la garantía".</warranty_link>
  </wo_integration>

  <permissions>
    <role name="Mantenimiento">CRUD completo de proveedores, contratistas y
      contratos.</role>
    <role name="Administrador">Solo consulta.</role>
    <role name="Técnico">Sin acceso al catálogo (puede ver el dato "ejecutado
      por" dentro de una OT si aplica).</role>
    <role name="Calidad">Solo consulta.</role>
  </permissions>
</module>
```
