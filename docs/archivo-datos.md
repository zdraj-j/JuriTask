# Proceso: El archivo de datos

Dónde viven los trámites y cómo se guardan.

## Archivos

- `js/archivo.js` → `soportaArchivo()`, `elegirCarpeta()`, `reconectarCarpeta()`,
  `cargarDeArchivo()`, `guardarArchivo()`, `guardarArchivoAhora()`,
  `autorizarVaciado()`, `renderArchivo()`.
- `js/storage.js` → `saveAll()`, el único punto que dispara el guardado.
- `js/config.js` → `arrancarApp()`, la puerta y el cableado de Ajustes.
- `test/archivo.js` → la prueba, con una File System Access API de mentira.

## El modelo

El usuario elige **una carpeta** y la app trabaja dentro:

```
<carpeta elegida>/
  juritask.json                     ← la base de datos
  copias/juritask-AAAA-MM-DD.json   ← una copia por día, 7 en retención
  copias/conflicto-<hora>.json      ← lo que había cuando algo cambió por fuera
```

`juritask.json` tiene el mismo formato que **Exportar JSON**, a propósito: un
archivo exportado se puede poner ahí y funciona, y `juritask.json` se puede abrir
en cualquier editor.

```json
{ "version": 3, "guardadoEn": "…", "tramites": [...], "order": [...], "config": {...} }
```

`localStorage` sigue escribiéndose, pero como **caché**, no como fuente de
verdad: cubre el hueco entre que arranca la app y que responde el disco, y es la
red de seguridad cuando el guardado falla.

## Por qué una carpeta y no un archivo

Parece más simple pedir el `.json` con `showSaveFilePicker`. No lo es: un
`FileSystemFileHandle` **no da acceso a su directorio** —no existe
`getParent()`—, así que con un archivo suelto la app no puede escribir las
copias al lado. Y quedarse sin copias es exactamente lo que ya costó días de
trabajo una vez ([copias-seguridad.md](copias-seguridad.md)).

## Dónde NO funciona

`showDirectoryPicker` existe **solo en Chrome, Edge y Opera de escritorio**.

| Navegador | Soporte |
|---|---|
| Chrome / Edge / Opera (escritorio) | Sí |
| Firefox | No |
| Safari | No |
| Cualquiera en móvil, Chrome Android incluido | No |

No es algo que se pueda rellenar con un polyfill: no hay otra forma de escribir
en el disco del usuario desde una página web. En esos navegadores la app arranca
sobre la caché de `localStorage` y lo dice en el pie de la barra lateral
(«Solo lectura en este navegador»).

**Esto es el precio de la arquitectura, y es un precio real:** la app dejó de
funcionar en el teléfono. Se aceptó a cambio de que los datos sean un archivo
del usuario y no una base de datos de un tercero.

## El arranque

`arrancarApp()` (config.js), en `DOMContentLoaded`:

1. `loadAll()` — la caché local primero, para poder pintar aunque el disco falle.
2. `reconectarCarpeta()` — sin gesto del usuario. Devuelve:
   - `'listo'` → se entra a la app.
   - `'permiso'` → la carpeta se recuerda pero el navegador exige un clic;
     la puerta muestra **Abrir mi carpeta**.
   - `'ninguna'` → la puerta muestra **Elegir carpeta de datos**.
3. `cargarDeArchivo()` vuelca el JSON en STATE, y `mostrarApp()`.

El handle de la carpeta se guarda en IndexedDB, que es la única forma de no
volver a pedirla en cada visita. Lo que **no** sobrevive siempre es el permiso:
`requestPermission()` fuera de un gesto falla, y por eso `reconectarCarpeta()`
no lo pide por su cuenta — gastar ahí el intento dejaría al usuario sin forma de
reconectar.

## Las tres reglas

Son las que sostienen que esto no pierda datos.

**1. Una escritura a la vez.** `createWritable()` reemplaza el contenido del
archivo. Dos escrituras solapadas dejan un JSON a medias, y un JSON a medias es
la base de datos entera. `_cola` las serializa encadenando promesas.

**2. Nunca escribir un estado vacío sobre un archivo con datos.** Un fallo que
deje STATE en blanco no puede convertirse en un archivo en blanco.
`_esBorradoSospechoso()` lee el archivo antes de escribir y cancela si tiene
trámites y STATE no. El vaciado legítimo —«Borrar todos mis datos»— pasa por
`autorizarVaciado()`, que es **de un solo uso**: dejarla puesta desarmaría la
defensa para el resto de la sesión.

**3. Detectar cambios de fuera.** Si el archivo cambió desde la última vez que lo
miramos —la carpeta está en Drive/Dropbox y escribió otro equipo, o alguien
editó el JSON a mano—, se guarda `copias/conflicto-<hora>.json` con lo que había
antes de pisarlo.

## La marca de cambios sin guardar

Igual que cuando los datos estaban en Firestore, y por el mismo motivo.

`saveAll()` escribe `localStorage` **primero** y el archivo después, así que la
caché nunca va por detrás. Si el guardado no llega a completarse, la marca
`juritask_pendiente` se queda puesta —solo la levanta una escritura terminada— y
`cargarDeArchivo()` sabe que la copia local manda: **fusiona en vez de
reemplazar** (`_fusionarConLocal`), conservando lo local y añadiendo del archivo
solo lo que la caché no conoce.

El precio, explícito: un trámite borrado con la caché desincronizada puede
reaparecer. Frente a perder una jornada de trabajo, un trámite de vuelta se
borra en un clic.

El aviso `#syncEstado`, en el pie de la barra lateral, es lo que hace que un
fallo de guardado se vea el mismo día en vez de descubrirse una semana después.

## Al modificar

- Cualquier código que toque `STATE` debe llamar a `saveAll()`. Es la única
  obligación, y ya lo era cuando esto iba contra Firestore.
- **Ninguna escritura directa con `createWritable()` fuera de `_escribir()`**,
  salvo las copias, que escriben archivos distintos. Saltarse `_cola` es
  reintroducir la escritura solapada.
- Al añadir un campo al JSON, sube `ARCHIVO_VERSION` y deja la migración en
  `migrateTramite()` (storage.js), que corre sobre lo que venga del archivo.
- La carpeta debería estar en algo que se sincronice o se respalde fuera del
  equipo. Las copias diarias están **en el mismo disco que el original**: no
  protegen de que el disco muera.
