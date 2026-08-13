# Proceso: Token OAuth de Google

Punto **único** por donde la app obtiene el token de acceso a Gmail, Drive y
Calendar. Hoy es un tope deliberado: devuelve `null` y avisa.

## Archivos

- `js/google-auth.js` → `GOOGLE.accessToken`, `ensureGoogleToken()`,
  `resetGoogleToken()`.
- Lo consumen `js/gmail.js` (`_ensureGmailToken`), `js/drive.js`
  (`_ensureDriveToken`) y `js/borradores.js` (la vigilancia de enviados).

## Por qué existe

Hasta la retirada de Firebase, el token lo daba **Firebase Auth**:

```js
const provider = new firebase.auth.GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
const result = await user.reauthenticateWithPopup(provider);
```

Sin Firebase el navegador se queda sin ese mecanismo. Montar un segundo OAuth
de cliente sería trabajo desechable: el sustituto previsto es el **servidor de
Apps Script**, que se autoriza una sola vez y expone el token con
`ScriptApp.getOAuthToken()`, sin popup, sin caducidad a 7 días y sin aviso de
"app no verificada".

Así que en vez de dejar cuatro sitios rotos, hay **una** función que centraliza
la decisión y un solo lugar que tocar en la Fase 4.

## Estado actual

**Con servidor** (Apps Script) ya funciona: `ensureGoogleToken()` pide el token
a `getOAuthToken()` en `Codigo.gs`, que devuelve `ScriptApp.getOAuthToken()`.
Sin popup y sin caducidad.

**Sin servidor** (navegador normal, desarrollo, pruebas) no hay token posible:
avisa y devuelve `null`.

## Quién lo usa realmente

Desde la Fase 4, **Gmail y Gemini ya no pasan por aquí**: sus llamadas salen del
servidor (`server/Correo.gs`, `server/Gemini.gs`) y el token no toca el
navegador.

Queda un consumidor de verdad: el **Google Drive Picker** (`js/drive.js`), que
es una biblioteca de cliente y necesita el token en la página. Para eso sirve
`getOAuthToken()` en `Codigo.gs`.

## Al modificar

No añadas otra vía de obtener el token. Si un módulo nuevo necesita hablar con
una API de Google, que pase por `ensureGoogleToken()`: el valor de este archivo
es ser el **único** sitio que cambia cuando llegue el servidor.
