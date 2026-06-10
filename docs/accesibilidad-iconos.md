# Proceso: Accesibilidad e iconos

Dos utilidades transversales que actúan sobre todo el DOM sin tocar cada flujo.

## Accesibilidad — `js/a11y.js`

IIFE que aplica accesibilidad de forma global:

1. **Espejo `title` → `aria-label`** en botones solo-icono (los lectores de
   pantalla no anuncian `title` de forma fiable).
2. **Focus-trap** dentro del modal abierto + restauración del foco al cerrarlo.

Se apoya en que los modales se muestran/ocultan con la clase `open`. Selectores:
`OPEN_MODAL_SEL` (lo abierto) y `WATCH_SEL` (lo observado): overlays, confirmaciones,
popover de perfil, panel de notificaciones y hoja móvil `#mobSheet`.

## Iconos — `js/icons.js`

Integración de **Lucide**. Como la app genera mucho HTML por `innerHTML`, en
lugar de llamar `lucide.createIcons()` en cada render, un **MutationObserver con
debounce** materializa cualquier `<i data-lucide="...">` recién insertado.

`lucide.createIcons()` reemplaza el `<i>` por un `<svg>` (que ya no casa con
`[data-lucide]`), por lo que la operación converge y no entra en bucle.
`window.refreshIcons()` fuerza un pase (lo llaman renders como el de la Agenda).

## Al modificar

- Para iconos en HTML dinámico, basta con poner `<i data-lucide="nombre"></i>`;
  el observer lo convierte. Tras grandes inserciones, opcionalmente
  `window.refreshIcons()`.
- Nuevos contenedores modales deben usar la clase `open` para heredar el
  focus-trap, o añadirse a los selectores de `a11y.js`.
