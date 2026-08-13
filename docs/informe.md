# Proceso: Informe / reporte del día

Genera un resumen de lo pendiente para hoy, con filtro por abogado. Es el
"primo" de la Agenda, pero de solo lectura. Se consume de dos maneras: como
**captura de imagen** para pegar en un chat, o **fijado como panel lateral**
mientras se trabaja.

## Archivos

- `js/ui.js` → `buildReportInto()` (núcleo compartido), `renderReport()`,
  `openReport()`, `closeReport()`, variable `reportFiltroAbogado`. Panel lateral:
  `renderReportDock()`, `openReportDock()`, `closeReportDock()`,
  `restoreReportDock()`, variable `reportDockFiltro`.
- `index.html` → `#reportOverlay`, `#reportContent`, `#reportFilterGroup`,
  `#reportScreenshotBtn`, botón `#reportBtn` en la topbar. Panel lateral:
  `#reportDock`, `#reportDockContent`, `#reportDockFilter` (desplegable),
  `#reportDockBtn` (fijar como panel) y `#reportDockScreenshotBtn`.
- `js/config.js` → listener de `#reportFilterGroup` (cambia `reportFiltroAbogado`),
  listeners del dock y `_screenshotReport()`.
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
`reportFiltroAbogado` (vacío = todos, `'yo'`, o clave de colaborador) decide
qué se muestra; para tareas usa `responsable` con `isMe`.

Se agrupa en **Urgentes / Vencidos / Para hoy** y se ordena igual que la Agenda.

> **Nota:** El criterio de "mío" del informe (`isMe = u => u === 'yo' || !u`)
> es el mismo que reutiliza la Agenda. Si cambias uno, revisa el otro para no
> divergir.

## Sin impresión ni copiado

Este reporte **no se imprime ni se copia como texto**: sus dos únicas salidas
son la captura y el panel lateral. `_printHtml()` y `_printHeader()` siguen
existiendo en `config.js`, pero ya solo los usa el
[reporte de trámites](reportes-excel.md#impresión).

## Al modificar

`_screenshotReport()` renderiza en un contenedor oculto, no sobre el nodo
visible. Si cambias la estructura HTML del ítem, revisa que la captura siga
saliendo con las mismas dimensiones desde el modal y desde el panel.
