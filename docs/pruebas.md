# Proceso: Prueba de humo en navegador

`test/smoke.js` levanta la app en un Chromium real y comprueba que los flujos
principales siguen vivos. No sustituye la revisión a ojo, pero atrapa lo que
más duele en una app sin bundler ni tipos: un `ReferenceError` por una variable
renombrada a medias, un botón que desapareció de más, un listener huérfano.

```bash
node test/smoke.js                    # sale 0 si pasa todo, 1 si algo falla
JT_SHOTS=/tmp node test/smoke.js      # dónde dejar las capturas
```

Requiere **Playwright con Chromium** instalado.

## Cómo arranca la app en la prueba

JuriTask normalmente arranca contra Firebase. La prueba no quiere red ni
sesión, así que sirve un `index.html` retocado al vuelo (`localIndex()`), con
tres cambios. Los tres tienen motivo:

| Retoque | Por qué |
|---|---|
| Quita los `<script src="https://…">` | Sin red no cargan; además `firebase.initializeApp()` lanzaría y dejaría `const AUTH` en TDZ, que rompe todo lo demás |
| Quita `firebase.js`, `auth.js`, `dashboard.js` y `notifications.js` | Exigen los SDK. Sin ellos `typeof firebase === 'undefined'` y `init()` toma la rama de arranque local |
| Quita el registro del service worker | Se registra y dispara `location.reload()` en `controllerchange`, recargando a mitad de prueba |

Además inyecta dos stubs antes de `storage.js`:

- `window.AUTH = { userProfile: null }` — `ui.js` usa `AUTH?.userProfile?.uid`,
  y el encadenamiento opcional **no** protege de una variable no declarada: si
  `AUTH` no existe como binding, lanza `ReferenceError`. Como propiedad de
  `window` sí resuelve.
- `window.lucide = { createIcons(){} }` — evita que `icons.js` falle sin CDN.
  Los iconos no se dibujan; a la prueba no le importa.

## Dos cosas que hay que saber

**`#appContainer` nace con `display:none`** y sólo lo destapa `firebase.js`
tras el login. En modo local nadie lo hace, así que la prueba lo destapa a
mano. Es decir: la rama "sin Firebase" de `init()` no llega a verse en un
navegador real; existe, pero no está cableada del todo.

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

Al final imprime un resumen y **falla si hubo cualquier `pageerror` o error de
consola** que no sea de red.

## Al modificar

- Si añades un módulo que exija Firebase, agrégalo a `DROP`.
- Si una comprobación empieza a fallar por tiempos, usa `waitForSelector` en
  vez de subir el `waitForTimeout`: el render de la app no es síncrono.
