# Proceso: PWA / offline

JuriTask es instalable y funciona offline a nivel de app-shell.

## Archivos

- `sw.js` → Service Worker (cacheo del esqueleto de la app).
- `manifest.json` → metadatos de la PWA (nombre, iconos, colores, display).

## Service Worker

- `VERSION = 'juritask-v24'`; caches `*-shell` y `*-runtime`.
- `SHELL_ASSETS` lista los recursos propios (HTML, CSS, JS, iconos) que forman
  el esqueleto offline.
- El shell es lo único que se cachea. `isDynamicApi()` deja pasar a la red,
  sin tocar, las llamadas a Firestore, a Auth y a las APIs de Google: servir
  una respuesta vieja de cualquiera de ellas daría datos obsoletos o una sesión
  fantasma. La persistencia offline de los datos la maneja el SDK de Firestore
  contra IndexedDB, no este cache.

## Manifest

`display: standalone`, orientación `portrait-primary`, `theme_color` `#3d5af1`,
iconos 192/512 + maskable en `assets/logo/`.

## Al modificar

- Al cambiar recursos del shell, **sube `VERSION`** para invalidar la caché
  antigua; si no, los usuarios verán archivos viejos.
- Añade cualquier archivo nuevo del shell (p. ej. un JS nuevo) a `SHELL_ASSETS`.
