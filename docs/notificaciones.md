# Proceso: Notificaciones

Avisa de tareas asignadas por compañeros, mensajes del admin y tareas
estancadas. Requiere Firebase (Auth + Firestore) cargado antes.

## Archivos

- `js/notifications.js` → suscripción en tiempo real, panel y badges.
- `index.html` → panel `#notif-panel` / campana en la topbar.

## Estado interno

- `_notifUnsubscribe` → listener activo de Firestore (se limpia al cerrar sesión).
- `_notifList` → notificaciones cargadas.
- `_stagnantNotifs` / `_stagnantTimer` → detección de tareas **estancadas**;
  umbral `STAGNANT_THRESHOLD_MS` (30 min) y marca temporal en `localStorage`
  bajo `STAGNANT_KEY` (`jt_stagnant_since`).

## Tipos

- **Tarea asignada** por otro miembro del equipo.
- **Mensaje del admin** (ver [dashboard](dashboard-admin.md)).
- **Estancamiento**: recordatorio local cuando hay pendientes sin atender.

## Al modificar

Recuerda desuscribir (`_notifUnsubscribe()`) al hacer logout para evitar
listeners colgados, y cancelar `_stagnantTimer`.
