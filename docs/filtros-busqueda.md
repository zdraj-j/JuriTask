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
| `filterScope` | alcance: `private` (mis trámites) / `team` (equipo) |

El predicado combina todos en AND. La búsqueda de texto corre sobre número y
descripción.

## Detalles

- `updateAbogadoSelects()` mezcla **miembros del equipo de Firestore**
  (`_teamMembers`) con **colaboradores manuales** de `config.abogados`, evitando
  duplicados.
- `buildRespOptions(tipoTramite, abogadoKey, selectedValue)` arma las opciones
  de responsable para una tarea (equipo + colaborador del trámite + "Yo").
- `#filterScopeWrap` solo se muestra cuando hay trámites de equipo.

## Al modificar

Las migraciones antiguas (`storage.js`) normalizan `responsable` `'auxiliar'`/
`'propio'` → `'yo'`. Mantén esa equivalencia al agregar lógica de responsables.
