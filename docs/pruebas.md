# Proceso: Pruebas en navegador

`test/smoke.js` levanta la app en un Chromium real y comprueba que los flujos
principales siguen vivos. No sustituye la revisión a ojo, pero atrapa lo que
más duele en una app sin bundler ni tipos: un `ReferenceError` por una variable
renombrada a medias, un botón que desapareció de más, un listener huérfano.

```bash
node test/smoke.js                    # sale 0 si pasa todo, 1 si algo falla
node test/archivo.js                  # el archivo de datos, con una FS API de mentira
JT_SHOTS=/tmp node test/smoke.js      # dónde dejar las capturas
JT_CHROME=/ruta/al/chrome node test/smoke.js   # usar otro binario
```

Requiere **Playwright con Chromium**. `JT_CHROME` existe para las máquinas que
ya traen un Chromium: Playwright exige la build exacta de su versión y falla
con *"Executable doesn't exist"* si no coincide. Vale para las dos pruebas.

## Cómo arranca la app en la prueba

La prueba no quiere red, así que sirve un `index.html` retocado al vuelo
(`localIndex()`), con dos cambios. Los dos tienen motivo:

| Retoque | Por qué |
|---|---|
| Quita los `<script src="https://…">` | Sin red no cargan (Lucide, html2canvas, el Picker, el SDK de Firebase) |
| Quita el registro del service worker | Se registra y dispara `location.reload()` en `controllerchange`, recargando a mitad de prueba |
| Añade un arranque propio | Con Firebase fuera nadie define `mostrarApp()`, y el arranque real se quedaría en la puerta esperando una carpeta de datos que aquí no hay |

> El regex del service worker **no mira el número del comentario**. Lo miraba, y
> cuando se renumeraron las secciones de `index.html` dejó de coincidir en
> silencio: el SW volvió a registrarse y a recargar la página a media prueba
> durante quién sabe cuánto. Se descubrió al escribir la prueba de la
> sincronización, y sigue valiendo igual para `test/archivo.js`.

Además inyecta un stub de `window.lucide` antes de `storage.js`, para que
`icons.js` no falle sin CDN. Los iconos no se dibujan; a la prueba no le
importa.

`DROP` retira `js/firebase.js` y `js/auth.js`: necesitan red y una sesión de
Google de verdad. Todo lo demás arranca en local, que es justo lo que se
comprueba. El arranque real —la puerta, la carpeta, la escritura— se prueba
aparte en `test/archivo.js`, que sí monta una File System Access API de
mentira.

## Una cosa que hay que saber

**`page.evaluate()` corre en un mundo aislado** y no ve los globals de la
página (`STATE`, `renderAll`, `getFilters`): el DOM es el mismo, pero el
contexto de JS no. Por eso la prueba comprueba **a través del DOM** y no
leyendo el estado. Si algún día hace falta llamar a una función de la app,
hay que inyectarla con `page.addScriptTag({ content: … })`, que sí corre en el
mundo principal.

## Qué cubre hoy

Los datos de prueba se siembran en `localStorage` antes de cargar: un trámite
activo con una tarea pendiente y uno terminado.

- **Navegación**: el menú y las vistas del DOM son los esperados.
- **Tarjetas**: la lista de activos renderiza.
- **Detalle expandido**: un solo botón "Nueva tarea", los cuatro botones de
  acción presentes, y ninguna franja vacía de `.card-actions-row`.
- **Reactivar**: el botón sale en Terminados, el trámite vuelve a la lista
  activa, se persiste `terminado:false` y sale el toast con Deshacer.
- **Reporte del día**: quedan Captura y Panel lateral, y no Imprimir ni Copiar.
- **Amputación**: no vuelven los equipos — ninguna pieza de perfiles ajenos,
  notificaciones, ámbitos compartidos ni aprobación.
- **Puerta y sesión**: `index.html` declara la puerta de la carpeta
  (`#gateScreen`, `#gateElegir`), el botón opcional de Google
  (`#btnConectarGoogle`) y `js/archivo.js`; y **no** declara
  `firebase-firestore-compat`, que se fue con la base de datos.
- **Crear un trámite**: se guarda como `propio` y sin `sharedWith`, `_scope`
  ni `createdBy`.
- **Borradores del día**: ya no están, ni ellos ni el trigger; la bitácora de
  enviados sí sigue.
- **Archivo de datos**: Ajustes declara la carpeta, la lista de copias y el
  aviso de cambios sin guardar.

Al final imprime un resumen y **falla si hubo cualquier `pageerror` o error de
consola** que no sea de red.

## Qué cubre `test/archivo.js`

Sustituyó a `test/firestore.js` cuando la base de datos pasó de la nube al disco
([archivo-datos.md](archivo-datos.md)). Ejercita el ciclo entero contra una File
System Access API de mentira: quién gana al cargar, qué se escribe y —sobre
todo— **qué no**.

- **1-3, la puerta.** Sin carpeta la app no entra; elegir una la crea, entra y
  vuelca al archivo lo que hubiera en la caché.
- **4-6, el ciclo normal.** Un cambio llega al archivo, la marca de pendientes
  se levanta al guardar, y al reabrir con la carpeta recordada manda el archivo.
- **7-8, el trabajo sin guardar.** Es la regresión del fallo por el que la app
  amanecía con datos de días atrás: con la marca `juritask_pendiente` puesta, la
  carga conserva lo local en `STATE` y en la caché, y lo escribe. Sin la marca,
  la 7 falla porque el archivo reemplaza la caché sin mirar.
- **9-11, no vaciar un archivo con datos.** Un `STATE` vacío no puede vaciar el
  archivo; «Borrar todos mis datos» sí, vía `autorizarVaciado()`; y esa
  autorización **no queda armada** para la siguiente escritura.
- **12-14, las copias.** Se crea una al día en `copias/`, la segunda del mismo
  día no pisa a la primera, y restaurar devuelve los trámites.
- **15, el conflicto.** Un archivo cambiado por fuera se guarda como
  `copias/conflicto-<hora>.json` antes de pisarlo.
- **16, sin soporte.** Sin `showDirectoryPicker` la app lo detecta en vez de
  reventar.

Dos detalles del andamiaje, por si hay que tocarlo: el "disco" falso se persiste
en `localStorage` para sobrevivir a los `reload()` —sin eso no se podría probar
lo que pasa **entre** dos arranques—, y el handle de la carpeta se guarda como
una marca, no como objeto, porque IndexedDB no puede clonar algo con funciones.

También hay un ayudante `sembrarCache()`: escribir solo en `localStorage` y
recargar no siembra nada, porque el `beforeunload` de la app vuelca el `STATE`
de la página que se va por encima.

## Al modificar

- Si algún día un módulo exige red o sesión para arrancar, agrégalo a `DROP`.
- **`page.evaluate()` no vale para tocar los globals de la app.** Usa
  `addScriptTag`, que sí corre en el mundo principal, y devuelve el resultado
  por el DOM, que es lo único que comparten los dos mundos. `test/archivo.js`
  tiene el ayudante `enPagina()` hecho, y además espera promesas.
- Si una comprobación empieza a fallar por tiempos, usa `waitForSelector` en
  vez de subir el `waitForTimeout`: el render de la app no es síncrono.
