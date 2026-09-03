# Proceso: Token OAuth de Google

Punto **único** por donde la app obtiene el token de acceso a Gmail y Drive.

## Archivos

- `js/google-auth.js` → `GOOGLE.accessToken`, `ensureGoogleToken()`,
  `resetGoogleToken()`.
- `js/firebase.js` → de donde sale el token: `AUTH.loginGoogle()` y
  `AUTH.refrescarTokenGoogle()`.
- Lo consumen `js/gmail.js` (`_ensureGmailToken`), `js/drive.js`
  (`_ensureDriveToken`) y `js/bitacora.js` (la vigilancia de enviados).

## De dónde sale el token

De la sesión de Firebase. `signInWithPopup` con el proveedor de Google
devuelve, junto a las credenciales de Firebase, un `accessToken` de Google con
los scopes que se pidieron:

```js
const p = new firebase.auth.GoogleAuthProvider();
p.addScope('https://www.googleapis.com/auth/drive.file');
p.addScope('https://www.googleapis.com/auth/gmail.modify');
const r = await auth.signInWithPopup(p);
r.credential.accessToken       // ← este
```

Ese es el que aceptan `gmail.googleapis.com` y el selector de Drive.

**Esta es la razón de que la app tenga login.** No hay usuarios que separar
—solo hay uno— pero sin sesión no hay token, y sin token no hay correo ni
adjuntos. Ver [autenticacion.md](autenticacion.md).

## El detalle que muerde: Firebase no lo renueva

El `accessToken` de Google llega **solo en el momento del login** y caduca en
torno a una hora. Firebase renueva su propio token de sesión, pero no este: la
sesión sigue viva mientras el token de Google ya está muerto.

Por eso el ciclo es:

1. Gmail responde **401**.
2. `resetGoogleToken()` lo borra.
3. La siguiente llamada a `ensureGoogleToken()` abre
   `reauthenticateWithPopup()`, que devuelve uno nuevo **sin cerrar la sesión**.

`_withGmailToken()` (gmail.js) ya implementa el reintento: llama, y si sale 401
pide token nuevo y repite una vez.

## Por qué todo pasa por aquí

`ensureGoogleToken()` es la única función que pide el token, y nadie lee
`AUTH.googleAccessToken` directamente. Así el reintento —y el popup, que es lo
molesto— vive en un solo sitio.

También hay un cerrojo: si dos módulos piden el token a la vez, comparten la
misma promesa. Dos `reauthenticateWithPopup` simultáneos se cancelan entre sí
con `auth/cancelled-popup-request`, y el usuario vería dos ventanas.

## Al modificar

- No añadas otra vía de obtener el token.
- El popup necesita un **gesto del usuario** para no ser bloqueado. Por eso la
  vigilancia automática de enviados (`checkBitacoraPendientes`) es silenciosa:
  si no hay token vigente no hace nada, en vez de abrir una ventana sola.
