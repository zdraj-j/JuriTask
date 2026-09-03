# Proceso: Copias de seguridad

Una copia diaria de los trámites, automática, junto al archivo de datos.

## Archivos

- `js/copias.js` → `crearCopiaDiaria()`, `listarCopias()`, `leerCopia()`,
  `restaurarCopia()`, `borrarCopia()`, `renderCopias()`, `initCopias()`.
- `index.html` → la sección **Ajustes › Copias de seguridad** (`#copiasList`,
  `#copiaAhoraBtn`).
- `js/config.js` → `crearCopiaDiaria()` al terminar el arranque, `initCopias()`
  en `init()`, `renderCopias()` al entrar en Configuración.

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

Las copias volvieron primero a Firestore y, poco después, al disco junto con el
resto de los datos.

## Dónde se guardan

```
<carpeta de datos>/copias/juritask-AAAA-MM-DD.json
```

Un archivo por día, al lado de `juritask.json`
([archivo-datos.md](archivo-datos.md)). El nombre lleva la fecha, así que la
operación es idempotente: abrir la app cinco veces en un día deja una sola
copia.

Vivían en Firestore (`users/{uid}/meta/copia-…`) hasta que la base de datos pasó
al disco. Se movieron con ella: no tendría sentido dejar el respaldo en la nube
que la app ya no usa, y así son archivos que el usuario ve, copia a un USB y
respalda con sus propias herramientas.

Cada copia lleva `version`, `creadoEn`, `total`, `tramites`, `order` y `config`
—el mismo formato que `juritask.json` más el sello—, así que una copia también
se puede importar a mano desde **Ajustes › Importar JSON**.

Sin tope de tamaño: es un archivo del disco, no un documento de 1 MiB. La
comprobación `TOPE_DOC` que existía para Firestore se fue con él.

## El límite que sí queda

**Las copias están en el mismo disco que el original.** No protegen de que el
disco muera, se pierda el portátil o alguien borre la carpeta. Si la carpeta de
datos está en algo que se sincroniza (Drive, OneDrive, Dropbox), hay además una
copia fuera del equipo; si está en un disco suelto, no la hay.

Es la limitación real de esta arquitectura y conviene decirla en voz alta, no
enterrarla.

## Retención

Se conservan `COPIAS_A_GUARDAR` (7). `_retirarCopiasViejas()` corre después de
cada copia nueva y borra las que sobran, de la más vieja hacia atrás.

Los `conflicto-*.json` que deja `js/archivo.js` viven en la misma carpeta pero
**no** cuentan como copias: no entran en el listado ni en la retención, porque
no son fotos coherentes que se puedan restaurar a ciegas.

Una copia de un estado **vacío** no se guarda: no protege de nada y sí podría
desplazar a una copia buena al aplicar la retención.

## Restaurar

`restaurarCopia(id)` pide confirmación diciendo cuántos trámites entran y
cuántos se reemplazan, y **antes de reemplazar guarda una copia del estado
actual** (con `forzar: true`, para que pise la de hoy). Restaurar por error es
tan fácil como restaurar a propósito; sin esa red, la equivocación no tendría
vuelta.

Después llama a `saveAll(true)`, que reescribe `juritask.json` entero con lo
restaurado.

## Al modificar

- El id del contenedor de la lista es **`copiasList`**, no `backupList`. Ese
  otro es el de la etapa multiusuario y `test/smoke.js` comprueba que no haya
  vuelto: reutilizarlo rompe la prueba.
- `crearCopiaDiaria()` se llama **después** de `mostrarApp()` y sin `await`: es
  protección, no puede retrasar el arranque ni tumbarlo si falla.
