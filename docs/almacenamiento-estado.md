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

- `saveAll()` vuelca `STATE` a `localStorage` con debounce de 400 ms y, **si hay
  servidor**, además lo manda a Drive con debounce de 2,5 s. `saveAll(true)`
  fuerza ambos. Los detalles del segundo destino, en
  [datos-drive.md](datos-drive.md).
- `sincronizarConServidor()` corre **después** del primer render: la app pinta
  con la caché local y luego, si Drive tiene datos, los sustituye y repinta.
- `loadAll()` carga de `localStorage` aplicando migraciones (p. ej. normaliza
  `responsable` `'auxiliar'`/`'propio'` → `'yo'`, y migra `proximaAccion` →
  `seguimiento`).

## Historial / Deshacer

`pushHistory(etiqueta)` toma un snapshot antes de una mutación; `undo()` lo
restaura. Los toasts de acciones (completar tarea, marcar cumplido, lotes)
ofrecen "Deshacer" apoyándose en esto.

## Al modificar

- Para añadir una preferencia nueva: agrégala a `DEFAULT_CONFIG` (así existe
  para usuarios actuales) y léela con fallback `STATE.config.x || valor`.
- `purgeExpiredFinished()` limpia trámites terminados pasado su periodo de
  retención al arrancar.
