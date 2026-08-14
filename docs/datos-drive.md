# Proceso: Datos en Drive

Sustituye a Firestore. Todo el estado vive en **un único JSON** dentro de una
carpeta `JuriTask` del Drive del usuario que despliega.

## Archivos

- `server/Datos.gs` → `getEstado`, `guardarEstado`, `estadoDelAlmacen` y los
  backups (`crearBackup`, `listarBackups`, `leerBackup`, `borrarBackup`,
  `purgarBackups`).
- `js/backend.js` → `srv()` (promesa sobre `google.script.run`),
  `backendCargar`, `backendGuardar`, y la UI de backups.
- `js/storage.js` → `saveAll()` con dos destinos y `sincronizarConServidor()`.

## Dos mundos, una API

La app funciona igual en dos entornos, y `backend.js` es la única pieza que
conoce la diferencia:

| | En Apps Script | En un navegador normal |
|---|---|---|
| `BACKEND.disponible` | `true` | `false` |
| Persistencia | JSON en Drive + caché en `localStorage` | solo `localStorage` |
| Backups | en Drive | no hay (queda "Exportar JSON") |
| Token de Google | `ScriptApp.getOAuthToken()` | ninguno |

El segundo no es un modo degradado accidental: es el modo en que se desarrolla
y en que corre `test/smoke.js`.

## Ritmos de guardado

`saveAll()` escribe en dos sitios con cadencias distintas, a propósito:

- **`localStorage`, 400 ms.** Copia inmediata. Es lo que permite repintar al
  instante en el siguiente arranque.
- **Drive, 2,5 s.** Cada `google.script.run` es un viaje de ida y vuelta; no se
  manda uno por tecla.

`saveAll(true)` fuerza ambos. En `beforeunload` se vuelcan los dos, aunque el
envío a Drive es asíncrono y puede no llegar — la copia local sí queda.

## El arranque tiene dos fases

`init()` **no espera** a Drive:

1. `loadAll()` lee `localStorage` (síncrono) y `renderAll()` pinta al instante.
2. `sincronizarConServidor()` va a Drive y, si trae datos, sustituye el estado
   y repinta.

Así la app no se queda en blanco durante el arranque en frío de Apps Script,
que ya es de varios segundos.

**Drive manda.** Es el único sitio compartido entre dispositivos; lo local es
caché. La única excepción es el primer arranque, cuando el fichero aún no
existe: ahí se sube lo local para no perderlo.

## Por qué viaja una cadena, no un objeto

`guardarEstado(json)` recibe la cadena ya serializada, y `getEstado()` la
devuelve igual. `google.script.run` sabe pasar objetos planos, pero mandar la
cadena deja el control del formato en un solo sitio y evita cualquier sorpresa
de serialización. El servidor hace `JSON.parse` antes de escribir: mejor fallar
que dejar el fichero corrupto.

Ayuda que las fechas de JuriTask sean cadenas `YYYY-MM-DD` por convención (ver
[tramites.md](tramites.md)): no hay objetos `Date` que se transformen por el
camino.

## El lock no es decorativo

`guardarEstado` toma `LockService.getScriptLock()`. El trigger diario de
borradores (Fase 5) también escribe el estado, y sin lock una corrida a las
6:00 podría pisar lo que estuvieras editando.

## Por qué el scope es `drive` y no `drive.file`

`drive.file` es el permiso mínimo: da acceso **solo a lo que el propio script
crea**, que sobre el papel es exactamente lo que hace falta aquí. No sirve.
`DriveApp` es un servicio de grano grueso y casi todos sus métodos exigen el
scope `drive` entero:

| Llamada | Con `drive.file` |
|---|---|
| `getFoldersByName` | ❌ *Required permissions: drive.readonly \|\| drive* |
| `createFolder` | ❌ *Required permissions: drive* |

Los dos errores saltan en la **primera autorización**, antes de que la app
llegue a arrancar, y no los ve ninguna prueba local: el servidor solo existe de
verdad una vez desplegado.

Hay una vía estrecha —la API REST de Drive con `UrlFetchApp`, que sí respeta
`drive.file`— y se llegó a implementar. Se descartó por decisión del dueño de la
cuenta: `DriveApp` es nativo, no depende de habilitar la Drive API en la consola
de Cloud y deja menos piezas que se puedan romper. Si algún día hace falta
volver a estrechar el permiso, está en el historial de git.

**El precio, explícito**: el script puede leer y escribir todo el Drive de la
cuenta, no solo su carpeta. Es una cuenta corporativa con expedientes; conviene
que quede dicho.

`drive` es además un scope **restringido** en Workspace: puede requerir que el
administrador apruebe el client ID del proyecto, igual que `gmail.modify`.

## Backups

Copias fechadas del JSON en la misma carpeta, con prefijo
`juritask-backup-`. Se purgan a los 30 días, y `crearBackup()` llama a
`purgarBackups()` para que la limpieza no dependa de un trigger.

`leerBackup` y `borrarBackup` comprueban el prefijo antes de tocar nada: el id
llega del cliente y, con el scope `drive`, aceptar cualquier id sería aceptar
cualquier fichero del Drive.

Antes de respaldar, el cliente **sube primero lo pendiente** (`crearBackupAhora`):
si no, con el debounce de 2,5 s se acabaría respaldando una versión vieja.

## Al modificar

- **Nada de esto se puede probar en local**: el servidor solo existe una vez
  desplegado, y los fallos de permisos aparecen en la autorización inicial. Tras
  tocar `Datos.gs`, ejecutar `estadoDelAlmacen` desde el editor antes de dar
  nada por bueno.
- Si algún día se estrecha el scope a `drive.file`, hay que sustituir `DriveApp`
  por la API REST: no es opcional, `DriveApp` no funciona con ese permiso.
- Si el JSON crece mucho, el cuello no es Drive sino el tiempo de
  `JSON.stringify` en cada guardado. Antes de trocear, medir.
- No metas `PropertiesService` como almacén: tope de 500 KB por almacén y 9 KB
  por valor. Por eso los datos van a Drive y ahí solo viven los ids.
