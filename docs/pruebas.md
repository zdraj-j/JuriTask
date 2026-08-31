# Proceso: Prueba de humo en navegador

`test/smoke.js` levanta la app en un Chromium real y comprueba que los flujos
principales siguen vivos. No sustituye la revisión a ojo, pero atrapa lo que
más duele en una app sin bundler ni tipos: un `ReferenceError` por una variable
renombrada a medias, un botón que desapareció de más, un listener huérfano.

```bash
node test/smoke.js                    # sale 0 si pasa todo, 1 si algo falla
node test/firestore.js                # la sincronización, con un SDK de mentira
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
| Añade un arranque propio | Con Firebase fuera nadie llama a `init()`: el arranque cuelga de la sesión |

> El regex del service worker **no mira el número del comentario**. Lo miraba, y
> cuando se renumeraron las secciones de `index.html` dejó de coincidir en
> silencio: el SW volvió a registrarse y a recargar la página a media prueba
> durante quién sabe cuánto. Fue lo que hizo fallar `test/firestore.js` al
> escribirlo.

Además inyecta un stub de `window.lucide` antes de `storage.js`, para que
`icons.js` no falle sin CDN. Los iconos no se dibujan; a la prueba no le
importa.

`DROP` retira `js/firebase.js` y `js/auth.js`: necesitan red y una sesión de
Google de verdad. Todo lo demás arranca en local, que es justo lo que se
comprueba. Lo que esos dos módulos hacen se prueba aparte, en
`test/firestore.js`.

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
- **Amputación**: vuelve la sesión, no vuelven los equipos — ninguna pieza de
  perfiles ajenos, notificaciones, ámbitos compartidos ni aprobación. Y el
  acceso con Google está declarado en `index.html`.
- **Crear un trámite**: se guarda como `propio` y sin `sharedWith`, `_scope`
  ni `createdBy`.
- **Borradores del día**: está el botón manual, no queda nada del trigger, y la
  selección de tareas solo coge requerimientos vencidos de trámites vivos.

Al final imprime un resumen y **falla si hubo cualquier `pageerror` o error de
consola** que no sea de red.

## Qué cubre `test/firestore.js`

El ciclo entero de sincronización contra un SDK de mentira: quién gana al
cargar, qué sube, qué no se reescribe, qué se borra, y que cerrar sesión vacía
la caché local.

Las comprobaciones 11-14 vigilan los **trámites duplicados**
([sincronizacion-firestore.md](sincronizacion-firestore.md#el-id-no-es-opcional)):
que las copias de la nube no se pinten repetidas, que las sobrantes se borren,
que un documento sin `id` adopte el suyo, y que guardar dos veces un trámite no
deje dos documentos. Para esto último el SDK falso imita al de verdad en el
detalle que causaba el fallo: **`doc()` sin id genera uno nuevo en cada
llamada**. Si se simplifica esa línea, la prueba 14 deja de probar nada.

## Al modificar

- Si algún día un módulo exige red o sesión para arrancar, agrégalo a `DROP`.
- **`page.evaluate()` no vale para tocar los globals de la app.** Usa
  `addScriptTag`, que sí corre en el mundo principal, y devuelve el resultado
  por el DOM, que es lo único que comparten los dos mundos. `test/firestore.js`
  tiene el ayudante `enPagina()` hecho.
- Si una comprobación empieza a fallar por tiempos, usa `waitForSelector` en
  vez de subir el `waitForTimeout`: el render de la app no es síncrono.
