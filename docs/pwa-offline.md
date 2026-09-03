# Proceso: PWA / offline

JuriTask es instalable y funciona offline a nivel de app-shell.

## Archivos

- `sw.js` → Service Worker (cacheo del esqueleto de la app).
- `manifest.json` → metadatos de la PWA (nombre, iconos, colores, display).

## Service Worker

- `VERSION = 'juritask-v25'`; caches `*-shell` y `*-runtime`.
- `SHELL_ASSETS` lista los recursos propios (HTML, CSS, JS, iconos) que forman
  el esqueleto offline.
- El shell es lo único que se cachea. `isDynamicApi()` deja pasar a la red,
  sin tocar, las llamadas a Auth y a las APIs de Google: servir una respuesta
  vieja de cualquiera de ellas daría una sesión fantasma o correo que ya no
  está.
- **Los datos no pasan por aquí en absoluto.** Viven en un JSON del disco
  ([archivo-datos.md](archivo-datos.md)), al que se llega por la File System
  Access API y no por `fetch`, así que la app funciona sin conexión por
  construcción y el service worker no tiene que hacer nada al respecto.

## El «offline» de la PWA y el navegador

Conviene no confundir dos cosas que ahora divergen:

- **La app funciona offline** en Chrome/Edge de escritorio: el shell viene de la
  caché y los datos, del disco. No hace falta red para nada salvo el correo.
- **En el teléfono, Firefox o Safari la app se instala y abre, pero no guarda
  datos**, porque `showDirectoryPicker` no existe ahí. Se queda en modo lectura
  sobre `localStorage` y lo avisa en el pie de la barra lateral.

El manifiesto sigue declarando `portrait-primary` por herencia de cuando la app
era realmente de móvil. Cambiarlo no arreglaría nada —el límite es la API, no el
manifiesto—, pero conviene saber por qué está ahí.

## Manifest

`display: standalone`, orientación `portrait-primary`, `theme_color` `#3d5af1`,
iconos 192/512 + maskable en `assets/logo/`.

## Al modificar

- Al cambiar recursos del shell, **sube `VERSION`** para invalidar la caché
  antigua; si no, los usuarios verán archivos viejos.
- Añade cualquier archivo nuevo del shell (p. ej. un JS nuevo) a `SHELL_ASSETS`.
