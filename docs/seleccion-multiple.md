# Proceso: Selección múltiple y acciones en lote

Permite seleccionar varios trámites y aplicarles acciones en bloque
(terminar / eliminar).

## Archivos

- `js/selection.js` → modo selección, barra flotante de acciones, estado `_selMode`.
- `css/style.css` → estilos de tarjeta seleccionada y barra flotante.

## Entrada al modo selección

- **Long-press** sobre una tarjeta (táctil y ratón).
- **Ctrl/Cmd + clic** en una tarjeta (escritorio).

Una barra flotante muestra el conteo y las acciones disponibles.

## Acciones en lote

Terminar o eliminar varios trámites a la vez. Cada lote llama a
`pushHistory(...)` **una sola vez**, de modo que "Deshacer" revierte el lote
completo de golpe.

## Al modificar

Mantén el `pushHistory` único por lote (no por elemento) para que el deshacer
sea coherente.
