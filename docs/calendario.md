# Proceso: Calendario mensual

Vista de calendario que ubica vencimientos y tareas en su día.

## Archivos

- `js/calendar.js` → `renderCalendar()`, `_calEventDot()`, estado `calYear`/`calMonth`.
- `index.html` → `#view-calendar` (toolbar con `#calPrev`/`#calNext`,
  `#calMonthTitle`, grilla `#calGrid`).
- `js/config.js` → `switchView('calendar')` llama a `renderCalendar()`.

## Comportamiento

- Semana en formato ISO (lunes primero). `today()` resalta la celda de hoy.
- Construye un `eventMap` `'YYYY-MM-DD' → [eventos]` recorriendo trámites no
  terminados:
  - **vencimiento**: `fechaVencimiento` sin `gestion.cumplimiento`.
  - **tarea**: items de `seguimiento` pendientes con fecha.
- Cada celda muestra hasta 3 eventos; el resto se expande con "+N más".
- Clic en un evento → `openDetail(t.id)`.

## Configuración (en Ajustes)

- `config.calendarShow`: `'both' | 'venc' | 'tarea'` — qué tipos pintar.
- `config.calendarShowNum` / `config.calendarShowDesc`: si la etiqueta del punto
  muestra el `#número`, la descripción, ambos o un genérico ("Venc."/"Tarea").

## Al modificar

`dateClass(dateStr)` decide la clase de color del punto de vencimiento
(vencido/próximo). El calendario **no** filtra por responsabilidad (a
diferencia de la Agenda); si se quisiera, habría que replicar el cálculo de
`mine` de `agenda.md`.
