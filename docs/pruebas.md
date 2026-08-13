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

La prueba no quiere red, así que sirve un `index.html` retocado al vuelo
(`localIndex()`), con dos cambios. Los dos tienen motivo:

| Retoque | Por qué |
|---|---|
| Quita los `<script src="https://…">` | Sin red no cargan (Lucide, html2canvas, el Picker) |
| Quita el registro del service worker | Se registra y dispara `location.reload()` en `controllerchange`, recargando a mitad de prueba |

Además inyecta un stub de `window.lucide` antes de `storage.js`, para que
`icons.js` no falle sin CDN. Los iconos no se dibujan; a la prueba no le
importa.

Desde que se retiró Firebase **no hay módulos que excluir** (`DROP` está
vacío): la app entera arranca en local, que es justo lo que se comprueba.

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
- **Amputación**: no queda en el DOM ninguna pieza de sesión, notificaciones ni
  backups, y `window` no expone `firebase`, `AUTH`, `db` ni `auth`.
- **Crear un trámite**: se guarda como `propio` y sin `sharedWith`, `_scope`
  ni `createdBy`.

Al final imprime un resumen y **falla si hubo cualquier `pageerror` o error de
consola** que no sea de red.

## Al modificar

- Si algún día un módulo exige un backend para arrancar, agrégalo a `DROP`.
- Si una comprobación empieza a fallar por tiempos, usa `waitForSelector` en
  vez de subir el `waitForTimeout`: el render de la app no es síncrono.
