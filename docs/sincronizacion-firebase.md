# Proceso: Sincronización con Firebase

Inicializa Firebase, gestiona la sesión y sincroniza trámites y config con
Firestore. La app funciona sin Firebase (modo local); si está presente, se
añade sync en la nube.

## Archivos

- `js/firebase.js` → `firebaseConfig`, init de Auth/Firestore, carga inicial de
  trámites y config, `saveTramiteFS`, borrado, gestión de equipos (`_teamMembers`).
- `firebase.rules` → reglas de seguridad de Firestore.
- `js/auth.js` → UI de login/registro (ver [autenticacion.md](autenticacion.md)).

## Modelo en Firestore

- `users/{uid}/tramites/{id}` — trámites de cada usuario.
- `users/{uid}` — perfil + config.
- Trámites compartidos: se escriben/leen también en el espacio del destinatario
  según `abogado` / `_sharedFrom` / `sharedWith` (ver lógica en `firebase.js`
  alrededor del guardado y borrado).

## Flujo

1. Si `firebase` no está definido → arranque local inmediato (`loadAll`).
2. Con sesión: se cargan trámites y config remotos (fusionados con
   `DEFAULT_CONFIG`), se pueblan selects de módulos/abogados y se renderiza.
3. `saveTramiteFS(t)` persiste un trámite individual; se llama desde
   `_persistTramite` (agenda) y demás flujos de escritura.

## Reglas (resumen)

- Solo el propio usuario lee/escribe sus documentos; excepción: crear/leer el
  **propio** perfil solo requiere estar autenticado.
- No se permite `list` global de `/users/`.

## Al modificar

`config` remota se fusiona siempre como `{ ...DEFAULT_CONFIG, ...remota }` con
copias de `abogados`/`modulos`. Si añades campos de config nuevos, no asumas que
existen en documentos antiguos.
