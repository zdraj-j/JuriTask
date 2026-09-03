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
  (`saveAll(true)` fuerza el volcado inmediato) y dispara además la subida a
  Firestore, que espera 1200 ms
  ([sincronizacion-firestore.md](sincronizacion-firestore.md)). Es el **único**
  punto desde el que se sincroniza.
- `pausarGuardadoLocal()` corta la escritura en local de forma definitiva. Lo
  usa el cierre de sesión, porque el `beforeunload` de la recarga volvería a
  volcar `STATE` sobre el almacenamiento recién vaciado.
- `loadAll()` carga de `localStorage` aplicando migraciones (p. ej. normaliza
  `responsable` `'auxiliar'`/`'propio'` → `'yo'`, y migra `proximaAccion` →
  `seguimiento`).

### Las claves

| Clave | Qué guarda |
|---|---|
| `juritask_tramites` | `STATE.tramites` |
| `juritask_order` | `STATE.order` |
| `juritask_config` | `STATE.config` |
| `juritask_pendiente` | `{ desde }` — hay cambios que la nube todavía no tiene |

`juritask_pendiente` la pone `saveAll()` en cuanto algo cambia y **solo** la
quita un `commit()` confirmado por el servidor. Es lo que impide que la carga
del día siguiente pise trabajo que no llegó a subir; el mecanismo completo está
en
[sincronizacion-firestore.md](sincronizacion-firestore.md#la-marca-de-cambios-sin-subir).

El cierre de sesión borra las cuatro: dejar la marca sin la caché a la que se
refiere haría que la próxima sesión defendiera datos que ya no están.

## La identidad de un trámite

`t.id` es la clave con la que `getById`, el borrado y el orden manual lo
encuentran, y además **el nombre de su documento en Firestore**. Un trámite sin
`id` acababa guardándose en un documento nuevo en cada subida, y la lista
amanecía con el mismo trámite repetido cientos de veces
([sincronizacion-firestore.md](sincronizacion-firestore.md#el-id-no-es-opcional)).

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
