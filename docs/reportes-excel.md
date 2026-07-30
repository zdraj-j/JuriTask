# Proceso: Reporte de trámites y exportación a Excel

Consulta **todo el histórico de trámites** con filtros combinables y lo exporta
a Excel (`.xlsx`), CSV, portapapeles o impresión, incluyendo las tareas
pendientes de cada trámite.

> No confundir con el [Reporte del día](informe.md) (`ui.js`), que solo lista lo
> vencido / para hoy y es de solo lectura. Este es el reporte "grande".

## Archivos

- `js/reportes.js` → estado de los filtros, `repBuildData()`, hojas del libro,
  vista previa (`renderReporte()`) y acciones de exportación.
- `js/xlsx.js` → escritor mínimo de `.xlsx` (ZIP + XML) y de CSV.
- `index.html` → botón `#reportesBtn` en la topbar y modal `#reporteOverlay`.
- `js/config.js` → engancha el botón (`openReporteDesdeFiltros`) y lo oculta en
  Configuración / Dashboard.
- `css/style.css` → bloque «REPORTE DE TRÁMITES».

## Filtros

| Control | Campo |
|---|---|
| `repEstado` | activos / terminados / ambos |
| `repTipo` | `propio` · `abogado` (compartido) · `equipo` (`sharedWith`) |
| `repAbogado` | `t.abogado` o `t.sharedWith` (`yo` ⇒ `esPropio`) |
| `repModulo` | `t.modulo` |
| `repEtapa` | `computeEtapa(t)` |
| `repResponsable` | responsable/`assignedTo` de alguna tarea **pendiente** |
| `repScope` | `t._scope` (`private` / `team`) |
| `repVencPresets` | vencidos · hoy · 7 · 30 días · este mes · sin fecha |
| `repVencDesde` / `repVencHasta` | rango manual (solo con el preset «Todos») |
| `repTexto` | número, descripción, tareas y notas |
| `repSolo*` | con tareas pendientes / vencidas / urgentes, o sin pendientes |
| `repOrden` | vencimiento · próxima acción · número · módulo · colaborador · nº de pendientes · más recientes |

Todos se combinan en AND. Se guardan en `localStorage`
(`juritask_reporte_filtros`), por dispositivo — igual que el panel lateral del
reporte del día. El botón de la topbar (`openReporteDesdeFiltros`) precarga los
filtros que estén activos en la barra lateral.

La vista previa muestra como máximo `REP_PREVIEW_MAX` (100) filas; la
exportación siempre lleva todas.

## Hojas del libro

| Hoja | Contenido |
|---|---|
| Resumen | Filtros aplicados + conteos (general, tareas, etapa, por módulo, por colaborador) |
| Trámites | Una fila por trámite (23 columnas) + detalle de pendientes en texto |
| Tareas | Una fila por tarea, con días de atraso y responsable |
| Notas | Una fila por nota |

«Incluir tareas ya realizadas» hace que la hoja *Tareas* traiga también las
`estado !== 'pendiente'`. El CSV exporta **una sola tabla**: la primera hoja de
datos seleccionada (Resumen no cuenta).

## Impresión

`repPrint()` **no** imprime `#reporteTabla`: esa vista está recortada a 100
filas. Reconstruye la tabla completa con `_repPrintHtml()` y la manda a
`_printHtml()` (config.js), que la mete en `#reportPrintArea`, marca
`body.printing` y limpia al terminar (`afterprint` + `setTimeout`).

Puntos que hicieron falta para que **pagine** (antes salía una sola hoja
recortada):

- El resto de la app se oculta con `display: none`, no con
  `visibility: hidden`. Con visibility los nodos siguen ocupando su caja, así
  que el contenedor de impresión tenía que ir en `position: fixed` — y un
  elemento fijo no fluye ni pagina.
- `html, body` en print: `display: block`, `height: auto`, `overflow: visible`.
  Los contenedores de la app fijan alturas de viewport que también recortan.
- `table-layout: fixed` + `<colgroup>` con porcentajes: sin eso la tabla se
  ensancha según el contenido y se sale de la hoja.
- `thead { display: table-header-group }` repite la cabecera en cada página;
  `tr { break-inside: avoid }` no parte filas.
- `body.printing *  { animation: none }`: el navegador no avanza las
  animaciones al imprimir, y `.report-item` entra con `cardIn`, que arranca en
  `opacity: 0` — las hojas salían en blanco.
- `break-inside: avoid` va en los **ítems**, nunca en `.report-section`: una
  sección entera no cabe en una hoja y el navegador la empuja dejando páginas
  vacías.

## El escritor de .xlsx (`js/xlsx.js`)

Un `.xlsx` es un ZIP con XML. Como la app no tiene bundler y un CDN rompería el
modo offline del service worker, el ZIP se escribe a mano con entradas
**stored** (sin compresión, así no hace falta un deflate) más CRC32 propio.

```js
xlsxDownload('archivo.xlsx', [{ name, columns:[{header,width,wrap}], rows:[[celda…]] }]);
```

Una celda puede ser `string | number | boolean | null` o `{ v, t }` con
`t ∈ 'date' | 'text' | 'number'`. Las fechas se escriben como **serial de Excel**
(numFmt `dd/mm/yyyy`), de modo que Excel las ordena y filtra como fechas de
verdad. Cada hoja lleva fila de cabecera fija (`pane frozen`) y `autoFilter`.

## Al modificar

- Si añades una columna, actualiza `columns` **y** la fila correspondiente en
  `rows`: se emparejan por posición.
- Excel rechaza los caracteres de control; `_xmlEscape()` ya los elimina.
- Los nombres de hoja se recortan a 31 caracteres y se deduplican en
  `xlsxBuildBlob()`.
- Los nombres de archivo pasan por `_repSlug()`: el navegador ignora el atributo
  `download` si trae caracteres no ASCII y descarga como «download».
