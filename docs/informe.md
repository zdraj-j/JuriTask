# Proceso: Informe / reporte del día

Genera un resumen imprimible/copiable de lo pendiente para hoy, con filtro por
abogado. Es el "primo" de la Agenda, pero de solo lectura y orientado a
compartir/imprimir.

## Archivos

- `js/ui.js` → `renderReport()`, `buildReportTextPlain()`, `openReport()`,
  `closeReport()`, variable `reportFiltroAbogado`.
- `index.html` → `#reportOverlay`, `#reportContent`, `#reportFilterGroup`,
  `#reportPrintBtn`, botón `#reportBtn` en la topbar.
- `js/config.js` → listener de `#reportFilterGroup` (cambia `reportFiltroAbogado`).
- `js/filters.js` → `buildRespOptions()` y poblado de `#reportFilterGroup`.

## Lógica

`renderReport()` recorre trámites no terminados y arma ítems de tipo
`vencimiento`, `analisis` y `tarea` (mismo criterio que la Agenda). El filtro
`reportFiltroAbogado` (vacío = todos, `'yo'`, o clave de abogado) decide qué se
muestra; para tareas usa `assignedTo`/`responsable` con `isMe`.

Se agrupa en **Urgentes / Vencidos / Para hoy** y se ordena igual que la Agenda.

> **Nota:** El criterio de "mío" del informe (`isMe = u => u === 'yo' || u ===
> miUID`) es el mismo que reutiliza la Agenda. Si cambias uno, revisa el otro
> para no divergir.

## Al modificar

`buildReportTextPlain()` extrae texto plano del DOM ya renderizado
(`#reportContent .report-item`); si cambias la estructura HTML del ítem, ajusta
también los selectores de esa función.
