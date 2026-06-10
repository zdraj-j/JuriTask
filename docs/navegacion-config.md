# Proceso: Navegación entre vistas y configuración

Orquesta el cambio de vista, la barra de herramientas contextual y la pantalla
de Ajustes. Es el "router" y el cableado de eventos de la app.

## Archivos

- `js/config.js` → `switchView(view)`, `init()`, `renderConfig()`, y casi todos
  los `addEventListener` de la app.
- `index.html` → menú lateral (`.nav-item[data-view]`) y `#view-*`.

## `switchView(view)`

1. Marca activa la vista (`#view-${view}`) y el item de menú.
2. Fija el título de la topbar.
3. Muestra/oculta herramientas: filtros, selector de columnas, orden, botón de
   reporte y "nuevo trámite". **La Agenda, el Calendario, la Config y el
   Dashboard ocultan la barra de herramientas** (`hideTools`).
4. Llama al render correspondiente:
   - `config` → `renderConfig()` + `syncConfigAccountUI()`
   - `calendar` → `renderCalendar()`
   - `agenda` → `renderAgenda()`
   - `dashboard` → `loadDashboardData()`
   - resto → `renderAll()`

## Configuración (Ajustes)

`renderConfig()` pinta: abogados/colaboradores y colores, módulos, barras de
color, tema, auto-requerimiento y opciones de calendario. Cada control tiene su
listener que escribe en `STATE.config` y llama a `saveAll()`.

Listeners destacados: filtro del informe (`#reportFilterGroup`) y **filtro de
responsabilidad de la Agenda** (`#agendaScopeGroup` → `STATE.config.agendaScope`,
ver [agenda.md](agenda.md)).

## Al modificar

Si añades una vista nueva: crea `#view-x`, un `.nav-item[data-view="x"]`,
una entrada en `titles`, decide si va en `hideTools`, y enlaza su render en
`switchView`.
