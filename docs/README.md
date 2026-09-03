# Documentación de procesos — JuriTask

JuriTask es una PWA (sin framework, JS modular cargado por `<script>`) para la
gestión de trámites jurídicos: vencimientos, tareas de seguimiento, reportes y
agenda diaria.

Es de **un solo usuario**: no hay cuentas que gestionar, ni equipos, ni nada
compartido.

Los datos viven en **un JSON del disco del usuario**, `juritask.json`, al que se
llega por la File System Access API, con `localStorage` como caché
([archivo-datos.md](archivo-datos.md)). No hay servidor ni base de datos
remota: la app no sube los trámites a ninguna parte.

Sigue habiendo un acceso con Google, pero es **opcional** y solo habilita el
correo y los adjuntos: de ahí sale el token de Gmail y Drive
([autenticacion.md](autenticacion.md)).

> **Lo que cuesta esta arquitectura, dicho de frente.** `showDirectoryPicker`
> solo existe en Chrome, Edge y Opera **de escritorio**: la app no guarda datos
> en Firefox, en Safari ni en el teléfono. Y el archivo vive en un solo disco,
> así que la carpeta debería estar en algo que se sincronice o se respalde
> fuera del equipo.

> **Nota histórica.** Antes los datos estuvieron en Firestore, y antes de eso
> hubo un intento de trasladar la app a una *web app de Apps Script* con los
> datos en un JSON de Drive, abandonado porque el administrador de Workspace
> bloqueó Apps Script. Con Firestore se fueron también los **borradores del
> día**; la bitácora de enviados, que vivía en el mismo archivo, se quedó
> ([bitacora-envios.md](bitacora-envios.md)). Todo queda en el historial de
> git.

Cada archivo de esta carpeta documenta **un proceso** de la app: para qué
sirve, qué archivos lo implementan, su modelo de datos y los puntos delicados a
tener en cuenta al modificarlo.

## Índice de procesos

| Proceso | Documento | Archivo(s) principal(es) |
|---|---|---|
| Estado, almacenamiento e historial | [almacenamiento-estado.md](almacenamiento-estado.md) | `js/storage.js` |
| Conectar con Google | [autenticacion.md](autenticacion.md) | `js/auth.js`, `js/firebase.js` |
| El archivo de datos | [archivo-datos.md](archivo-datos.md) | `js/archivo.js` |
| Copias de seguridad | [copias-seguridad.md](copias-seguridad.md) | `js/copias.js` |
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
| Bitácora de enviados | [bitacora-envios.md](bitacora-envios.md) | `js/bitacora.js` |
| Pruebas en navegador | [pruebas.md](pruebas.md) | `test/smoke.js`, `test/archivo.js` |
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
