# Proceso: Dashboard de administración

Panel solo para admins: KPIs, gestión de usuarios, equipos y backups.

## Archivos

- `js/dashboard.js` → `loadDashboardData()`, render de métricas y tablas de
  usuarios/equipos.
- `index.html` → `#view-dashboard`.
- `js/config.js` → `switchView('dashboard')` dispara `loadDashboardData()`.

## Restricción de permisos (importante)

Firestore **no** permite listar `/users/` completa desde el cliente, aunque el
usuario sea admin (las reglas no soportan `list` sobre una colección donde cada
doc tiene regla individual). Por eso el dashboard:

- Calcula métricas propias a partir de `STATE.tramites` (ya en memoria).
- Lee usuarios **individualmente** solo de los conocidos: el propio UID + los
  miembros de los equipos.

## Contenido

- KPIs (trámites activos, por abogado, por módulo, etc.).
- Gestión de usuarios: cambiar rol, bloquear, eliminar (con salvaguardas:
  no sobre uno mismo ni sobre el admin original).
- Equipos y backups.

## Al modificar

No introduzcas consultas que asuman `list` global sobre `/users/`: fallarán por
reglas. Mantén la estrategia de "leer solo lo conocido".
