# Proceso: Filtros y búsqueda

Filtra y busca trámites en las vistas de lista, y puebla los selects de módulos
y abogados.

## Archivos

- `js/filters.js` → `populateModuloSelects()`, `updateAbogadoSelects()`,
  `buildRespOptions()`, lectura de filtros activos y predicado de filtrado.
- `index.html` → barra lateral `#sidebarFilters` con `#filterTipo`,
  `#filterAbogado`, `#filterModulo`, `#filterResponsable`, `#filterEtapa`,
  `#filterScope` (+ `#filterScopeWrap`).
- `js/config.js` → re-render al cambiar cualquier filtro.

## Filtros disponibles

| Select | Campo del trámite |
|---|---|
| `filterTipo` | `tipo` (propio/abogado/equipo) |
| `filterAbogado` | `abogado` |
| `filterModulo` | `modulo` |
| `filterResponsable` | `seguimiento[].responsable` (alguna tarea) |
| `filterEtapa` | `computeEtapa(t)` |

El predicado combina todos en AND. La búsqueda de texto corre sobre número y
descripción.

## Detalles

- `updateAbogadoSelects()` puebla los selects desde `config.abogados`.
- `buildRespOptions(tipoTramite, abogadoKey, selectedValue)` arma las opciones
  de responsable de una tarea: "Yo" más el colaborador del trámite, si lo hay.

## Buscador de la topbar

`#searchInput` + `#searchClear` (la ✕). Puntos delicados:

- La visibilidad de la ✕ se decide **solo** en `syncSearchClear()` (config.js);
  llámala siempre que cambie el valor del input por código (`switchView`,
  `clearFilters`, `runSearch`), nunca la toques a mano.
- La ✕ se atiende por **delegación sobre `.search-wrap`** y en `pointerdown`,
  no en `click`. El `click` del ratón solo se emite si `mousedown` y `mouseup`
  resuelven al mismo elemento, de modo que depende de que nada altere ese nodo
  entre ambos eventos; el click sintético del toque no tiene esa condición, que
  es la diferencia entre "falla a veces" en escritorio y "siempre funciona" en
  móvil. `pointerdown` no depende de ese par. El `click` se sigue escuchando
  para el teclado, filtrando por `e.detail === 0` (Enter/Espacio no generan
  `pointerdown`), así no se ejecuta dos veces por un mismo gesto.
- `Esc` dentro del input también limpia (`clearSearch()`).
- `.topbar-center` necesita `min-width: 0`; sin eso el ancho intrínseco del input
  desborda la barra y empuja los botones de la derecha fuera de la pantalla.

## Al modificar

Las migraciones antiguas (`storage.js`) normalizan `responsable` `'auxiliar'`/
`'propio'` → `'yo'`. Mantén esa equivalencia al agregar lógica de responsables.
