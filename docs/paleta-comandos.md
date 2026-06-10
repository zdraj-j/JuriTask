# Proceso: Paleta de comandos y atajos de teclado

Acceso rápido por teclado a navegación y acciones.

## Archivos

- `js/commandpalette.js` → IIFE que registra la paleta y los atajos globales.
- `index.html` → overlay de la paleta (creado/gestionado por el módulo).

## Atajos globales

(Activos cuando el foco **no** está en un campo de texto.)

| Tecla | Acción |
|---|---|
| `Ctrl/Cmd + K` | abrir/cerrar la paleta |
| `?` | abrir la paleta |
| `n` | nuevo trámite |
| `/` | enfocar la búsqueda |

## Comandos de la paleta

Lista navegable con acciones como "Ir a: Agenda", "Ir a: Calendario", etc.
Cada comando ejecuta una función (p. ej. `go('agenda')` → `switchView('agenda')`).

## Al modificar

Para añadir un comando, agrégalo al array de comandos del módulo con su `icon`,
`label` y `run`. Si es navegación, usa el helper `go(view)`.
