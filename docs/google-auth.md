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

`ensureGoogleToken()` muestra un toast y devuelve `null`. Los flujos que
dependen de él quedan inertes:

- Revisar el correo para detectar trámites nuevos (botón ✉️).
- Borrador de correo por tarea.
- Bitácora de envíos y su vigilancia automática.
- Google Drive Picker.

**Lo que no se pierde es lo que importa**: el parseo de los correos de
notificación (`parseTramiteEmail`, los regex, `MODULO_PREFIX_ALIAS`), las
plantillas institucionales de `plantillas-correo.js` y los prompts de Gemini
siguen intactos. Eso es justo lo que se porta al servidor.

## Qué cambia en la Fase 4

`ensureGoogleToken()` pasa a pedir el token al servidor:

```js
GOOGLE.accessToken = await srv('getOAuthToken');   // ScriptApp.getOAuthToken()
```

Y el resto del código no se entera. Las llamadas `fetch` a
`gmail.googleapis.com` pueden quedarse en el cliente con ese token, o migrar al
servicio avanzado `Gmail` del lado del servidor — decisión de esa fase.

## Al modificar

No añadas otra vía de obtener el token. Si un módulo nuevo necesita hablar con
una API de Google, que pase por `ensureGoogleToken()`: el valor de este archivo
es ser el **único** sitio que cambia cuando llegue el servidor.
