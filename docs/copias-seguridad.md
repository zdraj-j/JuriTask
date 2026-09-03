# Proceso: Copias de seguridad

Una copia diaria de los trámites, automática, en la nube.

## Archivos

- `js/copias.js` → `crearCopiaDiaria()`, `listarCopias()`, `leerCopia()`,
  `restaurarCopia()`, `borrarCopia()`, `renderCopias()`, `initCopias()`.
- `index.html` → la sección **Ajustes › Copias de seguridad** (`#copiasList`,
  `#copiaAhoraBtn`).
- `js/firebase.js` → llama a `crearCopiaDiaria()` al terminar el arranque.
- `js/config.js` → `initCopias()` en `init()`, `renderCopias()` al entrar en
  Configuración.

## Por qué existe

La app **tuvo** copias automáticas: diarias, en `users/{uid}/backups`, con siete
días de retención y una lista con restaurar y borrar en el panel de
administración. Se retiraron al dejar de ser multiusuario (commit `a8704dd`,
«Los backups: iban contra Firestore y no tienen dónde escribir. Vuelven en la
Fase 3 sobre Drive»). La Fase 3 se revirtió y **las copias no volvieron con
ella**.

Durante ese tiempo la documentación afirmaba que Firestore «ya guarda el
histórico del lado de Google». No es cierto: Firestore sobrescribe el documento
y lo anterior desaparece. Recuperar un estado pasado exige *point-in-time
recovery*, que es del plan de pago y hay que activarlo a mano. La única copia
real era pulsar **Exportar JSON** y acordarse de hacerlo.

Este proceso cierra ese hueco.

## Dónde se guardan

```
users/{uid}/meta/copia-AAAA-MM-DD
```

La ruta se elige a propósito: `users/{uid}/meta/{docId}` es **una de las tres
que `firebase.rules` ya permite**, así que las copias funcionan sin tocar las
reglas y sin reabrir nada de la etapa multiusuario. La colección `backups`
original sigue cerrada.

El id es la fecha, así que la operación es idempotente: abrir la app cinco veces
en un día deja una sola copia.

| Campo | Qué lleva |
|---|---|
| `creadoEn` | ISO del momento exacto |
| `tramites` | `JSON.stringify(STATE.tramites)` |
| `order` | `JSON.stringify(STATE.order)` |
| `total` | cuántos trámites, para pintar la lista sin leer el cuerpo |

`tramites` y `order` van **como texto**, no como arrays: Firestore no anida
arrays de objetos sin límite, y un trámite lleva seguimiento, notas y adjuntos.

## El tope de 1 MiB

Aquí sí se mete todo en un documento, al contrario que los trámites
([sincronizacion-firestore.md](sincronizacion-firestore.md#el-modelo)). El
motivo es que una copia solo sirve si es **una foto coherente de un instante**,
y repartirla en documentos la expondría a quedar a medias.

Eso la sujeta al tope de 1 MiB por documento. `TOPE_DOC` (900 KB, con margen
para los metadatos y la codificación) se comprueba **antes** de escribir: si no
cabe, se avisa por toast y se registra en consola, en vez de fallar en silencio.
Cuando ese aviso aparezca, la salida es exportar el JSON —o pasar las copias a
varios documentos—.

## Retención

Se conservan `COPIAS_A_GUARDAR` (7). `_retirarCopiasViejas()` corre después de
cada copia nueva y borra las que sobran, de la más vieja hacia atrás.

Una copia de un estado **vacío** no se guarda: no protege de nada y sí podría
desplazar a una copia buena al aplicar la retención.

## Restaurar

`restaurarCopia(id)` pide confirmación diciendo cuántos trámites entran y
cuántos se reemplazan, y **antes de reemplazar guarda una copia del estado
actual** (con `forzar: true`, para que pise la de hoy). Restaurar por error es
tan fácil como restaurar a propósito; sin esa red, la equivocación no tendría
vuelta.

Después vacía `_sello` y llama a `saveAll(true)`: el comparador ve todos los
trámites como cambiados y los sube, incluidos los que la nube ya no tenía.

## Al modificar

- El id del contenedor de la lista es **`copiasList`**, no `backupList`. Ese
  otro es el de la etapa multiusuario y `test/smoke.js` comprueba que no haya
  vuelto: reutilizarlo rompe la prueba.
- `crearCopiaDiaria()` se llama **después** de `mostrarApp()` y sin `await`: es
  protección, no puede retrasar el arranque ni tumbarlo si falla.
- Si algún día hacen falta más de siete copias o no caben en un documento, el
  siguiente paso natural es un documento por copia bajo `meta/` troceado, no
  reabrir la colección `backups`.
