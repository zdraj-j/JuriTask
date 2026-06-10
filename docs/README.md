# Documentación de procesos — JuriTask

JuriTask es una PWA (sin framework, JS modular cargado por `<script>`) para la
gestión de trámites jurídicos: vencimientos, tareas de seguimiento, equipos,
reportes y agenda diaria. Los datos viven en `localStorage` y, si hay sesión,
se sincronizan con **Firestore**.

Cada archivo de esta carpeta documenta **un proceso** de la app: para qué
sirve, qué archivos lo implementan, su modelo de datos y los puntos delicados a
tener en cuenta al modificarlo.

## Índice de procesos

| Proceso | Documento | Archivo(s) principal(es) |
|---|---|---|
| Estado, almacenamiento e historial | [almacenamiento-estado.md](almacenamiento-estado.md) | `js/storage.js` |
| Trámites (CRUD y dominio) | [tramites.md](tramites.md) | `js/tramites.js`, `js/ui.js` |
| Filtros y búsqueda | [filtros-busqueda.md](filtros-busqueda.md) | `js/filters.js` |
| Agenda accionable | [agenda.md](agenda.md) | `js/ui.js` |
| Calendario mensual | [calendario.md](calendario.md) | `js/calendar.js` |
| Informe / reporte del día | [informe.md](informe.md) | `js/ui.js` |
| Autenticación (UI) | [autenticacion.md](autenticacion.md) | `js/auth.js` |
| Sincronización con Firebase | [sincronizacion-firebase.md](sincronizacion-firebase.md) | `js/firebase.js`, `firebase.rules` |
| Notificaciones | [notificaciones.md](notificaciones.md) | `js/notifications.js` |
| Dashboard de administración | [dashboard-admin.md](dashboard-admin.md) | `js/dashboard.js` |
| Adjuntos y Google Drive | [drive-adjuntos.md](drive-adjuntos.md) | `js/drive.js` |
| Selección múltiple y lotes | [seleccion-multiple.md](seleccion-multiple.md) | `js/selection.js` |
| Paleta de comandos y atajos | [paleta-comandos.md](paleta-comandos.md) | `js/commandpalette.js` |
| Navegación entre vistas y config | [navegacion-config.md](navegacion-config.md) | `js/config.js` |
| PWA / offline | [pwa-offline.md](pwa-offline.md) | `sw.js`, `manifest.json` |
| Accesibilidad e iconos | [accesibilidad-iconos.md](accesibilidad-iconos.md) | `js/a11y.js`, `js/icons.js` |

## Convenciones del dominio

- **`tipo` de trámite**: `propio` (mío), `abogado` (de otro abogado) o `equipo`
  (compartido). `esPropio(t)` ⇔ `t.tipo === 'propio'`.
- **Responsable de una tarea**: campo `responsable` (clave de abogado o `'yo'`)
  y/o `assignedTo` (array de UIDs). Se considera **mío** si el responsable es
  `'yo'`, mi UID, o no hay responsable explícito.
- **Etapas de gestión**: `gestion.analisis` → `gestion.cumplimiento` →
  `terminado`. Lo refleja la barra de 3 segmentos de cada tarjeta.
- **Fechas**: cadenas `YYYY-MM-DD`; se comparan lexicográficamente. `today()`
  (en `tramites.js`) devuelve la fecha local cacheada.
