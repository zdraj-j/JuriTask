# Documentación de procesos — JuriTask

JuriTask es una PWA (sin framework, JS modular cargado por `<script>`) para la
gestión de trámites jurídicos: vencimientos, tareas de seguimiento, reportes y
agenda diaria. Es de **un solo usuario**: no hay login, ni cuentas, ni equipos.
Los datos viven en `localStorage`.

> **Migración en curso.** El destino es una *web app de Apps Script*, con los
> datos en un JSON de Drive y el correo gestionado desde el servidor. Por eso
> ya no hay Firebase, y el acceso a Gmail/Drive está en pausa: ver
> [google-auth.md](google-auth.md).

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
| Informe / reporte del día | [informe.md](informe.md) | `js/ui.js` |
| Reporte de trámites y Excel | [reportes-excel.md](reportes-excel.md) | `js/reportes.js`, `js/xlsx.js` |
| Panel de indicadores | [panel.md](panel.md) | `js/dashboard.js` |
| Token OAuth de Google | [google-auth.md](google-auth.md) | `js/google-auth.js` |
| Adjuntos y Google Drive | [drive-adjuntos.md](drive-adjuntos.md) | `js/drive.js` |
| Selección múltiple y lotes | [seleccion-multiple.md](seleccion-multiple.md) | `js/selection.js` |
| Paleta de comandos y atajos | [paleta-comandos.md](paleta-comandos.md) | `js/commandpalette.js` |
| Navegación entre vistas y config | [navegacion-config.md](navegacion-config.md) | `js/config.js` |
| PWA / offline | [pwa-offline.md](pwa-offline.md) | `sw.js`, `manifest.json` |
| Prueba de humo en navegador | [pruebas.md](pruebas.md) | `test/smoke.js` |
| Build y despliegue en Apps Script | [appsscript.md](appsscript.md) | `tools/build.js`, `test/sandbox.js` |
| Accesibilidad e iconos | [accesibilidad-iconos.md](accesibilidad-iconos.md) | `js/a11y.js`, `js/icons.js` |

## Convenciones del dominio

- **`tipo` de trámite**: `propio` (mío) o `abogado` (a cargo de un colaborador).
  `esPropio(t)` ⇔ `t.tipo === 'propio'`.
- **Colaboradores**: son **etiquetas** de `config.abogados`, no usuarios. No hay
  UIDs ni cuentas que resolver.
- **Responsable de una tarea**: campo `responsable` — `'yo'` o la clave del
  colaborador del trámite. Se considera **mío** si es `'yo'` o está vacío.
- **Etapas de gestión**: `gestion.analisis` → `gestion.cumplimiento` →
  `terminado`. Lo refleja la barra de 3 segmentos de cada tarjeta.
- **Fechas**: cadenas `YYYY-MM-DD`; se comparan lexicográficamente. `today()`
  (en `tramites.js`) devuelve la fecha local cacheada.
- **Vencimiento**: solo aplica mientras el trámite no esté cumplido. En todas
  las vistas la condición es `t.fechaVencimiento && !t.gestion?.cumplimiento`
  (tarjetas, agenda, reporte del día, y `_repVenc()` en el reporte de
  trámites). Marcado el cumplimiento, el trámite
  deja de mostrar fecha y de contar como vencido.
