# Proceso: Autenticación (UI)

Interfaz de login, registro, recuperación de contraseña, perfil y logout. La
lógica de sesión real vive en `firebase.js`; aquí está la capa de UI.

## Archivos

- `js/auth.js` → `initAuthUI()` y manejadores de los formularios.
- `index.html` → formularios `#loginForm`, `#registerForm`, `#resetForm`,
  modal de perfil, popover de cuenta.
- `js/firebase.js` → Auth de Firebase (estado de sesión, `AUTH.userProfile`).

## Pantallas

- **Login** → email + contraseña.
- **Registro** → alta de usuario y creación de perfil.
- **Olvidé contraseña** (`#forgotPassBtn`) → envío de correo de reseteo.
- **Perfil** → editar nombre/datos visibles.
- **Logout**.

`clearAuthError()` / mostrar error gestionan el feedback de cada formulario.

## `AUTH.userProfile`

Objeto de sesión con `uid`, `displayName`, `email`. Lo usan muchos módulos para
saber "quién soy" (p. ej. el cálculo de `mine` en la [Agenda](agenda.md) y el
[Informe](informe.md), y `abogadoName`).

## Al modificar

Si la app corre sin Firebase, `AUTH` puede no existir: usa
`AUTH?.userProfile?.uid` con optional chaining, como hace el resto del código.
