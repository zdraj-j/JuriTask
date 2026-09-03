# Proceso: Estado, almacenamiento e historial

Fuente única de verdad en memoria + persistencia local + migraciones + deshacer.

## Archivos

- `js/storage.js` → `STATE`, `DEFAULT_CONFIG`, `THEMES`, `saveAll`/`loadAll`,
  migraciones, `pushHistory`/`undo`, `purgeExpiredFinished`.

## STATE

```
STATE = {
  tramites: [],   // todos los trámites en memoria
  order:    [],   // orden manual de ids
  config:   { ...DEFAULT_CONFIG }   // preferencias del usuario
}
```

`config` incluye: `abogados`, `modulos`, `plantillas`, `columns`, `detailMode`,
`sortBy`, `theme`, auto-requerimiento (`autoReq`, `autoReqTexto`, `autoReqDias`,
`autoReqResponsable`) y **`agendaScope`** (filtro de la Agenda,
ver [agenda.md](agenda.md)).

## Persistencia

- `saveAll()` vuelca `STATE` a `localStorage` con debounce de 400 ms
  (`saveAll(true)` fuerza el volcado inmediato) y dispara además la escritura de
  `juritask.json`, que espera 600 ms
  ([archivo-datos.md](archivo-datos.md)). Es el **único** punto desde el que se
  guarda.
- El orden importa y es siempre el mismo: `localStorage` primero, el archivo
  después. Por eso la caché nunca va por detrás del archivo, que es lo que hace
  correcta la fusión al cargar.
- `loadAll()` carga de `localStorage` aplicando migraciones (p. ej. normaliza
  `responsable` `'auxiliar'`/`'propio'` → `'yo'`, y migra `proximaAccion` →
  `seguimiento`).

### Las claves

| Clave | Qué guarda |
|---|---|
| `juritask_tramites` | `STATE.tramites` |
| `juritask_order` | `STATE.order` |
| `juritask_config` | `STATE.config` |
| `juritask_pendiente` | `{ desde }` — hay cambios que el archivo todavía no tiene |

`juritask_pendiente` la pone `saveAll()` en cuanto algo cambia y **solo** la
quita una escritura del archivo terminada. Es lo que impide que la carga del día
siguiente pise trabajo que no llegó al disco; el mecanismo completo está en
[archivo-datos.md](archivo-datos.md#la-marca-de-cambios-sin-guardar).

## La identidad de un trámite

`t.id` es la clave con la que `getById`, el borrado y el orden manual lo
encuentran, y la que decide si dos entradas son el mismo trámite.

Con Firestore era además el nombre del documento, y un trámite sin `id` acababa
guardándose en un documento nuevo en cada subida: la lista amanecía con el mismo
trámite repetido cientos de veces. Esa causa concreta se fue con Firestore, pero
`dedupeTramites()` y la asignación de `id` en `migrateTramite()` se quedan,
porque las entradas sin `id` siguen llegando por dos puertas abiertas: los JSON
importados o antiguos, y `juritask.json` editado a mano —que es justamente la
gracia de esta arquitectura—.

Por eso:

- `migrateTramite()` asigna un `id` a todo trámite que no lo traiga. Es la
  primera línea de la función a propósito.
- `dedupeTramites(lista)` quita copias antes de que entren a `STATE`: mismo
  `id`, o —para las que perdieron el suyo— mismo `numero`, conservando la copia
  más completa. Lo usan `loadAll()` y la importación de JSON.
- `dedupeOrder(order)` hace lo propio con el orden manual, que es un conjunto
  de ids: repetirlos no significa nada.

## Historial / Deshacer

`pushHistory(etiqueta)` toma un snapshot antes de una mutación; `undo()` lo
restaura. Los toasts de acciones (completar tarea, marcar cumplido, lotes)
ofrecen "Deshacer" apoyándose en esto.

## Al modificar

- Para añadir una preferencia nueva: agrégala a `DEFAULT_CONFIG` (así existe
  para usuarios actuales) y léela con fallback `STATE.config.x || valor`.
- `purgeExpiredFinished()` limpia trámites terminados pasado su periodo de
  retención al arrancar.
