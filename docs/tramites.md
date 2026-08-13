# Proceso: Trámites (CRUD y dominio)

Núcleo de la app. Un *trámite* es un expediente jurídico con vencimiento,
etapas de gestión y una lista de tareas de seguimiento.

## Archivos

- `js/tramites.js` → helpers de dominio y CRUD (`getById`, `esPropio`,
  `computeEtapa`, `proximaFechaSeguimiento`, `abogadoName`,
  `crearTareaRequerimiento`, orden manual drag&drop, export/import config).
- `js/ui.js` → render de tarjetas (`renderAll`, render de listas por vista),
  modal de detalle (`openDetail`), alta/edición y tareas (`_tareasIniciales`).
- `index.html` → vistas `#view-all`, `#view-today`, `#view-finished`, modales.

## Modelo de datos (trámite)

```
{
  id, numero, descripcion, modulo,
  tipo: 'propio' | 'abogado' | 'equipo',
  abogado,                 // clave del abogado responsable si no es propio
  fechaVencimiento,        // 'YYYY-MM-DD'
  gestion: { analisis?: bool, cumplimiento?: bool },
  terminado: bool,
  seguimiento: [ {
    descripcion, fecha, responsable, estado: 'pendiente'|'realizado',
    urgente: bool, attachments: [], assignedTo: [uid], completedBy: {}
  } ],
  sharedWith: [uid], _sharedFrom   // compartición en equipo
}
```

## Etapas

`computeEtapa(t)` → `'gestion'` mientras no haya `gestion.cumplimiento`, luego
`'seguimiento'`. El ciclo visible es **análisis → cumplimiento → terminado**,
representado por los 3 `progress-segment` de la tarjeta (`active-1/2/3`).

## Helpers clave

- `esPropio(t)` → `t.tipo === 'propio'`.
- `proximaFechaSeguimiento(t)` → fecha pendiente más próxima.
- `abogadoName(key, tramite)` → nombre legible (resuelve `'yo'`, UID propio,
  miembros de equipo de Firestore, colaboradores manuales de config).
- `crearTareaRequerimiento(t)` → al marcar cumplimiento, agenda automáticamente
  una tarea ("1er req" a N días) si `config.autoReq` está activo.

## Al modificar

- Las fechas son cadenas `YYYY-MM-DD` comparadas con `<`/`<=`. No uses `Date`.
- `seguimiento` puede no existir en trámites importados/migrados: usa
  `(t.seguimiento || [])` y `if (!Array.isArray(...))`.
- Cualquier escritura debe pasar por `saveAll()` y, con Firebase, `saveTramiteFS(t)`.
