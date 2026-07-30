# Proceso: Informe / reporte del día

Genera un resumen imprimible/copiable de lo pendiente para hoy, con filtro por
abogado. Es el "primo" de la Agenda, pero de solo lectura y orientado a
compartir/imprimir.

## Archivos

- `js/ui.js` → `buildReportInto()` (núcleo compartido), `renderReport()`,
  `buildReportTextPlain()`, `openReport()`, `closeReport()`, variable
  `reportFiltroAbogado`. Panel lateral: `renderReportDock()`, `openReportDock()`,
  `closeReportDock()`, `restoreReportDock()`, variable `reportDockFiltro`.
- `index.html` → `#reportOverlay`, `#reportContent`, `#reportFilterGroup`,
  `#reportPrintBtn`, botón `#reportBtn` en la topbar. Panel lateral:
  `#reportDock`, `#reportDockContent`, `#reportDockFilter` (desplegable),
  `#reportDockBtn` (fijar como panel) y acciones `#reportDock*`.
- `js/config.js` → listener de `#reportFilterGroup` (cambia `reportFiltroAbogado`),
  listeners del dock y helpers compartidos `_printReportFrom()`,
  `_copyReportFrom()`, `_screenshotReport()`.
- `js/filters.js` → `buildRespOptions()` y poblado de `#reportFilterGroup` y del
  desplegable `#reportDockFilter`.

## Panel lateral (dock)

Desde el modal, **"Panel lateral"** (`openReportDock()`) fija el reporte a la
derecha de la pantalla (`body.report-docked`), empujando la zona principal en
desktop y superponiéndose a pantalla completa en móvil. El panel **permanece
inmutable** mientras se navegan trámites: conserva colaborador seleccionado
(desplegable `#reportDockFilter`) y posición de scroll (se guarda/restaura en
`renderReportDock()`). Se refresca solo cuando cambian los datos vía el gancho en
`renderAll()`. El estado (abierto + filtro) se persiste en `localStorage`
(`juritask_report_dock`), por dispositivo, y se restaura al arrancar solo en
anchos ≥769px.

Las **capturas** (`_screenshotReport()`) se renderizan en un contenedor oculto
cuyo ancho se toma de `#reportContent`, de modo que la imagen conserva siempre
las dimensiones originales aunque el panel sea más angosto.

## Lógica

`renderReport()` recorre trámites no terminados y arma ítems de tipo
`vencimiento`, `analisis` y `tarea` (mismo criterio que la Agenda). El filtro
`reportFiltroAbogado` (vacío = todos, `'yo'`, o clave de abogado) decide qué se
muestra; para tareas usa `assignedTo`/`responsable` con `isMe`.

Se agrupa en **Urgentes / Vencidos / Para hoy** y se ordena igual que la Agenda.

> **Nota:** El criterio de "mío" del informe (`isMe = u => u === 'yo' || u ===
> miUID`) es el mismo que reutiliza la Agenda. Si cambias uno, revisa el otro
> para no divergir.

## Impresión

`_printReportFrom(area)` (config.js) delega en `_printHtml()`, que monta el
contenido en `#reportPrintArea`, marca `body.printing` y limpia al terminar.
El bloque `@media print` de `style.css` es el que hace que el documento
**pagine** en vez de salir en una sola hoja recortada; los detalles y el porqué
de cada regla están en [reportes-excel.md](reportes-excel.md#impresión), y
aplican igual a este reporte.

## Al modificar

`buildReportTextPlain()` extrae texto plano del DOM ya renderizado
(`#reportContent .report-item`); si cambias la estructura HTML del ítem, ajusta
también los selectores de esa función.
