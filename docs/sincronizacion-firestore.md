# Proceso: Sincronización con Firestore

Dónde viven los datos y cómo suben.

## Archivos

- `js/firebase.js` → `cargarDeFirestore()`, `sincronizarConFirestore()`,
  `subirTodoAFirestore()`.
- `js/storage.js` → `saveAll()`, el único punto que dispara la subida.
- `firebase.rules` → las reglas de acceso.
- `test/firestore.js` → la prueba, con un SDK de mentira.

## El modelo

```
users/{uid}/tramites/{id}     un documento por trámite
users/{uid}/meta/config       STATE.config
users/{uid}/meta/order        { order: [...] }
```

Un documento por trámite, y no uno solo con todo, por el tope de **1 MB por
documento** de Firestore: con suficientes trámites y adjuntos se alcanza.

`localStorage` sigue escribiéndose, pero ya no es la fuente de verdad: es una
**caché**. Al arrancar se lee primero para que la app pinte algo de inmediato,
y acto seguido la nube la reemplaza.

## La subida cuelga de `saveAll()`

Este es el cambio de diseño que conviene entender.

Antes había **28 llamadas a `saveTramiteFS(t)`** repartidas por `ui.js`,
`tramites.js` y `selection.js`, una detrás de cada mutación. Bastaba olvidar
una para que un cambio se guardara en local y nunca subiera —un fallo
silencioso, y de los peores: los datos parecen estar hasta que abres la app en
otro equipo.

Ahora hay un solo enganche. `saveAll()` ya era el punto por el que pasa
cualquier cambio de estado, así que la sincronización cuelga de ahí y **compara
contra lo último escrito** (`_sello`, un `Map` de id → JSON):

- lo que cambió, se sube;
- lo que ya no está en `STATE`, se borra;
- lo que está igual, no se toca.

Dos consecuencias buenas y gratis: no se puede olvidar un sitio, y **importar
un JSON** queda cubierto sin código propio —lo importado se sube y lo que
desapareció se borra, porque eso es exactamente lo que ve el comparador—.

## Los dos ritmos

| Capa | Espera | Por qué |
|---|---|---|
| `localStorage` | 400 ms | Inmediato y gratis: absorbe las ráfagas de tecleo |
| Firestore | 1200 ms | Cada subida es una operación de red que se cobra |

Un cierre de pestaña no espera al debounce: hay un `beforeunload` que fuerza la
subida pendiente.

## Si falla la subida

Se registra un aviso y **el sello no se revierte**. Es deliberado: el SDK de
Firestore reintenta la escritura por su cuenta cuando vuelve la conexión, y
mientras tanto los datos siguen en `localStorage`. Revertir el sello haría que
la siguiente pasada reenviara todo, compitiendo con el reintento del SDK.

Si es la **lectura** inicial la que falla, la app arranca igual con la caché
local y avisa. Mejor datos de hace un rato que una pantalla en blanco.

## Al modificar

- Cualquier código que toque `STATE` debe llamar a `saveAll()`. Es la única
  obligación, y ya lo era antes.
- No añadas `onSnapshot`. La carga es una foto al entrar, no un flujo en vivo:
  con un solo usuario, dos pestañas abiertas a la vez son el único caso de
  conflicto, y la última en escribir gana. Un listener en vivo obligaría a
  fusionar estados y a decidir qué hacer con el `undo` local.
- Los lotes de Firestore cortan a las **500 operaciones**;
  `subirTodoAFirestore()` trocea de 400 en 400.
