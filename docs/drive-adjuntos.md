# Proceso: Adjuntos y Google Drive

Permite adjuntar archivos de Google Drive (vía Picker) y URLs a cada tarea de
seguimiento.

## Archivos

- `js/drive.js` → `initDrivePicker()`, integración con `gapi`/Google Picker,
  estado `_pickerApiLoaded` / `_pickerInited`.
- `js/ui.js` → render de `attachments` en el detalle de la tarea.

## Modelo

Cada item de `seguimiento` tiene un array `attachments` con archivos de Drive
(id, nombre, enlace) y/o URLs sueltas.

## Flujo

1. `initDrivePicker()` carga el Picker una sola vez (`_pickerInited` evita
   reinicializar).
2. El usuario selecciona archivos de Drive o pega una URL.
3. Los adjuntos se guardan en el `seguimiento` correspondiente y persisten con
   el trámite.

## Al modificar

El Picker depende de `gapi` cargado externamente; protege los accesos con
`typeof gapi !== 'undefined'`. Si Drive no está disponible, el resto de la app
debe seguir funcionando.
