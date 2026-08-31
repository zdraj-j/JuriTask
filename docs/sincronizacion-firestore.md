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

El documento **se llama como el trámite**: `doc(t.id)`. Esa correspondencia es
la que garantiza que un trámite no pueda estar dos veces en la nube, y por eso
`js/firebase.js` nunca escribe con `doc(t.id)` a pelo, sino con `_docTramite(t)`
—ver [El `id` no es opcional](#el-id-no-es-opcional)—.

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

## El `id` no es opcional

Un trámite sin `id` hacía que la lista amaneciera con **el mismo trámite
repetido cientos de veces**. Merece la pena entender la cadena, porque el fallo
era silencioso de principio a fin:

1. `_tramitesRef().doc(t.id)` con `t.id` indefinido **no da error**: el SDK
   entiende que no le has dicho dónde guardar y **genera un id nuevo**. Cada
   guardado dejaba otra copia del trámite en la nube.
2. `db.settings({ ignoreUndefinedProperties: true })` descarta `id: undefined`
   al escribir, así que la copia nacía otra vez sin `id`.
3. Al recargar, la carga traía todas las copias y todas volvían a subirse sin
   `id`: se multiplicaban solas, un poco más cada día.

Y el detalle que despistaba al depurarlo: borrar **una** copia las quitaba
todas de golpe, porque el borrado filtra por `id` y todas compartían el mismo
—ninguno—. Parecía cosa del render, y estaba en los datos.

Las tres defensas, y por qué hacen falta las tres:

- **`migrateTramite()`** (`js/storage.js`) asigna un `id` a todo trámite que
  entre a `STATE`, venga de donde venga.
- **`_docTramite(t)`** es el único sitio desde el que se nombra un documento de
  trámite. Si falta el `id`, lo pone antes de escribir.
- **`_reconciliarTramites()`** limpia lo que ya quedó suelto en la nube: se
  queda el documento canónico —el que se llama como el trámite—, adopta el id
  del documento cuando el campo falta, reescribe en su sitio los que están
  descolocados y borra las copias sobrantes. Es lo que hace que el arreglo
  también cure las cuentas que ya tenían el problema, en la primera carga.

Las copias sin `id` se agrupan por `numero`, que es la clave de negocio —lo que
el usuario llama "el trámite", y lo que ya usa la detección de correo para no
crear duplicados—. De cada grupo se conserva la copia más completa.

## Si falla la subida

Se registra un aviso y **el sello no se revierte**. Es deliberado: el SDK de
Firestore reintenta la escritura por su cuenta cuando vuelve la conexión, y
mientras tanto los datos siguen en `localStorage`. Revertir el sello haría que
la siguiente pasada reenviara todo, compitiendo con el reintento del SDK.

Si es la **lectura** inicial la que falla, la app arranca igual con la caché
local y avisa. Mejor datos de hace un rato que una pantalla en blanco.

## Las reglas

`firebase.rules` cubre exactamente las tres rutas de arriba y cierra todo lo
demás, incluido el propio documento `users/{uid}` —que guardaba el perfil de la
etapa multiusuario— y las colecciones `teams`, `invitations`, `meta/userIndex`,
`notifications` y `backups`.

Dos decisiones que conviene no deshacer sin pensarlo:

- **Rutas explícitas, no `{doc=**}`.** El comodín recursivo tiene matices de
  coincidencia entre versiones de reglas, y una regla de seguridad no es sitio
  para depender de ellos.
- **`duenos()`, la lista de UID autorizados.** Vacía deja entrar a cualquier
  cuenta de Google. Eso *no* expone datos —cada cuenta solo alcanza su propio
  árbol— pero permite que un desconocido que dé con la dirección se registre y
  gaste tu cuota. Rellenarla es la única defensa contra eso, ahora que no hay
  un administrador que apruebe cuentas.

Cambiar las reglas **no borra nada**. Los datos de la etapa multiusuario siguen
en Firestore, simplemente inalcanzables.

## Al modificar

- Cualquier código que toque `STATE` debe llamar a `saveAll()`. Es la única
  obligación, y ya lo era antes.
- Para escribir un trámite, `_docTramite(t)`. Nunca `_tramitesRef().doc(t.id)`:
  esa es exactamente la línea que duplicaba trámites.
- No añadas `onSnapshot`. La carga es una foto al entrar, no un flujo en vivo:
  con un solo usuario, dos pestañas abiertas a la vez son el único caso de
  conflicto, y la última en escribir gana. Un listener en vivo obligaría a
  fusionar estados y a decidir qué hacer con el `undo` local.
- Los lotes de Firestore cortan a las **500 operaciones**;
  `subirTodoAFirestore()` trocea de 400 en 400.
