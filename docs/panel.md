# Proceso: Panel de indicadores

Vista de solo lectura con el estado global de los trámites: KPIs, tres tarjetas
de métricas y la tabla de vencidos.

## Archivos

- `js/dashboard.js` → `renderDashboard()`, `_renderVencidosTable()`,
  `renderDashMetrics()`, `initDashboard()`, `loadDashboardData()`.
- `index.html` → `#view-dashboard`.
- `js/config.js` → `switchView('dashboard')` dispara `loadDashboardData()`.

## Todo sale de `STATE.tramites`

El panel **no consulta Firestore** y no sabe nada de usuarios. Se calcula
entero sobre los trámites que ya están en memoria, de forma síncrona.

Antes era un dashboard de administración: leía perfiles uno a uno desde el
índice `/meta/userIndex` porque las reglas de Firestore no permiten `list`
sobre `/users/`, y gestionaba usuarios, roles, equipos y cuentas pendientes.
Sin usuarios esa gimnasia sobra, y con ella se fueron unas 780 líneas.

| KPI | Cómo se calcula |
|---|---|
| Trámites activos | `!t.terminado` |
| Trámites vencidos | activos con `fechaVencimiento < hoy` y sin `gestion.cumplimiento` |
| Vencen hoy | activos con `fechaVencimiento === hoy` y sin cumplimiento |
| Terminados | `t.terminado` |
| Tareas urgentes | activos con alguna tarea `urgente` y `pendiente` |

La convención de vencimiento es la misma de siempre: **un trámite con el
cumplimiento marcado ya no vence** (ver
[reportes-excel.md](reportes-excel.md#fecha-de-vencimiento-efectiva)).

## Métricas

`renderDashMetrics(activos, vencidos)` pinta tres tarjetas: trámites por módulo
(top 5), por abogado, y estado de tareas con la tasa de vencimiento. Es una
función pura sobre los arrays que recibe.

## Estado del almacén

`_renderSyncEstado()` muestra bajo los KPIs el tamaño del JSON en Drive y
cuándo se escribió por última vez. Solo aparece con servidor; en un navegador
normal se oculta.

## Backups

Viven en Drive y su UI está en Ajustes, no aquí. Ver
[datos-drive.md](datos-drive.md#backups).

## Al modificar

- Si añades un KPI, agrégalo al array de `renderDashboard()` que pone `'…'`
  como valor inicial, o se quedará mostrando el guion del HTML.
- El panel es síncrono: no lo conviertas en `async` sin necesidad, porque
  `switchView` no lo espera.
