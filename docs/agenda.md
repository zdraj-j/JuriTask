# Proceso: Agenda accionable

Lista enfocada de "lo que hay que hacer hoy o ya venció", pensada para ir
**marcando como realizado** directamente, sin abrir cada trámite.

## Archivos

- `js/ui.js` → `_buildAgendaItems()`, `renderAgenda()`, `countAgendaPendientes()`,
  `_updateAgendaBadge()`, `_syncAgendaScopeButtons()`, `_showAgendaNextTaskForm()`,
  `_aplazarTarea()`, `_installAgendaSnoozeCloser()`, `_persistTramite()`.
- `index.html` → `#view-agenda` (barra de filtro `#agendaScopeGroup` + `#agendaContent`).
- `js/config.js` → `switchView()` llama a `renderAgenda()`; listener del toggle
  de responsabilidad.
- `css/style.css` → bloque `AGENDA ACCIONABLE`.

## Qué entra en la agenda

`_buildAgendaItems()` recorre los trámites **no terminados** y genera ítems de
tres tipos:

| tipo | condición | acción de "hecho" |
|---|---|---|
| `vencimiento` | `fechaVencimiento <= hoy` y sin `gestion.cumplimiento` | botón **Cumplido** → marca `gestion.cumplimiento` y crea tarea de requerimiento (`crearTareaRequerimiento`) |
| `analisis` | trámite **no propio** sin `gestion.analisis` | check → marca `gestion.analisis` |
| `tarea` | item de `seguimiento` `pendiente` con `fecha <= hoy` | check → `s.estado = 'realizado'` |

Cada ítem se ordena por: urgentes primero → vencidos antes que de hoy → por fecha.

## Filtro por responsabilidad (Mías / De otros / Todas)

Cada ítem lleva una bandera **`mine`** calculada con
`isMe(u) = u === 'yo' || u === miUID || !u`:

- `vencimiento`: `mine` si el trámite es propio (`resp = 'yo'`); si no, el
  responsable es `t.abogado`.
- `analisis`: el responsable es `t.abogado` (de otro) → normalmente **no** mío.
- `tarea`: `mine` si `s.responsable` soy yo **o** algún `assignedTo` soy yo.

El filtro activo se guarda en `STATE.config.agendaScope` (`'mias'` | `'otros'`
| `'all'`; por defecto **`'mias'`**, porque el uso principal es marcar lo propio).
`renderAgenda()` filtra `allItems` según ese scope y
`_syncAgendaScopeButtons()` actualiza el botón activo y los contadores
(`Mías (n)`, `De otros (n)`, `Todas (n)`).

Cuando un ítem **no** es mío, se muestra un chip con el responsable
(`.agenda-resp`) usando `abogadoName(resp, t)`.

## Badge del menú

`_updateAgendaBadge()` usa `countAgendaPendientes()` = **total** de ítems
pendientes (todas las responsabilidades), no solo las mías, para no perder de
vista el volumen global. El desglose por responsabilidad va en los botones del
toggle.

## Encadenar "completar → siguiente tarea"

Al marcar una **tarea** como realizada, su fila se transforma in situ en un
mini-formulario (`_showAgendaNextTaskForm`) para registrar de inmediato la
siguiente tarea del mismo trámite, sin tener que buscarlo:

- Campos: descripción + fecha (la fecha viene precargada a **hoy + 7 días**,
  editable). `Enter` guarda.
- **Guardar** crea una nueva tarea de `seguimiento` en el mismo trámite,
  heredando `responsable`/`assignedTo` de la tarea recién cerrada (así sigue
  apareciendo en "Mías" si era tuya), notifica a los asignados externos y
  re-renderiza la agenda.
- **Listo, sin tarea** (o guardar con la descripción vacía) simplemente cierra
  el formulario y refresca la agenda.

Solo aplica al tipo `tarea`. Marcar un `analisis` o un `vencimiento` mantiene su
comportamiento anterior (el vencimiento ya genera su requerimiento automático
vía `crearTareaRequerimiento`).

Para que **Deshacer** y otros flujos refresquen la lista cuando la agenda es la
vista activa, `renderAll()` llama a `renderAgenda()` si `currentView === 'agenda'`.

## Aplazar una tarea

Cada ítem de tipo `tarea` tiene un botón-icono compacto (icono Lucide
`alarm-clock`, sin texto) que abre un menú emergente con opciones rápidas:
**Mañana**, **En 3 días**, **Próxima semana** y un selector **Otra fecha…**.

`_aplazarTarea(seg, nuevaFecha)` mueve `seg.fecha` a la fecha elegida
(`nDaysFromToday(n)` para los atajos), localiza el trámite dueño por referencia
(`seguimiento.includes(seg)`), persiste, muestra toast con **Deshacer** y
re-renderiza. Al mover la fecha al futuro, la tarea sale de la agenda de hoy y
reaparece en su nueva fecha.

El menú se cierra al hacer clic fuera vía `_installAgendaSnoozeCloser()` (listener
global instalado una sola vez). Solo aplica a `tarea`: los vencimientos son
fechas legales fijas y no se aplazan desde aquí.

## Persistencia

Marcar algo como hecho llama a `_persistTramite(t)` → `saveAll()` +
`saveTramiteFS(t)` (si Firebase está activo), registra `pushHistory(...)` para
permitir **Deshacer** desde el toast, y vuelve a renderizar agenda + badge.

## Al modificar

- Si añades un nuevo `tipo` de ítem, recuerda asignarle `resp` y `mine`, o
  quedará mal clasificado en el filtro.
- El estado vacío (`#emptyAgenda`) muestra un mensaje distinto según haya o no
  ítems en otros scopes (ver `renderAgenda()`).
