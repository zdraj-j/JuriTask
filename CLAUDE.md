# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JuriTask is a vanilla JS single-page application for legal task management ("trámites"). It has no build system, no framework, no package manager, and no test suite. Development is done by opening `index.html` directly in a browser.

## Architecture

### No build step
There is no compilation, bundling, or transpilation. Edit the files and refresh the browser. All JS files are loaded via `<script>` tags in `index.html`.

### Script load order (critical)
The order in `index.html` is mandatory — later modules depend on globals defined by earlier ones:
```
storage.js → tramites.js → filters.js → ui.js → calendar.js → auth.js → firebase.js → dashboard.js → config.js
```

### Global state
`STATE` (defined in `storage.js`) is the single source of truth. It holds:
- `STATE.tramites[]` — array of all tramite objects
- `STATE.order[]` — manual drag-and-drop ordering
- `STATE.config` — app settings (abogados/collaborators, modules, colors, theme, etc.)

All modules read and write directly to this global. After any mutation, call `saveAll()` then `renderAll()`.

### Dual persistence
- **Offline**: `localStorage` keys `juritask_tramites`, `juritask_order`, `juritask_config`
- **Cloud**: Firestore at `users/{uid}/tramites` and `users/{uid}/meta/config`
- When Firebase is loaded, `saveAll()` automatically delegates to `saveConfigDebounced()` (firebase.js). Without Firebase, it writes to `localStorage` directly.

### Tramite data model
Key fields on a tramite object:
- `id`, `tipo` (`'abogado'` | `'propio'`), `scope` (`'private'` | `'team'`)
- `vencimiento` (ISO date string `YYYY-MM-DD`), `terminado` (bool), `terminadoEn` (ISO)
- `seguimiento[]` — array of subtasks, each with `descripcion`, `fecha`, `responsable`, `estado`, `urgente`
- `notas[]` — free-text notes
- `gestion` — `{ analisis: bool, cumplimiento: bool }`
- `abogado` — key string matching an entry in `STATE.config.abogados`
- `_sharedFrom`, `_sharedFromName` — populated on team-shared tramites received from other users

### Firebase / Auth flow
- Firebase SDK loaded via CDN in `index.html` (not npm)
- `AUTH` object (firebase.js) wraps `firebase.auth()` for login/register/logout/profile
- Users require: email verified **and** `approved: true` in their Firestore `/users/{uid}` doc
- Admin role (`role: 'admin'`) is set manually in Firestore; admins can approve/block users and generate invitation codes
- Invitation codes live at `/invitations/{id}` — validated on registration before creating the account
- Team tramites sync via `/teams/{teamId}` documents; members share a team config

### Module responsibilities
| File | Responsibility |
|---|---|
| `storage.js` | `STATE`, `DEFAULT_CONFIG`, `saveAll()`, `loadAll()`, `migrateTramite()`, undo history |
| `tramites.js` | CRUD helpers, date utilities (`today()`, `formatDate()`, `dateClass()`), `abogadoName()`, `escapeHtml()` |
| `filters.js` | `renderAll()` — applies active filters/sort to `STATE.tramites` and delegates rendering |
| `ui.js` | DOM rendering: tramite cards, modals, detail panel, config screen, report, themes, drag-and-drop |
| `calendar.js` | Monthly calendar view, renders tramites as day-cell chips |
| `auth.js` | Auth form UI: login/register/forgot-password/profile modal; calls `AUTH.*` methods |
| `firebase.js` | Firebase init, `AUTH` object, Firestore sync (real-time listener, writes), team management, backups |
| `dashboard.js` | Admin dashboard: user list, approval/blocking, invitation generation, usage stats |
| `config.js` | App init (`init()`), view switching (`switchView()`), all event listener bindings |

### Rendering pattern
`renderAll()` (filters.js) is the main re-render entry point. It filters `STATE.tramites`, applies sort, then calls UI functions to build and inject HTML strings. The app does not use a virtual DOM — it rebuilds innerHTML for each render.

### Date handling
All dates are stored as `YYYY-MM-DD` strings (never `Date` objects in state). `today()` and `tomorrow()` use a 1-second cache. `dateClass()` returns `'overdue'|'today'|'soon'|'upcoming'` used as CSS classes.

### Firestore security model
Double gate: `emailVerified == true` AND `approved == true` (set by admin). See `firebase.rules` for the full ruleset. The exception is the initial profile creation (no verification needed at that instant).
