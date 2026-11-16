# Módulo 7: Reportes y KPIs

> **Entregables:** spec (abajo) · **Flujos/Interfaces:** [07-reportes-kpis-flujos.md](07-reportes-kpis-flujos.md)
> **Tablas BD:** [user_dashboard_kpis](BD/user_dashboard_kpis.md) · [scheduled_reports](BD/scheduled_reports.md) (6 reportes semilla) · [report_send_log](BD/report_send_log.md) — **compartidas:** [system_parameters](BD/system_parameters.md) (tarifa global — T2) · [audit_log](BD/audit_log.md) (module `configuration`) · [users](BD/users.md) (`hourly_rate`) — el Módulo 7 **consulta** las tablas de los demás módulos (ver F7.2 en los flujos)

```xml
<module id="7" name="Reportes y KPIs">
  <kpi_catalog>
    <group name="Operativos de mantenimiento">
      <kpi name="MTTR">Promedio de (fecha cierre − fecha apertura) de OTs
        correctivas.</kpi>
      <kpi name="MTBF">Promedio de tiempo entre OTs correctivas consecutivas de
        un mismo activo.</kpi>
      <kpi name="% cumplimiento de PM">OTs preventivas cerradas a tiempo / total
        de preventivas generadas.</kpi>
      <kpi name="OTs vencidas actuales">Preventivas que superaron margen de
        gracia y siguen abiertas.</kpi>
      <kpi name="Tiempo promedio de respuesta">Fecha de asignación − fecha de
        creación de la OT.</kpi>
      <kpi name="Costo de mantenimiento por activo">Mano de obra + repuestos +
        servicio externo, acumulado.</kpi>
      <kpi name="Costo de mantenimiento por categoría">Igual, agregado por
        categoría de activo.</kpi>
      <kpi name="Costo de mantenimiento por ubicación">Igual, agregado por
        ubicación/habitación.</kpi>
      <kpi name="Ranking de activos con más fallas">Conteo de OTs correctivas
        por activo, orden descendente.</kpi>
      <kpi name="OTs por origen">Reporte de daño / app externa (futuro) /
        inspección.</kpi>
      <kpi name="OTs reasignadas por técnicos">Conteo y detalle.</kpi>
      <kpi name="Desempeño por técnico">OTs cerradas, tiempo promedio, horas
        registradas.</kpi>
    </group>
    <group name="Inventario">
      <kpi name="Valor total de inventario">Suma de stock × último costo, por
        bodega.</kpi>
      <kpi name="Ítems bajo stock mínimo">Listado actual.</kpi>
      <kpi name="Ítems con stock negativo">Listado actual, pendientes de
        ajuste.</kpi>
      <kpi name="Consumo de repuestos por activo/categoría">Identifica qué
        equipos consumen más materiales.</kpi>
      <kpi name="Historial de conteos y diferencias">Ajustes generados por
        conteos físicos.</kpi>
    </group>
    <group name="Proveedores y contratistas">
      <kpi name="Costo total por proveedor/contratista">Suma de servicios
        externos en OTs.</kpi>
      <kpi name="Contratos por vencer">Listado con días restantes.</kpi>
      <kpi name="Historial de intervención por contratista">Ver módulo 5.</kpi>
    </group>
    <group name="Cumplimiento normativo y calidad">
      <kpi name="Certificaciones vigentes/por vencer/vencidas">Estado actual de
        cada una.</kpi>
      <kpi name="Historial de vigencias por certificación">Auditoría de
        períodos sin cobertura.</kpi>
      <kpi name="Mediciones fuera de rango">Conteo y frecuencia por punto de
        medición.</kpi>
      <kpi name="Tendencia de mediciones">Consolidado por rango de fechas
        amplio.</kpi>
    </group>
    <group name="Activos">
      <kpi name="Activos por etapa de vida">Conteo por estado.</kpi>
      <kpi name="Vida útil consumida/restante">Listado de activos próximos a fin
        de vida útil, para presupuesto.</kpi>
      <kpi name="Garantías vigentes/por vencer">Estado actual.</kpi>
    </group>
  </kpi_catalog>

  <dashboard> <!-- BD: user_dashboard_kpis -->
    <per_role_set>
      Cada rol tiene un SET PREDEFINIDO de KPIs disponibles (no todos ven todos
      los indicadores del sistema). Dentro de ese set, el usuario decide cuáles
      mostrar.
    </per_role_set>
    <configurability>
      <mechanism>Checkboxes DENTRO del propio dashboard (botón/ícono
        "Personalizar" que despliega la lista de KPIs disponibles para su rol).
        Al marcar/desmarcar, el widget aparece o desaparece inmediatamente, sin
        navegar a otra pantalla.</mechanism>
      <persistence>La selección se guarda POR USUARIO individual (no por rol
        general) — dos técnicos pueden personalizar su dashboard de forma
        distinta dentro de lo permitido para su rol.</persistence>
    </configurability>
    <widget_order>
      <rule>El orden de los KPIs es FIJO, agrupado por categoría (ej. todos los
        de costos juntos, todos los de PM juntos, todos los de inventario
        juntos). El usuario SOLO controla visibilidad (mostrar/ocultar), NO
        reordena ni reagrupa.</rule>
    </widget_order>
    <multi_role_users>
      Si un usuario tiene varios roles asignados, el dashboard COMBINA en un
      solo set de checkboxes los KPIs disponibles de TODOS sus roles (unión).
    </multi_role_users>
  </dashboard>

  <export>
    <formats>PDF y Excel</formats>
    <scope>Todos los reportes (dashboard y listados), respetando los filtros
      aplicados al momento de exportar.</scope>
  </export>

  <scheduled_monthly_reports> <!-- BD: scheduled_reports, report_send_log -->
    <config_table>
      <field>reporte (selección del catálogo)</field>
      <field>frecuencia (Mensual, fijo por ahora)</field>
      <field>día de envío</field>
      <field>formato adjunto (PDF/Excel)</field>
      <field>correos destinatarios (editable, texto libre)</field>
      <field>activo/inactivo</field>
    </config_table>
    <active_reports>
      <report id="1" name="Resumen de costos de mantenimiento">Por categoría de
        activo y por ubicación.</report>
      <report id="2" name="Cumplimiento de PM del mes">% ejecutado a tiempo vs.
        vencido.</report>
      <report id="3" name="Estado de certificaciones normativas">Vigentes / por
        vencer / vencidas.</report>
      <report id="4" name="Consumo e inventario">Ítems bajo mínimo, valor total
        de inventario.</report>
      <report id="5" name="Ranking de activos con más fallas del mes">Top N por
        conteo de OTs correctivas.</report>
      <report id="6" name="Costos por proveedor/contratista del mes">Servicios
        externos consumidos.</report>
    </active_reports>
    <note>Los 6 quedan ACTIVOS POR DEFECTO, cada uno con destinatarios de correo
      configurables independientemente (ej. el reporte de certificaciones podría
      ir también a Calidad, mientras costos van a gerencia general).</note>
  </scheduled_monthly_reports>
</module>
```
